'use server';

/**
 * NUT-149 — Acciones del equipo de nutrición sobre la cola de revisión de
 * predicciones IA (`/revision-ia`): detalle con foto (UNA signed URL, recién
 * al abrir el ítem), Confirmar, Corregir y Marcar como candidato a ejemplo.
 *
 * Toda la escritura va por las RPCs `revision_ia_*` (security definer, chequean
 * el rol adentro). Ninguna toca los valores de Gemini ni los del usuario: el
 * nutricionista escribe sólo en `nutricionista_alimento` / `nutricionista_gramos`.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MAX_CANTIDAD } from '@/lib/nutrition';
import { TTL_URL_LISTA_S, urlsFirmadas } from '@/lib/fotosDeteccion';
import type { MotivoRevision } from '@/lib/revisionIa';

type Supabase = Awaited<ReturnType<typeof createClient>>;
type ErrorRpc = { message?: string; details?: string | null };

export type ResultadoError = { error: string };
export type AccionResultado = { ok: true } | ResultadoError;

/** Fila de `v_revision_ia`. */
export interface RevisionFila {
  id_deteccion_item: number;
  id_deteccion: number;
  item_uuid: string;
  alimento_ia: string;
  gramos_ia: number;
  confidence: number;
  motivos_revision: MotivoRevision[];
  item_quitado: boolean;
  estado_revision: 'pendiente' | 'confirmado' | 'corregido';
  revisado_por: string | null;
  revisado_en: string | null;
  nutricionista_alimento: string | null;
  nutricionista_gramos: number | null;
  candidato_ejemplo: boolean;
  created_at: string;
  id_usuario: string;
  imagen_path: string | null;
  vajilla_tipo: string;
  vajilla_diametro_cm: number;
  angulo_captura_grados: number;
  angulo_aproximado: boolean;
  /** null = el usuario quitó el ítem (no hay valor final). */
  alimento_usuario: string | null;
  gramos_usuario: number | null;
  origen_usuario: string | null;
  /** boundingBox del ítem (fracciones 0–1 de la foto); null en detecciones viejas o sin caja. */
  bbox_x?: number | null;
  bbox_y?: number | null;
  bbox_width?: number | null;
  bbox_height?: number | null;
  /** Nombre de quien revisó (null si nadie revisó). */
  revisor_nombre?: string | null;
}

export type RenovarFotoResultado = { ok: true; url: string } | ResultadoError;

// Ruta de Storage de una foto de detección: {id_usuario}/{uuid}.jpg
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const rutaFoto = z.string().regex(new RegExp(`^${UUID}/${UUID}\\.jpg$`, 'i'));

const id = z.number().int().positive();
const corregirSchema = z.object({
  id,
  alimento: z.string().trim().max(200).nullish().transform((v) => v || null),
  gramos: z.number().positive().max(MAX_CANTIDAD).nullish().transform((v) => v ?? null),
});
const candidatoSchema = z.object({ id, valor: z.boolean() });

export type CorregirInput = z.input<typeof corregirSchema>;

/** Sesión + `profiles.role` ∈ investigador/administrador (mismo patrón que /validacion). */
async function clienteInvestigador(): Promise<{ supabase: Supabase } | ResultadoError> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado' };

  const { data: myProfile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  if (!myProfile || (myProfile.role !== 'investigador' && myProfile.role !== 'administrador')) {
    return { error: 'Acceso denegado' };
  }
  return { supabase };
}

/** Traduce los `raise exception` de las RPCs `revision_ia_*`. */
function errorDeRpc(error: ErrorRpc): ResultadoError {
  switch (error.message) {
    case 'FORBIDDEN':
      return { error: 'Acceso denegado' };
    case 'NOT_FOUND':
      return { error: 'El ítem ya no está en la cola de revisión' };
    case 'ESTADO_INVALIDO':
      return { error: 'Este ítem ya fue revisado por otra persona' };
    case 'INVALID':
      return { error: 'Datos inválidos: ingresá un alimento y/o un peso mayor a 0' };
    default:
      console.error('Error en la RPC de revisión:', error);
      return { error: 'No se pudo completar la acción. Probá de nuevo.' };
  }
}

/**
 * Una signed URL nueva para una foto cuya URL venció (la lista las firma en lote, con 10 minutos de vida).
 * Sólo investigadores, y sólo rutas con el formato de las fotos de detección. La URL no se loguea.
 */
export async function renovarFotoAction(path: string): Promise<RenovarFotoResultado> {
  if (!rutaFoto.safeParse(path).success) return { error: 'Datos inválidos' };
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const urls = await urlsFirmadas(auth.supabase, [path], TTL_URL_LISTA_S);
  const url = urls.get(path);
  return url ? { ok: true, url } : { error: 'No se pudo cargar la foto' };
}

export async function confirmarRevisionAction(idItem: number): Promise<AccionResultado> {
  if (!id.safeParse(idItem).success) return { error: 'Datos inválidos' };
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const { error } = await auth.supabase.rpc('revision_ia_confirmar', { p_id: idItem });
  if (error) return errorDeRpc(error);

  revalidatePath('/revision-ia');
  return { ok: true };
}

export async function corregirRevisionAction(input: CorregirInput): Promise<AccionResultado> {
  const parsed = corregirSchema.safeParse(input);
  if (!parsed.success || (parsed.data.alimento === null && parsed.data.gramos === null)) {
    return { error: 'Datos inválidos: ingresá un alimento y/o un peso mayor a 0' };
  }
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const { error } = await auth.supabase.rpc('revision_ia_corregir', {
    p_id: parsed.data.id,
    p_alimento: parsed.data.alimento,
    p_gramos: parsed.data.gramos,
  });
  if (error) return errorDeRpc(error);

  revalidatePath('/revision-ia');
  return { ok: true };
}

/** Reabre un ítem ya revisado (vuelve a Pendientes y se borran los valores del investigador) para corregirlo de nuevo. */
export async function reabrirRevisionAction(idItem: number): Promise<AccionResultado> {
  if (!id.safeParse(idItem).success) return { error: 'Datos inválidos' };
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const { error } = await auth.supabase.rpc('revision_ia_reabrir', { p_id: idItem });
  if (error) return error.message === 'ESTADO_INVALIDO' ? { error: 'Este ítem ya está pendiente' } : errorDeRpc(error);

  revalidatePath('/revision-ia');
  return { ok: true };
}

/** Independiente de Confirmar/Corregir: sólo marca o desmarca `candidato_ejemplo`. No dispara ninguna automatización. */
export async function marcarCandidatoAction(idItem: number, valor: boolean): Promise<AccionResultado> {
  const parsed = candidatoSchema.safeParse({ id: idItem, valor });
  if (!parsed.success) return { error: 'Datos inválidos' };
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const { error } = await auth.supabase.rpc('revision_ia_marcar_candidato', { p_id: parsed.data.id, p_valor: parsed.data.valor });
  if (error) return errorDeRpc(error);

  revalidatePath('/revision-ia');
  return { ok: true };
}
