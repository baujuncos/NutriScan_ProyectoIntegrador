/**
 * NUT-119 — Test de caracterización de geminiClient: fija el comportamiento
 * de reconocerAlimentos (fallback de modelo, reintento por JSON, mapeo de
 * errores) ANTES de extraer `llamarGeminiJson`, y después cubre el helper.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateContentMock, getGenerativeModelMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
  getGenerativeModelMock: vi.fn(),
}));

vi.mock('@google/generative-ai', () => {
  class GoogleGenerativeAIAbortError extends Error {}
  class GoogleGenerativeAIFetchError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  }
  class GoogleGenerativeAI {
    getGenerativeModel(...args: unknown[]) {
      return getGenerativeModelMock(...args);
    }
  }
  return {
    GoogleGenerativeAI,
    GoogleGenerativeAIAbortError,
    GoogleGenerativeAIFetchError,
    SchemaType: { STRING: 'STRING', NUMBER: 'NUMBER', INTEGER: 'INTEGER', BOOLEAN: 'BOOLEAN', ARRAY: 'ARRAY', OBJECT: 'OBJECT' },
  };
});

import { GoogleGenerativeAIAbortError, GoogleGenerativeAIFetchError } from '@google/generative-ai';
import {
  GeminiConfigError,
  GeminiError,
  GeminiInvalidResponseError,
  GeminiRateLimitError,
  GeminiTimeoutError,
  GeminiUnavailableError,
  llamarGeminiJson,
  reconocerAlimentos,
} from '@/lib/geminiClient';

const VALID = {
  detectedIngredients: [
    { ingredient: 'arroz', type: 'cereal', confidence: 0.9, estimatedWeightGrams: 120, questions: [], boundingBox: null },
  ],
  totalEstimatedWeightGrams: 120,
};

const ok = (payload: unknown) => ({ response: { text: () => JSON.stringify(payload) } });
const texto = (t: string) => ({ response: { text: () => t } });

const PARAMS = {
  contexto: { tipoVajilla: 'plato_playo' as const, diametroCm: 26, anguloCapturaGrados: 35 },
  imagen: { base64: 'AAAA', mimeType: 'image/jpeg' },
  anguloAproximado: false,
};

beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', 'test-key');
  vi.stubEnv('GEMINI_MODEL', 'modelo-a');
  vi.stubEnv('GEMINI_FALLBACK_MODEL', 'modelo-b');
  getGenerativeModelMock.mockReset().mockImplementation(() => ({ generateContent: generateContentMock }));
  generateContentMock.mockReset();
});

const modelosPedidos = () => getGenerativeModelMock.mock.calls.map((c) => (c[0] as { model: string }).model);

describe('reconocerAlimentos (caracterización)', () => {
  it('éxito: una sola llamada con el modelo principal', async () => {
    generateContentMock.mockResolvedValueOnce(ok(VALID));
    const r = await reconocerAlimentos(PARAMS);
    expect(r.resultado.detectedIngredients[0].ingredient).toBe('arroz');
    expect(r.modeloUsado).toBe('modelo-a');
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('503 en el principal → prueba el modelo de respaldo y devuelve cuál usó', async () => {
    generateContentMock
      .mockRejectedValueOnce(new GoogleGenerativeAIFetchError('saturado', 503))
      .mockResolvedValueOnce(ok(VALID));
    const r = await reconocerAlimentos(PARAMS);
    expect(r.modeloUsado).toBe('modelo-b');
    expect(modelosPedidos()).toEqual(['modelo-a', 'modelo-b']);
  });

  it('503 en ambos modelos → GeminiUnavailableError', async () => {
    generateContentMock.mockRejectedValue(new GoogleGenerativeAIFetchError('saturado', 503));
    await expect(reconocerAlimentos(PARAMS)).rejects.toBeInstanceOf(GeminiUnavailableError);
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it('429 → GeminiRateLimitError sin probar el respaldo', async () => {
    generateContentMock.mockRejectedValue(new GoogleGenerativeAIFetchError('cuota', 429));
    await expect(reconocerAlimentos(PARAMS)).rejects.toBeInstanceOf(GeminiRateLimitError);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('abort con respaldo igual al principal → GeminiTimeoutError sin reintentar', async () => {
    vi.stubEnv('GEMINI_FALLBACK_MODEL', 'modelo-a');
    generateContentMock.mockRejectedValue(new GoogleGenerativeAIAbortError('abort'));
    await expect(reconocerAlimentos(PARAMS)).rejects.toBeInstanceOf(GeminiTimeoutError);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('otro error de red → GeminiError', async () => {
    generateContentMock.mockRejectedValue(new Error('rota'));
    await expect(reconocerAlimentos(PARAMS)).rejects.toBeInstanceOf(GeminiError);
  });

  it('JSON inválido → reintenta con la instrucción estricta y devuelve el segundo', async () => {
    generateContentMock.mockResolvedValueOnce(texto('no es json')).mockResolvedValueOnce(ok(VALID));
    const r = await reconocerAlimentos(PARAMS);
    expect(r.resultado.totalEstimatedWeightGrams).toBe(120);
    expect(generateContentMock).toHaveBeenCalledTimes(2);
    const instruccion2 = (getGenerativeModelMock.mock.calls[1][0] as { systemInstruction: string }).systemInstruction;
    expect(instruccion2).toMatch(/no cumplió el formato JSON/);
  });

  it('JSON inválido dos veces → GeminiInvalidResponseError', async () => {
    generateContentMock.mockResolvedValue(texto('{"x":1}'));
    await expect(reconocerAlimentos(PARAMS)).rejects.toBeInstanceOf(GeminiInvalidResponseError);
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it('sin GEMINI_API_KEY → GeminiConfigError', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    await expect(reconocerAlimentos(PARAMS)).rejects.toBeInstanceOf(GeminiConfigError);
  });

  it('manda imagen + instrucción, responseSchema JSON y thinking minimal', async () => {
    generateContentMock.mockResolvedValueOnce(ok(VALID));
    await reconocerAlimentos({ ...PARAMS, anguloAproximado: true });
    const cfg = getGenerativeModelMock.mock.calls[0][0] as {
      generationConfig: { responseMimeType: string; thinkingConfig: { thinkingLevel: string } };
      systemInstruction: string;
    };
    expect(cfg.generationConfig.responseMimeType).toBe('application/json');
    expect(cfg.generationConfig.thinkingConfig.thinkingLevel).toBe('minimal');
    expect(cfg.systemInstruction).toMatch(/ángulo indicado arriba es un valor asumido/);
    const req = generateContentMock.mock.calls[0][0] as { contents: { parts: unknown[] }[] };
    expect(req.contents[0].parts).toHaveLength(2);
  });
});

describe('llamarGeminiJson', () => {
  it('usa el parse, el schema y el timeout por intento que le pasan', async () => {
    generateContentMock.mockResolvedValueOnce(ok({ n: 3 }));
    const schema = { type: 'OBJECT' } as never;
    const r = await llamarGeminiJson({
      systemInstruction: 'sys',
      contents: [{ role: 'user', parts: [{ text: 'hola' }] }],
      responseSchema: schema,
      parse: (t) => (JSON.parse(t) as { n: number }).n,
      maxTotalMs: 12_000,
      timeoutMs: 5_000,
    });
    expect(r).toEqual({ resultado: 3, modeloUsado: 'modelo-a' });
    const cfg = getGenerativeModelMock.mock.calls[0][0] as { generationConfig: { responseSchema: unknown } };
    expect(cfg.generationConfig.responseSchema).toBe(schema);
    const opciones = generateContentMock.mock.calls[0][1] as { timeout: number };
    expect(opciones.timeout).toBeLessThanOrEqual(5_000);
  });
});
