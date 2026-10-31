/**
 * Lógica pura del asistente de carga: pasos, texto ↔ series y progreso por grupo.
 * Los inputs trabajan con texto (coma decimal); acá se convierte a números y se
 * calcula el estado de cada variable con las funciones del motor.
 */
import {
  CLAVES_VARIABLES,
  GRUPOS_VARIABLE,
  VARIABLES,
  variablesDelGrupo,
  type ClaveVariable,
  type GrupoVariable,
  type SeriesPorVariable,
} from '@/lib/antropometria';
import { estadisticaSerie, MAX_SERIES, MIN_SERIES, type EstadisticaSerie } from '@/lib/antropometria/series';
import { parsearDecimal, textoDecimal } from './reglas';

export { MAX_SERIES, MIN_SERIES };

export type TextoSeries = Record<ClaveVariable, string[]>;

export interface Paso {
  id: GrupoVariable | 'revision';
  titulo: string;
}

/** Datos básicos → diámetros → perímetros → pliegues → revisión. */
export const PASOS: readonly Paso[] = [
  { id: 'basicas', titulo: 'Datos básicos' },
  { id: 'diametros', titulo: 'Diámetros' },
  { id: 'perimetros', titulo: 'Perímetros' },
  { id: 'pliegues', titulo: 'Pliegues' },
  { id: 'revision', titulo: 'Revisión' },
];

export const TITULO_GRUPO: Record<GrupoVariable, string> = {
  basicas: 'Datos básicos',
  diametros: 'Diámetros',
  perimetros: 'Perímetros',
  pliegues: 'Pliegues',
};

/** Todos los campos vacíos: una serie de texto por cada una de las 3 series posibles. */
export function textoVacio(): TextoSeries {
  return Object.fromEntries(CLAVES_VARIABLES.map((c) => [c, Array<string>(MAX_SERIES).fill('')])) as TextoSeries;
}

/** Series guardadas → texto para los inputs (con coma decimal). */
export function textoDesdeSeries(series: SeriesPorVariable): TextoSeries {
  const texto = textoVacio();
  for (const clave of CLAVES_VARIABLES) {
    (series[clave] ?? []).slice(0, MAX_SERIES).forEach((v, i) => {
      texto[clave][i] = textoDecimal(v);
    });
  }
  return texto;
}

/** Texto de los inputs → series numéricas (lo que no se entiende queda `null`). Solo variables con algún dato. */
export function seriesDesdeTexto(texto: TextoSeries): SeriesPorVariable {
  const series: Record<string, (number | null)[]> = {};
  for (const clave of CLAVES_VARIABLES) {
    const fila = texto[clave].map((t) => parsearDecimal(t));
    if (fila.some((v) => v !== null)) series[clave] = fila;
  }
  return series as SeriesPorVariable;
}

/** Un campo con algo escrito que no es un número válido (para marcarlo en rojo). */
export function campoInvalido(texto: string): boolean {
  return texto.trim() !== '' && parsearDecimal(texto) === null;
}

export interface EstadoVariable {
  /** Al menos 2 series válidas. */
  completa: boolean;
  /** Mediana, desvío y % de error; solo si está completa. Informativo: no bloquea nada. */
  estadistica: EstadisticaSerie | null;
}

export function estadoVariable(textoSerie: readonly string[], clave?: ClaveVariable): EstadoVariable {
  const numeros = textoSerie.map((t) => parsearDecimal(t));
  try {
    return { completa: true, estadistica: estadisticaSerie(numeros, clave) };
  } catch {
    return { completa: false, estadistica: null };
  }
}

export interface ProgresoGrupo {
  grupo: GrupoVariable;
  completas: number;
  total: number;
  /** Variables del grupo con menos de 2 series, en el orden del protocolo. */
  faltantes: { clave: ClaveVariable; etiqueta: string }[];
}

export function progresoPorGrupo(texto: TextoSeries): ProgresoGrupo[] {
  return GRUPOS_VARIABLE.map((grupo) => {
    const claves = variablesDelGrupo(grupo);
    const faltantes = VARIABLES.filter((v) => v.grupo === grupo && !estadoVariable(texto[v.clave], v.clave).completa).map(
      (v) => ({ clave: v.clave, etiqueta: v.etiqueta }),
    );
    return { grupo, completas: claves.length - faltantes.length, total: claves.length, faltantes };
  });
}

export const TOTAL_VARIABLES = CLAVES_VARIABLES.length;

export function totalCompletas(progreso: readonly ProgresoGrupo[]): number {
  return progreso.reduce((acc, g) => acc + g.completas, 0);
}
