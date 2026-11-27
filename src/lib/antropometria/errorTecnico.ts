import { valoresValidos } from './series';
import { VARIABLES, type ClaveVariable, type SeriesPorVariable } from './variables';

/**
 * Error técnico de medición (ETM / TEM) intra-evaluador, ISAK.
 *
 * Se calcula por variable sobre varias mediciones del MISMO evaluador, cada una con k ≥ 2 series:
 *
 *   TEM = √( Σᵢ Σⱼ (xᵢⱼ − x̄ᵢ)² / Σᵢ (kᵢ − 1) )
 *
 * donde i recorre las mediciones y j sus series. Es la raíz de la varianza intra-medición agrupada;
 * con 2 series por medición coincide con la fórmula clásica √(Σd² / 2n) (d = diferencia entre series).
 * %TEM = TEM / media de TODOS los valores × 100. No hay umbral ni semáforo: el ETM es informativo.
 *
 * Módulo puro: no redondea (el redondeo es de presentación) ni sabe de usuarios ni de base de datos.
 */

export interface ErrorTecnicoVariable {
  clave: ClaveVariable;
  unidad: 'kg' | 'cm' | 'mm';
  /** ETM en la unidad de la variable. */
  tem: number;
  /** ETM / media de todos los valores × 100. */
  porcentaje: number;
  /** Mediciones usadas (las que tienen al menos 2 series válidas de esta variable). */
  n: number;
}

export type ErrorTecnicoPorVariable = Record<ClaveVariable, ErrorTecnicoVariable | null>;

export interface ResumenErrorTecnico {
  /** Promedio del %ETM de los 6 pliegues; null si ninguno se pudo calcular. */
  pliegues: number | null;
  /** Promedio del %ETM de las otras 19 variables (básicas, diámetros y perímetros); null si ninguna. */
  otras: number | null;
}

export interface ErrorTecnico {
  variables: ErrorTecnicoPorVariable;
  /** Mediciones que aportaron al menos una variable. */
  mediciones: number;
  resumen: ResumenErrorTecnico;
}

function promedio(valores: readonly number[]): number | null {
  return valores.length === 0 ? null : valores.reduce((acc, v) => acc + v, 0) / valores.length;
}

/** Promedio de %ETM de los pliegues y de todo lo demás, para mostrarlo compacto. */
export function resumirErrorTecnico(variables: ErrorTecnicoPorVariable): ResumenErrorTecnico {
  const pliegues: number[] = [];
  const otras: number[] = [];
  for (const v of VARIABLES) {
    const e = variables[v.clave];
    if (e) (v.grupo === 'pliegues' ? pliegues : otras).push(e.porcentaje);
  }
  return { pliegues: promedio(pliegues), otras: promedio(otras) };
}

/**
 * ETM de cada variable a partir de las series crudas de varias mediciones del mismo evaluador.
 * Se ignoran las series que no son números válidos y, por variable, las mediciones con menos de 2
 * series válidas; una variable sin ninguna medición utilizable da `null`.
 */
export function calcularErrorTecnico(mediciones: readonly SeriesPorVariable[]): ErrorTecnico {
  const aportaron = new Set<number>();
  const variables = {} as ErrorTecnicoPorVariable;

  for (const def of VARIABLES) {
    let sumaCuadrados = 0;
    let gradosLibertad = 0;
    let sumaValores = 0;
    let cantidadValores = 0;
    let n = 0;

    mediciones.forEach((serie, indice) => {
      const crudo: unknown = serie?.[def.clave];
      const valores = valoresValidos(Array.isArray(crudo) ? crudo : undefined);
      if (valores.length < 2) return;

      const media = valores.reduce((acc, v) => acc + v, 0) / valores.length;
      sumaCuadrados += valores.reduce((acc, v) => acc + (v - media) ** 2, 0);
      gradosLibertad += valores.length - 1;
      sumaValores += valores.reduce((acc, v) => acc + v, 0);
      cantidadValores += valores.length;
      n += 1;
      aportaron.add(indice);
    });

    if (n === 0) {
      variables[def.clave] = null;
      continue;
    }

    // Con series idénticas el ETM es exactamente 0 (evita residuos de punto flotante).
    const tem = sumaCuadrados === 0 ? 0 : Math.sqrt(sumaCuadrados / gradosLibertad);
    variables[def.clave] = { clave: def.clave, unidad: def.unidad, tem, porcentaje: (tem / (sumaValores / cantidadValores)) * 100, n };
  }

  return { variables, mediciones: aportaron.size, resumen: resumirErrorTecnico(variables) };
}
