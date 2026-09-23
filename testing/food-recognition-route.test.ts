import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

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
  getGenerativeModelMock.mockReset();
  getGenerativeModelMock.mockImplementation(() => ({ generateContent: generateContentMock }));
  generateContentMock.mockReset();
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
  it('mapea un abort a 502 GEMINI_TIMEOUT sin reintentar', async () => {
    generateContentMock.mockRejectedValueOnce(new GoogleGenerativeAIAbortError('aborted'));

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe('GEMINI_TIMEOUT');
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('mapea un 429 a 502 GEMINI_RATE_LIMIT sin reintentar', async () => {
    generateContentMock.mockRejectedValueOnce(new GoogleGenerativeAIFetchError('rate limited', 429));

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe('GEMINI_RATE_LIMIT');
    expect(generateContentMock).toHaveBeenCalledTimes(1);
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
