import { FACTORES_ACTIVIDAD } from './datos/actividad';
import type { NivelActividad, Sexo } from './tipos';

export interface Energia {
  /** Presentación!B148: talla² × 23 (hombres) o × 21,5 (mujeres). */
  pesoIdeal: number;
  /** Presentación!H154:I154: peso ideal ∓ 10 %. */
  rangoPesoIdeal: { minimo: number; maximo: number };
  /** Presentación!D149: peso medido − peso ideal. */
  diferenciaConIdeal: number;
  /** Presentación!G149: 25 % de la diferencia ("masa muscular extra"). */
  ajusteSobrepeso: number;
  /** Presentación!F150: peso ideal + 25 % de la diferencia. */
  pesoParaCalculo: number;
  /** Presentación!G151: peso que efectivamente entra a Harris-Benedict. */
  pesoUsadoEnMetabolismo: number;
  /** Presentación!F151, en kcal/día. */
  metabolismoBasal: number;
  /** Presentación!G152. */
  factorActividad: number;
  /** Presentación!D153 = MB × factor, en kcal/día. */
  gastoEnergeticoTotal: number;
}

export function pesoIdeal(talla: number, sexo: Sexo): number {
  return (talla / 100) ** 2 * (sexo === 'M' ? 23 : 21.5);
}

/**
 * Metabolismo basal de Harris & Benedict (1919), Presentación!F151 (y Proc datos brutos!B111).
 * `edad` en años decimales (Proc datos brutos!I3).
 */
export function harrisBenedict(sexo: Sexo, peso: number, talla: number, edad: number): number {
  return sexo === 'M'
    ? 66 + 13.7 * peso + 5 * talla - 6.8 * edad
    : 655 + 9.6 * peso + 1.7 * talla - 4.7 * edad;
}

export function factorActividad(sexo: Sexo, nivel: NivelActividad): number {
  return FACTORES_ACTIVIDAD[nivel].factor[sexo];
}

export function calcularEnergia(
  sexo: Sexo,
  peso: number,
  talla: number,
  edadDecimal: number,
  nivel: NivelActividad,
): Energia {
  const ideal = pesoIdeal(talla, sexo);
  const diferencia = peso - ideal;
  const ajuste = diferencia * 0.25;
  const pesoParaCalculo = ideal + ajuste;
  // G151 = IF(E10 < B148, E10, F150): el ajuste del 25 % solo rige con sobrepeso; por debajo del
  // peso ideal el metabolismo basal se calcula con el peso medido.
  const pesoUsado = peso < ideal ? peso : pesoParaCalculo;
  const mb = harrisBenedict(sexo, pesoUsado, talla, edadDecimal);
  const factor = factorActividad(sexo, nivel);

  return {
    pesoIdeal: ideal,
    rangoPesoIdeal: { minimo: ideal - ideal * 0.1, maximo: ideal + ideal * 0.1 },
    diferenciaConIdeal: diferencia,
    ajusteSobrepeso: ajuste,
    pesoParaCalculo,
    pesoUsadoEnMetabolismo: pesoUsado,
    metabolismoBasal: mb,
    factorActividad: factor,
    gastoEnergeticoTotal: mb * factor,
  };
}
