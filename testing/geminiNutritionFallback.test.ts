/**
 * NUT-119 — Resolutor de Gemini para alimentos sin match exacto: elige una
 * entrada de la lista de SARA2/VALIDADO o, si no hay equivalente, estima los
 * macros por 100 g. llamarGeminiJson mockeado; las clases de error son las reales.
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
import { resolverAlimentosConIA } from '@/lib/geminiNutritionFallback';

const CATALOGO = [
  { id: 885, nombre: 'Huevo de gallina, entero, crudo' },
  { id: 886, nombre: 'Huevo de gallina, entero, hervido' },
  { id: 82, nombre: 'Huevo de chocolate tipo Kinder' },
  { id: 425, nombre: 'Arroz blanco, crudo' },
];

const sinId = { id_catalogo: null };
const ARROZ = { index: 0, ...sinId, kcal_100g: 130, proteinas_100g: 2.7, grasas_100g: 0.3, carbs_100g: 28 };
const POLLO = { index: 1, ...sinId, kcal_100g: 165, proteinas_100g: 31, grasas_100g: 3.6, carbs_100g: 0 };
const ELIGE = (index: number, id: number) => ({
  index,
  id_catalogo: id,
  kcal_100g: null,
  proteinas_100g: null,
  grasas_100g: null,
  carbs_100g: null,
});
const ALIMENTOS = [
  { nombre: 'Arroz blanco', categoria: 'cereal' },
  { nombre: 'Pollo grillado', categoria: 'proteína animal' },
];

beforeEach(() => {
  llamarMock.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const responde = (items: unknown[], modelo = 'modelo-x') =>
  llamarMock.mockImplementationOnce(async (opts: { parse: (t: string) => unknown }) => ({
    resultado: opts.parse(JSON.stringify({ items })),
    modeloUsado: modelo,
  }));

describe('resolverAlimentosConIA — elegir de la lista', () => {
  it('"huevo" → la entrada de SARA2 (no el huevo de chocolate): devuelve el id y no estima macros', async () => {
    responde([ELIGE(0, 886)]);
    const r = await resolverAlimentosConIA([{ nombre: 'Huevo', categoria: 'proteína animal' }], CATALOGO);
    expect(r.resultados).toEqual([{ idCatalogo: 886 }]);
    expect(r.modelo).toBe('modelo-x');
    expect(llamarMock).toHaveBeenCalledTimes(1);
  });

  it('manda al modelo sólo los candidatos parecidos (id|nombre), no la lista entera: menos tokens', async () => {
    responde([ELIGE(0, 886)]);
    await resolverAlimentosConIA([{ nombre: 'Huevo', categoria: 'proteína animal' }], CATALOGO);
    const opts = llamarMock.mock.calls[0][0];
    expect(opts.systemInstruction).toContain('886|Huevo de gallina, entero, hervido');
    expect(opts.systemInstruction).toContain('82|Huevo de chocolate tipo Kinder'); // el modelo decide entre los parecidos
    expect(opts.systemInstruction).not.toContain('425|Arroz blanco, crudo'); // nada que ver con "huevo"
    expect(JSON.stringify(opts.contents)).toContain('Huevo');
    expect(JSON.stringify(opts.contents)).not.toContain('886|');
    expect(opts.maxTotalMs).toBeLessThanOrEqual(12_000);
  });

  it('si un alimento no comparte ninguna palabra con el catálogo, manda la lista entera (para no perder recall)', async () => {
    responde([ELIGE(0, 886)]);
    await resolverAlimentosConIA(
      [
        { nombre: 'Huevo', categoria: 'proteína animal' },
        { nombre: 'Aguacate', categoria: 'fruta' },
      ],
      CATALOGO,
    );
    expect(llamarMock.mock.calls[0][0].systemInstruction).toContain('425|Arroz blanco, crudo');
  });

  it('un id que existe en el catálogo pero NO estaba entre los candidatos enviados se descarta', async () => {
    responde([ELIGE(0, 425)]); // "Huevo" → el modelo devuelve un id de arroz que no le mandamos
    const r = await resolverAlimentosConIA([{ nombre: 'Huevo', categoria: 'proteína animal' }], CATALOGO);
    expect(r.resultados).toEqual([null]);
  });

  it('un id que NO está en la lista (inventado por el modelo) se descarta: el servidor no confía en él', async () => {
    responde([ELIGE(0, 999999), { ...ELIGE(1, 12345), kcal_100g: null }]);
    const r = await resolverAlimentosConIA(ALIMENTOS, CATALOGO);
    expect(r.resultados).toEqual([null, null]);
  });

  it('si trae un id válido Y macros, manda el id (la fuente es el catálogo, no la estimación)', async () => {
    responde([{ ...ELIGE(0, 425), kcal_100g: 999, proteinas_100g: 1, grasas_100g: 1, carbs_100g: 1 }]);
    const r = await resolverAlimentosConIA([ALIMENTOS[0]], CATALOGO);
    expect(r.resultados).toEqual([{ idCatalogo: 425 }]);
  });
});

describe('resolverAlimentosConIA — estimar cuando no hay equivalente', () => {
  it('id null + macros plausibles → macros por 100 g, mapeados por índice', async () => {
    responde([POLLO, ARROZ]); // desordenado a propósito
    const r = await resolverAlimentosConIA(ALIMENTOS, CATALOGO);
    expect(r.resultados).toEqual([
      { macros: { kcal_100g: 130, proteinas_100g: 2.7, grasas_100g: 0.3, carbs_100g: 28 } },
      { macros: { kcal_100g: 165, proteinas_100g: 31, grasas_100g: 3.6, carbs_100g: 0 } },
    ]);
    expect(llamarMock).toHaveBeenCalledTimes(1); // una sola llamada batch
  });

  it('índice faltante, duplicado o fuera de rango → null en ese ítem', async () => {
    responde([ARROZ, { ...ARROZ }, { ...POLLO, index: 7 }]);
    const r = await resolverAlimentosConIA(ALIMENTOS, CATALOGO);
    expect(r.resultados).toEqual([null, null]);
  });

  it('valores implausibles → null solo en ese ítem', async () => {
    responde([ARROZ, { ...POLLO, kcal_100g: 950 }]);
    const r = await resolverAlimentosConIA(ALIMENTOS, CATALOGO);
    expect(r.resultados[0]).not.toBeNull();
    expect(r.resultados[1]).toBeNull();
  });

  it('no lo reconoce (todo null) → null', async () => {
    responde([ARROZ, { index: 1, ...sinId, kcal_100g: null, proteinas_100g: null, grasas_100g: null, carbs_100g: null }]);
    const r = await resolverAlimentosConIA(ALIMENTOS, CATALOGO);
    expect(r.resultados[1]).toBeNull();
  });

  it('sin catálogo (no se pudo cargar): igual estima macros, sin sección de catálogo en el prompt', async () => {
    responde([ARROZ, POLLO]);
    const r = await resolverAlimentosConIA(ALIMENTOS, []);
    expect(r.resultados.every((x) => x && 'macros' in x)).toBe(true);
    expect(llamarMock.mock.calls[0][0].systemInstruction).not.toContain('CATÁLOGO');
  });
});

describe('resolverAlimentosConIA — formato y errores', () => {
  it('el parse rechaza texto que no es JSON o que no cumple el schema (dispara el reintento)', async () => {
    responde([ARROZ, POLLO]);
    await resolverAlimentosConIA(ALIMENTOS, CATALOGO);
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
    const r = await resolverAlimentosConIA(ALIMENTOS, CATALOGO);
    expect(r).toEqual({ resultados: [null, null], modelo: null });
  });

  it('lista vacía: no llama a Gemini', async () => {
    const r = await resolverAlimentosConIA([], CATALOGO);
    expect(r).toEqual({ resultados: [], modelo: null });
    expect(llamarMock).not.toHaveBeenCalled();
  });
});
