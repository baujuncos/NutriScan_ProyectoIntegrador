/**
 * Modelo de vista del informe: ordena y etiqueta lo que devuelve el motor para que los
 * componentes solo dibujen. Puro y sin formato (el redondeo/coma lo pone la presentación).
 */
import {
  GRUPOS_VARIABLE,
  VARIABLES,
  type ClaveVariable,
  type ComparacionMediciones,
  type GrupoVariable,
  type NivelRiesgoIcc,
  type NombreMasa,
  type ResultadoAntropometria,
} from '@/lib/antropometria';
import type { ClavePhantom } from '@/lib/antropometria';
import { normalizarNombre } from './reglas';

export type ClaveMasa = NombreMasa | 'total';

export const ETIQUETA_MASA: Record<ClaveMasa, string> = {
  adiposa: 'Masa adiposa',
  muscular: 'Masa muscular',
  residual: 'Masa residual',
  osea: 'Masa ósea',
  piel: 'Masa de la piel',
  total: 'Total',
};

/** Textos fijos del informe (sin comentarios personalizados). */
export const DESCRIPCION_MASA: Record<NombreMasa, string> = {
  adiposa: 'Tejido graso del cuerpo, estimado con los seis pliegues cutáneos.',
  muscular: 'Tejido muscular esquelético, estimado con perímetros corregidos por pliegues y la talla.',
  residual: 'Vísceras y órganos internos del tronco.',
  osea: 'Esqueleto, estimado con diámetros, perímetro de cabeza y talla.',
  piel: 'Piel y tejido de revestimiento, estimada con la superficie corporal.',
};

export const ETIQUETA_RIESGO: Record<NivelRiesgoIcc, string> = {
  bajo: 'Bajo',
  moderado: 'Moderado',
  alto: 'Alto',
  muy_alto: 'Muy alto',
};

export interface FilaProporcionalidad {
  clave: ClaveVariable;
  grupo: GrupoVariable;
  etiqueta: string;
  unidad: string;
  /** Mediana de las series. */
  medido: number;
  /** Valor llevado a la talla del Phantom; null en la talla (no tiene Phantom). */
  ajustado: number | null;
  z: number | null;
  /** Actual − anterior; null sin medición anterior. */
  diferencia: number | null;
  errorPorcentual: number;
}

export function filasProporcionalidad(r: ResultadoAntropometria, comparacion: ComparacionMediciones | null): FilaProporcionalidad[] {
  return VARIABLES.map((v) => {
    const fantasma = v.clave === 'talla' ? null : r.phantom[v.clave as ClavePhantom];
    return {
      clave: v.clave,
      grupo: v.grupo,
      etiqueta: v.etiqueta,
      unidad: v.unidad,
      medido: r.estadistica[v.clave].mediana,
      ajustado: fantasma?.ajustado ?? null,
      z: fantasma?.z ?? null,
      diferencia: comparacion?.variables[v.clave] ?? null,
      errorPorcentual: r.estadistica[v.clave].errorPorcentual,
    };
  });
}

export interface FilaMasa {
  clave: ClaveMasa;
  etiqueta: string;
  kg: number;
  /** null en el total. */
  porcentaje: number | null;
  /** null en la piel (la planilla no la estandariza). */
  z: number | null;
  diferencia: number | null;
}

export function filasMasas(r: ResultadoAntropometria, comparacion: ComparacionMediciones | null): FilaMasa[] {
  const filas: FilaMasa[] = (Object.keys(DESCRIPCION_MASA) as NombreMasa[]).map((n) => ({
    clave: n,
    etiqueta: ETIQUETA_MASA[n],
    kg: r.masas.masas[n].kg,
    porcentaje: r.masas.masas[n].porcentaje,
    z: r.masas.masas[n].z,
    diferencia: comparacion?.masas[n] ?? null,
  }));
  filas.push({
    clave: 'total',
    etiqueta: ETIQUETA_MASA.total,
    kg: r.masas.total.kg,
    porcentaje: null,
    z: r.masas.total.z,
    diferencia: comparacion?.masas.total ?? null,
  });
  return filas;
}

export interface BarraPhantom {
  clave: ClaveVariable;
  etiqueta: string;
  z: number;
}

/** Z Phantom por grupo para los gráficos de barras (la talla no tiene Z). */
export function barrasPhantom(r: ResultadoAntropometria): Record<GrupoVariable, BarraPhantom[]> {
  const grupos = Object.fromEntries(GRUPOS_VARIABLE.map((g) => [g, [] as BarraPhantom[]])) as Record<GrupoVariable, BarraPhantom[]>;
  for (const v of VARIABLES) {
    if (v.clave === 'talla') continue;
    grupos[v.grupo].push({ clave: v.clave, etiqueta: v.etiqueta, z: r.phantom[v.clave as ClavePhantom].z });
  }
  return grupos;
}

/** "Marchetti_Julieta_2026-10-24": nombre sugerido del archivo al guardar como PDF. */
export function nombreArchivoInforme(paciente: { nombre: string; apellido: string }, fechaMedicion: string): string {
  const palabras = (t: string) => normalizarNombre(t).split(/[^a-z0-9]+/).filter(Boolean);
  const nombre = [...palabras(paciente.apellido), ...palabras(paciente.nombre)]
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('_');
  return `${nombre || 'Paciente'}_${fechaMedicion}`;
}
