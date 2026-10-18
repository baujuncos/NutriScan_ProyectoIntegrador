/**
 * NUT-154/156/166 — Llamada desde el cliente al endpoint combinado de
 * reconocimiento de alimentos + estimación de peso (épica NUT-12/NUT-119).
 * Una sola llamada por foto, sin refinamiento: las preguntas aclaratorias se
 * responden del lado del cliente (sesión 2), no disparan otra llamada.
 */
import type { EstadoAngulo } from '@/lib/anguloDispositivo';
import type { DetectionResponse, SaveRequest, SaveResponse } from '@/lib/deteccion';
import type { VajillaTipo } from '@/lib/vajilla';

export class ReconocimientoError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReconocimientoError';
    this.code = code;
  }
}

export interface LlamarReconocimientoParams {
  imagen: File;
  /** El endpoint sólo acepta platos con diámetro confirmado (nunca 'otro'). */
  vajilla: { tipo: Exclude<VajillaTipo, 'otro'>; diametroCm: number };
  angulo: { beta: number | null; estado: EstadoAngulo; dentroDeRango: boolean };
}

export async function llamarReconocimiento(
  params: LlamarReconocimientoParams,
): Promise<DetectionResponse> {
  const fd = new FormData();
  fd.set('image', params.imagen);
  fd.set('vajilla', JSON.stringify(params.vajilla));
  fd.set('angulo', JSON.stringify(params.angulo));

  const res = await fetch('/api/food-recognition', { method: 'POST', body: fd });
  const json = await res.json().catch(() => null);

  if (!res.ok || !json?.ok) {
    throw new ReconocimientoError(
      typeof json?.error === 'string' ? json.error : 'GEMINI_ERROR',
      typeof json?.message === 'string'
        ? json.message
        : 'No pudimos completar el reconocimiento. Probá de nuevo.',
    );
  }

  return {
    predictionId: json.predictionId,
    items: json.items,
    totalEstimatedWeightGrams: json.totalEstimatedWeightGrams,
  };
}

/**
 * NUT-172 — Envía las correcciones del usuario sobre una predicción (épica
 * NUT-119). NUT-119: el backend también registra los alimentos en el diario real
 * y nunca devuelve kcal/macros (solo contadores).
 */
export async function guardarCorrecciones(
  saveRequest: SaveRequest,
): Promise<Pick<SaveResponse, 'savedId' | 'diario'>> {
  const res = await fetch('/api/food-recognition/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(saveRequest),
  });
  const json = await res.json().catch(() => null);

  if (!res.ok || !json?.ok) {
    throw new ReconocimientoError(
      typeof json?.error === 'string' ? json.error : 'SAVE_ERROR',
      typeof json?.message === 'string' ? json.message : 'No pudimos guardar los cambios. Probá de nuevo.',
    );
  }

  return {
    savedId: String(json.savedId),
    diario: {
      itemsRegistrados: Number(json.diario?.itemsRegistrados) || 0,
      sinDatos: Number(json.diario?.sinDatos) || 0,
    },
  };
}
