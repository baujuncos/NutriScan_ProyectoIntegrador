/**
 * NUT-163 — Validación del ángulo de inclinación del celular al sacar la foto.
 *
 * El overlay elíptico de `VajillaGuia` (NUT-162) dibuja un círculo visto en
 * oblicuo: `ry / rx = ESCORZO_OBLICUO`. La proyección de un círculo visto con la
 * cámara a una elevación `φ` sobre el plano de la mesa tiene `ry / rx = sin(φ)`,
 * así que el ángulo que pide el overlay es `φ ≈ asin(ESCORZO_OBLICUO) ≈ 34°`
 * sobre la mesa — deliberadamente NO cenital (una foto desde arriba pierde el
 * relieve, p. ej. una montaña de puré).
 *
 * `DeviceOrientationEvent.beta` mide la inclinación frente-atrás del dispositivo:
 * 0° = acostado con la pantalla hacia arriba (cámara trasera apuntando al piso,
 * vista cenital), 90° = vertical (cámara apuntando al horizonte). Con la cámara a
 * elevación `φ` sobre la mesa, `beta ≈ 90 - φ`.
 */

/** Debe coincidir con el `ry = rx * ESCORZO_OBLICUO` del overlay en VajillaSelector. */
export const ESCORZO_OBLICUO = 0.56;

/** Elevación objetivo de la cámara sobre el plano de la mesa, en grados (≈ 34). */
export const ELEVACION_OBJETIVO_DEG = Math.round((Math.asin(ESCORZO_OBLICUO) * 180) / Math.PI);

/** Valor objetivo de `DeviceOrientationEvent.beta`, en grados (≈ 56). */
export const BETA_OBJETIVO_DEG = 90 - ELEVACION_OBJETIVO_DEG;

/** Tolerancia aceptada alrededor del objetivo, en grados. Rango válido ≈ [44°, 68°]. */
export const TOLERANCIA_DEG = 12;

export type EstadoAngulo = 'ok' | 'muy_cenital' | 'muy_rasante' | 'desconocido';

export interface LecturaAngulo {
  estado: EstadoAngulo;
  /** `true` también para `'desconocido'`: sin datos no se molesta al usuario. */
  dentroDeRango: boolean;
  beta: number | null;
  /** Elevación estimada de la cámara sobre la mesa (para mensajes), en grados. */
  elevacionDeg: number | null;
}

/**
 * Evalúa el `beta` de un `DeviceOrientationEvent` contra el rango oblicuo.
 * `null` / `NaN` (sin sensor o sin permiso) → `'desconocido'` sin bloquear nada.
 */
export function evaluarAngulo(beta: number | null | undefined): LecturaAngulo {
  if (beta == null || Number.isNaN(beta)) {
    return { estado: 'desconocido', dentroDeRango: true, beta: null, elevacionDeg: null };
  }

  const elevacionDeg = Math.round(90 - beta);
  const desvio = beta - BETA_OBJETIVO_DEG;

  if (Math.abs(desvio) <= TOLERANCIA_DEG) {
    return { estado: 'ok', dentroDeRango: true, beta, elevacionDeg };
  }
  // beta por debajo del rango → celular más acostado → foto más cenital.
  // beta por encima del rango → celular más vertical → foto casi de costado.
  return {
    estado: desvio < 0 ? 'muy_cenital' : 'muy_rasante',
    dentroDeRango: false,
    beta,
    elevacionDeg,
  };
}

export function mensajeAngulo(estado: EstadoAngulo): string {
  switch (estado) {
    case 'ok':
      return 'Ángulo correcto';
    case 'muy_cenital':
      return 'Estás fotografiando muy desde arriba: incliná el celular hacia vos.';
    case 'muy_rasante':
      return 'El celular está muy vertical: inclinálo un poco hacia la mesa.';
    case 'desconocido':
    default:
      return '';
  }
}
