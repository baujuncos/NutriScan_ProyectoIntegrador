'use server';

import { createClient } from '@/lib/supabase/server';
import { ATHLETE_ROLE } from '@/lib/researcher/athletes';
import { getWeekWindow } from '@/lib/researcher/compliance';
import ExcelJS from 'exceljs';
import { etiquetaDatoNutricional, macrosExportables } from '@/lib/datoNutricional';

type ProfileRow = {
  user_id: string;
  nombre: string;
  apellido: string;
  email: string;
  role: string;
  created_at: string;
};
type PhysicalRow = {
  user_id: string;
  peso_kg: number | null;
  altura_cm: number | null;
  fecha_nacimiento: string | null;
  sexo: string | null;
  factor_actividad: number | null;
  tmb: number | null;
  get_kcal: number | null;
  proteinas_g: number | null;
  carbohidratos_g: number | null;
  grasas_g: number | null;
};
type AcademicRow = {
  user_id: string;
  unidad_academica: string | null;
  carrera: string | null;
  anio: number | null;
  deporte: string | null;
  posicion: string | null;
  frecuencia_practicas_semana: number | null;
  horas_practica: number | null;
  frecuencia_competencias: string | null;
};
type SurveyRow = { user_id: string; respuestas: number[] | null; completed_at: string | null };
type RawItemRow = {
  id_item: number;
  id_alimento: number | null;
  id_alimento_barcode: number | null;
  /** NUT-119: de dónde salió el dato nutricional (null = ítem legado). */
  origen_macros: string | null;
  kcal_100g: number | null;
  cantidad: number;
  kcal: number;
  proteinas_g: number;
  grasas_g: number;
  carbs_g: number;
  nombre_manual: string | null;
  alimentos: { nombre: string; fuente?: string | null } | null;
  alimentos_barcode: { nombre: string } | null;
};
type RawIngestaWithItems = {
  id_ingesta: number;
  id_usuario: string;
  tipo: string;
  fecha: string;
  items: RawItemRow[];
};
type HidraRow = { id_usuario: string; fecha: string; ml_total: number };

const MEAL_LABELS: Record<string, string> = {
  desayuno: 'Desayuno', almuerzo: 'Almuerzo', merienda: 'Merienda',
  cena: 'Cena', colacion: 'Colación', suplemento: 'Suplemento',
};

const MEAL_ORDER = ['desayuno', 'almuerzo', 'merienda', 'cena', 'colacion', 'suplemento'] as const;

// Column layout:
// 1-4   DATOS DEL USUARIO
// 5-15  PERFIL FÍSICO
// 16-23 PERFIL ACADÉMICO / DEPORTIVO
// 24-30 VALORACIÓN PSICOLÓGICA
// 31-39 REGISTRO ALIMENTARIO (one row per food item; 39 = Dato nutricional, NUT-119)
// 40    HIDRATACIÓN (ml total)

export async function generateExcelAction(
  userIds: string[]
): Promise<{ xlsx: string } | { error: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado' };

  const { data: myProfile } = await supabase
    .from('profiles').select('role').eq('user_id', user.id).single();

  if (!myProfile || (myProfile.role !== 'investigador' && myProfile.role !== 'administrador')) {
    return { error: 'Acceso denegado' };
  }
  if (userIds.length === 0) return { error: 'Sin usuarios seleccionados' };

  const [profilesRes, physRes, acadRes, survRes, ingeRes, hidraRes] = await Promise.all([
    // Defense in depth: only ATHLETES can ever be exported, regardless of the
    // ids the client sent. Private/researcher users are excluded server-side.
    supabase.from('profiles')
      .select('user_id, nombre, apellido, email, role, created_at')
      .in('user_id', userIds).eq('role', ATHLETE_ROLE).order('created_at', { ascending: false }),
    supabase.from('physical_data')
      .select('user_id, peso_kg, altura_cm, fecha_nacimiento, sexo, factor_actividad, tmb, get_kcal, proteinas_g, carbohidratos_g, grasas_g')
      .in('user_id', userIds),
    supabase.from('academic_data')
      .select('user_id, unidad_academica, carrera, anio, deporte, posicion, frecuencia_practicas_semana, horas_practica, frecuencia_competencias')
      .in('user_id', userIds),
    supabase.from('psychological_surveys')
      .select('user_id, respuestas, completed_at')
      .in('user_id', userIds),
    supabase.from('ingestas')
      .select('id_ingesta, id_usuario, tipo, fecha, items(id_item, id_alimento, id_alimento_barcode, origen_macros, kcal_100g, cantidad, kcal, proteinas_g, grasas_g, carbs_g, nombre_manual, alimentos(nombre, fuente), alimentos_barcode(nombre))')
      .in('id_usuario', userIds).order('fecha', { ascending: true }),
    supabase.from('hidratacion')
      .select('id_usuario, fecha, ml_total')
      .in('id_usuario', userIds).order('fecha', { ascending: true }),
  ]);

  const profiles = (profilesRes.data ?? []) as ProfileRow[];
  if (profiles.length === 0) return { error: 'Sin deportistas para exportar' };

  // Only build data for the athlete ids that survived the role filter.
  const athleteIds = new Set(profiles.map((p) => p.user_id));
  const physMap = new Map(((physRes.data ?? []) as PhysicalRow[]).filter((p) => athleteIds.has(p.user_id)).map((p) => [p.user_id, p]));
  const acadMap = new Map(((acadRes.data ?? []) as AcademicRow[]).filter((a) => athleteIds.has(a.user_id)).map((a) => [a.user_id, a]));
  const survMap = new Map(((survRes.data ?? []) as SurveyRow[]).filter((s) => athleteIds.has(s.user_id)).map((s) => [s.user_id, s]));

  // userId → fecha → ingestas in meal type order
  const ingestas = (ingeRes.data ?? []) as unknown as RawIngestaWithItems[];
  const ingeByUser = new Map<string, Map<string, { tipo: string; items: RawItemRow[] }[]>>();
  for (const ing of ingestas) {
    if (!athleteIds.has(ing.id_usuario)) continue;
    if (!ingeByUser.has(ing.id_usuario)) ingeByUser.set(ing.id_usuario, new Map());
    const byDate = ingeByUser.get(ing.id_usuario)!;
    if (!byDate.has(ing.fecha)) byDate.set(ing.fecha, []);
    byDate.get(ing.fecha)!.push({ tipo: ing.tipo, items: ing.items ?? [] });
  }
  for (const byDate of ingeByUser.values()) {
    for (const [fecha, list] of byDate) {
      byDate.set(fecha, [...list].sort(
        (a, b) => MEAL_ORDER.indexOf(a.tipo as typeof MEAL_ORDER[number]) - MEAL_ORDER.indexOf(b.tipo as typeof MEAL_ORDER[number])
      ));
    }
  }

  // userId_fecha → ml total
  const hidraMap = new Map<string, number>();
  for (const h of (hidraRes.data ?? []) as HidraRow[]) {
    if (!athleteIds.has(h.id_usuario)) continue;
    hidraMap.set(`${h.id_usuario}_${h.fecha}`, Number(h.ml_total) || 0);
  }

  // Union of all dates per user (ingestas + hydration)
  const datesByUser = new Map<string, Set<string>>();
  for (const ing of ingestas) {
    if (!athleteIds.has(ing.id_usuario)) continue;
    if (!datesByUser.has(ing.id_usuario)) datesByUser.set(ing.id_usuario, new Set());
    datesByUser.get(ing.id_usuario)!.add(ing.fecha);
  }
  for (const h of (hidraRes.data ?? []) as HidraRow[]) {
    if (!athleteIds.has(h.id_usuario)) continue;
    if (!datesByUser.has(h.id_usuario)) datesByUser.set(h.id_usuario, new Set());
    datesByUser.get(h.id_usuario)!.add(h.fecha);
  }

  // ── Helper functions ────────────────────────────────────────────────────────
  function calcAge(fechaNacimiento: string | null): number | null {
    if (!fechaNacimiento) return null;
    const dob = new Date(fechaNacimiento);
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
    return age;
  }

  const PSYCH_DIM_NAMES = ['Confianza', 'Concentración', 'Ansiedad', 'Resiliencia', 'Motivación'];

  function calcPsychDims(respuestas: number[]): number[] {
    return PSYCH_DIM_NAMES.map((_, i) => {
      const slice = respuestas.slice(i * 5, i * 5 + 5);
      return slice.length > 0 ? Math.round((slice.reduce((s, v) => s + v, 0) / slice.length) * 100) / 100 : 0;
    });
  }

  function calcPsychScore(respuestas: number[]): number | null {
    return respuestas.length > 0
      ? Math.round((respuestas.reduce((s, v) => s + v, 0) / respuestas.length) * 20 * 10) / 10
      : null;
  }

  // ── Build workbook ──────────────────────────────────────────────────────────
  const COL_DATO_NUTRICIONAL = 39;
  const COL_HIDRATACION = 40;
  const TOTAL_COLS = COL_HIDRATACION;
  const STATIC_COLS = 30; // cols 1–30 merged vertically per athlete block

  const wb = new ExcelJS.Workbook();
  wb.creator = 'NutriScan';

  const ws = wb.addWorksheet('NutriScan Informe', {
    views: [{ state: 'frozen', ySplit: 4 }],
    properties: { defaultRowHeight: 18 },
  });

  // ── Row 1: Title ────────────────────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, TOTAL_COLS);
  const r1 = ws.getRow(1);
  r1.height = 36;
  const titleCell = r1.getCell(1);
  titleCell.value = 'NutriScan — Informe de Deportistas';
  titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // ── Row 2: Subtitle ─────────────────────────────────────────────────────────
  ws.mergeCells(2, 1, 2, TOTAL_COLS);
  const r2 = ws.getRow(2);
  r2.height = 20;
  const subCell = r2.getCell(1);
  subCell.value = `Generado el ${new Date().toLocaleDateString('es-AR')}  ·  ${profiles.length} deportista(s)`;
  subCell.font = { italic: true, size: 10, color: { argb: 'FF475569' }, name: 'Calibri' };
  subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F6FF' } };
  subCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // ── Row 3: Section headers ───────────────────────────────────────────────────
  const SECTIONS = [
    { label: 'DATOS DEL USUARIO',            start: 1,  end: 4,  argb: 'FF1D4ED8' },
    { label: 'PERFIL FÍSICO',                start: 5,  end: 15, argb: 'FF047857' },
    { label: 'PERFIL ACADÉMICO / DEPORTIVO', start: 16, end: 23, argb: 'FF6D28D9' },
    { label: 'VALORACIÓN PSICOLÓGICA',       start: 24, end: 30, argb: 'FFB91C1C' },
    { label: 'REGISTRO ALIMENTARIO',         start: 31, end: COL_DATO_NUTRICIONAL, argb: 'FFD97706' },
    { label: 'HIDRATACIÓN',                  start: COL_HIDRATACION, end: COL_HIDRATACION, argb: 'FF0891B2' },
  ];

  const r3 = ws.getRow(3);
  r3.height = 18;
  for (const s of SECTIONS) {
    if (s.start !== s.end) ws.mergeCells(3, s.start, 3, s.end);
    const c = r3.getCell(s.start);
    c.value = s.label;
    c.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: s.argb } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  // ── Row 4: Column headers ────────────────────────────────────────────────────
  const COL_HEADERS = [
    // usuario (4)
    'Nombre', 'Apellido', 'Email', 'Fecha Registro',
    // físico (11)
    'Peso (kg)', 'Altura (cm)', 'Fecha Nac.', 'Edad', 'Sexo',
    'Factor Act.', 'TMB', 'GET (kcal)', 'Meta Prot. (g)', 'Meta Carbs. (g)', 'Meta Grasas (g)',
    // académico (8)
    'Unidad Académica', 'Carrera', 'Año Ingreso', 'Deporte', 'Posición',
    'Prácticas/sem.', 'Hs Práctica', 'Freq. Competencia',
    // valoración psicológica (7)
    'Confianza', 'Concentración', 'Ansiedad', 'Resiliencia', 'Motivación',
    'Puntaje Total', 'Fecha Encuesta',
    // registro alimentario (9)
    'Fecha', 'Ingesta', 'Alimento', 'Cantidad (g)', 'Kcal', 'Prot. (g)', 'Grasas (g)', 'Carbs. (g)', 'Dato nutricional',
    // hidratación (1)
    'Hidratación (ml)',
  ];

  const COL_HEADER_COLORS = [
    ...Array(4).fill('FF1D4ED8'),
    ...Array(11).fill('FF047857'),
    ...Array(8).fill('FF6D28D9'),
    ...Array(7).fill('FFB91C1C'),
    ...Array(9).fill('FFD97706'),
    'FF0891B2',
  ];

  const r4 = ws.getRow(4);
  r4.height = 30;
  COL_HEADERS.forEach((h, i) => {
    const c = r4.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, size: 8, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COL_HEADER_COLORS[i] } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = { right: { style: 'thin', color: { argb: 'FF00000030' } } };
  });

  // ── Data rows ────────────────────────────────────────────────────────────────
  let ri = 5;

  const applyCell = (
    row: ExcelJS.Row,
    colIdx: number,
    val: ExcelJS.CellValue,
    bg: string,
  ) => {
    const c = row.getCell(colIdx);
    c.value = val;
    c.font = { size: 9, name: 'Calibri' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    c.alignment = { vertical: 'middle' };
    c.border = {
      top:    { style: 'thin', color: { argb: 'FFD1D5DB' } },
      left:   { style: 'thin', color: { argb: 'FFD1D5DB' } },
      right:  { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    };
  };

  for (const p of profiles) {
    const phys = physMap.get(p.user_id);
    const acad = acadMap.get(p.user_id);
    const surv = survMap.get(p.user_id);
    const respuestas: number[] = (surv?.respuestas as number[] | null) ?? [];
    const psychDims = calcPsychDims(respuestas);
    const psychScore = calcPsychScore(respuestas);

    const staticVals: ExcelJS.CellValue[] = [
      // usuario (4)
      p.nombre, p.apellido, p.email, p.created_at?.slice(0, 10) ?? '',
      // físico (11)
      phys?.peso_kg ?? '', phys?.altura_cm ?? '', phys?.fecha_nacimiento ?? '',
      calcAge(phys?.fecha_nacimiento ?? null) ?? '',
      phys?.sexo ?? '', phys?.factor_actividad ?? '', phys?.tmb ?? '',
      phys?.get_kcal ?? '', phys?.proteinas_g ?? '',
      phys?.carbohidratos_g ?? '', phys?.grasas_g ?? '',
      // académico (8)
      acad?.unidad_academica ?? '', acad?.carrera ?? '', acad?.anio ?? '',
      acad?.deporte ?? '', acad?.posicion ?? '',
      acad?.frecuencia_practicas_semana ?? '',
      acad?.horas_practica ?? '', acad?.frecuencia_competencias ?? '',
      // valoración psicológica (7)
      respuestas.length > 0 ? psychDims[0] : '',
      respuestas.length > 0 ? psychDims[1] : '',
      respuestas.length > 0 ? psychDims[2] : '',
      respuestas.length > 0 ? psychDims[3] : '',
      respuestas.length > 0 ? psychDims[4] : '',
      psychScore ?? '',
      surv?.completed_at?.slice(0, 10) ?? '',
    ];

    const userBg = (ri % 2 === 0) ? 'FFF8FAFC' : 'FFFFFFFF';
    const blockStart = ri;

    const writeRow = (
      fecha: string,
      tipo: string,
      foodName: string,
      cantidad: number | '',
      kcal: number | '',
      prot: number | '',
      grasas: number | '',
      carbs: number | '',
      hydration: number | '',
      isFirstOfAthlete: boolean,
      datoNutricional = '',
    ) => {
      const row = ws.getRow(ri);
      row.height = 16;
      if (isFirstOfAthlete) {
        staticVals.forEach((val, i) => applyCell(row, i + 1, val, userBg));
      }
      applyCell(row, 31, fecha, userBg);
      applyCell(row, 32, tipo, userBg);
      applyCell(row, 33, foodName, userBg);
      applyCell(row, 34, cantidad, userBg);
      applyCell(row, 35, kcal, userBg);
      applyCell(row, 36, prot, userBg);
      applyCell(row, 37, grasas, userBg);
      applyCell(row, 38, carbs, userBg);
      applyCell(row, COL_DATO_NUTRICIONAL, datoNutricional, userBg);
      applyCell(row, COL_HIDRATACION, hydration, userBg);
      ri++;
    };

    const dates = [...(datesByUser.get(p.user_id) ?? new Set<string>())].sort();

    if (dates.length === 0) {
      writeRow('', '', '', '', '', '', '', '', '', true);
    } else {
      let isFirstOfAthlete = true;
      for (const fecha of dates) {
        const hydration = hidraMap.get(`${p.user_id}_${fecha}`) ?? 0;
        const dateIngestas = ingeByUser.get(p.user_id)?.get(fecha) ?? [];
        let isFirstOfDate = true;
        const dateStartRow = ri;

        if (dateIngestas.length === 0) {
          writeRow(fecha, '', '', '', '', '', '', '', hydration || '', isFirstOfAthlete);
          isFirstOfAthlete = false;
          isFirstOfDate = false;
        } else {
          for (const ing of dateIngestas) {
            const tipoLabel = MEAL_LABELS[ing.tipo] ?? ing.tipo;
            if (ing.items.length === 0) {
              writeRow(
                fecha, tipoLabel, '', '', '', '', '', '',
                isFirstOfDate ? (hydration || '') : '',
                isFirstOfAthlete,
              );
              isFirstOfAthlete = false;
              isFirstOfDate = false;
            } else {
              for (const item of ing.items) {
                // NUT-119: descartados / sin datos / manuales salen con macros vacíos (no 0) y su origen explícito.
                const itemConFuente = { ...item, fuente_alimento: item.alimentos?.fuente ?? null };
                const macros = macrosExportables(itemConFuente);
                writeRow(
                  fecha, tipoLabel,
                  item.alimentos_barcode?.nombre ?? item.alimentos?.nombre ?? item.nombre_manual ?? 'Alimento desconocido',
                  Number(item.cantidad) || 0,
                  macros.kcal,
                  macros.proteinas,
                  macros.grasas,
                  macros.carbs,
                  isFirstOfDate ? (hydration || '') : '',
                  isFirstOfAthlete,
                  etiquetaDatoNutricional(itemConFuente),
                );
                isFirstOfAthlete = false;
                isFirstOfDate = false;
              }
            }
          }
        }

        // Merge hydration cell vertically across all rows of this date
        const dateEndRow = ri - 1;
        if (dateEndRow > dateStartRow) {
          ws.mergeCells(dateStartRow, COL_HIDRATACION, dateEndRow, COL_HIDRATACION);
          const hydCell = ws.getCell(dateStartRow, COL_HIDRATACION);
          hydCell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      }
    }

    const blockSize = ri - blockStart;

    // Merge static cols vertically for this athlete block
    if (blockSize > 1) {
      const blockEnd = blockStart + blockSize - 1;
      for (let col = 1; col <= STATIC_COLS; col++) {
        ws.mergeCells(blockStart, col, blockEnd, col);
        const cell = ws.getCell(blockStart, col);
        cell.alignment = { vertical: 'middle', wrapText: false };
      }
      // Visible separator border at the bottom of each athlete block
      for (let col = 1; col <= TOTAL_COLS; col++) {
        const cell = ws.getCell(blockStart + blockSize - 1, col);
        cell.border = {
          ...cell.border,
          bottom: { style: 'medium', color: { argb: 'FF9CA3AF' } },
        };
      }
    }
  }

  // ── Column widths ─────────────────────────────────────────────────────────
  const COL_WIDTHS = [
    14, 14, 28, 13,               // usuario
    9, 9, 13, 6, 6, 11, 7, 11, 14, 14, 13, // físico
    22, 20, 10, 12, 12, 12, 11, 18,          // académico
    11, 14, 11, 12, 12, 13, 13,              // psych
    13, 14, 28, 10, 9, 9, 9, 9, 18,          // alimentario (+ Dato nutricional)
    14,                                        // hidratación
  ];
  COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // ── Second worksheet: Psychological Survey Annex ──────────────────────────
  const SURVEY_QUESTIONS = [
    'Suelo tener problemas para concentrarme mientras compito.',
    'Tengo una gran confianza en mi técnica.',
    'Me llevo muy bien con otros miembros de mi equipo.',
    'En la mayoría de las competiciones confío en que lo haré bien.',
    'Cuando lo hago mal, suelo perder la concentración.',
    'Me importa más mi propio rendimiento que el rendimiento del equipo.',
    'Cuando cometo un error, me cuesta olvidarlo para concentrarme rápidamente en lo que tengo que hacer.',
    'Durante mi actuación en una competición, mi atención parece fluctuar una y otra vez entre lo que tengo que hacer y otras cosas.',
    'Me gusta trabajar con mis compañeros de equipo.',
    'Tengo frecuentes dudas respecto a mis posibilidades de hacerlo bien en una competición.',
    'Cuando comienzo haciéndolo mal, mi confianza baja rápidamente.',
    'Pienso que el espíritu de equipo es muy importante.',
    'Cuando me preparo para participar en una prueba (o para jugar un partido), intento imaginarme lo que veré, haré o notaré cuando la situación sea real.',
    'Cuando cometo un error en una competición me pongo muy ansioso.',
    'En este momento lo más importante en mi vida es hacerlo bien en mi deporte.',
    'Mi deporte es toda mi vida.',
    'Tengo fe en mí mismo/a.',
    'Cuando cometo un error durante una competición suele preocuparme lo que piensen otras personas como el entrenador, los compañeros de equipo o algún espectador.',
    'Creo que el aporte específico de todos los miembros de un equipo es sumamente importante para la obtención del éxito del equipo.',
    'No vale la pena dedicar tanto tiempo y esfuerzo como yo le dedico al deporte.',
    'A menudo pierdo la concentración durante una competición por preocuparme o ponerme a pensar en el resultado final.',
    'Suelo aceptar bien las críticas e intento aprender de ellas.',
    'Me cuesta aceptar que se destaque más la labor de otros miembros del equipo que la mía.',
    'Suelo establecer objetivos prioritarios antes de cada sesión de entrenamiento.',
    'Suelo confiar en mí mismo/a aun en los momentos más difíciles de una competición.',
  ];

  const ANNEX_TOTAL_COLS = 4 + SURVEY_QUESTIONS.length; // 29

  const wsAnnex = wb.addWorksheet('Anexo Encuesta Psicológica', {
    views: [{ state: 'frozen', ySplit: 3 }],
    properties: { defaultRowHeight: 18 },
  });

  // Annex row 1: Title
  wsAnnex.mergeCells(1, 1, 1, ANNEX_TOTAL_COLS);
  const aTitleRow = wsAnnex.getRow(1);
  aTitleRow.height = 32;
  const aTitleCell = aTitleRow.getCell(1);
  aTitleCell.value = 'NutriScan — Anexo Encuesta Psicológica';
  aTitleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
  aTitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
  aTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // Annex row 2: Subtitle
  wsAnnex.mergeCells(2, 1, 2, ANNEX_TOTAL_COLS);
  const aSubRow = wsAnnex.getRow(2);
  aSubRow.height = 18;
  const aSubCell = aSubRow.getCell(1);
  aSubCell.value = `Respuestas crudas (escala 1–5)  ·  Generado el ${new Date().toLocaleDateString('es-AR')}`;
  aSubCell.font = { italic: true, size: 10, color: { argb: 'FF475569' }, name: 'Calibri' };
  aSubCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F6FF' } };
  aSubCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // Annex row 3: Column headers
  const annexHeaders: string[] = [
    'Nombre', 'Apellido', 'Email', 'Fecha Registro',
    ...SURVEY_QUESTIONS,
  ];
  const r3Annex = wsAnnex.getRow(3);
  r3Annex.height = 60;
  annexHeaders.forEach((h, i) => {
    const c = r3Annex.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, size: 8, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i < 4 ? 'FF1D4ED8' : 'FFB91C1C' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = { right: { style: 'thin', color: { argb: 'FF00000030' } } };
  });

  // Annex data rows — only athletes who completed the survey
  let arIdx = 4;
  for (const p of profiles) {
    const surv = survMap.get(p.user_id);
    const respuestas: number[] = (surv?.respuestas as number[] | null) ?? [];
    if (respuestas.length === 0) continue;

    const rowBg = (arIdx % 2 === 0) ? 'FFF8FAFC' : 'FFFFFFFF';
    const aRow = wsAnnex.getRow(arIdx);
    aRow.height = 16;

    const annexStatic: ExcelJS.CellValue[] = [
      p.nombre, p.apellido, p.email, p.created_at?.slice(0, 10) ?? '',
    ];
    const borderStyle = {
      top: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
      left: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
      right: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
    };

    annexStatic.forEach((val, i) => {
      const c = aRow.getCell(i + 1);
      c.value = val;
      c.font = { size: 9, name: 'Calibri' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
      c.alignment = { vertical: 'middle' };
      c.border = borderStyle;
    });

    for (let q = 0; q < 25; q++) {
      const c = aRow.getCell(5 + q);
      c.value = respuestas[q] ?? '';
      c.font = { size: 9, name: 'Calibri' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.border = borderStyle;
    }
    arIdx++;
  }

  // Annex column widths
  wsAnnex.getColumn(1).width = 14;
  wsAnnex.getColumn(2).width = 14;
  wsAnnex.getColumn(3).width = 28;
  wsAnnex.getColumn(4).width = 13;
  for (let i = 5; i <= ANNEX_TOTAL_COLS; i++) {
    wsAnnex.getColumn(i).width = 20;
  }

  const buffer = await wb.xlsx.writeBuffer();
  return { xlsx: Buffer.from(buffer as ArrayBuffer).toString('base64') };
}

// ─── Athlete Detail ──────────────────────────────────────────────────────────

export interface MealItem {
  nombre: string;
  cantidad: number;
  kcal: number;
  /** kcal y macros del ítem; null si no hay dato (descartado, sin datos, manual): nunca se muestran como 0. */
  macros: { kcal: number; proteinas: number; grasas: number; carbs: number } | null;
  /** De dónde salió el dato nutricional: SARA2, ANMAT, IA (Gemini), Validado, etc. (NUT-119) */
  fuente: string;
}

export interface IngestaDetail {
  id_ingesta: number;
  tipo: string;
  fecha: string;
  kcal_total: number;
  items: MealItem[];
}

export interface WeeklyMealDay {
  day: string;   // 'Lun'|'Mar'|'Mié'|'Jue'|'Vie'|'Sáb'|'Dom'
  fecha: string; // YYYY-MM-DD
  count: number; // ingestas that day
}

export interface PsychDimension {
  dimension: string;
  value: number; // 0–5 average
}

export interface AthleteDetail {
  user_id: string;
  nombre: string;
  apellido: string;
  email: string;
  physical: {
    peso_kg: number | null;
    altura_cm: number | null;
    fecha_nacimiento: string | null;
    sexo: string | null;
    factor_actividad: number | null;
    tmb: number | null;
    get_kcal: number | null;
    proteinas_g: number | null;
    carbohidratos_g: number | null;
    grasas_g: number | null;
  } | null;
  academic: {
    unidad_academica: string | null;
    carrera: string | null;
    anio: number | null;
    deporte: string | null;
    posicion: string | null;
    frecuencia_practicas_semana: number | null;
    horas_practica: number | null;
    frecuencia_competencias: string | null;
  } | null;
  psychDimensions: PsychDimension[];
  psychScore: number | null; // mean of all 25 answers × 20
  weeklyMeals: WeeklyMealDay[];
  recentIngestas: IngestaDetail[];
}

const PSYCH_DIMS = ['Confianza', 'Concentración', 'Ansiedad', 'Resiliencia', 'Motivación'];
const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export async function getAthleteDetailAction(
  athleteId: string
): Promise<AthleteDetail | { error: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado' };

  const { data: myProfile } = await supabase
    .from('profiles').select('role').eq('user_id', user.id).single();
  if (!myProfile || (myProfile.role !== 'investigador' && myProfile.role !== 'administrador')) {
    return { error: 'Acceso denegado' };
  }

  const { data: athleteProfile } = await supabase
    .from('profiles')
    .select('user_id, nombre, apellido, email, role')
    .eq('user_id', athleteId)
    .eq('role', ATHLETE_ROLE)
    .single();
  if (!athleteProfile) return { error: 'Deportista no encontrado' };

  const now = new Date();
  const week = getWeekWindow(now);
  const tz = 'America/Argentina/Buenos_Aires';
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone: tz });

  const [physRes, acadRes, survRes, weekIngeRes, recentIngeRes] = await Promise.all([
    supabase
      .from('physical_data')
      .select('peso_kg, altura_cm, fecha_nacimiento, sexo, factor_actividad, tmb, get_kcal, proteinas_g, carbohidratos_g, grasas_g')
      .eq('user_id', athleteId)
      .single(),
    supabase
      .from('academic_data')
      .select('unidad_academica, carrera, anio, deporte, posicion, frecuencia_practicas_semana, horas_practica, frecuencia_competencias')
      .eq('user_id', athleteId)
      .single(),
    supabase
      .from('psychological_surveys')
      .select('respuestas')
      .eq('user_id', athleteId)
      .single(),
    supabase
      .from('ingestas')
      .select('tipo, fecha')
      .eq('id_usuario', athleteId)
      .gte('fecha', week.monday)
      .lte('fecha', week.today),
    supabase
      .from('ingestas')
      .select(`id_ingesta, tipo, fecha, kcal_total, items(id_item, id_alimento, id_alimento_barcode, origen_macros, kcal_100g, cantidad, kcal, proteinas_g, grasas_g, carbs_g, nombre_manual, alimentos(nombre, fuente), alimentos_barcode(nombre))`)
      .eq('id_usuario', athleteId)
      .in('fecha', [todayStr, yesterdayStr])
      .order('fecha', { ascending: false })
      .order('tipo', { ascending: true }),
  ]);

  // ── Psychological dimensions ───────────────────────────────────────────────
  const respuestas: number[] = (survRes.data?.respuestas as number[] | null) ?? [];
  const psychDimensions: PsychDimension[] = PSYCH_DIMS.map((dim, i) => {
    const slice = respuestas.slice(i * 5, i * 5 + 5);
    const avg = slice.length > 0 ? slice.reduce((s, v) => s + v, 0) / slice.length : 0;
    return { dimension: dim, value: Math.round(avg * 100) / 100 };
  });
  const psychScore =
    respuestas.length > 0
      ? Math.round((respuestas.reduce((s, v) => s + v, 0) / respuestas.length) * 20 * 10) / 10
      : null;

  // ── Weekly meal counts by day ──────────────────────────────────────────────
  const countByDate = new Map<string, number>();
  for (const ing of weekIngeRes.data ?? []) {
    const r = ing as { tipo: string; fecha: string };
    countByDate.set(r.fecha, (countByDate.get(r.fecha) ?? 0) + 1);
  }

  const weeklyMeals: WeeklyMealDay[] = [];
  const monday = new Date(week.monday + 'T00:00:00');
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const fecha = d.toLocaleDateString('en-CA');
    weeklyMeals.push({
      day: DAY_LABELS[d.getDay()],
      fecha,
      count: countByDate.get(fecha) ?? 0,
    });
  }

  // ── Recent ingestas (today + yesterday) ──────────────────────────────────
  type RawIngesta = {
    id_ingesta: number;
    tipo: string;
    fecha: string;
    kcal_total: number;
    items: {
      id_item: number;
      id_alimento: number | null;
      id_alimento_barcode: number | null;
      origen_macros: string | null;
      kcal_100g: number | null;
      cantidad: number;
      kcal: number;
      proteinas_g: number;
      grasas_g: number;
      carbs_g: number;
      nombre_manual: string | null;
      alimentos: { nombre: string; fuente?: string | null } | null;
      alimentos_barcode: { nombre: string } | null;
    }[];
  };

  const recentIngestas: IngestaDetail[] = ((recentIngeRes.data ?? []) as unknown as RawIngesta[]).map((ing) => ({
    id_ingesta: ing.id_ingesta,
    tipo: ing.tipo,
    fecha: ing.fecha,
    kcal_total: Number(ing.kcal_total) || 0,
    items: (ing.items ?? []).map((it) => {
      const exportable = {
        id_alimento: it.id_alimento,
        id_alimento_barcode: it.id_alimento_barcode,
        nombre_manual: it.nombre_manual,
        origen_macros: it.origen_macros,
        kcal_100g: it.kcal_100g,
        fuente_alimento: it.alimentos?.fuente ?? null,
        kcal: it.kcal,
        proteinas_g: it.proteinas_g,
        grasas_g: it.grasas_g,
        carbs_g: it.carbs_g,
      };
      const m = macrosExportables(exportable);
      return {
        nombre: it.alimentos_barcode?.nombre ?? it.alimentos?.nombre ?? it.nombre_manual ?? 'Alimento desconocido',
        cantidad: Number(it.cantidad) || 0,
        kcal: Number(it.kcal) || 0,
        // macrosExportables devuelve '' cuando no hay dato (descartado / sin datos / manual).
        macros:
          m.kcal === '' || m.proteinas === '' || m.grasas === '' || m.carbs === ''
            ? null
            : { kcal: m.kcal, proteinas: m.proteinas, grasas: m.grasas, carbs: m.carbs },
        fuente: etiquetaDatoNutricional(exportable),
      };
    }),
  }));

  return {
    user_id: athleteProfile.user_id,
    nombre: athleteProfile.nombre,
    apellido: athleteProfile.apellido,
    email: athleteProfile.email,
    physical: physRes.data ?? null,
    academic: acadRes.data ?? null,
    psychDimensions,
    psychScore,
    weeklyMeals,
    recentIngestas,
  };
}
