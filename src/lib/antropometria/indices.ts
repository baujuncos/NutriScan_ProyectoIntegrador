import { RIESGO_ICC, type BandaRiesgoIcc } from './datos/riesgoIcc';
import type { ResultadoKerr } from './kerr';
import type { Sexo } from './tipos';
import type { ValoresPorVariable } from './variables';

export type NivelRiesgoIcc = 'bajo' | 'moderado' | 'alto' | 'muy_alto';

export interface RiesgoIcc {
  nivel: NivelRiesgoIcc;
  /** Banda de edad de la tabla que se aplicó, p. ej. "20-29". */
  banda: string;
  /** true si la edad cae fuera de 20–69 y se usó la banda más cercana (la tabla no la cubre). */
  bandaExtrapolada: boolean;
}

export interface Indices {
  /** Presentación!F181, kg/m². */
  imc: number;
  /** Presentación!D173: cintura / cadera. */
  icc: number;
  riesgoIcc: RiesgoIcc;
  /** Presentación!F187: BSA, m². */
  superficieCorporal: number;
  /** Presentación!F190: BSA / peso, cm²/kg. */
  superficieCorporalPorPeso: number;
  /** Presentación!D178: masa muscular / masa ósea (masas sin ajustar al peso, como en la planilla). */
  indiceMusculoOseo: number;
  /** Presentación!I178: masa adiposa / masa muscular (masas sin ajustar). */
  indiceAdiposoMuscular: number;
  /** Presentación!D184. */
  tallaSentadoTalla: number;
  /** Presentación!F175, mm. */
  sumaSeisPliegues: number;
}

function bandaIcc(sexo: Sexo, edadAnios: number): { banda: BandaRiesgoIcc; extrapolada: boolean } {
  const bandas = RIESGO_ICC[sexo];
  const exacta = bandas.find((b) => edadAnios >= b.desde && edadAnios < b.hasta + 1);
  if (exacta) return { banda: exacta, extrapolada: false };
  return { banda: edadAnios < bandas[0].desde ? bandas[0] : bandas[bandas.length - 1], extrapolada: true };
}

/**
 * Presentación!C161:J171. La tabla está en 2 decimales, así que se clasifica el ICC redondeado a 2
 * decimales (solo para ubicarlo en la tabla; el ICC que se devuelve no se redondea).
 */
export function riesgoIcc(icc: number, sexo: Sexo, edadAnios: number): RiesgoIcc {
  const { banda, extrapolada } = bandaIcc(sexo, edadAnios);
  const valor = Math.round(icc * 100) / 100;
  let nivel: NivelRiesgoIcc;
  if (valor < banda.bajoMenorA) nivel = 'bajo';
  else if (valor <= banda.moderadoHasta) nivel = 'moderado';
  else if (valor <= banda.altoHasta) nivel = 'alto';
  else nivel = 'muy_alto';
  return { nivel, banda: banda.edad, bandaExtrapolada: extrapolada };
}

export function calcularIndices(
  m: ValoresPorVariable,
  kerr: Pick<ResultadoKerr, 'sinAjustar'>,
  sexo: Sexo,
  edadAnios: number,
): Indices {
  const icc = m.perimetro_cintura / m.perimetro_caderas;
  const bsa = m.peso ** 0.425 * m.talla ** 0.725 * 0.007189;

  return {
    imc: m.peso / (m.talla / 100) ** 2,
    icc,
    riesgoIcc: riesgoIcc(icc, sexo, edadAnios),
    superficieCorporal: bsa,
    superficieCorporalPorPeso: (bsa * 10000) / m.peso,
    indiceMusculoOseo: kerr.sinAjustar.muscular / kerr.sinAjustar.osea,
    indiceAdiposoMuscular: kerr.sinAjustar.adiposa / kerr.sinAjustar.muscular,
    tallaSentadoTalla: m.talla_sentado / m.talla,
    sumaSeisPliegues:
      m.pliegue_triceps + m.pliegue_subescapular + m.pliegue_supraespinal +
      m.pliegue_abdominal + m.pliegue_muslo_medial + m.pliegue_pantorrilla,
  };
}
