import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { generateContentMock, getGenerativeModelMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
  getGenerativeModelMock: vi.fn(),
}));

// La compresión de imagen (sharp) es procesamiento local, pero se mockea igual
// para no depender de un JPEG real en el fixture y mantener los tests rápidos.
const { sharpMock, resizeMock, jpegMock, toBufferMock } = vi.hoisted(() => ({
  sharpMock: vi.fn(),
  resizeMock: vi.fn(),
  jpegMock: vi.fn(),
  toBufferMock: vi.fn(),
}));

vi.mock('sharp', () => ({ default: sharpMock }));

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
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
    SchemaType: {
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      INTEGER: 'INTEGER',
      BOOLEAN: 'BOOLEAN',
      ARRAY: 'ARRAY',
      OBJECT: 'OBJECT',
    },
  };
});

import { POST } from '@/app/api/food-recognition/route';
import { GoogleGenerativeAIAbortError, GoogleGenerativeAIFetchError } from '@google/generative-ai';

const VALID_RESULT = {
  detectedIngredients: [
    {
      ingredient: 'milanesa de pollo',
      type: 'proteína animal',
      confidence: 0.82,
      estimatedWeightGrams: 150,
      questionForUser: null,
    },
  ],
  totalEstimatedWeightGrams: 150,
};

function jsonResponse(payload: unknown) {
  return { response: { text: () => JSON.stringify(payload) } };
}

function textResponse(text: string) {
  return { response: { text: () => text } };
}

function makeForm(overrides: Record<string, string | undefined> = {}) {
  const fd = new FormData();
  const image = new File([new Uint8Array([1, 2, 3])], 'foto.jpg', { type: 'image/jpeg' });
  fd.set('image', overrides.image === undefined ? image : (overrides.image as unknown as File));
  fd.set(
    'vajilla',
    overrides.vajilla ?? JSON.stringify({ tipo: 'plato_playo', diametroCm: 26 }),
  );
  fd.set(
    'angulo',
    overrides.angulo ?? JSON.stringify({ beta: 56, estado: 'ok', dentroDeRango: true }),
  );
  if (overrides.preguntasPorIngrediente !== undefined) {
    fd.set('preguntasPorIngrediente', overrides.preguntasPorIngrediente);
  }
  if (overrides.previousDetection !== undefined) {
    fd.set('previousDetection', overrides.previousDetection);
  }
  if (overrides.respuestaUsuario !== undefined) {
    fd.set('respuestaUsuario', overrides.respuestaUsuario);
  }
  return fd;
}

function makeRequest(form: FormData): NextRequest {
  return { formData: async () => form } as unknown as NextRequest;
}

beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', 'test-key');
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'user-1', email: 'test@example.com' } } });
  getGenerativeModelMock.mockReset();
  getGenerativeModelMock.mockImplementation(() => ({ generateContent: generateContentMock }));
  generateContentMock.mockReset();

  sharpMock.mockReset();
  resizeMock.mockReset();
  jpegMock.mockReset();
  toBufferMock.mockReset().mockResolvedValue(Buffer.from('fake-compressed-jpeg'));
  jpegMock.mockReturnValue({ toBuffer: toBufferMock });
  resizeMock.mockReturnValue({ jpeg: jpegMock });
  sharpMock.mockReturnValue({ rotate: () => ({ resize: resizeMock }) });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/food-recognition — éxito', () => {
  it('reconoce en una sola llamada a Gemini y devuelve 200', async () => {
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, ...VALID_RESULT });
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('pasa intacta una pregunta aclaratoria no nula', async () => {
    const conPregunta = {
      detectedIngredients: [
        { ...VALID_RESULT.detectedIngredients[0], questionForUser: '¿Frito o al horno?' },
      ],
      totalEstimatedWeightGrams: 150,
    };
    generateContentMock.mockResolvedValueOnce(jsonResponse(conPregunta));

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(body.detectedIngredients[0].questionForUser).toBe('¿Frito o al horno?');
  });
});

describe('POST /api/food-recognition — JSON malformado', () => {
  it('reintenta una vez y falla con GEMINI_INVALID_RESPONSE si ambos intentos son inválidos', async () => {
    generateContentMock.mockResolvedValueOnce(textResponse('esto no es json'));
    generateContentMock.mockResolvedValueOnce(textResponse('tampoco esto'));

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe('GEMINI_INVALID_RESPONSE');
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it('si el reintento devuelve JSON válido, responde 200', async () => {
    generateContentMock.mockResolvedValueOnce(textResponse('no es json'));
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, ...VALID_RESULT });
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });
});

describe('POST /api/food-recognition — timeout y rate limit', () => {
  it('si el modelo principal da timeout, espera el backoff y reintenta con el de respaldo (200)', async () => {
    generateContentMock.mockRejectedValueOnce(new GoogleGenerativeAIAbortError('aborted'));
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, ...VALID_RESULT });
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it('si ambos modelos dan timeout, corta ahí con 502 GEMINI_UNAVAILABLE (sin más reintentos)', async () => {
    generateContentMock.mockRejectedValue(new GoogleGenerativeAIAbortError('aborted'));

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe('GEMINI_UNAVAILABLE');
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it('mapea un 429 a 502 GEMINI_RATE_LIMIT sin reintentar (la cuota no se arregla probando otro modelo)', async () => {
    generateContentMock.mockRejectedValueOnce(new GoogleGenerativeAIFetchError('rate limited', 429));

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe('GEMINI_RATE_LIMIT');
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('espera ~1s de backoff antes de intentar el modelo de respaldo', async () => {
    vi.useFakeTimers();
    generateContentMock.mockRejectedValueOnce(new GoogleGenerativeAIFetchError('high demand', 503));
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));

    const promise = POST(makeRequest(makeForm()));
    await vi.advanceTimersByTimeAsync(0);
    expect(generateContentMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(generateContentMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const res = await promise;

    expect(res.status).toBe(200);
    expect(generateContentMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('POST /api/food-recognition — modelo saturado (503) y fallback', () => {
  it('ante un 503 del modelo principal reintenta con el modelo de respaldo y responde 200', async () => {
    generateContentMock.mockRejectedValueOnce(new GoogleGenerativeAIFetchError('high demand', 503));
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, ...VALID_RESULT });
    expect(generateContentMock).toHaveBeenCalledTimes(2);
    const primario = getGenerativeModelMock.mock.calls[0][0].model;
    const respaldo = getGenerativeModelMock.mock.calls[1][0].model;
    expect(respaldo).not.toBe(primario);
  });

  it('si ambos modelos devuelven 503 responde 502 GEMINI_UNAVAILABLE', async () => {
    generateContentMock.mockRejectedValue(new GoogleGenerativeAIFetchError('high demand', 503));

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe('GEMINI_UNAVAILABLE');
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it('pide thinking mínimo para mantener la latencia baja', async () => {
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));

    await POST(makeRequest(makeForm()));

    const { generationConfig } = getGenerativeModelMock.mock.calls[0][0];
    expect(generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
  });
});

describe('POST /api/food-recognition — compresión de imagen', () => {
  it('redimensiona a ≤1024px y comprime a JPEG calidad 78 antes de llamar a Gemini', async () => {
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));

    await POST(makeRequest(makeForm()));

    expect(resizeMock).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }),
    );
    expect(jpegMock).toHaveBeenCalledWith(expect.objectContaining({ quality: 78 }));

    const { contents } = generateContentMock.mock.calls[0][0];
    const { inlineData } = contents[0].parts[0];
    expect(inlineData.mimeType).toBe('image/jpeg');
    expect(inlineData.data).toBe(Buffer.from('fake-compressed-jpeg').toString('base64'));
  });

  it('si la imagen no se puede procesar, responde 400 IMAGE_INVALID_TYPE sin llamar a Gemini', async () => {
    toBufferMock.mockReset().mockRejectedValue(new Error('formato no soportado'));

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('IMAGE_INVALID_TYPE');
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/food-recognition — límite de preguntas por alimento', () => {
  it('con un ingrediente en el límite, el prompt indica que no se le puede volver a preguntar', async () => {
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));

    await POST(
      makeRequest(
        makeForm({ preguntasPorIngrediente: JSON.stringify({ 'milanesa de pollo': 3 }) }),
      ),
    );

    const modelParams = getGenerativeModelMock.mock.calls[0][0];
    expect(modelParams.systemInstruction).toContain('milanesa de pollo');
    expect(modelParams.systemInstruction).toContain('ya alcanzaron el máximo de preguntas permitidas');
  });
});

describe('POST /api/food-recognition — validación de entrada', () => {
  it('sin imagen devuelve 400 IMAGE_REQUIRED y no llama a Gemini', async () => {
    const fd = makeForm();
    fd.delete('image');

    const res = await POST(makeRequest(fd));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('IMAGE_REQUIRED');
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('vajilla con tipo "otro" es rechazada con 400 INVALID', async () => {
    const res = await POST(
      makeRequest(makeForm({ vajilla: JSON.stringify({ tipo: 'otro', diametroCm: 30 }) })),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('INVALID');
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('vajilla con JSON inválido es rechazada con 400 INVALID', async () => {
    const res = await POST(makeRequest(makeForm({ vajilla: '{not-json' })));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('INVALID');
  });

  it('respuestaUsuario sin previousDetection es rechazada con 400 INVALID', async () => {
    const res = await POST(
      makeRequest(
        makeForm({
          respuestaUsuario: JSON.stringify({ ingredient: 'milanesa', respuesta: 'de pollo' }),
        }),
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('INVALID');
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/food-recognition — ángulo sin lectura de giroscopio', () => {
  it('con beta null, responde 200 y el prompt aclara que el ángulo es un valor por defecto', async () => {
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));

    const res = await POST(
      makeRequest(
        makeForm({ angulo: JSON.stringify({ beta: null, estado: 'desconocido', dentroDeRango: true }) }),
      ),
    );

    expect(res.status).toBe(200);
    const modelParams = getGenerativeModelMock.mock.calls[0][0];
    expect(modelParams.systemInstruction).toContain('valor asumido por defecto');
  });
});

describe('POST /api/food-recognition — refinamiento tras pregunta aclaratoria', () => {
  it('arma 3 turnos user/model/user cuando viene previousDetection + respuestaUsuario', async () => {
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));

    await POST(
      makeRequest(
        makeForm({
          previousDetection: JSON.stringify(VALID_RESULT),
          respuestaUsuario: JSON.stringify({ ingredient: 'milanesa de pollo', respuesta: 'al horno' }),
        }),
      ),
    );

    const { contents } = generateContentMock.mock.calls[0][0];
    expect(contents).toHaveLength(3);
    expect(contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
  });
});

describe('POST /api/food-recognition — autenticación', () => {
  it('sin sesión responde 401 UNAUTHENTICATED y no llama a Gemini', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('UNAUTHENTICATED');
    expect(generateContentMock).not.toHaveBeenCalled();
    expect(sharpMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/food-recognition — configuración del servidor', () => {
  it('sin GEMINI_API_KEY responde 500 SERVER_CONFIG y no llama a Gemini', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('SERVER_CONFIG');
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});
