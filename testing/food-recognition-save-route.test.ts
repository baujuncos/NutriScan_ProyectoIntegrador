import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));
const supabaseFromMock = createSupabaseFromMock();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: supabaseFromMock.from }),
}));

import { POST } from '@/app/api/food-recognition/save/route';
import type { FinalItem, SaveRequest } from '@/lib/deteccion';

const ITEM_UUID = '11111111-1111-1111-1111-111111111111';

function makeSaveRequest(overrides: Partial<SaveRequest> = {}): SaveRequest {
  const items: FinalItem[] = overrides.items ?? [
    {
      sourceItemId: ITEM_UUID,
      name: 'Milanesa de pollo',
      category: 'proteína animal',
      grams: 150,
      aiGrams: 150,
      origin: 'ai',
      answers: [],
    },
  ];
  return {
    predictionId: overrides.predictionId ?? '1',
    mealType: overrides.mealType ?? 'Desayuno',
    items,
    removedItemIds: overrides.removedItemIds ?? [],
  };
}

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'user-1', email: 'test@example.com' } } });
  supabaseFromMock.reset();
  supabaseFromMock.mockTable('detecciones_ia', {
    data: { id_deteccion: 1, id_usuario: 'user-1' },
    error: null,
  });
  supabaseFromMock.mockTable('detecciones_ia_items', {
    data: [{ item_uuid: ITEM_UUID }],
    error: null,
  });
  supabaseFromMock.mockTable('detecciones_guardados', { data: { id_guardado: 1 }, error: null });
  supabaseFromMock.mockTable('detecciones_guardados_items', { data: null, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/food-recognition/save — autenticación', () => {
  it('sin sesión responde 401 UNAUTHENTICATED', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const res = await POST(makeRequest(makeSaveRequest()));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('UNAUTHENTICATED');
  });
});

describe('POST /api/food-recognition/save — validación', () => {
  it('cuerpo no-JSON responde 400 INVALID', async () => {
    const req = { json: async () => { throw new Error('bad'); } } as unknown as NextRequest;
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('INVALID');
  });

  it('falta predictionId responde 400 INVALID', async () => {
    const payload = makeSaveRequest();
    const { predictionId: _predictionId, ...sinPredictionId } = payload;
    const res = await POST(makeRequest(sinPredictionId));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('INVALID');
  });

  it('origin inválido responde 400 INVALID', async () => {
    const payload = makeSaveRequest({
      items: [{ ...makeSaveRequest().items[0], origin: 'inventado' as FinalItem['origin'] }],
    });
    const res = await POST(makeRequest(payload));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('INVALID');
  });

  it('grams<=0 responde 400 INVALID', async () => {
    const payload = makeSaveRequest({ items: [{ ...makeSaveRequest().items[0], grams: 0 }] });
    const res = await POST(makeRequest(payload));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('INVALID');
  });

  it('added_manually con sourceItemId no nulo responde 400 INVALID', async () => {
    const payload = makeSaveRequest({
      items: [
        {
          sourceItemId: ITEM_UUID,
          name: 'Agregado a mano',
          category: 'otro',
          grams: 50,
          aiGrams: null,
          origin: 'added_manually',
          answers: [],
        },
      ],
    });
    const res = await POST(makeRequest(payload));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('INVALID');
  });

  it('sourceItemId que no pertenece a la predicción responde 400 INVALID', async () => {
    const payload = makeSaveRequest({
      items: [{ ...makeSaveRequest().items[0], sourceItemId: '22222222-2222-2222-2222-222222222222' }],
    });
    const res = await POST(makeRequest(payload));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('INVALID');
  });
});

describe('POST /api/food-recognition/save — ownership de la predicción', () => {
  it('predicción inexistente responde 404 NOT_FOUND', async () => {
    supabaseFromMock.reset();
    supabaseFromMock.mockTable('detecciones_ia', { data: null, error: null });

    const res = await POST(makeRequest(makeSaveRequest()));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('NOT_FOUND');
  });

  it('predicción de otro usuario responde 403 FORBIDDEN', async () => {
    supabaseFromMock.reset();
    supabaseFromMock.mockTable('detecciones_ia', {
      data: { id_deteccion: 1, id_usuario: 'otro-usuario' },
      error: null,
    });

    const res = await POST(makeRequest(makeSaveRequest()));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('FORBIDDEN');
  });
});

describe('POST /api/food-recognition/save — éxito por cada origin', () => {
  it('origin "ai" (aceptación sin cambios) persiste el guardado y responde 200', async () => {
    const res = await POST(makeRequest(makeSaveRequest()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.savedId).toBe('string');
  });

  it('origin "answered" (respondió una pregunta) persiste el guardado', async () => {
    const payload = makeSaveRequest({
      items: [
        {
          sourceItemId: ITEM_UUID,
          name: 'Milanesa de pollo (al horno)',
          category: 'proteína animal',
          grams: 150,
          aiGrams: 150,
          origin: 'answered',
          answers: [{ question: '¿Frita o al horno?', answer: 'Al horno' }],
        },
      ],
    });
    const res = await POST(makeRequest(payload));
    expect(res.status).toBe(200);
  });

  it('origin "replaced" (cambió el alimento) persiste el guardado', async () => {
    const payload = makeSaveRequest({
      items: [
        {
          sourceItemId: ITEM_UUID,
          name: 'Yogur griego',
          category: 'lácteo',
          grams: 35,
          aiGrams: 35,
          origin: 'replaced',
          answers: [],
        },
      ],
    });
    const res = await POST(makeRequest(payload));
    expect(res.status).toBe(200);
  });

  it('origin "added_manually" (ítem agregado a mano) persiste el guardado', async () => {
    const payload = makeSaveRequest({
      items: [
        {
          sourceItemId: null,
          name: 'Café con leche',
          category: 'bebida',
          grams: 200,
          aiGrams: null,
          origin: 'added_manually',
          answers: [],
        },
      ],
    });
    const res = await POST(makeRequest(payload));
    expect(res.status).toBe(200);
  });

  it('removedItemIds (falso positivo) se persiste en el guardado', async () => {
    const payload = makeSaveRequest({ removedItemIds: [ITEM_UUID] });
    await POST(makeRequest(payload));

    const insertGuardado = supabaseFromMock
      .insertsLlamados()
      .find((i) => i.tabla === 'detecciones_guardados');
    expect(insertGuardado?.payload).toMatchObject({ removed_item_uuids: [ITEM_UUID] });
  });
});

describe('POST /api/food-recognition/save — fallos de persistencia', () => {
  it('si falla el insert de detecciones_guardados responde 502 PERSISTENCE_ERROR', async () => {
    supabaseFromMock.reset();
    supabaseFromMock.mockTable('detecciones_ia', {
      data: { id_deteccion: 1, id_usuario: 'user-1' },
      error: null,
    });
    supabaseFromMock.mockTable('detecciones_ia_items', { data: [{ item_uuid: ITEM_UUID }], error: null });
    supabaseFromMock.mockTable('detecciones_guardados', { data: null, error: { message: 'boom' } });

    const res = await POST(makeRequest(makeSaveRequest()));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe('PERSISTENCE_ERROR');
  });
});

describe('POST /api/food-recognition/save — nunca toca el diario real', () => {
  it('supabase.from nunca se llama con "ingestas" ni "items"', async () => {
    await POST(makeRequest(makeSaveRequest()));

    const tablas = supabaseFromMock.tablasLlamadas();
    expect(tablas).not.toContain('ingestas');
    expect(tablas).not.toContain('items');
  });
});
