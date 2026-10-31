// Constantes del fraccionamiento de 5 masas de D. Kerr (1988), tal como están en 'Proc datos brutos'.
// Cada masa se obtiene de un Z Phantom propio y se convierte a kg con (Z × desvío + media) / factor³:
//   Z = (suma × factor − p) / s        masa = (Z × desvioKg + mediaKg) / factor³
// donde factor = 170,18 / talla (o 89,92 / talla sentado para la masa residual).

export interface ConstantesMasaKerr {
  /** Media Phantom de la suma de variables que alimenta la masa (cm o mm). */
  p: number;
  /** Desvío Phantom de esa suma. */
  s: number;
  /** Masa Phantom (kg). */
  mediaKg: number;
  /** Desvío de la masa Phantom (kg). */
  desvioKg: number;
  celdas: string;
}

export const KERR_ADIPOSA: ConstantesMasaKerr = {
  p: 116.41, s: 34.79, mediaKg: 25.6, desvioKg: 5.85,
  celdas: "Proc datos brutos!B51 (Z) y B52 (kg)",
};

export const KERR_MUSCULAR: ConstantesMasaKerr = {
  p: 207.21, s: 13.74, mediaKg: 24.5, desvioKg: 5.4,
  celdas: "Proc datos brutos!B61 (Z) y B62 (kg)",
};

/** Usa talla sentado como talla de escala: (suma × 89,92 / talla sentado). */
export const KERR_RESIDUAL: ConstantesMasaKerr = {
  p: 109.35, s: 7.08, mediaKg: 6.1, desvioKg: 1.24,
  celdas: "Proc datos brutos!B67 (Z) y B68 (kg)",
};

/** Masa ósea del cuerpo (suma de diámetros). */
export const KERR_OSEA_CUERPO: ConstantesMasaKerr = {
  p: 98.88, s: 5.33, mediaKg: 6.7, desvioKg: 1.34,
  celdas: "Proc datos brutos!B75 (Z) y B76 (kg)",
};

/**
 * Masa ósea de la cabeza. Su Z usa el perímetro SIN ajustar por talla: (cabeza − 56) / 1,44 y la masa es
 * Z × 0,18 + 1,2 sin dividir por factor³ (Proc datos brutos!B71 y B72).
 */
export const KERR_OSEA_CABEZA: ConstantesMasaKerr = {
  p: 56, s: 1.44, mediaKg: 1.2, desvioKg: 0.18,
  celdas: "Proc datos brutos!B71 (Z) y B72 (kg)",
};

/** Corrección de perímetros por pliegue: perímetro − pliegue(mm) × 3,141 / 10 (Proc datos brutos!B55, B57:B59; B65 usa × 0,3141). */
export const KERR_PI_CORRECCION = 3.141;

export const KERR_PIEL = {
  /** Grosor de piel (mm) por sexo. Proc datos brutos!B39 (masculino), B40 (femenino), B41. */
  grosor: { M: 2.07, F: 1.96 },
  /** Constante de superficie corporal para > 12 años. Proc datos brutos!B42 (masculino), B43 (femenino), B45. */
  constanteSuperficie: { M: 68.308, F: 73.074 },
  /** Densidad de la piel. Proc datos brutos!B47 = superficie × grosor × 1,05. */
  densidad: 1.05,
} as const;

/**
 * La masa ósea se calcula hasta los 21 años; desde los 21 se reutiliza siempre la misma masa ósea de
 * referencia (respuesta 5 del cuestionario a nutrición; en la planilla es un valor manual, Proc datos brutos!I39).
 */
export const EDAD_FIJA_MASA_OSEA = 21;
