'use server';

/**
 * NUT-119 — Acciones del investigador sobre la cola de validación
 * (`alimentos_pendientes_validacion`): Modificar (borrador), Validar y
 * Descartar, más el detalle que necesita la pantalla `/validacion`.
 *
 * Toda la escritura va por las RPCs `pendiente_*` (security definer, una
 * transacción, chequean el rol adentro). Acá se re-verifica el rol igual que
 * en `deportistas/actions.ts` para no llegar a la RPC si no corresponde, y se
 * validan los argumentos antes de llamarla.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { urlsFirmadas } from '@/lib/fotosDeteccion';
import { composicionSchema } from '@/lib/composicion';
import type { AlimentoOption } from '@/app/alimentacion/actions';
import {
  FUENTES_DATO,
  JUSTIFICACION_MIN,
  MENSAJE_ADVERTENCIA,
  MENSAJE_BLOQUEO,
  MOTIVO_RETIRO_MIN,
  type CodigoAdvertencia,
  type CodigoBloqueo,
  type FuenteDato,
} from '@/lib/verificacionAlimento';
import type { BoundingBox, ItemAnswer } from '@/lib/deteccion';

type Supabase = Awaited<ReturnType<typeof createClient>>;
type ErrorRpc = { message?: string; details?: string | null };

export type ResultadoError = { error: string };
export type ModificarResultado = { ok: true } | ResultadoError;
export type ValidarResultado =
  /** `idAlimento` es null cuando se valida un alimento nuevo: no se agrega al catálogo. */
  | { ok: true; idAlimento: number | null; itemsAfectados: number }
  | ResultadoError;
export type DescartarResultado = { ok: true; itemsAfectados: number } | ResultadoError;

export interface ExistenteCatalogo {
  origen: 'catalogo' | 'propio';
  id: number;
  nombre: string;
  fuente: string;
}

/** Resultado de la RPC `propio_verificar` (única fuente de verdad de las reglas en el servidor). */
export interface VerificacionPropio {
  bloqueos: Array<{ codigo: CodigoBloqueo; existente?: ExistenteCatalogo }>;
  advertencias: Array<{ codigo: CodigoAdvertencia; similares?: Array<ExistenteCatalogo & { similitud: number }> }>;
}

export interface PropioInfo {
  id: number;
  estado: 'activo' | 'retirado';
  fuenteDato: string;
  justificacion: string;
  motivoRetiro: string | null;
}

export type VerificarPropioResultado = ({ ok: true } & VerificacionPropio) | ResultadoError;
export type ValidarComoPropioResultado = { ok: true; idAlimentoPropio: number; itemsAfectados: number } | ResultadoError;
export type RetirarPropioResultado = { ok: true } | ResultadoError;

/** Fila de `v_alimentos_pendientes` (cola + ocurrencias). */
export interface PendienteFila {
  id_pendiente: number;
  nombre_original: string;
  nombre_normalizado: string;
  categoria_ia: string | null;
  gemini_kcal_100g: number | null;
  gemini_proteinas_100g: number | null;
  gemini_grasas_100g: number | null;
  gemini_carbs_100g: number | null;
  gemini_modelo: string | null;
  nombre_final: string | null;
  categoria_final: string | null;
  final_kcal_100g: number | null;
  final_proteinas_100g: number | null;
  final_grasas_100g: number | null;
  final_carbs_100g: number | null;
  id_alimento_vinculado: number | null;
  estado: 'pendiente' | 'validado' | 'descartado';
  observaciones: string | null;
  /** jsonb crudo de la cola; se lee con `restaurarComposicion` (puede ser null o de una versión vieja). */
  composicion: unknown;
  id_alimento_propio: number | null;
  resuelto_at: string | null;
  created_at: string;
  /** Ocurrencias CON foto (detección por imagen). */
  ocurrencias: number;
  ultima_ocurrencia: string | null;
  /** NUT-192: cómo se creó la entrada y cuántas cargas manuales (sin foto) y usuarios distintos tiene. */
  origen: 'ia' | 'manual';
  ocurrencias_manuales: number;
  usuarios_distintos: number;
}

export interface OcurrenciaDetalle {
  idGuardadoItem: number;
  fecha: string;
  deportista: string | null;
  nombreIa: string | null; // null = agregado a mano
  nombreFinal: string;
  gramosIa: number | null;
  gramosFinal: number;
  respuestas: ItemAnswer[];
  bbox: BoundingBox | null;
  fotoUrl: string | null;
  /** La primera ocurrencia del pendiente: su peso es el de referencia para la composición (ver migración 018). */
  esReferencia: boolean;
}

/** NUT-192: una carga manual (sin foto) vinculada a la entrada por items.id_pendiente. */
export interface SolicitudManual {
  idItem: number;
  fecha: string;
  deportista: string | null;
  /** Lo que escribió la persona. */
  nombre: string;
  gramos: number;
}

export type PendienteDetalleResultado =
  | {
      ok: true;
      pendiente: PendienteFila;
      ocurrencias: OcurrenciaDetalle[];
      totalOcurrencias: number;
      propio?: PropioInfo | null;
      /** Últimas cargas manuales (hasta MAX_OCURRENCIAS) y el total real (`pendiente.ocurrencias_manuales`). */
      solicitudesManuales?: SolicitudManual[];
      totalSolicitudesManuales?: number;
      /** Alimentos de SARA2/ANMAT con el mismo nombre normalizado (aviso no bloqueante). */
      existentesCatalogo?: ExistenteCatalogo[];
    }
  | ResultadoError;

/** Ocurrencias que se muestran en el detalle ("y N más" para el resto). */
const MAX_OCURRENCIAS = 20;

const id = z.number().int().positive();
const valor = z.number().min(0).max(100_000); // z.number() ya rechaza NaN/Infinity
const textoOpcional = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => v || null);

const formBase = {
  id,
  nombre: z.string().trim().min(1).max(200),
  categoria: textoOpcional(100),
  observaciones: textoOpcional(2000),
};
const composicion = composicionSchema.nullish().transform((v) => v ?? null);
const valorOpcional = valor.nullish().transform((v) => v ?? null);

const modificarSchema = z.object({
  ...formBase,
  kcal: valor.nullable(),
  proteinas: valor.nullable(),
  grasas: valor.nullable(),
  carbs: valor.nullable(),
  composicion,
});
// NUT-225: vínculo directo con un alimento existente (idAlimentoExistente, sin composición): los 4 valores
// salen de la fila de `alimentos`, que la acción relee en el servidor; lo que mande el cliente no se usa.
const esVinculoDirecto = (f: { idAlimentoExistente?: number | null; composicion: unknown }) =>
  f.idAlimentoExistente != null && f.composicion == null;

// En modo catálogo los 4 valores los calcula el servidor; en los demás casos son obligatorios
// (salvo el vínculo directo con un alimento existente).
const validarSchema = z
  .object({
    ...formBase,
    kcal: valorOpcional,
    proteinas: valorOpcional,
    grasas: valorOpcional,
    carbs: valorOpcional,
    idAlimentoExistente: id.nullish(),
    composicion,
  })
  .refine(
    (f) =>
      f.composicion?.modo === 'catalogo' ||
      [f.kcal, f.proteinas, f.grasas, f.carbs].every((v) => v !== null) ||
      esVinculoDirecto(f),
  );
const descartarSchema = z.object({ id, observaciones: textoOpcional(2000) });

const valorVerificacion = z.number().min(-100_000).max(100_000).nullable(); // el negativo llega a la RPC, que lo informa
const verificarSchema = z.object({
  nombre: z.string().max(200),
  kcal: valorVerificacion,
  proteinas: valorVerificacion,
  grasas: valorVerificacion,
  carbs: valorVerificacion,
});
const propioSchema = z.object({
  fuenteDato: z.enum(FUENTES_DATO.map((f) => f.valor) as [FuenteDato, ...FuenteDato[]]),
  justificacion: z.string().trim().min(JUSTIFICACION_MIN).max(1000),
  confirmaciones: z.object({
    reviseFuente: z.literal(true),
    valoresPor100g: z.literal(true),
    busqueExistente: z.literal(true),
  }),
  confirmaIncoherente: z.boolean().optional(),
  confirmaDistinto: z.boolean().optional(),
});
const validarComoPropioSchema = z.object({
  ...formBase,
  kcal: valor,
  proteinas: valor,
  grasas: valor,
  carbs: valor,
  propio: propioSchema,
});
const retirarSchema = z.object({ id, motivo: z.string().trim().min(MOTIVO_RETIRO_MIN).max(1000) });

export type ModificarInput = z.input<typeof modificarSchema>;
export type ValidarInput = z.input<typeof validarSchema>;
export type DescartarInput = z.input<typeof descartarSchema>;
export type VerificarPropioInput = z.input<typeof verificarSchema>;
export type ValidarComoPropioInput = z.input<typeof validarComoPropioSchema>;
export type RetirarPropioInput = z.input<typeof retirarSchema>;

/** Sesión + `profiles.role` ∈ investigador/administrador (patrón de deportistas/actions.ts). */
async function clienteInvestigador(): Promise<{ supabase: Supabase } | ResultadoError> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado' };

  const { data: myProfile } = await supabase
    .from('profiles').select('role').eq('user_id', user.id).single();
  if (!myProfile || (myProfile.role !== 'investigador' && myProfile.role !== 'administrador')) {
    return { error: 'Acceso denegado' };
  }
  return { supabase };
}


const TEXTO_EVALUACION: Record<string, string> = {
  fuente: 'Elegí la fuente del dato.',
  justificacion: `Escribí una justificación de al menos ${JUSTIFICACION_MIN} caracteres.`,
  confirmaciones: 'Marcá las tres confirmaciones.',
  motivo: `Escribí el motivo (al menos ${MOTIVO_RETIRO_MIN} caracteres).`,
};

/** `PROPIO_BLOQUEADO` trae en `details` el JSON de bloqueos de `propio_verificar`. */
function textoBloqueos(details: string | null | undefined): string {
  try {
    const bloqueos = JSON.parse(details ?? '[]') as Array<{ codigo: CodigoBloqueo; existente?: ExistenteCatalogo }>;
    const textos = bloqueos.map((b) =>
      b.codigo === 'DUPLICADO' && b.existente
        ? `Ya existe «${b.existente.nombre}» (${b.existente.fuente}). Usalo desde "Del catálogo".`
        : (MENSAJE_BLOQUEO[b.codigo] ?? 'Hay valores que no se pueden aceptar.'),
    );
    return textos.length > 0 ? textos.join(' ') : 'Hay valores que no se pueden aceptar.';
  } catch {
    return 'Hay valores que no se pueden aceptar.';
  }
}

/** Traduce los `raise exception` de las RPCs `pendiente_*`. */
function errorDeRpc(error: ErrorRpc): ResultadoError {
  switch (error.message) {
    case 'ESTADO_INVALIDO':
      return { error: 'Este alimento ya fue resuelto por otro investigador' };
    case 'FORBIDDEN':
      return { error: 'Acceso denegado' };
    case 'NOT_FOUND':
      return { error: 'El alimento pendiente no existe' };
    case 'ALIMENTO_NO_ENCONTRADO':
      return {
        error: error.details?.startsWith('propio:')
          ? 'Un alimento propio de la composición ya no está disponible (fue retirado). Quitalo de la lista.'
          : 'El alimento del catálogo elegido no existe',
      };
    case 'PROPIO_BLOQUEADO':
      return { error: textoBloqueos(error.details) };
    case 'PROPIO_ADVERTENCIA':
      return { error: `Falta confirmar: ${MENSAJE_ADVERTENCIA[error.details as CodigoAdvertencia] ?? 'revisá los avisos.'}` };
    case 'PROPIO_EVALUACION':
      return { error: TEXTO_EVALUACION[error.details ?? ''] ?? 'Completá la evaluación del alimento.' };
    case 'PROPIO_DUPLICADO':
      return { error: 'Otro investigador acaba de crear un alimento con ese nombre. Usalo desde "Del catálogo".' };
    case 'COMPOSICION_INVALIDA':
      return { error: error.details ? `La composición no es válida: ${error.details}` : 'La composición no es válida' };
    case 'INVALID':
      return { error: 'Datos inválidos' };
    default:
      console.error('Error en la RPC de validación:', error);
      return { error: 'No se pudo completar la acción. Probá de nuevo.' };
  }
}

export async function modificarPendienteAction(input: ModificarInput): Promise<ModificarResultado> {
  const parsed = modificarSchema.safeParse(input);
  if (!parsed.success) return { error: 'Datos inválidos' };
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const f = parsed.data;
  const { error } = await auth.supabase.rpc('pendiente_modificar', {
    p_id: f.id,
    p_nombre: f.nombre,
    p_categoria: f.categoria,
    p_kcal: f.kcal,
    p_prot: f.proteinas,
    p_grasas: f.grasas,
    p_carbs: f.carbs,
    p_observaciones: f.observaciones,
    p_composicion: f.composicion,
  });
  if (error) return { error: errorDeRpc(error).error };

  revalidatePath('/validacion');
  return { ok: true };
}

const CAMPOS_100G = ['kcal_100g', 'proteinas_100g', 'grasas_100g', 'carbs_100g'] as const;

/** Un valor presente: número finito (o numérico en texto, como llega `numeric`). Un 0 es válido; NULL o vacío, no. */
const esValorNumerico = (v: unknown) =>
  (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));

/**
 * NUT-225 — Relee el alimento al que se quiere vincular (nunca se confía en lo que manda el cliente) y
 * exige que exista y tenga los 4 valores por 100 g: la RPC no lo valida y dejaría la entrada validada con
 * valores nulos (y los ítems manuales sin completar).
 */
async function verificarAlimentoVinculable(supabase: Supabase, idAlimento: number): Promise<ResultadoError | null> {
  const { data, error } = await supabase
    .from('alimentos')
    .select(`id_alimento, ${CAMPOS_100G.join(', ')}`)
    .eq('id_alimento', idAlimento)
    .single();
  if (error && (error as { code?: string }).code !== 'PGRST116') {
    console.error('No se pudo leer el alimento a vincular:', error);
    return { error: 'No se pudo comprobar el alimento elegido. Probá de nuevo.' };
  }
  if (error || !data) return { error: 'El alimento elegido no existe' };
  const fila = data as unknown as Record<string, unknown>;
  if (!CAMPOS_100G.every((c) => esValorNumerico(fila[c]))) {
    return { error: 'El alimento elegido no tiene sus 4 valores nutricionales cargados: elegí otro' };
  }
  return null;
}

export async function validarPendienteAction(input: ValidarInput): Promise<ValidarResultado> {
  const parsed = validarSchema.safeParse(input);
  if (!parsed.success) return { error: 'Datos inválidos: nombre y los 4 valores por 100 g (≥ 0) son obligatorios' };
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const f = parsed.data;
  if (esVinculoDirecto(f)) {
    const invalido = await verificarAlimentoVinculable(auth.supabase, f.idAlimentoExistente!);
    if (invalido) return invalido;
  }
  const { data, error } = await auth.supabase.rpc('pendiente_validar', {
    p_id: f.id,
    p_nombre: f.nombre,
    p_categoria: f.categoria,
    p_kcal: f.kcal,
    p_prot: f.proteinas,
    p_grasas: f.grasas,
    p_carbs: f.carbs,
    p_observaciones: f.observaciones,
    p_id_alimento_existente: f.idAlimentoExistente ?? null,
    p_composicion: f.composicion,
  });
  if (error) return errorDeRpc(error);

  revalidatePath('/validacion');
  revalidatePath('/alimentacion'); // los ítems del diario (también los cargados manualmente) cambian de valores
  const r = data as { id_alimento: number | null; items_afectados: number };
  return { ok: true, idAlimento: r.id_alimento, itemsAfectados: r.items_afectados };
}

export async function descartarPendienteAction(input: DescartarInput): Promise<DescartarResultado> {
  const parsed = descartarSchema.safeParse(input);
  if (!parsed.success) return { error: 'Datos inválidos' };
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const { data, error } = await auth.supabase.rpc('pendiente_descartar', {
    p_id: parsed.data.id,
    p_observaciones: parsed.data.observaciones,
  });
  if (error) return { error: errorDeRpc(error).error };

  revalidatePath('/validacion');
  revalidatePath('/alimentacion'); // los ítems descartados dejan de mostrar valores
  return { ok: true, itemsAfectados: (data as { items_afectados: number }).items_afectados };
}

export async function verificarAlimentoPropioAction(input: VerificarPropioInput): Promise<VerificarPropioResultado> {
  const parsed = verificarSchema.safeParse(input);
  if (!parsed.success) return { error: 'Datos inválidos' };
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const f = parsed.data;
  const { data, error } = await auth.supabase.rpc('propio_verificar', {
    p_nombre: f.nombre,
    p_kcal: f.kcal,
    p_prot: f.proteinas,
    p_grasas: f.grasas,
    p_carbs: f.carbs,
  });
  if (error) return errorDeRpc(error);
  const v = data as VerificacionPropio;
  return { ok: true, bloqueos: v.bloqueos ?? [], advertencias: v.advertencias ?? [] };
}

export async function validarComoPropioAction(input: ValidarComoPropioInput): Promise<ValidarComoPropioResultado> {
  const parsed = validarComoPropioSchema.safeParse(input);
  if (!parsed.success) {
    return { error: 'Datos inválidos: completá el nombre, los 4 valores por 100 g, la fuente, la justificación y las 3 confirmaciones' };
  }
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const f = parsed.data;
  const { data, error } = await auth.supabase.rpc('pendiente_validar_como_propio', {
    p_id: f.id,
    p_nombre: f.nombre,
    p_categoria: f.categoria,
    p_kcal: f.kcal,
    p_prot: f.proteinas,
    p_grasas: f.grasas,
    p_carbs: f.carbs,
    p_observaciones: f.observaciones,
    p_propio: {
      fuente_dato: f.propio.fuenteDato,
      justificacion: f.propio.justificacion,
      confirmaciones: { revise_fuente: true, valores_por_100g: true, busque_existente: true },
      confirma_incoherente: f.propio.confirmaIncoherente ?? false,
      confirma_distinto: f.propio.confirmaDistinto ?? false,
    },
  });
  if (error) return errorDeRpc(error);

  revalidatePath('/validacion');
  revalidatePath('/alimentacion');
  const r = data as { id_alimento_propio: number; items_afectados: number };
  return { ok: true, idAlimentoPropio: r.id_alimento_propio, itemsAfectados: r.items_afectados };
}

export async function retirarAlimentoPropioAction(input: RetirarPropioInput): Promise<RetirarPropioResultado> {
  const parsed = retirarSchema.safeParse(input);
  if (!parsed.success) return { error: `Escribí el motivo (al menos ${MOTIVO_RETIRO_MIN} caracteres).` };
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const { error } = await auth.supabase.rpc('propio_retirar', { p_id: parsed.data.id, p_motivo: parsed.data.motivo });
  if (error) return errorDeRpc(error);

  revalidatePath('/validacion');
  return { ok: true };
}

/** Buscador de propios para "Del catálogo". Sólo investigadores; el diario de los deportistas no lo usa. */
export async function buscarAlimentosPropiosAction(query: string): Promise<AlimentoOption[]> {
  const q = query.trim().replace(/[*,\\]/g, '');
  if (q.length < 2) return [];
  const auth = await clienteInvestigador();
  if ('error' in auth) return [];

  const { data } = await auth.supabase
    .from('alimentos_propios')
    .select('id_alimento_propio, nombre, categoria, kcal_100g, proteinas_100g, grasas_100g, carbs_100g')
    .eq('estado', 'activo')
    .ilike('nombre', `%${q}%`)
    .order('nombre', { ascending: true })
    .limit(20);
  return ((data ?? []) as Array<{
    id_alimento_propio: number; nombre: string; categoria: string | null;
    kcal_100g: number; proteinas_100g: number; grasas_100g: number; carbs_100g: number;
  }>).map((p) => ({
    id_alimento: p.id_alimento_propio,
    nombre: p.nombre,
    categoria: p.categoria,
    fuente: 'PROPIO',
    marca: null,
    denominacion: null,
    kcal_100g: p.kcal_100g,
    proteinas_100g: p.proteinas_100g,
    grasas_100g: p.grasas_100g,
    carbs_100g: p.carbs_100g,
  }));
}

type OcurrenciaRaw = {
  id_guardado_item: number;
  name: string;
  grams: number;
  ai_grams: number | null;
  answers: ItemAnswer[] | null;
  created_at: string;
  detecciones_guardados: { id_usuario: string; detecciones_ia: { imagen_path: string | null } | null } | null;
  detecciones_ia_items: {
    ingredient: string;
    estimated_weight_grams: number;
    bbox_x: number | null;
    bbox_y: number | null;
    bbox_width: number | null;
    bbox_height: number | null;
  } | null;
};

type ManualRaw = {
  id_item: number;
  nombre_manual: string | null;
  cantidad: number | string;
  created_at: string;
  ingestas: { fecha: string; id_usuario: string } | null;
};

/**
 * Detalle de una fila de la cola para el modal de `/validacion`: la fila +
 * las últimas MAX_OCURRENCIAS ocurrencias con deportista, nombre/gramos IA vs.
 * final, respuestas, bbox y la foto (signed URLs en UNA llamada).
 */
export async function getPendienteDetalleAction(idPendiente: number): Promise<PendienteDetalleResultado> {
  if (!id.safeParse(idPendiente).success) return { error: 'Datos inválidos' };
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;
  const { supabase } = auth;

  const seleccion = () =>
    supabase
      .from('detecciones_guardados_items')
      .select(
        'id_guardado_item, name, grams, ai_grams, answers, created_at, ' +
          'detecciones_guardados(id_usuario, detecciones_ia(imagen_path)), ' +
          'detecciones_ia_items(ingredient, estimated_weight_grams, bbox_x, bbox_y, bbox_width, bbox_height)',
      )
      .eq('id_pendiente', idPendiente);
  const [pendienteRes, ocurrenciasRes, primeraRes, manualesRes] = await Promise.all([
    supabase.from('v_alimentos_pendientes').select('*').eq('id_pendiente', idPendiente).single(),
    seleccion().order('created_at', { ascending: false }).limit(MAX_OCURRENCIAS),
    // La foto de referencia es la PRIMERA ocurrencia (no cambia cuando aparecen más); puede no estar entre las últimas.
    seleccion().order('id_guardado_item', { ascending: true }).limit(1),
    // NUT-192: cargas manuales (sin foto) de esta entrada.
    supabase
      .from('items')
      .select('id_item, nombre_manual, cantidad, created_at, ingestas(fecha, id_usuario)')
      .eq('id_pendiente', idPendiente)
      .order('created_at', { ascending: false })
      .limit(MAX_OCURRENCIAS),
  ]);
  if (pendienteRes.error || !pendienteRes.data) return { error: 'El alimento pendiente no existe' };
  if (ocurrenciasRes.error || primeraRes.error) {
    console.error('No se pudieron leer las ocurrencias del pendiente:', ocurrenciasRes.error ?? primeraRes.error);
    return { error: 'No se pudo cargar el detalle' };
  }

  const primera = ((primeraRes.data ?? []) as unknown as OcurrenciaRaw[])[0];
  const recientes = (ocurrenciasRes.data ?? []) as unknown as OcurrenciaRaw[];
  // La referencia va primero (una sola vez, aunque también esté entre las más recientes).
  const raws = primera ? [primera, ...recientes.filter((r) => r.id_guardado_item !== primera.id_guardado_item)] : recientes;
  const manuales = ((manualesRes?.data ?? []) as unknown as ManualRaw[]);
  const userIds = [
    ...new Set([
      ...raws.map((r) => r.detecciones_guardados?.id_usuario),
      ...manuales.map((m) => m.ingestas?.id_usuario),
    ].filter((u): u is string => !!u)),
  ];
  const paths = [...new Set(raws.map((r) => r.detecciones_guardados?.detecciones_ia?.imagen_path).filter((p): p is string => !!p))];

  const nombreNormalizado = (pendienteRes.data as PendienteFila).nombre_normalizado;
  const resuelto = (pendienteRes.data as PendienteFila).estado !== 'pendiente';
  const [perfilesRes, urls, existentesRes] = await Promise.all([
    userIds.length > 0
      ? supabase.from('profiles').select('user_id, nombre, apellido').in('user_id', userIds)
      : Promise.resolve({ data: [] as unknown[] }),
    urlsFirmadas(supabase, paths),
    // Aviso no bloqueante: ¿ya existe en SARA2/ANMAT? (solo mientras está pendiente; usa la clave normalizada de la cola).
    resuelto
      ? Promise.resolve({ data: [] as unknown[] })
      : supabase.from('alimentos').select('id_alimento, nombre, fuente').eq('nombre_normalizado', nombreNormalizado).in('fuente', ['SARA2', 'ANMAT']).limit(3),
  ]);
  const nombres = new Map(
    ((perfilesRes.data ?? []) as Array<{ user_id: string; nombre: string; apellido: string }>).map((p) => [
      p.user_id,
      `${p.nombre} ${p.apellido}`.trim(),
    ]),
  );

  const ocurrencias: OcurrenciaDetalle[] = raws.map((r) => {
    const ia = r.detecciones_ia_items;
    const path = r.detecciones_guardados?.detecciones_ia?.imagen_path;
    const bbox =
      ia && ia.bbox_x != null && ia.bbox_y != null && ia.bbox_width != null && ia.bbox_height != null
        ? { x: Number(ia.bbox_x), y: Number(ia.bbox_y), width: Number(ia.bbox_width), height: Number(ia.bbox_height) }
        : null;
    return {
      idGuardadoItem: r.id_guardado_item,
      fecha: r.created_at,
      deportista: nombres.get(r.detecciones_guardados?.id_usuario ?? '') ?? null,
      nombreIa: ia?.ingredient ?? null,
      nombreFinal: r.name,
      gramosIa: r.ai_grams ?? ia?.estimated_weight_grams ?? null,
      gramosFinal: r.grams,
      respuestas: r.answers ?? [],
      bbox,
      fotoUrl: path ? urls.get(path) ?? null : null,
      esReferencia: primera != null && r.id_guardado_item === primera.id_guardado_item,
    };
  });

  const pendiente = pendienteRes.data as PendienteFila;
  let propio: PropioInfo | null = null;
  if (pendiente.id_alimento_propio != null) {
    const { data } = await supabase
      .from('alimentos_propios')
      .select('id_alimento_propio, estado, fuente_dato, justificacion, motivo_retiro')
      .eq('id_alimento_propio', pendiente.id_alimento_propio)
      .single();
    if (data) {
      propio = {
        id: data.id_alimento_propio,
        estado: data.estado,
        fuenteDato: data.fuente_dato,
        justificacion: data.justificacion,
        motivoRetiro: data.motivo_retiro,
      };
    }
  }
  const solicitudesManuales: SolicitudManual[] = manuales.map((m) => ({
    idItem: m.id_item,
    fecha: m.ingestas?.fecha ?? m.created_at,
    deportista: nombres.get(m.ingestas?.id_usuario ?? '') ?? null,
    nombre: m.nombre_manual ?? '',
    gramos: Number(m.cantidad),
  }));
  const existentesCatalogo: ExistenteCatalogo[] = (
    (existentesRes?.data ?? []) as Array<{ id_alimento: number; nombre: string; fuente: string }>
  ).map((a) => ({ origen: 'catalogo', id: a.id_alimento, nombre: a.nombre, fuente: a.fuente }));
  return {
    ok: true,
    pendiente,
    ocurrencias,
    totalOcurrencias: Number(pendiente.ocurrencias),
    propio,
    solicitudesManuales,
    totalSolicitudesManuales: Number(pendiente.ocurrencias_manuales ?? solicitudesManuales.length),
    existentesCatalogo,
  };
}
