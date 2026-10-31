import {
  PHANTOM,
  PHANTOM_TALLA_REFERENCIA_CM,
  type ClavePhantom,
} from './datos/phantom';
import type { ValoresPorVariable } from './variables';

export interface ResultadoPhantom {
  /** Valor llevado a la talla de referencia del Phantom (columna F de 'Presentación'). */
  ajustado: number;
  /** Score-Z Phantom (columna K de 'Presentación'). */
  z: number;
}

/** (170,18 / talla)^d — Presentación!F10 usa d = 3 (peso); F12:F37 usan d = 1. */
export function factorPhantom(talla: number, exponente: 1 | 3 = 1): number {
  return (PHANTOM_TALLA_REFERENCIA_CM / talla) ** exponente;
}

export function ajustarPhantom(clave: ClavePhantom, valor: number, talla: number): number {
  return valor * factorPhantom(talla, PHANTOM[clave].exponente);
}

/** Z = (ajustado − P) / S (Presentación!K10:K37). */
export function zPhantom(clave: ClavePhantom, ajustado: number): number {
  const { p, s } = PHANTOM[clave];
  return (ajustado - p) / s;
}

export function calcularPhantom(medianas: ValoresPorVariable): Record<ClavePhantom, ResultadoPhantom> {
  const resultado = {} as Record<ClavePhantom, ResultadoPhantom>;
  for (const clave of Object.keys(PHANTOM) as ClavePhantom[]) {
    const ajustado = ajustarPhantom(clave, medianas[clave], medianas.talla);
    resultado[clave] = { ajustado, z: zPhantom(clave, ajustado) };
  }
  return resultado;
}
