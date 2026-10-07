/**
 * NUT-119 — Fallback de Gemini: macros por 100 g de alimentos sin match en la DB.
 * llamarGeminiJson mockeado; las clases de error son las reales.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { llamarMock } = vi.hoisted(() => ({ llamarMock: vi.fn() }));

vi.mock('@/lib/geminiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/geminiClient')>();
  return { ...actual, llamarGeminiJson: llamarMock };
});

import {
  GeminiConfigError,
  GeminiInvalidResponseError,
  GeminiRateLimitError,
  GeminiTimeoutError,
  GeminiUnavailableError,
} from '@/lib/geminiClient';
import { estimarMacrosPor100g } from '@/lib/geminiNutritionFallback';

const ARROZ = { index: 0, kcal_100g: 130, proteinas_100g: 2.7, grasas_100g: 0.3, carbs_100g: 28 };
const POLLO = { index: 1, kcal_100g: 165, proteinas_100g: 31, grasas_100g: 3.6, carbs_100g: 0 };
const ALIMENTOS = [
  { nombre: 'Arroz blanco', categoria: 'cereal' },
  { nombre: 'Pollo grillado', categoria: 'proteína animal' },
];

beforeEach(() => {
  llamarMock.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const responde = (items: unknown[], modelo = 'modelo-x') =>
  llamarMock.mockImplementationOnce(async (opts: { parse: (t: string) => unknown }) => {
    const resultado = opts.parse(JSON.stringify({ items }));
    return { resultado, modeloUsado: modelo };
  });

describe('estimarMacrosPor100g', () => {
  it('éxito: un valor por alimento, mapeado por índice, con el modelo usado', async () => {
    responde([POLLO, ARROZ]); // desordenado a propósito
    const r = await estimarMacrosPor100g(ALIMENTOS);
    expect(r.modelo).toBe('modelo-x');
    expect(r.valores).toEqual([
      { kcal_100g: 130, proteinas_100g: 2.7, grasas_100g: 0.3, carbs_100g: 28 },
      { kcal_100g: 165, proteinas_100g: 31, grasas_100g: 3.6, carbs_100g: 0 },
    ]);
    expect(llamarMock).toHaveBeenCalledTimes(1); // una sola llamada batch
  });

  it('manda los nombres y categorías en el contenido y usa un presupuesto corto', async () => {
    responde([ARROZ, POLLO]);
    await estimarMacrosPor100g(ALIMENTOS);
    const opts = llamarMock.mock.calls[0][0];
    expect(JSON.stringify(opts.contents)).toContain('Arroz blanco');
    expect(JSON.stringify(opts.contents)).toContain('proteína animal');
    expect(opts.maxTotalMs).toBeLessThanOrEqual(12_000);
  });

  it('índice faltante, duplicado o fuera de rango → null en ese ítem', async () => {
    responde([ARROZ, { ...ARROZ }, { ...POLLO, index: 7 }]);
    const r = await estimarMacrosPor100g(ALIMENTOS);
    // 0 duplicado → ambiguo → null; 1 ausente (el 7 no existe) → null
    expect(r.valores).toEqual([null, null]);
  });

  it('valores implausibles → null solo en ese ítem', async () => {
    responde([ARROZ, { ...POLLO, kcal_100g: 950 }]);
    const r = await estimarMacrosPor100g(ALIMENTOS);
    expect(r.valores[0]).not.toBeNull();
    expect(r.valores[1]).toBeNull();
  });

  it('el modelo no lo reconoce (null en algún macro) → null', async () => {
    responde([ARROZ, { index: 1, kcal_100g: null, proteinas_100g: null, grasas_100g: null, carbs_100g: null }]);
    const r = await estimarMacrosPor100g(ALIMENTOS);
    expect(r.valores[1]).toBeNull();
  });

  it('el parse rechaza texto que no es JSON o que no cumple el schema (dispara el reintento)', async () => {
    responde([ARROZ, POLLO]);
    await estimarMacrosPor100g(ALIMENTOS);
    const { parse } = llamarMock.mock.calls[0][0] as { parse: (t: string) => unknown };
    expect(parse('no json')).toBeNull();
    expect(parse(JSON.stringify({ items: [{ index: 'x' }] }))).toBeNull();
    expect(parse(JSON.stringify({ otra: 1 }))).toBeNull();
  });

  it.each([
    ['timeout', new GeminiTimeoutError('t')],
    ['429', new GeminiRateLimitError('r')],
    ['503', new GeminiUnavailableError('u')],
    ['JSON inválido', new GeminiInvalidResponseError('i')],
    ['sin key', new GeminiConfigError('c')],
    ['error cualquiera', new Error('x')],
  ])('%s → todos null, modelo null, no lanza', async (_n, err) => {
    llamarMock.mockRejectedValueOnce(err);
    const r = await estimarMacrosPor100g(ALIMENTOS);
    expect(r).toEqual({ valores: [null, null], modelo: null });
  });

  it('lista vacía: no llama a Gemini', async () => {
    const r = await estimarMacrosPor100g([]);
    expect(r).toEqual({ valores: [], modelo: null });
    expect(llamarMock).not.toHaveBeenCalled();
  });
});
