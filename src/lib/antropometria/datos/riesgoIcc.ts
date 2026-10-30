// Riesgo cardiovascular según el índice cintura/cadera (ICC), por sexo y edad.
// Origen: 'Presentación'!B161:J171 (Bray, 1992 / Ducimetiere 1986 / Ohlson 1985, según el texto de la planilla).
// Cada fila de la planilla dice "<a", "a-b", "c-d", ">d". Se guardan los topes numéricos:
//   bajo      si ICC <  bajoMenorA
//   moderado  si ICC <= moderadoHasta
//   alto      si ICC <= altoHasta
//   muy alto  si ICC >  altoHasta
// La planilla escribe los tramos con 2 decimales (p. ej. "0.83-0.88" y "0.89-0.94"), por eso la
// clasificación se hace sobre el ICC redondeado a 2 decimales (ver riesgoIcc en indices.ts).

import type { Sexo } from '../tipos';

export interface BandaRiesgoIcc {
  /** Etiqueta de la planilla, p. ej. "20-29". */
  edad: string;
  desde: number;
  hasta: number;
  bajoMenorA: number;
  moderadoHasta: number;
  altoHasta: number;
  celdas: string;
}

export const RIESGO_ICC: Record<Sexo, readonly BandaRiesgoIcc[]> = {
  M: [
    { edad: '20-29', desde: 20, hasta: 29, bajoMenorA: 0.83, moderadoHasta: 0.88, altoHasta: 0.94, celdas: 'Presentación!C162:J162' },
    { edad: '30-39', desde: 30, hasta: 39, bajoMenorA: 0.84, moderadoHasta: 0.91, altoHasta: 0.96, celdas: 'Presentación!C163:J163' },
    { edad: '40-49', desde: 40, hasta: 49, bajoMenorA: 0.88, moderadoHasta: 0.95, altoHasta: 1.0, celdas: 'Presentación!C164:J164' },
    { edad: '50-59', desde: 50, hasta: 59, bajoMenorA: 0.9, moderadoHasta: 0.96, altoHasta: 1.02, celdas: 'Presentación!C165:J165' },
    { edad: '60-69', desde: 60, hasta: 69, bajoMenorA: 0.91, moderadoHasta: 0.98, altoHasta: 1.03, celdas: 'Presentación!C166:J166' },
  ],
  F: [
    { edad: '20-29', desde: 20, hasta: 29, bajoMenorA: 0.71, moderadoHasta: 0.77, altoHasta: 0.82, celdas: 'Presentación!C167:J167' },
    { edad: '30-39', desde: 30, hasta: 39, bajoMenorA: 0.72, moderadoHasta: 0.78, altoHasta: 0.84, celdas: 'Presentación!C168:J168' },
    { edad: '40-49', desde: 40, hasta: 49, bajoMenorA: 0.73, moderadoHasta: 0.79, altoHasta: 0.87, celdas: 'Presentación!C169:J169' },
    { edad: '50-59', desde: 50, hasta: 59, bajoMenorA: 0.74, moderadoHasta: 0.81, altoHasta: 0.88, celdas: 'Presentación!C170:J170' },
    { edad: '60-69', desde: 60, hasta: 69, bajoMenorA: 0.76, moderadoHasta: 0.83, altoHasta: 0.9, celdas: 'Presentación!C171:J171' },
  ],
};
