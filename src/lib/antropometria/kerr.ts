import { ErrorAntropometria } from './errores';
import {
  EDAD_FIJA_MASA_OSEA,
  KERR_ADIPOSA,
  KERR_MUSCULAR,
  KERR_OSEA_CABEZA,
  KERR_OSEA_CUERPO,
  KERR_PI_CORRECCION,
  KERR_PIEL,
  KERR_RESIDUAL,
  type ConstantesMasaKerr,
} from './datos/kerr';
import { PHANTOM_TALLA_REFERENCIA_CM, PHANTOM_TALLA_SENTADO_REFERENCIA_CM } from './datos/phantom';
import { factorPhantom, zPhantom } from './phantom';
import type { Sexo } from './tipos';
import type { ValoresPorVariable } from './variables';

export const NOMBRES_MASA = ['adiposa', 'muscular', 'residual', 'osea', 'piel'] as const;
export type NombreMasa = (typeof NOMBRES_MASA)[number];

export interface MasaKerr {
  kg: number;
  /** kg / peso medido × 100. */
  porcentaje: number;
  /** Z Phantom de la masa (la piel no tiene Z en la planilla). */
  z: number | null;
  /** kg / talla(m)² (Proc datos brutos!H58:H62). */
  indice: number;
}

export interface MasaOsea {
  /** Masa ósea calculada con la medición actual, ya ajustada al peso (Proc datos brutos!E78). */
  calculadaKg: number;
  /** La que efectivamente entra al fraccionamiento (Proc datos brutos!I39). */
  usadaKg: number;
  origen: 'calculada' | 'referencia';
  /** true si es una medición de ≥ 21 años sin referencia previa: quien llama debe guardar `usadaKg`. */
  guardarComoReferencia: boolean;
}

export interface ResultadoKerr {
  masas: Record<NombreMasa, MasaKerr>;
  total: { kg: number; z: number };
  masaOsea: MasaOsea;
  /** Masas antes de ajustar al peso medido (Proc datos brutos!B47, B52, B62, B68, B78), en kg. */
  sinAjustar: Record<NombreMasa, number>;
  /** Σ de las masas sin ajustar (Proc datos brutos!B80). */
  pesoEstructurado: number;
  /** (peso estructurado − peso bruto) / peso bruto × 100 (Proc datos brutos!B82). Control de calidad. */
  diferenciaPesoPorcentaje: number;
}

const corregirPerimetro = (perimetro: number, pliegueMm: number) =>
  perimetro - (pliegueMm * KERR_PI_CORRECCION) / 10;

/** Z = (suma × factor − p) / s; masa = (Z × desvío + media) / factor^exponente. */
function masaPorZ(
  suma: number,
  factorEscala: number,
  c: ConstantesMasaKerr,
): { z: number; kg: number } {
  const z = (suma * factorEscala - c.p) / c.s;
  return { z, kg: (z * c.desvioKg + c.mediaKg) / factorEscala ** 3 };
}

/**
 * Fraccionamiento de Kerr en 5 masas.
 * @param edadAnios años cumplidos (decide si la masa ósea se calcula o se reutiliza la de referencia).
 */
export function calcularKerr(
  m: ValoresPorVariable,
  sexo: Sexo,
  edadAnios: number,
  masaOseaReferencia?: number | null,
): ResultadoKerr {
  const { peso, talla } = m;
  const f = PHANTOM_TALLA_REFERENCIA_CM / talla;
  const fSentado = PHANTOM_TALLA_SENTADO_REFERENCIA_CM / m.talla_sentado;

  // Piel — Proc datos brutos!B41:B47
  const superficie = (KERR_PIEL.constanteSuperficie[sexo] * peso ** 0.425 * talla ** 0.725) / 10000;
  const piel = superficie * KERR_PIEL.grosor[sexo] * KERR_PIEL.densidad;

  // Adiposa — B50:B52
  const sumaPliegues =
    m.pliegue_triceps + m.pliegue_subescapular + m.pliegue_supraespinal +
    m.pliegue_abdominal + m.pliegue_muslo_medial + m.pliegue_pantorrilla;
  const adiposa = masaPorZ(sumaPliegues, f, KERR_ADIPOSA);

  // Muscular — B55:B62
  const sumaPerimetrosCorregidos =
    corregirPerimetro(m.perimetro_brazo_relajado, m.pliegue_triceps) +
    m.perimetro_antebrazo +
    corregirPerimetro(m.perimetro_muslo_superior, m.pliegue_muslo_medial) +
    corregirPerimetro(m.perimetro_pantorrilla, m.pliegue_pantorrilla) +
    corregirPerimetro(m.perimetro_torax_mesoesternal, m.pliegue_subescapular);
  const muscular = masaPorZ(sumaPerimetrosCorregidos, f, KERR_MUSCULAR);

  // Residual — B65:B68 (escala con talla sentado)
  const sumaTorax =
    m.diametro_torax_transverso + m.diametro_torax_anteroposterior +
    corregirPerimetro(m.perimetro_cintura, m.pliegue_abdominal);
  const residual = masaPorZ(sumaTorax, fSentado, KERR_RESIDUAL);

  // Ósea — B71:B78
  const zCabeza = (m.perimetro_cabeza - KERR_OSEA_CABEZA.p) / KERR_OSEA_CABEZA.s;
  const oseaCabezaKg = zCabeza * KERR_OSEA_CABEZA.desvioKg + KERR_OSEA_CABEZA.mediaKg;
  const sumaDiametros =
    m.diametro_biacromial + m.diametro_biiliocrestideo + m.diametro_humeral * 2 + m.diametro_femoral * 2;
  const oseaCuerpo = masaPorZ(sumaDiametros, f, KERR_OSEA_CUERPO);
  const oseaSinAjustar = oseaCabezaKg + oseaCuerpo.kg;

  // Ajuste al peso medido — C47:E80, B80:B82
  const sinAjustar: Record<NombreMasa, number> = {
    adiposa: adiposa.kg,
    muscular: muscular.kg,
    residual: residual.kg,
    osea: oseaSinAjustar,
    piel,
  };
  const pesoEstructurado = NOMBRES_MASA.reduce((acc, n) => acc + sinAjustar[n], 0);
  const diferenciaKg = pesoEstructurado - peso;
  const ajustada = Object.fromEntries(
    NOMBRES_MASA.map((n) => [n, sinAjustar[n] - diferenciaKg * (sinAjustar[n] / pesoEstructurado)]),
  ) as Record<NombreMasa, number>;

  // Masa ósea de referencia — Proc datos brutos!I39:I55
  if (masaOseaReferencia != null && (!Number.isFinite(masaOseaReferencia) || masaOseaReferencia <= 0 || masaOseaReferencia >= peso)) {
    throw new ErrorAntropometria(
      'MASA_OSEA_INVALIDA',
      'La masa ósea de referencia debe ser un número positivo menor al peso.',
      { masaOseaReferencia },
    );
  }
  const usaReferencia = edadAnios >= EDAD_FIJA_MASA_OSEA && masaOseaReferencia != null;
  const oseaUsada = usaReferencia ? masaOseaReferencia : ajustada.osea;
  const deltaOsea = oseaUsada - ajustada.osea; // I40 = I39 − E78
  const sumaOtrasMasas = peso - oseaUsada; // I41 = E80 − I39
  // I43:I46 y I50:I54. La planilla divide por (peso − referencia) y no por (peso − ósea calculada): las
  // masas re-ajustadas suman el peso salvo por un término de 2.º orden (≈ delta² / peso). Se replica tal cual.
  const final = { ...ajustada, osea: oseaUsada };
  for (const n of ['adiposa', 'muscular', 'residual', 'piel'] as const) {
    final[n] = ajustada[n] - deltaOsea * (ajustada[n] / sumaOtrasMasas);
  }

  const alturaM2 = (talla / 100) ** 2;
  const zMasa: Record<NombreMasa, number | null> = {
    adiposa: adiposa.z,
    muscular: muscular.z,
    residual: residual.z,
    osea: oseaCuerpo.z, // Presentación!G62 = Proc datos brutos!B75 (Z de la masa ósea del cuerpo)
    piel: null,
  };
  const masas = Object.fromEntries(
    NOMBRES_MASA.map((n) => [
      n,
      { kg: final[n], porcentaje: (final[n] / peso) * 100, z: zMasa[n], indice: final[n] / alturaM2 },
    ]),
  ) as Record<NombreMasa, MasaKerr>;

  const totalKg = NOMBRES_MASA.reduce((acc, n) => acc + final[n], 0);

  return {
    masas,
    // Presentación!E64:G64
    total: { kg: totalKg, z: zPhantom('peso', totalKg * factorPhantom(talla, 3)) },
    masaOsea: {
      calculadaKg: ajustada.osea,
      usadaKg: oseaUsada,
      origen: usaReferencia ? 'referencia' : 'calculada',
      guardarComoReferencia: !usaReferencia && edadAnios >= EDAD_FIJA_MASA_OSEA,
    },
    sinAjustar,
    pesoEstructurado,
    diferenciaPesoPorcentaje: (diferenciaKg / peso) * 100,
  };
}
