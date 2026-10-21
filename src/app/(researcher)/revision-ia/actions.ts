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
import { urlsFirmadas } from '@/lib/fotosDeteccion';
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
}

export type RevisionDetalleResultado = { ok: true; fila: RevisionFila; fotoUrl: string | null } | ResultadoError;

const id = z.number().int().positive();
const corregirSchema = z.object({
  id,
  alimento: z.string().trim().max(200).nullish().transform((v) => v || null),
  gramos: z.number().positive().max(100_000).nullish().transform((v) => v ?? null),
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

/** Detalle de un ítem: la fila + UNA signed URL de la foto (TTL corto, ver `TTL_URL_FIRMADA_S`). */
export async function getRevisionDetalleAction(idItem: number): Promise<RevisionDetalleResultado> {
  if (!id.safeParse(idItem).success) return { error: 'Datos inválidos' };
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;
  const { supabase } = auth;

  const { data, error } = await supabase.from('v_revision_ia').select('*').eq('id_deteccion_item', idItem).single();
  if (error || !data) return { error: 'El ítem ya no está en la cola de revisión' };

  const fila = data as unknown as RevisionFila;
  const urls = fila.imagen_path ? await urlsFirmadas(supabase, [fila.imagen_path]) : new Map<string, string>();
  return { ok: true, fila, fotoUrl: fila.imagen_path ? urls.get(fila.imagen_path) ?? null : null };
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
