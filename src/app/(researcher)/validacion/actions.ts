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
  resuelto_at: string | null;
  created_at: string;
  ocurrencias: number;
  ultima_ocurrencia: string | null;
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
}

export type PendienteDetalleResultado =
  | { ok: true; pendiente: PendienteFila; ocurrencias: OcurrenciaDetalle[]; totalOcurrencias: number }
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
const modificarSchema = z.object({
  ...formBase,
  kcal: valor.nullable(),
  proteinas: valor.nullable(),
  grasas: valor.nullable(),
  carbs: valor.nullable(),
});
const validarSchema = z.object({
  ...formBase,
  kcal: valor,
  proteinas: valor,
  grasas: valor,
  carbs: valor,
  idAlimentoExistente: id.nullish(),
});
const descartarSchema = z.object({ id, observaciones: textoOpcional(2000) });

export type ModificarInput = z.input<typeof modificarSchema>;
export type ValidarInput = z.input<typeof validarSchema>;
export type DescartarInput = z.input<typeof descartarSchema>;

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
      return { error: 'El alimento del catálogo elegido no existe' };
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
  });
  if (error) return { error: errorDeRpc(error).error };

  revalidatePath('/validacion');
  return { ok: true };
}

export async function validarPendienteAction(input: ValidarInput): Promise<ValidarResultado> {
  const parsed = validarSchema.safeParse(input);
  if (!parsed.success) return { error: 'Datos inválidos: nombre y los 4 valores por 100 g (≥ 0) son obligatorios' };
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const f = parsed.data;
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
  });
  if (error) return errorDeRpc(error);

  revalidatePath('/validacion');
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
  return { ok: true, itemsAfectados: (data as { items_afectados: number }).items_afectados };
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

  const [pendienteRes, ocurrenciasRes] = await Promise.all([
    supabase.from('v_alimentos_pendientes').select('*').eq('id_pendiente', idPendiente).single(),
    supabase
      .from('detecciones_guardados_items')
      .select(
        'id_guardado_item, name, grams, ai_grams, answers, created_at, ' +
          'detecciones_guardados(id_usuario, detecciones_ia(imagen_path)), ' +
          'detecciones_ia_items(ingredient, estimated_weight_grams, bbox_x, bbox_y, bbox_width, bbox_height)',
      )
      .eq('id_pendiente', idPendiente)
      .order('created_at', { ascending: false })
      .limit(MAX_OCURRENCIAS),
  ]);
  if (pendienteRes.error || !pendienteRes.data) return { error: 'El alimento pendiente no existe' };
  if (ocurrenciasRes.error) {
    console.error('No se pudieron leer las ocurrencias del pendiente:', ocurrenciasRes.error);
    return { error: 'No se pudo cargar el detalle' };
  }

  const raws = (ocurrenciasRes.data ?? []) as unknown as OcurrenciaRaw[];
  const userIds = [...new Set(raws.map((r) => r.detecciones_guardados?.id_usuario).filter((u): u is string => !!u))];
  const paths = [...new Set(raws.map((r) => r.detecciones_guardados?.detecciones_ia?.imagen_path).filter((p): p is string => !!p))];

  const [perfilesRes, urls] = await Promise.all([
    userIds.length > 0
      ? supabase.from('profiles').select('user_id, nombre, apellido').in('user_id', userIds)
      : Promise.resolve({ data: [] as unknown[] }),
    urlsFirmadas(supabase, paths),
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
    };
  });

  const pendiente = pendienteRes.data as PendienteFila;
  return { ok: true, pendiente, ocurrencias, totalOcurrencias: Number(pendiente.ocurrencias) };
}
