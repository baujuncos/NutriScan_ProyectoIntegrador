/**
 * NUT-119 — Parámetros y consulta paginada de la cola de validación
 * (`/validacion`, panel de investigadores). Todo vive en la querystring para
 * que los filtros funcionen sin JS (`<form method="get">`) y los links de
 * paginación sean simples `<a href>`.
 */

export const PAGE_SIZE = 20;

export const ESTADOS_FILTRO = ['pendiente', 'validado', 'descartado', 'todos'] as const;
export type EstadoFiltro = (typeof ESTADOS_FILTRO)[number];

export const ORDENES = ['fecha', 'ocurrencias'] as const;
export type OrdenCola = (typeof ORDENES)[number];

export interface ValidacionParams {
  estado: EstadoFiltro;
  q: string;
  orden: OrdenCola;
  page: number;
}

const DEFAULTS: ValidacionParams = { estado: 'pendiente', q: '', orden: 'fecha', page: 1 };

type SearchParams = Record<string, string | string[] | undefined>;

const primero = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Normaliza la querystring: lo inválido cae al valor por defecto. */
export function parseParams(sp: SearchParams): ValidacionParams {
  const estado = primero(sp.estado);
  const orden = primero(sp.orden);
  const page = Number.parseInt(primero(sp.page) ?? '', 10);
  return {
    estado: (ESTADOS_FILTRO as readonly string[]).includes(estado ?? '') ? (estado as EstadoFiltro) : DEFAULTS.estado,
    q: (primero(sp.q) ?? '').trim().slice(0, 100),
    orden: (ORDENES as readonly string[]).includes(orden ?? '') ? (orden as OrdenCola) : DEFAULTS.orden,
    page: Number.isFinite(page) && page >= 1 ? page : DEFAULTS.page,
  };
}

/** Querystring (con `?`, o vacía) omitiendo lo que vale el default. */
export function buildQuery(params: ValidacionParams, overrides: Partial<ValidacionParams> = {}): string {
  const p = { ...params, ...overrides };
  const qs = new URLSearchParams();
  if (p.estado !== DEFAULTS.estado) qs.set('estado', p.estado);
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

/** Aplica estado + búsqueda (comunes a la página y al conteo). */
function filtrar(query: any, params: ValidacionParams) {
  if (params.estado !== 'todos') query = query.eq('estado', params.estado);
  if (params.q) query = query.ilike('nombre_original', `%${params.q}%`);
  return query;
}

/** Una página de la cola desde `v_alimentos_pendientes` (security_invoker: solo investigadores ven filas). */
export async function consultarPendientes(
  client: FromClient,
  params: ValidacionParams,
): Promise<{ rows: unknown[]; total: number }> {
  let query = filtrar(client.from('v_alimentos_pendientes').select('*', { count: 'exact' }), params);

  // Orden estable: el criterio elegido, lo más reciente y, de desempate final, el id.
  if (params.orden === 'ocurrencias') query = query.order('ocurrencias', { ascending: false });
  query = query.order('ultima_ocurrencia', { ascending: false, nullsFirst: false }).order('id_pendiente');

  const desde = (params.page - 1) * PAGE_SIZE;
  const { data, error, count } = await query.range(desde, desde + PAGE_SIZE - 1);
  if (error) {
    // PostgREST responde 416 si el offset supera el total (ej. se validó el último de la última página):
    // no es un error — devolvemos 0 filas con el total real y la página redirige a la última válida.
    if (error.code === 'PGRST103') {
      const { count: total, error: errorConteo } = await filtrar(
        client.from('v_alimentos_pendientes').select('id_pendiente', { count: 'exact', head: true }),
        params,
      );
      if (errorConteo) throw new Error(`No se pudo leer la cola de validación: ${errorConteo.message}`);
      return { rows: [], total: total ?? 0 };
    }
    throw new Error(`No se pudo leer la cola de validación: ${error.message}`);
  }
  return { rows: (data ?? []) as unknown[], total: count ?? 0 };
}
