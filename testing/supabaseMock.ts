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

export function createSupabaseFromMock() {
  const colas = new Map<string, TableResult[]>();
  const llamadas: string[] = [];
  const inserts: InsertLlamado[] = [];

  function siguiente(tabla: string): TableResult {
    const cola = colas.get(tabla) ?? [];
    return cola.shift() ?? { data: null, error: null };
  }

  const from = vi.fn((tabla: string) => {
    llamadas.push(tabla);
    // El query builder real de supabase-js es "thenable": awaitear
    // `supabase.from(t).insert(x)` sin `.select().single()` también debe
    // resolver, por eso la cadena expone `.then` además de los métodos.
    const chain: Record<string, unknown> = {
      insert: vi.fn((payload: unknown) => {
        inserts.push({ tabla, payload });
        return chain;
      }),
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      single: vi.fn(() => Promise.resolve(siguiente(tabla))),
      then: (resolve: (v: TableResult) => void) => resolve(siguiente(tabla)),
    };
    return chain;
  });

  return {
    from,
    /** Encola el próximo resultado que devolverá esa tabla (FIFO por tabla). */
    mockTable(tabla: string, resultado: TableResult) {
      const cola = colas.get(tabla) ?? [];
      cola.push(resultado);
      colas.set(tabla, cola);
    },
    tablasLlamadas: () => llamadas,
    insertsLlamados: () => inserts,
    reset() {
      colas.clear();
      llamadas.length = 0;
      inserts.length = 0;
      from.mockClear();
    },
  };
}
