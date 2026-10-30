import { calcularEdad, type Edad } from './edad';
import { ErrorAntropometria } from './errores';
import { NIVELES_ACTIVIDAD } from './datos/actividad';
import { calcularEnergia, type Energia } from './energia';
import { calcularIndices, type Indices } from './indices';
import { calcularKerr, NOMBRES_MASA, type NombreMasa, type ResultadoKerr } from './kerr';
import { calcularPhantom, type ResultadoPhantom } from './phantom';
import type { ClavePhantom } from './datos/phantom';
import { calcularEstadisticas, medianasDe, type EstadisticaSerie } from './series';
import {
  calcularSomatotipo,
  somatotipoDeDeporte,
  type ComparacionDeporte,
  type Somatotipo,
} from './somatotipo';
import { SEXOS, type NivelActividad, type Sexo } from './tipos';
import { CLAVES_VARIABLES, type ClaveVariable, type SeriesPorVariable } from './variables';

export interface EntradaAntropometria {
  sexo: Sexo;
  /** AAAA-MM-DD */
  fechaNacimiento: string;
  /** AAAA-MM-DD */
  fechaMedicion: string;
  /** 2 o 3 series por variable, siempre lado derecho y en el mismo orden. Las 25 son obligatorias. */
  series: SeriesPorVariable;
  nivelActividad: NivelActividad;
  /** id de deporte (ver `deportesDisponibles`); omitido o "ninguno" = sin comparación. */
  deporte?: string | null;
  /** Masa ósea (kg) de la primera medición de ≥ 21 años; se reutiliza en las siguientes. */
  masaOseaReferencia?: number | null;
}

export interface ResultadoAntropometria {
  edad: Edad;
  /** Mediana, desvío estándar y % de error por variable (Proc datos brutos!G:I). */
  estadistica: Record<ClaveVariable, EstadisticaSerie>;
  /** Valor ajustado al Phantom y Z por variable (Presentación!F:K); la talla no tiene. */
  phantom: Record<ClavePhantom, ResultadoPhantom>;
  /** Fraccionamiento de Kerr en 5 masas. */
  masas: ResultadoKerr;
  /** Heath-Carter con coordenadas de somatocarta (x, y). */
  somatotipo: Somatotipo;
  /** Somatotipo de referencia del deporte, o null si no hay deporte. */
  comparacionDeporte: ComparacionDeporte | null;
  energia: Energia;
  indices: Indices;
  /** Control de calidad del fraccionamiento (banner del informe); sin umbral, solo informativo. */
  calidad: {
    pesoEstructuradoKg: number;
    pesoBrutoKg: number;
    /** (peso estructurado − peso bruto) / peso bruto × 100 (Proc datos brutos!B82). */
    diferenciaPesoPorcentaje: number;
  };
}

function validarEntrada(entrada: EntradaAntropometria): void {
  if (!SEXOS.includes(entrada.sexo)) {
    throw new ErrorAntropometria('SEXO_INVALIDO', `Sexo inválido: "${String(entrada.sexo)}" (se esperaba "M" o "F").`, {
      sexo: entrada.sexo,
    });
  }
  if (!NIVELES_ACTIVIDAD.includes(entrada.nivelActividad)) {
    throw new ErrorAntropometria(
      'NIVEL_ACTIVIDAD_INVALIDO',
      `Nivel de actividad inválido: "${String(entrada.nivelActividad)}".`,
      { nivelActividad: entrada.nivelActividad },
    );
  }
}

/**
 * Motor de cálculo antropométrico completo: replica las hojas 'Proc datos brutos' y 'Presentación' de la
 * planilla de F. Holway. Función pura: sin I/O, sin estado global y sin redondeo interno.
 *
 * Lanza `ErrorAntropometria` si el sexo/actividad/deporte/fechas son inválidos, si la persona es menor de
 * 18 años (`MENOR_DE_EDAD`), si faltan variables (`VARIABLES_FALTANTES`, con `detalle.faltantes`) o si una
 * serie no tiene 2 o 3 valores válidos.
 */
export function calcularAntropometria(entrada: EntradaAntropometria): ResultadoAntropometria {
  validarEntrada(entrada);
  const edad = calcularEdad(entrada.fechaNacimiento, entrada.fechaMedicion);
  const comparacionDeporte = somatotipoDeDeporte(entrada.deporte, entrada.sexo);

  const estadistica = calcularEstadisticas(entrada.series);
  const m = medianasDe(estadistica);

  const masas = calcularKerr(m, entrada.sexo, edad.anios, entrada.masaOseaReferencia);

  return {
    edad,
    estadistica,
    phantom: calcularPhantom(m),
    masas,
    somatotipo: calcularSomatotipo(m),
    comparacionDeporte,
    energia: calcularEnergia(entrada.sexo, m.peso, m.talla, edad.decimal, entrada.nivelActividad),
    indices: calcularIndices(m, masas, entrada.sexo, edad.anios),
    calidad: {
      pesoEstructuradoKg: masas.pesoEstructurado,
      pesoBrutoKg: m.peso,
      diferenciaPesoPorcentaje: masas.diferenciaPesoPorcentaje,
    },
  };
}

export interface ComparacionMediciones {
  /** actual − anterior, en kg (Presentación!J10). */
  peso: number;
  /** actual − anterior de cada masa, en kg (Presentación!I59:I64). */
  masas: Record<NombreMasa | 'total', number>;
  /** Diferencias de somatotipo y de coordenadas de somatocarta (Presentación!D227:F228, K226:K228). */
  somatotipo: { endomorfia: number; mesomorfia: number; ectomorfia: number; x: number; y: number };
  /** actual − anterior de la mediana de cada variable (Presentación!J10:J37). */
  variables: Record<ClaveVariable, number>;
}

/** Diferencias (actual − anterior) entre dos mediciones ya calculadas. */
export function compararMediciones(
  actual: ResultadoAntropometria,
  anterior: ResultadoAntropometria,
): ComparacionMediciones {
  const masas = Object.fromEntries([
    ...NOMBRES_MASA.map((n) => [n, actual.masas.masas[n].kg - anterior.masas.masas[n].kg]),
    ['total', actual.masas.total.kg - anterior.masas.total.kg],
  ]) as ComparacionMediciones['masas'];

  const variables = Object.fromEntries(
    CLAVES_VARIABLES.map((c) => [c, actual.estadistica[c].mediana - anterior.estadistica[c].mediana]),
  ) as Record<ClaveVariable, number>;

  const a = actual.somatotipo;
  const b = anterior.somatotipo;
  return {
    peso: actual.estadistica.peso.mediana - anterior.estadistica.peso.mediana,
    masas,
    somatotipo: {
      endomorfia: a.endomorfia - b.endomorfia,
      mesomorfia: a.mesomorfia - b.mesomorfia,
      ectomorfia: a.ectomorfia - b.ectomorfia,
      x: a.x - b.x,
      y: a.y - b.y,
    },
    variables,
  };
}
