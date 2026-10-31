import { ErrorAntropometria } from './errores';
import {
  DEPORTE_NINGUNO,
  DEPORTES_FEMENINO,
  DEPORTES_MASCULINO,
  type DeporteReferencia,
} from './datos/deportes';
import { PHANTOM_TALLA_REFERENCIA_CM } from './datos/phantom';
import type { Sexo } from './tipos';
import type { ValoresPorVariable } from './variables';

export interface CoordenadasSomatocarta {
  /** X = ectomorfia − endomorfia. */
  x: number;
  /** Y = 2 × mesomorfia − (endomorfia + ectomorfia). */
  y: number;
}

export interface Somatotipo extends CoordenadasSomatocarta {
  endomorfia: number;
  mesomorfia: number;
  ectomorfia: number;
  /** Índice altura-peso (talla / peso^⅓), Presentación!I199. */
  hwr: number;
}

/** Presentación!K226:K227 y K231:K232. */
export function coordenadasSomatocarta(
  endomorfia: number,
  mesomorfia: number,
  ectomorfia: number,
): CoordenadasSomatocarta {
  return { x: ectomorfia - endomorfia, y: 2 * mesomorfia - (endomorfia + ectomorfia) };
}

/** Presentación!C201: polinomio de Heath-Carter sobre la suma de pliegues escalada a 170,18 cm. */
export function endomorfia(sumaPliegues3: number, talla: number): number {
  const sumSF = sumaPliegues3 * (PHANTOM_TALLA_REFERENCIA_CM / talla); // C198 × C199
  return -0.7182 + 0.1451 * sumSF - 0.00068 * sumSF ** 2 + 0.0000014 * sumSF ** 3;
}

/**
 * Presentación!I201: regla COMPLETA de ectomorfia (la hoja 'Proc datos brutos'!B107 omite el tramo
 * HWR ≤ 38,25; el equipo de nutrición definió usar siempre esta).
 */
export function ectomorfia(hwr: number): number {
  if (hwr <= 38.25) return 0.1;
  if (hwr < 40.75) return 0.463 * hwr - 17.63;
  return 0.732 * hwr - 28.58;
}

/** Heath-Carter (1990). Presentación!C198:I201 y K226:K227. */
export function calcularSomatotipo(m: ValoresPorVariable): Somatotipo {
  const endo = endomorfia(m.pliegue_triceps + m.pliegue_subescapular + m.pliegue_supraespinal, m.talla);

  // F198 y F199: perímetros de brazo flexionado y pantorrilla corregidos por pliegue
  const brazoCorregido = m.perimetro_brazo_flexionado - m.pliegue_triceps / 10;
  const pantorrillaCorregida = m.perimetro_pantorrilla - m.pliegue_pantorrilla / 10;
  const meso =
    0.858 * m.diametro_humeral +
    0.601 * m.diametro_femoral +
    0.188 * brazoCorregido +
    0.161 * pantorrillaCorregida -
    m.talla * 0.131 +
    4.5;

  // I198:I199: la planilla usa el exponente 0,33333 (no 1/3 exacto)
  const hwr = m.talla / m.peso ** 0.33333;
  const ecto = ectomorfia(hwr);

  return { endomorfia: endo, mesomorfia: meso, ectomorfia: ecto, hwr, ...coordenadasSomatocarta(endo, meso, ecto) };
}

export interface ComparacionDeporte {
  id: string;
  nombre: string;
  endomorfia: number;
  mesomorfia: number;
  ectomorfia: number;
  x: number;
  y: number;
}

/** Deportes disponibles para cada sexo (la planilla tiene una tabla por sexo). */
export function deportesDisponibles(sexo: Sexo): readonly DeporteReferencia[] {
  return sexo === 'M' ? DEPORTES_MASCULINO : DEPORTES_FEMENINO;
}

/**
 * Somatotipo de referencia del deporte para el sexo dado (Presentación!G232:K232).
 * `null`, `undefined` o "ninguno" → sin comparación (devuelve null). Un id desconocido es un error.
 */
export function somatotipoDeDeporte(
  deporte: string | null | undefined,
  sexo: Sexo,
): ComparacionDeporte | null {
  if (deporte == null || deporte === '' || deporte === DEPORTE_NINGUNO) return null;
  const ref = deportesDisponibles(sexo).find((d) => d.id === deporte);
  if (!ref) {
    throw new ErrorAntropometria('DEPORTE_INVALIDO', `Deporte desconocido para el sexo indicado: "${deporte}".`, {
      deporte,
      sexo,
    });
  }
  return {
    id: ref.id,
    nombre: ref.nombre,
    endomorfia: ref.endomorfia,
    mesomorfia: ref.mesomorfia,
    ectomorfia: ref.ectomorfia,
    ...coordenadasSomatocarta(ref.endomorfia, ref.mesomorfia, ref.ectomorfia),
  };
}
