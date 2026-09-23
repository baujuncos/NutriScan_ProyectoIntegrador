/**
 * NUT-154 + NUT-156 — Llamada desde el cliente al endpoint combinado de
 * reconocimiento de alimentos + estimación de peso (épica NUT-12).
 */
import type { EstadoAngulo } from '@/lib/anguloDispositivo';
import type { FoodDetectionResult, PreguntasPorIngrediente } from '@/lib/geminiFoodPrompt';
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
  preguntasPorIngrediente: PreguntasPorIngrediente;
  refinamiento?: {
    previousDetection: FoodDetectionResult;
    respuestaUsuario: { ingredient: string; respuesta: string };
  };
}

export async function llamarReconocimiento(
  params: LlamarReconocimientoParams,
): Promise<FoodDetectionResult> {
  const fd = new FormData();
  fd.set('image', params.imagen);
  fd.set('vajilla', JSON.stringify(params.vajilla));
  fd.set('angulo', JSON.stringify(params.angulo));
  fd.set('preguntasPorIngrediente', JSON.stringify(params.preguntasPorIngrediente));
  if (params.refinamiento) {
    fd.set('previousDetection', JSON.stringify(params.refinamiento.previousDetection));
    fd.set('respuestaUsuario', JSON.stringify(params.refinamiento.respuestaUsuario));
  }

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
    detectedIngredients: json.detectedIngredients,
    totalEstimatedWeightGrams: json.totalEstimatedWeightGrams,
  };
}
