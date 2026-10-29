/**
 * Tipos mínimos del cliente de Supabase que usan las consultas de las pantallas del investigador
 * (revisión de IA, métricas y validación). Se tipa solo lo que se usa para poder mockearlo en los
 * tests sin `any`, y los filtros comunes viven acá en lugar de repetirse en cada módulo.
 */

export interface QueryResult {
  data: unknown[] | null;
  error: { code?: string; message: string } | null;
  count?: number | null;
}

/** Query builder encadenable de PostgREST; es "thenable": `await query` devuelve el resultado. */
export interface QueryLike extends PromiseLike<QueryResult> {
  select(columnas: string, opciones?: { count?: 'exact'; head?: boolean }): QueryLike;
  eq(columna: string, valor: unknown): QueryLike;
  gte(columna: string, valor: unknown): QueryLike;
  lte(columna: string, valor: unknown): QueryLike;
  contains(columna: string, valor: unknown[]): QueryLike;
  in(columna: string, valores: unknown[]): QueryLike;
  ilike(columna: string, patron: string): QueryLike;
  or(filtro: string): QueryLike;
  order(columna: string, opciones?: { ascending?: boolean; nullsFirst?: boolean }): QueryLike;
  range(desde: number, hasta: number): QueryLike;
}

/**
 * Lo mínimo del cliente de Supabase que usamos (facilita mockear). `from` devuelve `unknown` a propósito:
 * el query builder real de supabase-js tiene tipos genéricos enormes y los dobles de prueba son objetos
 * simples; `desdeTabla` es el único punto donde se lo ve como `QueryLike`.
 */
export interface FromClient {
  from: (tabla: string) => unknown;
}

export function desdeTabla(client: FromClient, tabla: string): QueryLike {
  return client.from(tabla) as QueryLike;
}

export interface FiltroFechaVajilla {
  desde: string;
  hasta: string;
  vajilla: string;
}

/** Rango de fechas (inclusivo, hora de Argentina UTC-3 sin horario de verano) y tipo de vajilla. */
export function filtrarFechaYVajilla(query: QueryLike, params: FiltroFechaVajilla): QueryLike {
  let q = query;
  if (params.desde) q = q.gte('created_at', `${params.desde}T00:00:00-03:00`);
  if (params.hasta) q = q.lte('created_at', `${params.hasta}T23:59:59.999-03:00`);
  if (params.vajilla !== 'todas') q = q.eq('vajilla_tipo', params.vajilla);
  return q;
}
