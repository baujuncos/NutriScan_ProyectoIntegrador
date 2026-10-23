/**
 * NUT-151 — Parámetros y carga de datos del dashboard `/revision-ia/metricas`.
 * Mismo patrón que `revisionIaQuery.ts`: todo vive en la querystring
 * (`<form method="get">`). Fecha y vajilla se filtran en la base; la versión de
 * prompt se filtra en memoria sobre lo ya cargado (así el select ofrece todas las
 * versiones del período y la evolución por versión sigue siendo comparable).
 */
import { daysAgoAR, todayAR } from '@/lib/date';
import type { ItemMetrica, NoDetectadoFila } from '@/lib/metricasIa';
import { VAJILLAS, type VajillaFiltro } from '@/lib/revisionIaQuery';
import { desdeTabla, filtrarFechaYVajilla, type FromClient, type QueryLike } from './supabaseQuery';

/** Filas por pedido a PostgREST y tope de seguridad del total (se avisa si se alcanza). */
export const BLOQUE = 1000;
export const MAX_FILAS = 20_000;
export const DIAS_POR_DEFECTO = 30;

export interface MetricasParams {
  /** YYYY-MM-DD, inclusivo; '' = sin límite. */
  desde: string;
  hasta: string;
  vajilla: VajillaFiltro;
  /** 'todas' o una `prompt_version`. */
  prompt: string;
  /** `alimento_norm` para la evolución por versión; '' = todos. */
  alimento: string;
}

type SearchParams = Record<string, string | string[] | undefined>;
const primero = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export const defaultsMetricas = (): MetricasParams => ({
  desde: daysAgoAR(DIAS_POR_DEFECTO),
  hasta: todayAR(),
  vajilla: 'todas',
  prompt: 'todas',
  alimento: '',
});

/** Normaliza la querystring: lo ausente o inválido cae al default; una fecha vacía = sin límite. */
export function parseMetricasParams(sp: SearchParams): MetricasParams {
  const d = defaultsMetricas();
  const fecha = (v: string | undefined, def: string) => (v === undefined ? def : FECHA.test(v) ? v : v === '' ? '' : def);
  const vajilla = primero(sp.vajilla);
  return {
    desde: fecha(primero(sp.desde), d.desde),
    hasta: fecha(primero(sp.hasta), d.hasta),
    vajilla: (VAJILLAS as readonly string[]).includes(vajilla ?? '') ? (vajilla as VajillaFiltro) : d.vajilla,
    prompt: (primero(sp.prompt) ?? '').trim().slice(0, 100) || d.prompt,
    alimento: (primero(sp.alimento) ?? '').trim().slice(0, 100),
  };
}

/** Querystring (con `?`, o vacía) omitiendo lo que vale el default. */
export function buildMetricasQuery(params: MetricasParams, overrides: Partial<MetricasParams> = {}): string {
  const p = { ...params, ...overrides };
  const d = defaultsMetricas();
  const qs = new URLSearchParams();
  if (p.desde !== d.desde) qs.set('desde', p.desde);
  if (p.hasta !== d.hasta) qs.set('hasta', p.hasta);
  if (p.vajilla !== d.vajilla) qs.set('vajilla', p.vajilla);
  if (p.prompt !== d.prompt) qs.set('prompt', p.prompt);
  if (p.alimento) qs.set('alimento', p.alimento);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/** Fecha y vajilla, iguales para las dos vistas (por eso los filtros aplican en conjunto a ambas). */
function filtrar(query: QueryLike, params: MetricasParams): QueryLike {
  return filtrarFechaYVajilla(query, params);
}

/** Trae todas las filas de una vista en bloques; `truncado` = se alcanzó el tope de seguridad. */
async function traerTodo<T>(
  client: FromClient,
  vista: string,
  columnas: string,
  params: MetricasParams,
  columnasBasicas?: string,
): Promise<{ filas: T[]; truncado: boolean }> {
  const filas: T[] = [];
  for (let desde = 0; desde < MAX_FILAS; desde += BLOQUE) {
    const { data, error } = await filtrar(desdeTabla(client, vista).select(columnas), params)
      .order('created_at', { ascending: true })
      .range(desde, desde + BLOQUE - 1);
    // Columna inexistente (42703): la vista todavía no tiene las columnas nuevas (falta aplicar el SQL). Se reintenta con las básicas.
    if (error && columnasBasicas && desde === 0 && (error.code === '42703' || /does not exist/i.test(String(error.message)))) {
      return traerTodo<T>(client, vista, columnasBasicas, params);
    }
    if (error) throw new Error(`No se pudieron leer las métricas: ${error.message}`);
    const bloque = (data ?? []) as T[];
    filas.push(...bloque);
    if (bloque.length < BLOQUE) return { filas, truncado: false };
  }
  return { filas, truncado: true };
}

export interface DatosMetricas {
  items: ItemMetrica[];
  noDetectados: NoDetectadoFila[];
  truncado: boolean;
}

const COLUMNAS_ITEMS =
  'alimento, alimento_norm, confidence, gramos_ia, gramos_usuario, motivos_revision, estado_revision, candidato_ejemplo, prompt_version, vajilla_tipo, created_at, ' +
  'alimento_usuario, origen_usuario, nutricionista_alimento, nutricionista_gramos, vajilla_diametro_cm, angulo_captura_grados';
const COLUMNAS_ITEMS_BASICAS =
  'alimento, alimento_norm, confidence, gramos_ia, gramos_usuario, motivos_revision, estado_revision, prompt_version, vajilla_tipo, created_at';
const COLUMNAS_NO_DETECTADOS ='alimento, alimento_norm, prompt_version, vajilla_tipo, created_at';

/** Carga ítems evaluados y no detectados con los MISMOS filtros de fecha y vajilla. */
export async function cargarMetricas(client: FromClient, params: MetricasParams): Promise<DatosMetricas> {
  const [items, noDet] = await Promise.all([
    traerTodo<Omit<ItemMetrica, 'confidence' | 'gramos_ia' | 'gramos_usuario' | 'nutricionista_gramos' | 'vajilla_diametro_cm'> & { confidence: number | string; gramos_ia: number | string; gramos_usuario: number | string | null; nutricionista_gramos?: number | string | null; vajilla_diametro_cm?: number | string | null }>(
      client,
      'v_metricas_ia_items',
      COLUMNAS_ITEMS,
      params,
      COLUMNAS_ITEMS_BASICAS,
    ),
    traerTodo<NoDetectadoFila>(client, 'v_metricas_ia_no_detectados', COLUMNAS_NO_DETECTADOS, params),
  ]);
  return {
    // numeric llega como string desde PostgREST según el tipo: se normaliza acá.
    items: items.filas.map((i) => ({
      ...i,
      confidence: Number(i.confidence),
      gramos_ia: Number(i.gramos_ia),
      gramos_usuario: i.gramos_usuario == null ? null : Number(i.gramos_usuario),
      nutricionista_gramos: i.nutricionista_gramos == null ? null : Number(i.nutricionista_gramos),
      vajilla_diametro_cm: i.vajilla_diametro_cm == null ? null : Number(i.vajilla_diametro_cm),
    })),
    noDetectados: noDet.filas,
    truncado: items.truncado || noDet.truncado,
  };
}

/** Versiones de prompt presentes en lo cargado, de la más reciente a la más antigua. */
export function versionesDePrompt(items: Array<Pick<ItemMetrica, 'prompt_version' | 'created_at'>>): string[] {
  const ultimo = new Map<string, string>();
  for (const i of items) if (!ultimo.has(i.prompt_version) || i.created_at > ultimo.get(i.prompt_version)!) ultimo.set(i.prompt_version, i.created_at);
  return [...ultimo.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([v]) => v);
}

/** Filtro por versión de prompt (en memoria). 'todas' no filtra. */
export function filtrarPorPrompt<T extends { prompt_version: string }>(filas: T[], prompt: string): T[] {
  return prompt === 'todas' ? filas : filas.filter((f) => f.prompt_version === prompt);
}
