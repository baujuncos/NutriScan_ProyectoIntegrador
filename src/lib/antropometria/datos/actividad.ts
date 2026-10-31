// Factor de actividad física para el gasto energético total (OMS, 1985).
// Origen: 'Proc datos brutos'!P1:S6 (CODIGO, CATEGORIA, MUJERES, HOMBRES), nombrado "AF" en la planilla.
// La fila 7 ("F – Incorrecta", factor 0) es un valor de control de la planilla y no se incluye.
// Presentación!G152 elige la columna de mujeres (3) u hombres (4) según el sexo.

import type { NivelActividad, Sexo } from '../tipos';

export interface FactorActividad {
  /** Código de la planilla ('Proc datos brutos'!P). */
  codigo: 'A' | 'B' | 'C' | 'D' | 'E';
  categoria: string;
  factor: Record<Sexo, number>;
  celdas: string;
}

export const FACTORES_ACTIVIDAD: Record<NivelActividad, FactorActividad> = {
  sedentaria: { codigo: 'A', categoria: 'Sedentaria', factor: { F: 1.3, M: 1.3 }, celdas: 'Proc datos brutos!P2:S2' },
  liviana: { codigo: 'B', categoria: 'Liviana', factor: { F: 1.5, M: 1.6 }, celdas: 'Proc datos brutos!P3:S3' },
  moderada: { codigo: 'C', categoria: 'Moderada', factor: { F: 1.6, M: 1.7 }, celdas: 'Proc datos brutos!P4:S4' },
  intensa: { codigo: 'D', categoria: 'Intensa', factor: { F: 1.9, M: 2.1 }, celdas: 'Proc datos brutos!P5:S5' },
  extremada: { codigo: 'E', categoria: 'Extremada', factor: { F: 2.2, M: 2.4 }, celdas: 'Proc datos brutos!P6:S6' },
};

export const NIVELES_ACTIVIDAD = Object.keys(FACTORES_ACTIVIDAD) as NivelActividad[];
