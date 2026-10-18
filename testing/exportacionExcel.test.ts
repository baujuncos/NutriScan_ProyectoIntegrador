/**
 * NUT-119 — La exportación de investigadores agrega la columna "Dato nutricional"
 * (39) y corre Hidratación a la 40; descartados / sin datos salen con macros vacíos.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));
const db = createSupabaseFromMock();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: db.from }),
}));

import { generateExcelAction } from '@/app/(researcher)/deportistas/actions';

const item = (over: Record<string, unknown>) => ({
  id_item: 1,
  id_alimento: null,
  id_alimento_barcode: null,
  origen_macros: null,
  kcal_100g: null,
  cantidad: 100,
  kcal: 0,
  proteinas_g: 0,
  grasas_g: 0,
  carbs_g: 0,
  nombre_manual: null,
  alimentos: null,
  alimentos_barcode: null,
  ...over,
});

beforeEach(() => {
  db.reset();
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'inv-1' } } });
  db.mockTable('profiles', { data: { role: 'investigador' }, error: null }); // rol del que exporta
  db.mockTable('profiles', {
    data: [{ user_id: 'dep-1', nombre: 'Ana', apellido: 'Pérez', email: 'a@ucc.edu.ar', role: 'deportista_ucc', created_at: '2026-01-01T00:00:00Z' }],
    error: null,
  });
  db.mockTable('physical_data', { data: [], error: null });
  db.mockTable('academic_data', { data: [], error: null });
  db.mockTable('psychological_surveys', { data: [], error: null });
  db.mockTable('ingestas', {
    data: [
      {
        id_ingesta: 1,
        id_usuario: 'dep-1',
        tipo: 'almuerzo',
        fecha: '2026-10-06',
        items: [
          item({ id_item: 1, id_alimento: 4, alimentos: { nombre: 'Arroz', fuente: 'SARA2' }, kcal: 130, proteinas_g: 2.7, grasas_g: 0.3, carbs_g: 28 }),
          item({ id_item: 2, nombre_manual: 'Flan', origen_macros: 'descartado' }),
          item({ id_item: 3, nombre_manual: 'Budín', origen_macros: 'sin_datos' }),
          item({ id_item: 4, nombre_manual: 'Tarta', origen_macros: 'pendiente', kcal_100g: 200, kcal: 300, proteinas_g: 10, grasas_g: 12, carbs_g: 30 }),
          item({ id_item: 5, id_alimento: 1000001, alimentos: { nombre: 'Galletitas', fuente: 'ANMAT' }, kcal: 450, proteinas_g: 6, grasas_g: 18, carbs_g: 65 }),
          item({ id_item: 6, nombre_manual: 'Yogur', origen_macros: 'estimado_ia', kcal_100g: 60, kcal: 90, proteinas_g: 4, grasas_g: 3, carbs_g: 9 }),
        ],
      },
    ],
    error: null,
  });
  db.mockTable('hidratacion', { data: [{ id_usuario: 'dep-1', fecha: '2026-10-06', ml_total: 750 }], error: null });
});

async function leerHoja() {
  const r = await generateExcelAction(['dep-1']);
  if ('error' in r) throw new Error(r.error);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(r.xlsx, 'base64') as never);
  return wb.getWorksheet('NutriScan Informe')!;
}

describe('exportación a Excel — Dato nutricional (NUT-119)', () => {
  it('agrega la columna 39 "Dato nutricional" y mueve Hidratación a la 40', async () => {
    const ws = await leerHoja();
    expect(ws.getRow(4).getCell(38).value).toBe('Carbs. (g)');
    expect(ws.getRow(4).getCell(39).value).toBe('Dato nutricional');
    expect(ws.getRow(4).getCell(40).value).toBe('Hidratación (ml)');
    expect(ws.getRow(3).getCell(31).value).toBe('REGISTRO ALIMENTARIO');
    expect(ws.getRow(3).getCell(40).value).toBe('HIDRATACIÓN');
  });

  it('cada ítem lleva su fuente (SARA2, ANMAT, IA…) y los descartados / sin datos salen con macros vacíos (no 0)', async () => {
    const ws = await leerHoja();
    const fila = (n: number) => ws.getRow(n);
    // filas de datos desde la 5: arroz, flan, budín, tarta
    expect(fila(5).getCell(33).value).toBe('Arroz');
    expect(fila(5).getCell(35).value).toBe(130);
    expect(fila(5).getCell(39).value).toBe('SARA2');

    expect(fila(6).getCell(33).value).toBe('Flan');
    expect(fila(6).getCell(35).value ?? '').toBe('');
    expect(fila(6).getCell(39).value).toBe('Descartado');

    expect(fila(7).getCell(39).value).toBe('Sin datos');
    expect(fila(7).getCell(36).value ?? '').toBe('');

    expect(fila(8).getCell(35).value).toBe(300);
    expect(fila(8).getCell(39).value).toBe('IA (pendiente de validación)');

    // la fuente real de cada dato: catálogo ANMAT y estimación de la IA
    expect(fila(9).getCell(33).value).toBe('Galletitas');
    expect(fila(9).getCell(39).value).toBe('ANMAT');
    expect(fila(10).getCell(39).value).toBe('IA (Gemini)');
    expect(fila(10).getCell(35).value).toBe(90);
  });

  it('la hidratación sigue en su celda (col 40) del día', async () => {
    const ws = await leerHoja();
    expect(ws.getRow(5).getCell(40).value).toBe(750);
  });
});
