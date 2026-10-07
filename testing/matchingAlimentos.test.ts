/**
 * NUT-119 — Wrapper TS de la RPC match_alimentos (RPC mockeada).
 */
import { describe, expect, it } from 'vitest';
import { matchearAlimentos, UMBRAL_MATCH } from '@/lib/matchingAlimentos';
import { createSupabaseFromMock } from './supabaseMock';

describe('matchearAlimentos', () => {
  it('llama a la RPC una sola vez con todos los nombres y el umbral', async () => {
    const mock = createSupabaseFromMock();
    mock.mockRpc('match_alimentos', { data: [], error: null });
    await matchearAlimentos(mock, ['Arroz', 'X']);
    expect(mock.rpcLlamadas()).toEqual([
      { nombre: 'match_alimentos', args: { p_nombres: ['Arroz', 'X'], p_umbral: UMBRAL_MATCH } },
    ]);
  });

  it('devuelve un resultado por índice de entrada, con idAlimento null si no hubo match', async () => {
    const mock = createSupabaseFromMock();
    mock.mockRpc('match_alimentos', {
      // La RPC numera desde 1 (with ordinality) y puede venir desordenada.
      data: [
        { idx: 2, nombre_normalizado: 'x', id_alimento: null, nombre: null, fuente: null, score: null, metodo: null,
          kcal_100g: null, proteinas_100g: null, grasas_100g: null, carbs_100g: null },
        { idx: 1, nombre_normalizado: 'arroz', id_alimento: 7, nombre: 'Arroz', fuente: 'SARA2', score: 1, metodo: 'exacto',
          kcal_100g: '130', proteinas_100g: '2.7', grasas_100g: '0.3', carbs_100g: '28' },
      ],
      error: null,
    });
    const res = await matchearAlimentos(mock, ['Arroz', 'X']);
    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({
      nombreNormalizado: 'arroz',
      idAlimento: 7,
      metodo: 'exacto',
      score: 1,
      macros: { kcal_100g: 130, proteinas_100g: 2.7, grasas_100g: 0.3, carbs_100g: 28 },
    });
    expect(res[1]).toMatchObject({ nombreNormalizado: 'x', idAlimento: null, metodo: null, macros: null });
  });

  it('un nombre que la RPC no devolvió queda como sin match', async () => {
    const mock = createSupabaseFromMock();
    mock.mockRpc('match_alimentos', { data: [], error: null });
    const res = await matchearAlimentos(mock, ['Algo']);
    expect(res).toEqual([
      { nombreNormalizado: null, idAlimento: null, nombre: null, fuente: null, score: null, metodo: null, macros: null },
    ]);
  });

  it('lista vacía: no llama a la RPC', async () => {
    const mock = createSupabaseFromMock();
    expect(await matchearAlimentos(mock, [])).toEqual([]);
    expect(mock.rpcLlamadas()).toHaveLength(0);
  });

  it('lanza si la RPC devuelve error', async () => {
    const mock = createSupabaseFromMock();
    mock.mockRpc('match_alimentos', { data: null, error: { message: 'boom' } });
    await expect(matchearAlimentos(mock, ['Arroz'])).rejects.toThrow(/boom/);
  });
});
