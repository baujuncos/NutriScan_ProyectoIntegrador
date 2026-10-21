/**
 * NUT-151 — Métricas de calidad de las detecciones de Gemini. Funciones puras
 * (sin I/O) sobre las filas de `v_metricas_ia_items` y `v_metricas_ia_no_detectados`.
 *
 * Los motivos NO se recalculan: salen de `motivos_revision`, que guardó NUT-149
 * al momento de guardar. Aquí sólo se agregan. Las tasas son proporciones 0–1.
 */
import { CONFIDENCE_ALTA_UMBRAL } from '@/lib/deteccionResultado';
import type { MotivoRevision } from '@/lib/revisionIa';

/** Confianza promedio desde la que se considera que "el modelo estaba seguro". */
export const UMBRAL_CONFIANZA_ALTA = CONFIDENCE_ALTA_UMBRAL;
/** Tasa de corrección desde la que se considera un alimento "muy corregido". */
export const UMBRAL_TASA_CORRECCION_ALTA = 0.3;
/** Detecciones mínimas de un alimento para ofrecerlo en la evolución por versión de prompt. */
export const MIN_DETECCIONES_EVOLUCION = 5;

export type EstadoRevision = 'pendiente' | 'confirmado' | 'corregido';

/** Fila de `v_metricas_ia_items`. */
export interface ItemMetrica {
  alimento: string;
  alimento_norm: string;
  confidence: number;
  gramos_ia: number;
  /** null = el usuario quitó el ítem (no hay peso final). */
  gramos_usuario: number | null;
  motivos_revision: MotivoRevision[];
  estado_revision: EstadoRevision | null;
  prompt_version: string;
  created_at: string;
}

/** Fila de `v_metricas_ia_no_detectados`. */
export interface NoDetectadoFila {
  alimento: string;
  alimento_norm: string;
  prompt_version: string;
}

const tiene = (i: ItemMetrica, m: MotivoRevision) => i.motivos_revision.includes(m);

/** Corrigió nombre, peso o quitó el ítem. `confianza_baja` sola NO es una corrección. */
const fueCorregido = (i: ItemMetrica) =>
  tiene(i, 'cambio_alimento') || tiene(i, 'correccion_peso_grande') || tiene(i, 'item_quitado');

/** Agrupa por `alimento_norm` conservando el orden de aparición. */
function agrupar<T extends { alimento_norm: string }>(filas: T[]): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const f of filas) grupos.set(f.alimento_norm, [...(grupos.get(f.alimento_norm) ?? []), f]);
  return grupos;
}

/** Nombre a mostrar: el más frecuente del grupo (empate: el primero que apareció). */
function nombreVisible(filas: Array<{ alimento: string }>): string {
  const cuenta = new Map<string, number>();
  for (const f of filas) cuenta.set(f.alimento, (cuenta.get(f.alimento) ?? 0) + 1);
  return [...cuenta.entries()].reduce((mejor, e) => (e[1] > mejor[1] ? e : mejor))[0];
}

const promedio = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---------- 1. Ranking de alimentos más corregidos ----------

export interface FilaRanking {
  alimento: string;
  alimento_norm: string;
  detecciones: number;
  /** Cambió el alimento. */
  tasaNombre: number;
  /** El peso final difirió más del umbral (sin cambio de alimento). */
  tasaPeso: number;
  /** El usuario quitó el ítem (falso positivo): ni error de nombre ni de escala. */
  tasaQuitado: number;
  /** Algún tipo de corrección (nombre, peso o quitado). */
  tasaCorreccion: number;
}

export function rankingAlimentos(items: ItemMetrica[]): FilaRanking[] {
  return [...agrupar(items).entries()]
    .map(([alimento_norm, grupo]) => {
      const n = grupo.length;
      const tasa = (pred: (i: ItemMetrica) => boolean) => grupo.filter(pred).length / n;
      return {
        alimento: nombreVisible(grupo),
        alimento_norm,
        detecciones: n,
        tasaNombre: tasa((i) => tiene(i, 'cambio_alimento')),
        tasaPeso: tasa((i) => tiene(i, 'correccion_peso_grande')),
        tasaQuitado: tasa((i) => tiene(i, 'item_quitado')),
        tasaCorreccion: tasa(fueCorregido),
      };
    })
    .sort((a, b) => b.tasaCorreccion - a.tasaCorreccion || b.detecciones - a.detecciones || a.alimento.localeCompare(b.alimento));
}

// ---------- 2. Confianza vs. tasa de corrección ----------

export type Cuadrante = 'confiado_equivocado' | 'confiado_ok' | 'dudoso_equivocado' | 'dudoso_ok';

export interface PuntoConfianza {
  alimento: string;
  alimento_norm: string;
  detecciones: number;
  confianzaPromedio: number;
  tasaCorreccion: number;
  cuadrante: Cuadrante;
}

export function cuadranteDe(confianzaPromedio: number, tasaCorreccion: number): Cuadrante {
  const confiado = confianzaPromedio >= UMBRAL_CONFIANZA_ALTA;
  const equivocado = tasaCorreccion >= UMBRAL_TASA_CORRECCION_ALTA;
  if (confiado) return equivocado ? 'confiado_equivocado' : 'confiado_ok';
  return equivocado ? 'dudoso_equivocado' : 'dudoso_ok';
}

export function confianzaVsCorreccion(items: ItemMetrica[]): PuntoConfianza[] {
  return [...agrupar(items).entries()].map(([alimento_norm, grupo]) => {
    const confianzaPromedio = promedio(grupo.map((i) => i.confidence));
    const tasaCorreccion = grupo.filter(fueCorregido).length / grupo.length;
    return {
      alimento: nombreVisible(grupo),
      alimento_norm,
      detecciones: grupo.length,
      confianzaPromedio,
      tasaCorreccion,
      cuadrante: cuadranteDe(confianzaPromedio, tasaCorreccion),
    };
  });
}

// ---------- 3. Evolución por versión de prompt ----------

export interface VersionPrompt {
  prompt_version: string;
  detecciones: number;
  tasaCorreccion: number;
  /** Error relativo medio de peso (|final − estimado| / estimado) sobre ítems que no se quitaron; null si no hay datos. */
  errorPesoPromedio: number | null;
  /** errorPesoPromedio − el de la versión anterior (negativo = mejoró); null en la primera versión o sin datos. */
  deltaError: number | null;
}

/** Con `alimentoNorm` sólo cuenta ese alimento; sin él, todos. Versiones ordenadas por su primer uso. */
export function evolucionPorPrompt(items: ItemMetrica[], alimentoNorm?: string): VersionPrompt[] {
  const filtrados = alimentoNorm ? items.filter((i) => i.alimento_norm === alimentoNorm) : items;
  const porVersion = new Map<string, ItemMetrica[]>();
  for (const i of filtrados) porVersion.set(i.prompt_version, [...(porVersion.get(i.prompt_version) ?? []), i]);

  const versiones = [...porVersion.entries()]
    .map(([prompt_version, grupo]) => ({
      prompt_version,
      grupo,
      primerUso: grupo.reduce((min, i) => (i.created_at < min ? i.created_at : min), grupo[0].created_at),
    }))
    .sort((a, b) => a.primerUso.localeCompare(b.primerUso) || a.prompt_version.localeCompare(b.prompt_version));

  let anterior: number | null = null;
  return versiones.map(({ prompt_version, grupo }) => {
    const errores = grupo
      .filter((i) => i.gramos_usuario != null && i.gramos_ia > 0 && !tiene(i, 'item_quitado'))
      .map((i) => Math.abs((i.gramos_usuario as number) - i.gramos_ia) / i.gramos_ia);
    const errorPesoPromedio = errores.length > 0 ? promedio(errores) : null;
    const deltaError = errorPesoPromedio != null && anterior != null ? errorPesoPromedio - anterior : null;
    if (errorPesoPromedio != null) anterior = errorPesoPromedio;
    return {
      prompt_version,
      detecciones: grupo.length,
      tasaCorreccion: grupo.filter(fueCorregido).length / grupo.length,
      errorPesoPromedio,
      deltaError,
    };
  });
}

export interface ResumenEvolucion {
  desde: string;
  hasta: string;
  /** Cambio del error de peso en puntos porcentuales redondeados; negativo = mejoró. */
  puntos: number;
}

/** Compara la última versión con la anterior que tenga dato de peso; null si hay menos de dos. */
export function resumenEvolucion(versiones: VersionPrompt[]): ResumenEvolucion | null {
  const conDato = versiones.filter((v) => v.errorPesoPromedio != null);
  if (conDato.length < 2) return null;
  const [anterior, ultima] = conDato.slice(-2);
  return {
    desde: anterior.prompt_version,
    hasta: ultima.prompt_version,
    puntos: Math.round(((ultima.errorPesoPromedio as number) - (anterior.errorPesoPromedio as number)) * 100),
  };
}

/** Alimentos con volumen suficiente para mirar su evolución, de más a menos detectados. */
export function alimentosConVolumen(items: ItemMetrica[], minimo = MIN_DETECCIONES_EVOLUCION) {
  return [...agrupar(items).entries()]
    .filter(([, grupo]) => grupo.length >= minimo)
    .map(([alimento_norm, grupo]) => ({ alimento_norm, alimento: nombreVisible(grupo), detecciones: grupo.length }))
    .sort((a, b) => b.detecciones - a.detecciones || a.alimento.localeCompare(b.alimento));
}

// ---------- 4. Alimentos no detectados ----------

export interface FilaNoDetectado {
  alimento: string;
  alimento_norm: string;
  veces: number;
}

/** Falsos negativos agrupados por nombre normalizado. Nunca se mezclan con el ranking de corrección. */
export function noDetectados(filas: NoDetectadoFila[]): FilaNoDetectado[] {
  return [...agrupar(filas).entries()]
    .map(([alimento_norm, grupo]) => ({ alimento: nombreVisible(grupo), alimento_norm, veces: grupo.length }))
    .sort((a, b) => b.veces - a.veces || a.alimento.localeCompare(b.alimento));
}

// ---------- 5. Estado de la cola de NUT-149 ----------

export interface EstadoCola {
  pendiente: number;
  confirmado: number;
  corregido: number;
}

/** Ítems de la cola (los que entraron a revisión) por estado, dentro de los filtros activos. */
export function estadoCola(items: ItemMetrica[]): EstadoCola {
  const cola: EstadoCola = { pendiente: 0, confirmado: 0, corregido: 0 };
  for (const i of items) if (i.estado_revision) cola[i.estado_revision] += 1;
  return cola;
}
