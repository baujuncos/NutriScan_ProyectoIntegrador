/**
 * NUT-149 — Parámetros y consulta paginada de la cola de revisión de
 * predicciones IA (`/revision-ia`, panel de investigadores). Mismo patrón que
 * `validacionQuery.ts`: todo vive en la querystring (`<form method="get">`).
 * La lista NO genera signed URLs de las fotos: se piden de a una al abrir un ítem.
 */
import { MOTIVOS_REVISION, type MotivoRevision } from '@/lib/revisionIa';

export const PAGE_SIZE = 20;

export const ESTADOS_REVISION = ['pendiente', 'confirmado', 'corregido', 'todos'] as const;
export type EstadoRevisionFiltro = (typeof ESTADOS_REVISION)[number];

export const ORDENES_REVISION = ['fecha', 'confianza'] as const;
export type OrdenRevision = (typeof ORDENES_REVISION)[number];

export type MotivoFiltro = MotivoRevision | 'todos';

export const VAJILLAS = ['plato_playo', 'plato_postre', 'plato_hondo'] as const;
export type VajillaFiltro = (typeof VAJILLAS)[number] | 'todas';

export interface RevisionParams {
  estado: EstadoRevisionFiltro;
  motivo: MotivoFiltro;
  vajilla: VajillaFiltro;
  /** YYYY-MM-DD, inclusivo; '' = sin límite. */
  desde: string;
  hasta: string;
  q: string;
  orden: OrdenRevision;
  page: number;
}

const DEFAULTS: RevisionParams = { estado: 'pendiente', motivo: 'todos', vajilla: 'todas', desde: '', hasta: '', q: '', orden: 'fecha', page: 1 };

type SearchParams = Record<string, string | string[] | undefined>;

const primero = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Normaliza la querystring: lo inválido cae al valor por defecto. */
export function parseRevisionParams(sp: SearchParams): RevisionParams {
  const estado = primero(sp.estado);
  const motivo = primero(sp.motivo);
  const vajilla = primero(sp.vajilla);
  const orden = primero(sp.orden);
  const desde = primero(sp.desde) ?? '';
  const hasta = primero(sp.hasta) ?? '';
  const page = Number.parseInt(primero(sp.page) ?? '', 10);
  return {
    estado: (ESTADOS_REVISION as readonly string[]).includes(estado ?? '') ? (estado as EstadoRevisionFiltro) : DEFAULTS.estado,
    motivo: (MOTIVOS_REVISION as readonly string[]).includes(motivo ?? '') ? (motivo as MotivoRevision) : DEFAULTS.motivo,
    vajilla: (VAJILLAS as readonly string[]).includes(vajilla ?? '') ? (vajilla as VajillaFiltro) : DEFAULTS.vajilla,
    desde: FECHA.test(desde) ? desde : '',
    hasta: FECHA.test(hasta) ? hasta : '',
    q: (primero(sp.q) ?? '').trim().slice(0, 100),
    orden: (ORDENES_REVISION as readonly string[]).includes(orden ?? '') ? (orden as OrdenRevision) : DEFAULTS.orden,
    page: Number.isFinite(page) && page >= 1 ? page : DEFAULTS.page,
  };
}

/** Querystring (con `?`, o vacía) omitiendo lo que vale el default. */
export function buildRevisionQuery(params: RevisionParams, overrides: Partial<RevisionParams> = {}): string {
  const p = { ...params, ...overrides };
  const qs = new URLSearchParams();
  if (p.estado !== DEFAULTS.estado) qs.set('estado', p.estado);
  if (p.motivo !== DEFAULTS.motivo) qs.set('motivo', p.motivo);
  if (p.vajilla !== DEFAULTS.vajilla) qs.set('vajilla', p.vajilla);
  if (p.desde) qs.set('desde', p.desde);
  if (p.hasta) qs.set('hasta', p.hasta);
  if (p.q) qs.set('q', p.q);
  if (p.orden !== DEFAULTS.orden) qs.set('orden', p.orden);
  if (p.page !== DEFAULTS.page) qs.set('page', String(p.page));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/** Lo mínimo del cliente de Supabase que usamos (facilita mockear). */
export interface FromClient {
  from: (tabla: string) => any;
}

/** Aplica estado, motivo, rango de fechas y búsqueda (comunes a la página y al conteo). */
function filtrar(query: any, params: RevisionParams) {
  if (params.estado !== 'todos') query = query.eq('estado_revision', params.estado);
  if (params.motivo !== 'todos') query = query.contains('motivos_revision', [params.motivo]);
  if (params.vajilla !== 'todas') query = query.eq('vajilla_tipo', params.vajilla);
  if (params.desde) query = query.gte('created_at', `${params.desde}T00:00:00-03:00`);
  // Inclusivo: hasta el final del día (Argentina, UTC-3 sin horario de verano).
  if (params.hasta) query = query.lte('created_at', `${params.hasta}T23:59:59.999-03:00`);
  if (params.q) {
    // Los caracteres con significado en la sintaxis de `.or()` de PostgREST se sacan.
    const q = params.q.replace(/[*,()\\%_]/g, ' ').trim();
    if (q) query = query.or(`alimento_ia.ilike.%${q}%,alimento_usuario.ilike.%${q}%,nutricionista_alimento.ilike.%${q}%`);
  }
  return query;
}

/** Una página de la cola desde `v_revision_ia` (security_invoker: sólo investigadores ven filas ajenas). */
export async function consultarRevisiones(
  client: FromClient,
  params: RevisionParams,
): Promise<{ rows: unknown[]; total: number }> {
  let query = filtrar(client.from('v_revision_ia').select('*', { count: 'exact' }), params);

  // Orden estable: el criterio elegido, lo más reciente y, de desempate final, el id.
  if (params.orden === 'confianza') query = query.order('confidence', { ascending: true });
  query = query.order('created_at', { ascending: false }).order('id_deteccion_item');

  const desde = (params.page - 1) * PAGE_SIZE;
  const { data, error, count } = await query.range(desde, desde + PAGE_SIZE - 1);
  if (error) {
    // PostgREST responde 416 si el offset supera el total: 0 filas con el total real.
    if (error.code === 'PGRST103') {
      const { count: total, error: errorConteo } = await filtrar(
        client.from('v_revision_ia').select('id_deteccion_item', { count: 'exact', head: true }),
        params,
      );
      if (errorConteo) throw new Error(`No se pudo leer la cola de revisión: ${errorConteo.message}`);
      return { rows: [], total: total ?? 0 };
    }
    throw new Error(`No se pudo leer la cola de revisión: ${error.message}`);
  }
  return { rows: (data ?? []) as unknown[], total: count ?? 0 };
}

export interface ConteosRevision {
  pendiente: number;
  confirmado: number;
  corregido: number;
}

/** Totales por estado (sin filtros) para los chips del encabezado: 3 conteos livianos, sin traer filas. */
export async function contarPorEstado(client: FromClient): Promise<ConteosRevision> {
  const estados = ['pendiente', 'confirmado', 'corregido'] as const;
  const resultados = await Promise.all(
    estados.map((estado) =>
      client.from('v_revision_ia').select('id_deteccion_item', { count: 'exact', head: true }).eq('estado_revision', estado),
    ),
  );
  const [pendiente, confirmado, corregido] = resultados.map((r: { count: number | null; error: { message: string } | null }) => {
    if (r.error) throw new Error(`No se pudo contar la cola de revisión: ${r.error.message}`);
    return r.count ?? 0;
  });
  return { pendiente, confirmado, corregido };
}
