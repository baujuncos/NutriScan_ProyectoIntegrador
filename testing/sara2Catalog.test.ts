/**
 * Catálogo SARA2 para el chat: carga paginada (1000 por página), caché de 10 minutos y
 * compatibilidad con bases sin la columna `fuente` (error 42703).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

type Resp = { data: unknown[] | null; error: { code?: string; message?: string } | null };

/** Cliente falso: cada `.range()` consume la siguiente respuesta; registra los filtros aplicados. */
function clienteConRespuestas(respuestas: Resp[]) {
  const eqs: unknown[][] = [];
  const ranges: number[][] = [];
  const cola = [...respuestas];
  const chain: Record<string, unknown> = {
    select: () => chain,
    not: () => chain,
    eq: (...a: unknown[]) => (eqs.push(a), chain),
    order: () => chain,
    range: (...a: number[]) => (ranges.push(a), Promise.resolve(cola.shift() ?? { data: [], error: null })),
  };
  return { supabase: { from: () => chain } as unknown as SupabaseClient, eqs, ranges };
}

const fila = (id: number) => ({ id_alimento: id, nombre: `Alimento ${id}`, kcal_100g: '100', proteinas_100g: '5', grasas_100g: null, carbs_100g: '20' });

// Cada test importa el módulo de nuevo: la caché es una variable del módulo.
async function cargar() {
  vi.resetModules();
  return import('@/lib/chat/sara2Catalog');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('createSupabaseSara2Catalog', () => {
  it('convierte los números que llegan como texto y completa los nulos con 0', async () => {
    const { createSupabaseSara2Catalog } = await cargar();
    const { supabase } = clienteConRespuestas([{ data: [fila(1)], error: null }]);
    const [alimento] = await createSupabaseSara2Catalog(supabase).getAll();
    expect(alimento).toEqual({ id_alimento: 1, nombre: 'Alimento 1', kcal_100g: 100, proteinas_100g: 5, grasas_100g: 0, carbs_100g: 20 });
  });

  it('filtra por fuente SARA2', async () => {
    const { createSupabaseSara2Catalog } = await cargar();
    const { supabase, eqs } = clienteConRespuestas([{ data: [fila(1)], error: null }]);
    await createSupabaseSara2Catalog(supabase).getAll();
    expect(eqs[0]).toEqual(['fuente', 'SARA2']);
  });

  it('valor límite: una página de exactamente 1000 filas obliga a pedir otra; una de 999 no', async () => {
    const { createSupabaseSara2Catalog } = await cargar();
    const mil = Array.from({ length: 1000 }, (_, i) => fila(i + 1));
    const { supabase, ranges } = clienteConRespuestas([{ data: mil, error: null }, { data: [fila(1001)], error: null }]);
    const todos = await createSupabaseSara2Catalog(supabase).getAll();
    expect(todos).toHaveLength(1001);
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);

    const otro = await cargar();
    const nuevo = clienteConRespuestas([{ data: mil.slice(0, 999), error: null }]);
    expect(await otro.createSupabaseSara2Catalog(nuevo.supabase).getAll()).toHaveLength(999);
    expect(nuevo.ranges).toHaveLength(1);
  });

  it('usa la caché dentro de los 10 minutos y recarga después', async () => {
    const { createSupabaseSara2Catalog } = await cargar();
    const { supabase, ranges } = clienteConRespuestas([{ data: [fila(1)], error: null }, { data: [fila(1), fila(2)], error: null }]);
    const catalogo = createSupabaseSara2Catalog(supabase);
    expect(await catalogo.getAll()).toHaveLength(1);
    vi.advanceTimersByTime(10 * 60 * 1000 - 1);
    expect(await catalogo.getAll()).toHaveLength(1);
    expect(ranges).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(await catalogo.getAll()).toHaveLength(2);
    expect(ranges).toHaveLength(2);
  });

  it('si la base no tiene la columna `fuente` (42703) reintenta sin filtro', async () => {
    const { createSupabaseSara2Catalog } = await cargar();
    const { supabase, eqs } = clienteConRespuestas([
      { data: null, error: { code: '42703', message: 'column fuente does not exist' } },
      { data: [fila(7)], error: null },
    ]);
    const todos = await createSupabaseSara2Catalog(supabase).getAll();
    expect(todos.map((a) => a.id_alimento)).toEqual([7]);
    expect(eqs).toHaveLength(1); // el segundo intento ya no filtra
  });

  it('cualquier otro error de Supabase se propaga', async () => {
    const { createSupabaseSara2Catalog } = await cargar();
    const { supabase } = clienteConRespuestas([{ data: null, error: { code: '500', message: 'boom' } }]);
    await expect(createSupabaseSara2Catalog(supabase).getAll()).rejects.toMatchObject({ message: 'boom' });
  });

  it('una respuesta sin datos ni error devuelve un catálogo vacío', async () => {
    const { createSupabaseSara2Catalog } = await cargar();
    const { supabase } = clienteConRespuestas([{ data: null, error: null }]);
    expect(await createSupabaseSara2Catalog(supabase).getAll()).toEqual([]);
  });
});

describe('macrosForQuantity y sara2Per100', () => {
  it('escala por cantidad y redondea a 2 decimales (misma fórmula que el trigger SQL)', async () => {
    const { macrosForQuantity, sara2Per100 } = await cargar();
    const per100 = sara2Per100({ id_alimento: 1, nombre: 'x', kcal_100g: 52, proteinas_100g: 0.3, grasas_100g: 0.2, carbs_100g: 13.8 });
    expect(macrosForQuantity(per100, 150)).toEqual({ kcal: 78, proteinas_g: 0.45, grasas_g: 0.3, carbs_g: 20.7 });
    expect(macrosForQuantity(per100, 0)).toEqual({ kcal: 0, proteinas_g: 0, grasas_g: 0, carbs_g: 0 });
  });
});
