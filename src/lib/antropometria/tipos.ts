/** M = masculino (planilla: sexo = 1), F = femenino (planilla: sexo = 2). Mismo criterio que `lib/calculations`. */
export type Sexo = 'M' | 'F';

export const SEXOS: readonly Sexo[] = ['M', 'F'];

/** Categorías de nivel de actividad física (OMS, 1985); códigos A–E de 'Proc datos brutos'!P2:Q6. */
export type NivelActividad = 'sedentaria' | 'liviana' | 'moderada' | 'intensa' | 'extremada';
