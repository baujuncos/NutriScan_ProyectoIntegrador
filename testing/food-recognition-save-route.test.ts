/**
 * NUT-119 — /save: valida, resuelve cada alimento (foodRef | catálogo | Gemini)
 * y escribe TODO en una sola RPC transaccional (cliente admin). Nunca devuelve
 * kcal/macros. Matching, Gemini y RPC de commit mockeados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock, resolverMock, catalogoMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  resolverMock: vi.fn(),
  catalogoMock: vi.fn(),
}));
const userDb = createSupabaseFromMock();
const adminDb = createSupabaseFromMock();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: userDb.from, rpc: userDb.rpc }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: adminDb.rpc, from: adminDb.from }),
}));
vi.mock('@/lib/geminiNutritionFallback', () => ({ resolverAlimentosConIA: resolverMock }));
vi.mock('@/lib/catalogoAutomatico', () => ({ cargarCatalogoAutomatico: catalogoMock }));

import { POST } from '@/app/api/food-recognition/save/route';
import { NUTRITION_PROMPT_VERSION, type FinalItem, type SaveRequest } from '@/lib/deteccion';
import { daysAgoAR, todayAR } from '@/lib/date';

const ITEM_UUID = '11111111-1111-1111-1111-111111111111';
const ITEM_UUID_2 = '33333333-3333-3333-3333-333333333333';

const baseItem = (over: Partial<FinalItem> = {}): FinalItem => ({
  sourceItemId: ITEM_UUID,
  name: 'Milanesa de pollo',
  category: 'proteína animal',
  grams: 150,
  aiGrams: 150,
  origin: 'ai',
  answers: [],
  ...over,
});

function makeSaveRequest(over: Partial<SaveRequest> = {}): SaveRequest {
  return {
    predictionId: over.predictionId ?? '1',
    mealType: over.mealType ?? 'desayuno',
    items: over.items ?? [baseItem()],
    removedItemIds: over.removedItemIds ?? [],
    ...(over.fecha ? { fecha: over.fecha } : {}),
  };
}

const makeRequest = (body: unknown): NextRequest => ({ json: async () => body }) as unknown as NextRequest;

const filaMatch = (idx: number, over: Record<string, unknown> = {}) => ({
  idx,
  nombre_normalizado: `n${idx}`,
  id_alimento: null,
  nombre: null,
  fuente: null,
  score: null,
  metodo: null,
  kcal_100g: null,
  proteinas_100g: null,
  grasas_100g: null,
  carbs_100g: null,
  ...over,
});
const catalogo = (idx: number, id = 10, score = 0.8) =>
  filaMatch(idx, {
    id_alimento: id,
    nombre: 'X',
    fuente: 'SARA2',
    score,
    metodo: 'exacto',
    kcal_100g: 200,
    proteinas_100g: 10,
    grasas_100g: 5,
    carbs_100g: 20,
  });

const CATALOGO = [
  { id: 886, nombre: 'Huevo de gallina, entero, hervido' },
  { id: 425, nombre: 'Arroz blanco, crudo' },
];

const IA = { kcal_100g: 250, proteinas_100g: 20, grasas_100g: 15, carbs_100g: 10 };

const COMMIT_OK = { data: { id_guardado: 7, items_registrados: 1, sin_datos: 0 }, error: null };

/** Encola el escenario feliz para UN POST (predicción propia, sin guardado previo, un ítem sin match). */
function escenario(opts: { uuids?: string[]; match?: unknown[] } = {}) {
  const uuids = opts.uuids ?? [ITEM_UUID];
  userDb.mockTable('detecciones_ia', { data: { id_deteccion: 1, id_usuario: 'user-1' }, error: null });
  userDb.mockTable('detecciones_ia_items', { data: uuids.map((u) => ({ item_uuid: u })), error: null });
  userDb.mockTable('detecciones_guardados', { data: [], error: null }); // pre-check: sin guardado previo
  userDb.mockRpc('match_alimentos', { data: opts.match ?? [filaMatch(1)], error: null });
  adminDb.mockRpc('registrar_guardado_deteccion', COMMIT_OK);
}

const itemsDeLaRpc = (n = 0) =>
  (adminDb.rpcLlamadas().filter((l) => l.nombre === 'registrar_guardado_deteccion')[n].args as { p_items: any[] })
    .p_items;

beforeEach(() => {
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'user-1', email: 'test@example.com' } } });
  resolverMock.mockReset().mockResolvedValue({ resultados: [], modelo: null });
  catalogoMock.mockReset().mockResolvedValue(CATALOGO);
  userDb.reset();
  adminDb.reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /save — autenticación y validación', () => {
  it('sin sesión responde 401 UNAUTHENTICATED', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeRequest(makeSaveRequest()));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('UNAUTHENTICATED');
  });

  it('cuerpo no-JSON responde 400 INVALID', async () => {
    const res = await POST({
      json: async () => {
        throw new Error('bad');
      },
    } as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID');
  });

  it('falta predictionId / origin inválido / grams<=0 responden 400 INVALID', async () => {
    const { predictionId: _p, ...sinId } = makeSaveRequest();
    for (const body of [
      sinId,
      makeSaveRequest({ items: [baseItem({ origin: 'inventado' as FinalItem['origin'] })] }),
      makeSaveRequest({ items: [baseItem({ grams: 0 })] }),
    ]) {
      const res = await POST(makeRequest(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('INVALID');
    }
  });

  it('added_manually con sourceItemId no nulo responde 400 INVALID', async () => {
    escenario();
    const body = makeSaveRequest({
      items: [baseItem({ sourceItemId: ITEM_UUID, aiGrams: null, origin: 'added_manually' })],
    });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(400);
  });

  it('sourceItemId que no pertenece a la predicción responde 400 INVALID', async () => {
    escenario();
    const res = await POST(
      makeRequest(makeSaveRequest({ items: [baseItem({ sourceItemId: '22222222-2222-2222-2222-222222222222' })] })),
    );
    expect(res.status).toBe(400);
  });

  it("mealType inválido → 400 INVALID con field 'mealType'", async () => {
    const res = await POST(makeRequest(makeSaveRequest({ mealType: 'brunch' })));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('mealType');
  });

  it("'Desayuno' y 'Colación' se aceptan y viajan normalizados a la RPC", async () => {
    for (const mealType of ['Desayuno', 'Colación']) {
      escenario();
      const ok = await POST(makeRequest(makeSaveRequest({ mealType })));
      expect(ok.status).toBe(200);
    }
    const tipos = adminDb.rpcLlamadas().map((l) => (l.args as { p_tipo: string }).p_tipo);
    expect(tipos).toEqual(['desayuno', 'colacion']);
  });

  it("fecha fuera de la ventana editable → 400 INVALID con field 'fecha'", async () => {
    for (const fecha of [daysAgoAR(8), '2999-01-01', 'ayer']) {
      const res = await POST(makeRequest(makeSaveRequest({ fecha })));
      expect(res.status).toBe(400);
      expect((await res.json()).field).toBe('fecha');
    }
  });

  it('fecha por defecto = hoy (AR) y una fecha válida viaja a la RPC', async () => {
    escenario();
    await POST(makeRequest(makeSaveRequest()));
    expect((adminDb.rpcLlamadas()[0].args as { p_fecha: string }).p_fecha).toBe(todayAR());

    escenario();
    const ayer = daysAgoAR(1);
    await POST(makeRequest(makeSaveRequest({ fecha: ayer })));
    expect((adminDb.rpcLlamadas()[1].args as { p_fecha: string }).p_fecha).toBe(ayer);
  });

  it('grams > 2000 → 400 INVALID (field items.0.grams)', async () => {
    const res = await POST(makeRequest(makeSaveRequest({ items: [baseItem({ grams: 2001 })] })));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('items.0.grams');
  });

  it('foodRef no numérico → 400 INVALID (field items.0.foodRef)', async () => {
    const res = await POST(makeRequest(makeSaveRequest({ items: [baseItem({ foodRef: 'abc' })] })));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('items.0.foodRef');
  });
});

describe('POST /save — ownership y guardado previo', () => {
  it('predicción inexistente → 404 NOT_FOUND', async () => {
    userDb.mockTable('detecciones_ia', { data: null, error: null });
    const res = await POST(makeRequest(makeSaveRequest()));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('NOT_FOUND');
  });

  it('predicción de otro usuario → 403 FORBIDDEN', async () => {
    userDb.mockTable('detecciones_ia', { data: { id_deteccion: 1, id_usuario: 'otro' }, error: null });
    const res = await POST(makeRequest(makeSaveRequest()));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('FORBIDDEN');
  });

  it('guardado previo → 409 ALREADY_SAVED sin llamar a Gemini ni a la RPC de commit', async () => {
    userDb.mockTable('detecciones_ia', { data: { id_deteccion: 1, id_usuario: 'user-1' }, error: null });
    userDb.mockTable('detecciones_ia_items', { data: [{ item_uuid: ITEM_UUID }], error: null });
    userDb.mockTable('detecciones_guardados', { data: [{ id_guardado: 5 }], error: null });
    const res = await POST(makeRequest(makeSaveRequest()));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('ALREADY_SAVED');
    expect(resolverMock).not.toHaveBeenCalled();
    expect(adminDb.rpcLlamadas()).toHaveLength(0);
  });

  it('ALREADY_SAVED lanzado por la RPC (carrera) también es 409', async () => {
    escenario();
    adminDb.reset();
    adminDb.mockRpc('registrar_guardado_deteccion', { data: null, error: { message: 'ALREADY_SAVED' } });
    const res = await POST(makeRequest(makeSaveRequest()));
    expect(res.status).toBe(409);
  });
});

describe('POST /save — resolución de alimentos', () => {
  it('foodRef: no entra en match_alimentos y viaja con metodo_match food_ref', async () => {
    escenario({ uuids: [ITEM_UUID, ITEM_UUID_2], match: [catalogo(1, 77)] });
    await POST(
      makeRequest(
        makeSaveRequest({
          items: [baseItem({ foodRef: '42' }), baseItem({ sourceItemId: ITEM_UUID_2, name: 'Otro' })],
        }),
      ),
    );

    expect(userDb.rpcLlamadas()[0].args).toEqual({ p_nombres: ['Otro'] });
    const items = itemsDeLaRpc();
    expect(items[0]).toMatchObject({ id_alimento: 42, metodo_match: 'food_ref', food_ref: '42' });
    expect(items[1]).toMatchObject({ id_alimento: 77, metodo_match: 'exacto', score_match: 0.8 });
  });

  it('todos con foodRef: no llama a match_alimentos', async () => {
    escenario();
    await POST(makeRequest(makeSaveRequest({ items: [baseItem({ foodRef: '5' })] })));
    expect(userDb.rpcLlamadas()).toHaveLength(0);
  });

  it('match del catálogo: viaja el gramaje FINAL (no aiGrams) y no se llama a Gemini', async () => {
    escenario({ match: [catalogo(1, 10)] });
    await POST(makeRequest(makeSaveRequest({ items: [baseItem({ grams: 220, aiGrams: 150 })] })));
    expect(itemsDeLaRpc()[0]).toMatchObject({
      grams: 220,
      ai_grams: 150,
      id_alimento: 10,
      metodo_match: 'exacto',
      ia: null,
    });
    expect(resolverMock).not.toHaveBeenCalled();
  });

  it('sin match: una sola llamada a Gemini y los valores viajan en ia', async () => {
    escenario();
    resolverMock.mockResolvedValue({ resultados: [{ macros: IA }], modelo: 'gemini-x' });
    await POST(makeRequest(makeSaveRequest()));
    expect(resolverMock).toHaveBeenCalledTimes(1);
    expect(resolverMock).toHaveBeenCalledWith([{ nombre: 'Milanesa de pollo', categoria: 'proteína animal' }], CATALOGO);
    const args = adminDb.rpcLlamadas()[0].args as Record<string, unknown>;
    expect(itemsDeLaRpc()[0]).toMatchObject({ id_alimento: null, metodo_match: 'gemini', ia: IA });
    expect(args.p_modelo_nutricion).toBe('gemini-x');
    expect(args.p_nutrition_prompt_version).toBe(NUTRITION_PROMPT_VERSION);
  });

  it('Gemini falla (null) → ia null, metodo_match ninguno y el guardado responde 200', async () => {
    escenario();
    resolverMock.mockResolvedValue({ resultados: [null], modelo: null });
    const res = await POST(makeRequest(makeSaveRequest()));
    expect(res.status).toBe(200);
    expect(itemsDeLaRpc()[0]).toMatchObject({ ia: null, metodo_match: 'ninguno' });
  });

  it('dos ítems con el mismo nombre normalizado → un solo nombre a Gemini, ambos con los valores', async () => {
    escenario({
      uuids: [ITEM_UUID, ITEM_UUID_2],
      match: [filaMatch(1, { nombre_normalizado: 'flan' }), filaMatch(2, { nombre_normalizado: 'flan' })],
    });
    resolverMock.mockResolvedValue({ resultados: [{ macros: IA }], modelo: 'm' });
    await POST(
      makeRequest(
        makeSaveRequest({
          items: [baseItem({ name: 'Flan' }), baseItem({ sourceItemId: ITEM_UUID_2, name: 'flan ', grams: 80 })],
        }),
      ),
    );
    expect(resolverMock.mock.calls[0][0]).toHaveLength(1);
    const items = itemsDeLaRpc();
    expect(items.map((i) => i.ia)).toEqual([IA, IA]);
    expect(items.map((i) => i.grams)).toEqual([150, 80]);
  });

  it('el matching caído → 502 PERSISTENCE_ERROR y no se escribe nada', async () => {
    userDb.mockTable('detecciones_ia', { data: { id_deteccion: 1, id_usuario: 'user-1' }, error: null });
    userDb.mockTable('detecciones_ia_items', { data: [{ item_uuid: ITEM_UUID }], error: null });
    userDb.mockTable('detecciones_guardados', { data: [], error: null });
    userDb.mockRpc('match_alimentos', { data: null, error: { message: 'boom' } });
    const res = await POST(makeRequest(makeSaveRequest()));
    expect(res.status).toBe(502);
    expect(adminDb.rpcLlamadas()).toHaveLength(0);
  });
});

describe('POST /save — cola de validación: reuso para deportistas (NUT-119)', () => {
  const deportista = () => userDb.mockTable('profiles', { data: { role: 'deportista_ucc' }, error: null });
  const filaCola = (idx: number, norm: string, necesitaIa: boolean) => ({
    idx,
    nombre_normalizado: norm,
    id_pendiente: necesitaIa ? null : 3,
    estado: necesitaIa ? null : 'validado',
    necesita_ia: necesitaIa,
  });
  const dos = () =>
    escenario({
      uuids: [ITEM_UUID, ITEM_UUID_2],
      match: [filaMatch(1, { nombre_normalizado: 'flan' }), filaMatch(2, { nombre_normalizado: 'budin' })],
    });
  const reqDos = () =>
    makeSaveRequest({
      items: [baseItem({ name: 'Flan' }), baseItem({ sourceItemId: ITEM_UUID_2, name: 'Budín' })],
    });

  it('deportista: consulta cola_lookup con el cliente admin; lo que ya está en la cola no va a Gemini y viaja como "cola"', async () => {
    dos();
    deportista();
    adminDb.mockRpc('cola_lookup', { data: [filaCola(1, 'flan', false), filaCola(2, 'budin', true)], error: null });
    resolverMock.mockResolvedValue({ resultados: [{ macros: IA }], modelo: 'm' });

    const res = await POST(makeRequest(reqDos()));

    expect(res.status).toBe(200);
    expect(adminDb.rpcLlamadas()[0]).toEqual({ nombre: 'cola_lookup', args: { p_nombres: ['Flan', 'Budín'] } });
    expect(resolverMock).toHaveBeenCalledWith([{ nombre: 'Budín', categoria: 'proteína animal' }], CATALOGO);
    const items = itemsDeLaRpc();
    expect(items[0]).toMatchObject({ metodo_match: 'cola', ia: null, id_alimento: null });
    expect(items[1]).toMatchObject({ metodo_match: 'gemini', ia: IA });
  });

  it('deportista con todo en la cola: no se llama a Gemini', async () => {
    escenario({ match: [filaMatch(1, { nombre_normalizado: 'flan' })] });
    deportista();
    adminDb.mockRpc('cola_lookup', { data: [filaCola(1, 'flan', false)], error: null });
    await POST(makeRequest(makeSaveRequest({ items: [baseItem({ name: 'Flan' })] })));
    expect(resolverMock).not.toHaveBeenCalled();
    expect(itemsDeLaRpc()[0].metodo_match).toBe('cola');
  });

  it('particular: nunca llama a cola_lookup', async () => {
    dos();
    userDb.mockTable('profiles', { data: { role: 'particular' }, error: null });
    resolverMock.mockResolvedValue({ resultados: [{ macros: IA }, { macros: IA }], modelo: 'm' });
    await POST(makeRequest(reqDos()));
    expect(adminDb.rpcLlamadas().map((l) => l.nombre)).toEqual(['registrar_guardado_deteccion']);
    expect(resolverMock.mock.calls[0][0]).toHaveLength(2);
  });

  it('sin perfil legible: se trata como no-deportista (no consulta la cola)', async () => {
    dos();
    resolverMock.mockResolvedValue({ resultados: [{ macros: IA }, { macros: IA }], modelo: 'm' });
    await POST(makeRequest(reqDos()));
    expect(adminDb.rpcLlamadas().map((l) => l.nombre)).not.toContain('cola_lookup');
  });

  it('si cola_lookup falla se sigue con Gemini para todos (degrada, no rompe)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    dos();
    deportista();
    adminDb.mockRpc('cola_lookup', { data: null, error: { message: 'boom' } });
    resolverMock.mockResolvedValue({ resultados: [{ macros: IA }, { macros: IA }], modelo: 'm' });
    const res = await POST(makeRequest(reqDos()));
    expect(res.status).toBe(200);
    expect(resolverMock.mock.calls[0][0]).toHaveLength(2);
    expect(itemsDeLaRpc().map((i) => i.metodo_match)).toEqual(['gemini', 'gemini']);
    spy.mockRestore();
  });

  it('todo resuelto por catálogo: ni siquiera se lee el rol', async () => {
    escenario({ match: [catalogo(1, 10)] });
    await POST(makeRequest(makeSaveRequest()));
    expect(userDb.tablasLlamadas()).not.toContain('profiles');
  });
});

describe('POST /save — la IA elige de la lista SARA2 (NUT-119)', () => {
  it('la IA elige una entrada: viaja el id con metodo_match sara2_ia y SIN macros de IA (salen del catálogo)', async () => {
    escenario();
    resolverMock.mockResolvedValue({ resultados: [{ idCatalogo: 886 }], modelo: 'gemini-x' });
    const res = await POST(makeRequest(makeSaveRequest({ items: [baseItem({ name: 'Huevo' })] })));
    expect(res.status).toBe(200);
    expect(itemsDeLaRpc()[0]).toMatchObject({ id_alimento: 886, metodo_match: 'sara2_ia', score_match: null, ia: null });
  });

  it('le pasa al resolutor el catálogo cargado (SARA2 + VALIDADO) para que elija', async () => {
    escenario();
    resolverMock.mockResolvedValue({ resultados: [{ idCatalogo: 886 }], modelo: 'm' });
    await POST(makeRequest(makeSaveRequest({ items: [baseItem({ name: 'Huevo' })] })));
    expect(catalogoMock).toHaveBeenCalledTimes(1);
    expect(resolverMock.mock.calls[0][1]).toBe(CATALOGO);
  });

  it('si no se puede cargar el catálogo, igual se estima con la IA (sólo macros) y el guardado no falla', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    escenario();
    catalogoMock.mockRejectedValue(new Error('boom'));
    resolverMock.mockResolvedValue({ resultados: [{ macros: IA }], modelo: 'm' });
    const res = await POST(makeRequest(makeSaveRequest()));
    expect(res.status).toBe(200);
    expect(resolverMock.mock.calls[0][1]).toEqual([]);
    expect(itemsDeLaRpc()[0]).toMatchObject({ metodo_match: 'gemini', ia: IA });
    spy.mockRestore();
  });

  it('si todo se resuelve por match exacto / foodRef no se carga el catálogo ni se llama a la IA', async () => {
    escenario({ match: [catalogo(1, 10)] });
    await POST(makeRequest(makeSaveRequest()));
    expect(catalogoMock).not.toHaveBeenCalled();
    expect(resolverMock).not.toHaveBeenCalled();
  });
});

describe('POST /save — commit transaccional', () => {
  it('usa el cliente admin con p_user_id = user.id y los datos del guardado', async () => {
    escenario();
    await POST(makeRequest(makeSaveRequest({ removedItemIds: [ITEM_UUID_2] })));
    const call = adminDb.rpcLlamadas()[0];
    expect(call.nombre).toBe('registrar_guardado_deteccion');
    expect(call.args).toMatchObject({
      p_user_id: 'user-1',
      p_id_deteccion: 1,
      p_tipo: 'desayuno',
      p_removed: [ITEM_UUID_2],
    });
    // ya no se escribe nada directo desde el cliente del usuario
    expect(userDb.insertsLlamados()).toEqual([]);
  });

  it('mapea los ítems al formato snake_case de la RPC', async () => {
    escenario();
    await POST(
      makeRequest(
        makeSaveRequest({
          items: [baseItem({ origin: 'answered', answers: [{ question: '¿Cómo?', answer: 'Al horno' }] })],
        }),
      ),
    );
    expect(itemsDeLaRpc()[0]).toMatchObject({
      source_item_uuid: ITEM_UUID,
      name: 'Milanesa de pollo',
      category: 'proteína animal',
      origin: 'answered',
      answers: [{ question: '¿Cómo?', answer: 'Al horno' }],
    });
  });

  it('si la RPC falla → 502 PERSISTENCE_ERROR', async () => {
    escenario();
    adminDb.reset();
    adminDb.mockRpc('registrar_guardado_deteccion', { data: null, error: { message: 'boom' } });
    const res = await POST(makeRequest(makeSaveRequest()));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('PERSISTENCE_ERROR');
  });

  it('FOOD_REF_INVALIDO → 400 INVALID apuntando al ítem con ese foodRef', async () => {
    escenario();
    adminDb.reset();
    adminDb.mockRpc('registrar_guardado_deteccion', {
      data: null,
      error: { message: 'FOOD_REF_INVALIDO', details: '999' },
    });
    const res = await POST(makeRequest(makeSaveRequest({ items: [baseItem({ foodRef: '999' })] })));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('items.0.foodRef');
  });

  it('cada origin y removedItemIds se aceptan (200)', async () => {
    for (const item of [
      baseItem({ origin: 'replaced', name: 'Yogur griego' }),
      baseItem({ sourceItemId: null, aiGrams: null, origin: 'added_manually', name: 'Café' }),
    ]) {
      escenario();
      const res = await POST(makeRequest(makeSaveRequest({ items: [item], removedItemIds: [ITEM_UUID] })));
      expect(res.status).toBe(200);
    }
  });
});

describe('POST /save — la respuesta nunca lleva kcal/macros', () => {
  const claves = (v: unknown, acc: string[] = []): string[] => {
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        acc.push(k);
        claves(val, acc);
      }
    }
    return acc;
  };

  it('devuelve savedId y contadores, sin ninguna clave de kcal/macros', async () => {
    escenario();
    resolverMock.mockResolvedValue({ resultados: [{ macros: IA }], modelo: 'm' });
    adminDb.reset();
    adminDb.mockRpc('registrar_guardado_deteccion', {
      data: { id_guardado: 7, items_registrados: 1, sin_datos: 0, kcal: 999 },
      error: null,
    });
    const res = await POST(makeRequest(makeSaveRequest()));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, savedId: '7', diario: { itemsRegistrados: 1, sinDatos: 0 } });
    expect(claves(body).join(' ')).not.toMatch(/kcal|proteina|grasa|carb|macro/i);
  });
});
