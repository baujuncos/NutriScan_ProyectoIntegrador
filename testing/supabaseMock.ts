/**
 * Mock encadenable de `supabase.from(tabla)...` para tests de Route Handlers
 * que persisten en Supabase, sin pegarle nunca a una base real. No existe
 * ningún mock de `.from()` en el repo todavía — este es el primero, pensado
 * para reusarse en cualquier test que necesite mockear inserts/selects.
 *
 * Uso típico:
 * ```ts
 * const supabaseFromMock = createSupabaseFromMock();
 * vi.mock('@/lib/supabase/server', () => ({
 *   createClient: async () => ({ auth: { getUser: getUserMock }, from: supabaseFromMock.from }),
 * }));
 * // en el test:
 * supabaseFromMock.mockTable('detecciones_ia', { data: { id_deteccion: 1 }, error: null });
 * ```
 */
import { vi } from 'vitest';

export interface TableResult {
  data: unknown;
  error: unknown;
}

export interface InsertLlamado {
  tabla: string;
  payload: unknown;
}

export interface FiltroLlamado {
  tabla: string;
  metodo: string;
  args: unknown[];
}

export interface RpcLlamado {
  nombre: string;
  args: unknown;
}

export interface StorageLlamado {
  bucket: string;
  metodo: string;
  args: unknown[];
}

const METODOS_STORAGE = ['upload', 'remove', 'list', 'createSignedUrl', 'createSignedUrls', 'download'] as const;

export function createSupabaseFromMock() {
  const colas = new Map<string, TableResult[]>();
  const colasRpc = new Map<string, TableResult[]>();
  const colasStorage = new Map<string, TableResult[]>();
  const rpcs: RpcLlamado[] = [];
  const storageLlamados: StorageLlamado[] = [];
  const llamadas: string[] = [];
  const inserts: InsertLlamado[] = [];
  const filtros: FiltroLlamado[] = [];

  function siguiente(tabla: string): TableResult {
    const cola = colas.get(tabla) ?? [];
    return cola.shift() ?? { data: null, error: null };
  }

  const from = vi.fn((tabla: string) => {
    llamadas.push(tabla);
    // El query builder real de supabase-js es "thenable": awaitear
    // `supabase.from(t).insert(x)` sin `.select().single()` también debe
    // resolver, por eso la cadena expone `.then` además de los métodos.
    let chain: Record<string, unknown>;
    chain = new Proxy(
      {
        insert: vi.fn((payload: unknown) => {
          inserts.push({ tabla, payload });
          return chain;
        }),
        // upsert se registra como insert: para los tests es "una escritura".
        upsert: vi.fn((payload: unknown) => {
          inserts.push({ tabla, payload });
          return chain;
        }),
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        single: vi.fn(() => Promise.resolve(siguiente(tabla))),
        then: (resolve: (v: TableResult) => void) => resolve(siguiente(tabla)),
      },
      {
        get(target, prop: string) {
          if (prop in target) return (target as Record<string, unknown>)[prop];
          // Passthrough encadenable para cualquier método de filtro de
          // PostgREST (ilike, or, not, order, limit, in, etc.) que todavía no
          // tiene un stub explícito arriba — siempre devuelve la misma cadena.
          // Cada llamada queda registrada en `filtros` para poder assertar
          // qué predicados arma el código bajo test, no solo qué devuelve.
          return vi.fn((...args: unknown[]) => {
            filtros.push({ tabla, metodo: prop, args });
            return chain;
          });
        },
      },
    );
    return chain;
  });

  /** NUT-119 — `supabase.rpc(nombre, args)`: FIFO por función, devuelve `{data:null,error:null}` si no hay nada encolado. */
  const rpc = vi.fn((nombre: string, args?: unknown) => {
    rpcs.push({ nombre, args });
    return Promise.resolve((colasRpc.get(nombre) ?? []).shift() ?? { data: null, error: null });
  });

  /** NUT-119 — `supabase.storage.from(bucket).<metodo>(...)`: FIFO por método. */
  const storage = {
    from: (bucket: string) =>
      Object.fromEntries(
        METODOS_STORAGE.map((metodo) => [
          metodo,
          vi.fn((...args: unknown[]) => {
            storageLlamados.push({ bucket, metodo, args });
            return Promise.resolve((colasStorage.get(metodo) ?? []).shift() ?? { data: null, error: null });
          }),
        ]),
      ) as unknown as Record<(typeof METODOS_STORAGE)[number], (...args: any[]) => Promise<{ data: any; error: any }>>,
  };

  return {
    from,
    rpc,
    storage,
    mockRpc(nombre: string, resultado: TableResult) {
      colasRpc.set(nombre, [...(colasRpc.get(nombre) ?? []), resultado]);
    },
    mockStorage(metodo: (typeof METODOS_STORAGE)[number], resultado: TableResult) {
      colasStorage.set(metodo, [...(colasStorage.get(metodo) ?? []), resultado]);
    },
    rpcLlamadas: () => rpcs,
    storageLlamadas: () => storageLlamados,
    /** Encola el próximo resultado que devolverá esa tabla (FIFO por tabla). */
    mockTable(tabla: string, resultado: TableResult) {
      const cola = colas.get(tabla) ?? [];
      cola.push(resultado);
      colas.set(tabla, cola);
    },
    tablasLlamadas: () => llamadas,
    insertsLlamados: () => inserts,
    /** Cada llamada a un método de filtro sin stub explícito (ilike, or, not, order, limit, in, etc.), en orden. */
    filtrosLlamados: () => filtros,
    reset() {
      colas.clear();
      colasRpc.clear();
      colasStorage.clear();
      rpcs.length = 0;
      storageLlamados.length = 0;
      rpc.mockClear();
      llamadas.length = 0;
      inserts.length = 0;
      filtros.length = 0;
      from.mockClear();
    },
  };
}
