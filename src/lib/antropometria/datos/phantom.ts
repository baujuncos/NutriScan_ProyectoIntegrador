// Parámetros del modelo de proporcionalidad Phantom (Ross & Wilson), tal como figuran en la planilla de
// F. Holway. Origen: hoja 'Presentación', columna K ("Score-Z"): Z = (F − P) / S, con F = valor ajustado.
// P = media Phantom y S = desvío Phantom de cada variable; `exponente` es el d de (170,18 / talla)^d.
//
// La talla no tiene Z en la planilla (Presentación!E11 no tiene fórmula en K11), por eso no está acá.

import type { ClaveVariable } from '../variables';

/** Talla de referencia del Phantom (cm). Presentación!F10:F37, p. ej. F14 = E14*(170.18/$E$11). */
export const PHANTOM_TALLA_REFERENCIA_CM = 170.18;

/** Talla sentado de referencia del Phantom (cm). Presentación!K12 = (F12-89.92)/4.5; también Proc datos brutos!B67. */
export const PHANTOM_TALLA_SENTADO_REFERENCIA_CM = 89.92;

export interface ParametroPhantom {
  p: number;
  s: number;
  /** d = 3 para el peso (masa ∝ talla³), d = 1 para el resto. */
  exponente: 1 | 3;
  /** Celda de 'Presentación' de donde se extrajeron P y S. */
  celda: string;
}

export type ClavePhantom = Exclude<ClaveVariable, 'talla'>;

export const PHANTOM: Record<ClavePhantom, ParametroPhantom> = {
  peso: { p: 64.58, s: 8.6, exponente: 3, celda: 'Presentación!K10' },
  talla_sentado: { p: 89.92, s: 4.5, exponente: 1, celda: 'Presentación!K12' },

  diametro_biacromial: { p: 38.04, s: 1.92, exponente: 1, celda: 'Presentación!K14' },
  diametro_torax_transverso: { p: 27.92, s: 1.74, exponente: 1, celda: 'Presentación!K15' },
  diametro_torax_anteroposterior: { p: 17.5, s: 1.38, exponente: 1, celda: 'Presentación!K16' },
  diametro_biiliocrestideo: { p: 28.84, s: 1.75, exponente: 1, celda: 'Presentación!K17' },
  diametro_humeral: { p: 6.48, s: 0.35, exponente: 1, celda: 'Presentación!K18' },
  diametro_femoral: { p: 9.52, s: 0.48, exponente: 1, celda: 'Presentación!K19' },

  perimetro_cabeza: { p: 56, s: 1.44, exponente: 1, celda: 'Presentación!K21' },
  perimetro_brazo_relajado: { p: 26.89, s: 2.33, exponente: 1, celda: 'Presentación!K22' },
  perimetro_brazo_flexionado: { p: 29.41, s: 2.37, exponente: 1, celda: 'Presentación!K23' },
  perimetro_antebrazo: { p: 25.13, s: 1.41, exponente: 1, celda: 'Presentación!K24' },
  perimetro_torax_mesoesternal: { p: 87.86, s: 5.18, exponente: 1, celda: 'Presentación!K25' },
  perimetro_cintura: { p: 71.91, s: 4.45, exponente: 1, celda: 'Presentación!K26' },
  perimetro_caderas: { p: 94.67, s: 5.58, exponente: 1, celda: 'Presentación!K27' },
  perimetro_muslo_superior: { p: 55.82, s: 4.23, exponente: 1, celda: 'Presentación!K28' },
  // CORRECCIÓN VALIDADA con el equipo de nutrición: la celda K29 de la planilla calcula
  // (E29-53.2)/4.56 con el valor SIN ajustar; acá, como en el resto de las variables, se usa el ajustado
  // (F29-53.2)/4.56. P y S son los mismos que usa la planilla.
  perimetro_muslo_medial: { p: 53.2, s: 4.56, exponente: 1, celda: 'Presentación!K29' },
  perimetro_pantorrilla: { p: 35.25, s: 2.3, exponente: 1, celda: 'Presentación!K30' },

  pliegue_triceps: { p: 15.4, s: 4.47, exponente: 1, celda: 'Presentación!K32' },
  pliegue_subescapular: { p: 17.2, s: 5.07, exponente: 1, celda: 'Presentación!K33' },
  pliegue_supraespinal: { p: 15.4, s: 4.47, exponente: 1, celda: 'Presentación!K34' },
  pliegue_abdominal: { p: 25.4, s: 7.78, exponente: 1, celda: 'Presentación!K35' },
  // Este Z (fila 36) está bien en la planilla: usa el valor ajustado F36.
  pliegue_muslo_medial: { p: 27, s: 8.33, exponente: 1, celda: 'Presentación!K36' },
  pliegue_pantorrilla: { p: 16, s: 4.67, exponente: 1, celda: 'Presentación!K37' },
};
