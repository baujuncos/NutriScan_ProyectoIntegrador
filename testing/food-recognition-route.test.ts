import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { createSupabaseFromMock } from './supabaseMock';
import {
  FIXTURE_DOBLE_AMBIGUEDAD,
  FIXTURE_EXCESO_PREGUNTAS,
  FIXTURE_SIN_BBOX,
} from './fixtures/deteccion';

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
const supabaseFromMock = createSupabaseFromMock();
// Cliente admin (service role) solo para la limpieza de fotos huérfanas.
const adminMock = createSupabaseFromMock();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: supabaseFromMock.from,
    storage: supabaseFromMock.storage,
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ storage: adminMock.storage }),
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
      questions: [],
      boundingBox: null,
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
  fd.set('vajilla', overrides.vajilla ?? JSON.stringify({ tipo: 'plato_playo', diametroCm: 26 }));
  fd.set('angulo', overrides.angulo ?? JSON.stringify({ beta: 56, estado: 'ok', dentroDeRango: true }));
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

  // Por defecto, persistencia exitosa — los tests que prueban fallos de
  // persistencia lo pisan explícitamente después de este reset.
  supabaseFromMock.reset();
  adminMock.reset();
  supabaseFromMock.mockTable('detecciones_ia', { data: { id_deteccion: 1 }, error: null });
  supabaseFromMock.mockTable('detecciones_ia_items', { data: null, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/food-recognition — éxito', () => {
  it('reconoce en una sola llamada a Gemini, persiste la predicción y devuelve 200', async () => {
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.predictionId).toBe('1');
    expect(body.totalEstimatedWeightGrams).toBe(150);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      ingredient: 'milanesa de pollo',
      type: 'proteína animal',
      confidence: 0.82,
      estimatedWeightGrams: 150,
      questions: [],
      boundingBox: null,
    });
    expect(typeof body.items[0].id).toBe('string');
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('pasa intactas las preguntas con sus opciones', async () => {
    generateContentMock.mockResolvedValueOnce(jsonResponse(FIXTURE_DOBLE_AMBIGUEDAD));

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items[0].questions).toEqual([
      {
        question: '¿De qué relleno es la empanada?',
        kind: 'identity',
        options: ['Carne', 'Pollo', 'Jamón y queso', 'Verdura'],
      },
    ]);
    expect(body.items[1].questions).toEqual([
      { question: '¿Está frita o al horno?', kind: 'attribute', options: ['Frita', 'Al horno'] },
    ]);
  });
});

describe('POST /api/food-recognition — persistencia de la predicción (NUT-172)', () => {
  it('inserta en detecciones_ia y luego en detecciones_ia_items, en ese orden', async () => {
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));

    await POST(makeRequest(makeForm()));

    expect(supabaseFromMock.tablasLlamadas()).toEqual(['detecciones_ia', 'detecciones_ia_items']);
  });

  it('trunca a 3 preguntas por ítem antes de persistir, no sólo antes de responder', async () => {
    generateContentMock.mockResolvedValueOnce(jsonResponse(FIXTURE_EXCESO_PREGUNTAS));

    await POST(makeRequest(makeForm()));

    const itemsInsert = supabaseFromMock
      .insertsLlamados()
      .find((i) => i.tabla === 'detecciones_ia_items');
    const payload = itemsInsert?.payload as Array<{ questions: unknown[] }>;
    expect(payload[0].questions).toHaveLength(3);
  });

  it('convierte el bbox de Gemini a fracción 0-1 tanto en la respuesta como en lo persistido', async () => {
    const conBbox = {
      detectedIngredients: [{ ...VALID_RESULT.detectedIngredients[0], boundingBox: { ymin: 100, xmin: 200, ymax: 600, xmax: 800 } }],
      totalEstimatedWeightGrams: 150,
    };
    generateContentMock.mockResolvedValueOnce(jsonResponse(conBbox));

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(body.items[0].boundingBox).toEqual({ x: 0.2, y: 0.1, width: 0.6, height: 0.5 });

    const itemsInsert = supabaseFromMock
      .insertsLlamados()
      .find((i) => i.tabla === 'detecciones_ia_items');
    const payload = itemsInsert?.payload as Array<Record<string, unknown>>;
    expect(payload[0]).toMatchObject({ bbox_x: 0.2, bbox_y: 0.1, bbox_width: 0.6, bbox_height: 0.5 });
  });

  it('con boundingBox null de Gemini, persiste las columnas bbox_* en null', async () => {
    generateContentMock.mockResolvedValueOnce(jsonResponse(FIXTURE_SIN_BBOX));

    await POST(makeRequest(makeForm()));

    const itemsInsert = supabaseFromMock
      .insertsLlamados()
      .find((i) => i.tabla === 'detecciones_ia_items');
    const payload = itemsInsert?.payload as Array<Record<string, unknown>>;
    expect(payload[0]).toMatchObject({ bbox_x: null, bbox_y: null, bbox_width: null, bbox_height: null });
  });

  it('con dos ítems ambiguos a la vez, cada uno conserva sus propias preguntas al persistir', async () => {
    generateContentMock.mockResolvedValueOnce(jsonResponse(FIXTURE_DOBLE_AMBIGUEDAD));

    await POST(makeRequest(makeForm()));

    const itemsInsert = supabaseFromMock
      .insertsLlamados()
      .find((i) => i.tabla === 'detecciones_ia_items');
    const payload = itemsInsert?.payload as Array<{ ingredient: string; questions: unknown[] }>;
    expect(payload).toHaveLength(2);
    expect(payload[0].ingredient).toBe('Empanada');
    expect(payload[0].questions).toHaveLength(1);
    expect(payload[1].ingredient).toBe('Milanesa');
    expect(payload[1].questions).toHaveLength(1);
  });

  it('si falla el insert de detecciones_ia responde 502 PERSISTENCE_ERROR sin insertar items', async () => {
    supabaseFromMock.reset();
    supabaseFromMock.mockTable('detecciones_ia', { data: null, error: { message: 'boom' } });
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe('PERSISTENCE_ERROR');
    expect(supabaseFromMock.tablasLlamadas()).not.toContain('detecciones_ia_items');
  });

  it('si falla el insert de detecciones_ia_items responde 502 PERSISTENCE_ERROR', async () => {
    supabaseFromMock.reset();
    supabaseFromMock.mockTable('detecciones_ia', { data: { id_deteccion: 1 }, error: null });
    supabaseFromMock.mockTable('detecciones_ia_items', { data: null, error: { message: 'boom' } });
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));

    const res = await POST(makeRequest(makeForm()));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe('PERSISTENCE_ERROR');
  });
});

describe('POST /api/food-recognition — foto del plato en Storage privado (NUT-119)', () => {
  it('sube la imagen procesada a {uid}/{uuid}.jpg y guarda el path en detecciones_ia.imagen_path', async () => {
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));
    supabaseFromMock.mockStorage('upload', { data: { path: 'x' }, error: null });

    const res = await POST(makeRequest(makeForm()));

    expect(res.status).toBe(200);
    const subida = supabaseFromMock.storageLlamadas().find((l) => l.metodo === 'upload')!;
    expect(subida.bucket).toBe('detecciones-fotos');
    const path = subida.args[0] as string;
    expect(path).toMatch(/^user-1\/[0-9a-f-]{36}\.jpg$/);
    // Es la misma imagen comprimida que se manda a Gemini (coherente con los bounding boxes).
    expect(Buffer.isBuffer(subida.args[1])).toBe(true);
    expect((subida.args[1] as Buffer).toString()).toBe('fake-compressed-jpeg');
    const insert = supabaseFromMock.insertsLlamados().find((i) => i.tabla === 'detecciones_ia')!;
    expect(insert.payload).toMatchObject({ imagen_path: path });
    expect(insert.payload).not.toHaveProperty('imagen_url', expect.anything());
  });

  it('si la subida falla la detección NO falla: 200 con imagen_path null', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));
    supabaseFromMock.mockStorage('upload', { data: null, error: { message: 'storage caído' } });

    const res = await POST(makeRequest(makeForm()));

    expect(res.status).toBe(200);
    const insert = supabaseFromMock.insertsLlamados().find((i) => i.tabla === 'detecciones_ia')!;
    expect(insert.payload).toMatchObject({ imagen_path: null });
    spy.mockRestore();
  });

  it('la subida corre en paralelo con Gemini (ya inició cuando se llama a Gemini)', async () => {
    let subidasAlLlamarGemini = -1;
    generateContentMock.mockImplementationOnce(async () => {
      subidasAlLlamarGemini = supabaseFromMock.storageLlamadas().filter((l) => l.metodo === 'upload').length;
      return jsonResponse(VALID_RESULT);
    });
    supabaseFromMock.mockStorage('upload', { data: { path: 'x' }, error: null });

    await POST(makeRequest(makeForm()));

    expect(subidasAlLlamarGemini).toBe(1);
  });

  it('si Gemini falla después de subir, borra la foto huérfana con el cliente admin', async () => {
    generateContentMock.mockRejectedValue(new GoogleGenerativeAIFetchError('cuota', 429));
    supabaseFromMock.mockStorage('upload', { data: { path: 'x' }, error: null });

    const res = await POST(makeRequest(makeForm()));

    expect(res.status).toBe(502);
    const path = supabaseFromMock.storageLlamadas().find((l) => l.metodo === 'upload')!.args[0];
    expect(adminMock.storageLlamadas()).toEqual([{ bucket: 'detecciones-fotos', metodo: 'remove', args: [[path]] }]);
  });

  it('si falla el insert de detecciones_ia después de subir, borra la foto huérfana', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));
    supabaseFromMock.reset();
    supabaseFromMock.mockTable('detecciones_ia', { data: null, error: { message: 'boom' } });
    supabaseFromMock.mockStorage('upload', { data: { path: 'x' }, error: null });

    const res = await POST(makeRequest(makeForm()));

    expect(res.status).toBe(502);
    expect(adminMock.storageLlamadas().map((l) => l.metodo)).toEqual(['remove']);
    spy.mockRestore();
  });

  it('si no hubo foto subida no se intenta borrar nada', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    generateContentMock.mockRejectedValue(new GoogleGenerativeAIFetchError('cuota', 429));
    supabaseFromMock.mockStorage('upload', { data: null, error: { message: 'x' } });

    await POST(makeRequest(makeForm()));

    expect(adminMock.storageLlamadas()).toEqual([]);
    spy.mockRestore();
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
    expect(body.predictionId).toBe('1');
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });
});

describe('POST /api/food-recognition — timeout y rate limit', () => {
  it('si el modelo principal da timeout, espera el backoff y reintenta con el de respaldo (200)', async () => {
    generateContentMock.mockRejectedValueOnce(new GoogleGenerativeAIAbortError('aborted'));
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));

    const res = await POST(makeRequest(makeForm()));

    expect(res.status).toBe(200);
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

    expect(res.status).toBe(200);
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

describe('POST /api/food-recognition — arma un único turno por llamada, siempre', () => {
  it('el contents enviado a Gemini siempre tiene un solo turno "user"', async () => {
    generateContentMock.mockResolvedValueOnce(jsonResponse(VALID_RESULT));

    await POST(makeRequest(makeForm()));

    const { contents } = generateContentMock.mock.calls[0][0];
    expect(contents).toHaveLength(1);
    expect(contents[0].role).toBe('user');
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
