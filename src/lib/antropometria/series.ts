import { ErrorAntropometria } from './errores';
import {
  CLAVES_VARIABLES,
  type ClaveVariable,
  type SeriesPorVariable,
  type ValoresPorVariable,
} from './variables';

export const MIN_SERIES = 2;
export const MAX_SERIES = 3;

export interface EstadisticaSerie {
  /** Valores válidos usados (sin vacíos), en el orden en que se cargaron. */
  valores: number[];
  mediana: number;
  /** Desvío estándar muestral (n − 1). */
  desvioEstandar: number;
  /** Desvío / mediana × 100. Solo informativo: no hay umbral ni alerta. */
  errorPorcentual: number;
}

/** Una celda vacía (o 0) en la planilla equivale a "serie no medida". */
function valoresValidos(serie: readonly (number | null | undefined)[] | undefined): number[] {
  if (!serie) return [];
  return serie.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
}

/**
 * Proc datos brutos!G6 (=MEDIAN), H6 (=STDEVA) e I6 (=H6/G6*100) y sus equivalentes en las filas 7–33.
 * La planilla redondea a 3 decimales (ROUND(…,3)); acá no se redondea (el redondeo es de presentación).
 * La planilla admite hasta 5 series; el protocolo de NutriScan usa 2 o 3.
 */
export function estadisticaSerie(
  serie: readonly (number | null | undefined)[],
  variable?: ClaveVariable,
): EstadisticaSerie {
  const valores = valoresValidos(serie);
  if (valores.length < MIN_SERIES || valores.length > MAX_SERIES) {
    throw new ErrorAntropometria(
      'SERIE_INVALIDA',
      `Se esperan ${MIN_SERIES} o ${MAX_SERIES} series válidas${variable ? ` para "${variable}"` : ''} y llegaron ${valores.length}.`,
      { variable, cantidad: valores.length },
    );
  }

  const ordenados = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(ordenados.length / 2);
  const mediana =
    ordenados.length % 2 === 1 ? ordenados[mitad] : (ordenados[mitad - 1] + ordenados[mitad]) / 2;

  // Con series idénticas el desvío es exactamente 0 (evita residuos de punto flotante).
  const todasIguales = valores.every((v) => v === valores[0]);
  const media = valores.reduce((acc, v) => acc + v, 0) / valores.length;
  const desvioEstandar = todasIguales
    ? 0
    : Math.sqrt(valores.reduce((acc, v) => acc + (v - media) ** 2, 0) / (valores.length - 1));

  return { valores, mediana, desvioEstandar, errorPorcentual: (desvioEstandar / mediana) * 100 };
}

/** Variables que todavía no tienen al menos 2 series válidas. El informe solo se genera si devuelve []. */
export function variablesFaltantes(series: SeriesPorVariable): ClaveVariable[] {
  return CLAVES_VARIABLES.filter((clave) => valoresValidos(series[clave]).length < MIN_SERIES);
}

export function calcularEstadisticas(
  series: SeriesPorVariable,
): Record<ClaveVariable, EstadisticaSerie> {
  const faltantes = variablesFaltantes(series);
  if (faltantes.length > 0) {
    throw new ErrorAntropometria(
      'VARIABLES_FALTANTES',
      `Faltan variables para calcular el informe: ${faltantes.join(', ')}.`,
      { faltantes },
    );
  }
  return Object.fromEntries(
    CLAVES_VARIABLES.map((clave) => [clave, estadisticaSerie(series[clave] ?? [], clave)]),
  ) as Record<ClaveVariable, EstadisticaSerie>;
}

export function medianasDe(estadistica: Record<ClaveVariable, EstadisticaSerie>): ValoresPorVariable {
  return Object.fromEntries(
    CLAVES_VARIABLES.map((clave) => [clave, estadistica[clave].mediana]),
  ) as ValoresPorVariable;
}
