// NUT-191 — Guardado del chat de comidas: validación, recálculo de macros en el backend,
// criterio del agua y el endpoint /api/chat/meal/confirm (con Supabase simulado: no toca la base).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { confirmRequestSchema, type ConfirmItem, type ConfirmRequest } from '@/lib/chat/confirmSchemas';
import { buildConfirmPayload, ConfirmValidationError } from '@/lib/chat/confirmService';
import type { Per100 } from '@/lib/chat/sara2Catalog';
import { isWaterIngredient } from '@/lib/chat/water';

const authenticateMock = vi.fn();
vi.mock('@/lib/chat/authenticate', () => ({ authenticate: (...args: unknown[]) => authenticateMock(...args) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/date', () => ({ todayAR: () => '2026-10-08', daysAgoAR: () => '2026-10-01' }));

import { POST } from '@/app/api/chat/meal/confirm/route';

const REQUEST_ID = '3f2b8c1e-7d4a-4e0b-9a55-0c1d2e3f4a5b';
const CONTEXT = { modelo: 'mock', promptVersion: 'mock', minDate: '2026-10-01', maxDate: '2026-10-08' };
const BANANA_PER100: Per100 = { kcal: 92, proteinas: 1.2, grasas: 0.2, carbs: 20.4 };

const empanada: ConfirmItem = {
  ingrediente: 'Empanada de carne', tipo: 'otro', unidad: 'g', origin: 'ai', macroSource: 'estimado_ia',
  idAlimento: null, confidence: 0.7, gramosIa: 240, gramosFinal: 240,
  macrosIa: { kcal: 600, proteinas_g: 25.2, carbs_g: 64.8, grasas_g: 26.4 },
};
const banana: ConfirmItem = {
  ingrediente: 'Banana', tipo: 'fruta', unidad: 'g', origin: 'ai', macroSource: 'sara2',
  idAlimento: 375, confidence: 0.9, gramosIa: 120, gramosFinal: 120,
  // El cliente manda valores que NO coinciden con el catálogo: el backend los ignora.
  macrosIa: { kcal: 9999, proteinas_g: 99, carbs_g: 99, grasas_g: 99 },
};
const agua: ConfirmItem = {
  ingrediente: 'Agua', tipo: 'bebida', unidad: 'ml', origin: 'ai', macroSource: 'estimado_ia',
  idAlimento: null, confidence: 0.9, gramosIa: 250, gramosFinal: 250,
  macrosIa: { kcal: 0, proteinas_g: 0, carbs_g: 0, grasas_g: 0 },
};

const request = (items: ConfirmItem[], extra: Partial<ConfirmRequest> = {}): ConfirmRequest => ({
  requestId: REQUEST_ID, fecha: '2026-10-08', tipoIngesta: 'almuerzo', items, ...extra,
});

describe('isWaterIngredient — solo agua, no cualquier líquido', () => {
  it('reconoce agua y sus variantes comunes', () => {
    for (const name of ['agua', 'Agua', 'agua mineral', 'Agua con gas', 'agua de la canilla', 'soda', ' AGUA ']) {
      expect(isWaterIngredient(name), name).toBe(true);
    }
  });

  it('no confunde con café, mate, jugo, gaseosa ni con alimentos que llevan "agua" en el nombre', () => {
    for (const name of ['café', 'mate cocido', 'jugo de naranja', 'gaseosa cola', 'agua saborizada', 'agua de coco', 'galletitas de agua', 'fernet']) {
      expect(isWaterIngredient(name), name).toBe(false);
    }
  });
});

describe('confirmRequestSchema — coherencia entre origen y datos', () => {
  const parse = (items: ConfirmItem[]) => confirmRequestSchema.safeParse(request(items));

  it('acepta ítems ai, edited y removed bien formados', () => {
    expect(parse([empanada, { ...banana, origin: 'edited', gramosFinal: 100 }, { ...agua, origin: 'removed', gramosFinal: null }]).success).toBe(true);
  });

  it('rechaza un ítem "ai" cuyos gramos no coinciden con los de la IA', () => {
    expect(parse([{ ...empanada, gramosFinal: 100 }]).success).toBe(false);
  });

  it('rechaza un ítem quitado con cantidad final y uno editado sin ella', () => {
    expect(parse([{ ...empanada, origin: 'removed' }]).success).toBe(false);
    expect(parse([{ ...empanada, origin: 'edited', gramosFinal: null }]).success).toBe(false);
  });

  it('exige idAlimento si es sara2 y macros si es estimado_ia', () => {
    expect(parse([{ ...banana, idAlimento: null }]).success).toBe(false);
    expect(parse([{ ...empanada, macrosIa: null }]).success).toBe(false);
    expect(parse([{ ...empanada, idAlimento: 5 }]).success).toBe(false);
  });

  it('un ítem agregado a mano no puede traer datos de la IA', () => {
    const manual: ConfirmItem = { ...empanada, origin: 'added_manually', gramosIa: null, macrosIa: null, macroSource: null, idAlimento: null, confidence: null, gramosFinal: 80 };
    expect(parse([manual]).success).toBe(true);
    expect(parse([{ ...manual, gramosIa: 80 }]).success).toBe(false);
  });

  it('rechaza lista vacía, requestId inválido, fecha mal formada y comida desconocida', () => {
    expect(confirmRequestSchema.safeParse(request([])).success).toBe(false);
    expect(confirmRequestSchema.safeParse(request([empanada], { requestId: 'no-es-uuid' })).success).toBe(false);
    expect(confirmRequestSchema.safeParse(request([empanada], { fecha: '8/10/2026' })).success).toBe(false);
    expect(confirmRequestSchema.safeParse({ ...request([empanada]), tipoIngesta: 'brunch' }).success).toBe(false);
  });
});

describe('buildConfirmPayload — macros finales recalculados en el backend', () => {
  const per100 = new Map([[375, BANANA_PER100]]);
  const build = (items: ConfirmItem[], extra: Partial<ConfirmRequest> = {}) =>
    buildConfirmPayload(request(items, extra), per100, CONTEXT);

  it('sara2: usa el catálogo con la fórmula del trigger e ignora lo que mandó el cliente', () => {
    const [item] = build([banana]).items;
    expect(item.final).toEqual({ gramos: 120, kcal: 110.4, proteinas_g: 1.44, carbs_g: 24.48, grasas_g: 0.24 });
    expect(item.ia).toEqual(item.final);
  });

  it('estimado_ia editado: escala proporcionalmente la estimación del modelo', () => {
    const [item] = build([{ ...empanada, origin: 'edited', gramosFinal: 120 }]).items;
    expect(item.ia).toMatchObject({ gramos: 240, kcal: 600 });
    expect(item.final).toEqual({ gramos: 120, kcal: 300, proteinas_g: 12.6, carbs_g: 32.4, grasas_g: 13.2 });
  });

  it('acota una estimación imposible del modelo (más macros que gramos)', () => {
    const [item] = build([{ ...empanada, gramosIa: 100, gramosFinal: 100, macrosIa: { kcal: 5000, proteinas_g: 400, carbs_g: 10, grasas_g: 0 } }]).items;
    expect(item.final).toMatchObject({ kcal: 900, proteinas_g: 100 });
  });

  it('el agua va a hidratación; el resto de los líquidos y alimentos, al diario; los quitados, a ninguno', () => {
    const cafe: ConfirmItem = { ...agua, ingrediente: 'Café', gramosIa: 200, gramosFinal: 200 };
    const payload = build([agua, cafe, empanada, { ...banana, origin: 'removed', gramosFinal: null }]);
    expect(payload.items.map((i) => i.destino)).toEqual(['hidratacion', 'diario', 'diario', 'ninguno']);
  });

  it('un ítem quitado conserva lo de la IA y deja final en null', () => {
    const removed = build([empanada, { ...banana, origin: 'removed', gramosFinal: null }]).items[1];
    expect(removed).toMatchObject({ origin: 'removed', destino: 'ninguno', final: null });
    expect(removed.ia).toEqual({ gramos: 120, kcal: 110.4, proteinas_g: 1.44, carbs_g: 24.48, grasas_g: 0.24 });
  });

  it('los totales suman solo lo confirmado (sin los quitados)', () => {
    const { totales } = build([empanada, banana, { ...agua, origin: 'removed', gramosFinal: null }]);
    expect(totales).toEqual({ gramos: 360, kcal: 710.4, proteinas_g: 26.64, carbs_g: 89.28, grasas_g: 26.64 });
  });

  it('un ítem agregado a mano queda sin macros (como la carga manual del diario)', () => {
    const manual: ConfirmItem = { ...empanada, ingrediente: 'Torta casera', origin: 'added_manually', gramosIa: null, macrosIa: null, macroSource: null, idAlimento: null, confidence: null, gramosFinal: 80 };
    const [item] = build([manual]).items;
    expect(item).toMatchObject({ ia: null, destino: 'diario', final: { gramos: 80, kcal: 0 } });
  });

  it('rechaza fechas fuera del rango editable del diario', () => {
    expect(() => build([empanada], { fecha: '2026-09-20' })).toThrow(ConfirmValidationError);
    expect(() => build([empanada], { fecha: '2026-10-09' })).toThrow(ConfirmValidationError);
  });

  it('rechaza si todo fue quitado, si falta el alimento del catálogo o si un ítem del diario pasa el tope', () => {
    expect(() => build([{ ...empanada, origin: 'removed', gramosFinal: null }])).toThrow('No hay ningún alimento');
    expect(() => buildConfirmPayload(request([banana]), new Map(), CONTEXT)).toThrow(ConfirmValidationError);
    expect(() => build([{ ...empanada, gramosIa: 2500, gramosFinal: 2500 }])).toThrow('supera el máximo');
  });

  it('el agua no está sujeta al tope del diario', () => {
    expect(() => build([empanada, { ...agua, gramosIa: 2500, gramosFinal: 2500 }])).not.toThrow();
  });
});

describe('POST /api/chat/meal/confirm', () => {
  const rpc = vi.fn();
  const inFilter = vi.fn();
  const supabase = { from: vi.fn(() => ({ select: vi.fn(() => ({ in: inFilter })) })), rpc };

  const call = (body: unknown) =>
    POST(new NextRequest('http://localhost/api/chat/meal/confirm', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));

  beforeEach(() => {
    vi.clearAllMocks();
    authenticateMock.mockResolvedValue({ userId: 'u1', supabase });
    inFilter.mockResolvedValue({ data: [{ id_alimento: 375, kcal_100g: 92, proteinas_100g: 1.2, grasas_100g: 0.2, carbs_100g: 20.4 }], error: null });
    rpc.mockResolvedValue({ data: { idRegistro: 7, idIngesta: 3, itemsDiario: 2, mlAgua: 250, yaGuardado: false }, error: null });
  });

  it('401 sin sesión', async () => {
    authenticateMock.mockResolvedValue(null);
    const res = await call(request([empanada]));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('400 con JSON inválido, payload inválido o fecha fuera de rango; nunca llega a la base', async () => {
    expect((await call('{no es json')).status).toBe(400);
    expect((await call({ requestId: REQUEST_ID, items: [] })).status).toBe(400);
    const outOfRange = await call(request([empanada], { fecha: '2026-08-01' }));
    expect(outOfRange.status).toBe(400);
    expect((await outOfRange.json()).error.message).toContain('7 días');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('200: guarda todo con UNA sola llamada atómica y devuelve el resumen', async () => {
    const res = await call(request([empanada, banana, agua, { ...banana, ingrediente: 'Banana', origin: 'removed', gramosFinal: null }]));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, idRegistro: 7, itemsDiario: 2, mlAgua: 250, yaGuardado: false });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe('confirmar_chat_ia_registro');
    expect(args.p_payload).toMatchObject({ requestId: REQUEST_ID, fecha: '2026-10-08', tipoIngesta: 'almuerzo', modelo: expect.stringMatching(/^gemini-/), promptVersion: expect.stringMatching(/^nut188-/) });
    expect(args.p_payload.items.map((i: { destino: string }) => i.destino)).toEqual(['diario', 'diario', 'hidratacion', 'ninguno']);
    // Banana con los valores del catálogo, no los del cliente (9999 kcal).
    expect(args.p_payload.items[1].final.kcal).toBe(110.4);
    expect(args.p_payload.totales.kcal).toBe(710.4);
  });

  it('audita siempre el modelo de Gemini y la versión del prompt (nunca "mock")', async () => {
    process.env.GEMINI_MODEL = 'gemini-test-model';
    await call(request([empanada]));
    expect(rpc.mock.calls[0][1].p_payload).toMatchObject({ modelo: 'gemini-test-model', promptVersion: expect.stringMatching(/^nut188-/) });
    delete process.env.GEMINI_MODEL;
  });

  it('no consulta el catálogo si ningún ítem es de SARA2', async () => {
    await call(request([empanada]));
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('400 si el alimento de SARA2 ya no existe en el catálogo', async () => {
    inFilter.mockResolvedValue({ data: [], error: null });
    const res = await call(request([banana]));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('500 PERSISTENCE_ERROR si falla el guardado, sin exponer el detalle de la base', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.confirmar_chat_ia_registro' } });
    const res = await call(request([empanada]));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('PERSISTENCE_ERROR');
    expect(JSON.stringify(body)).not.toContain('PGRST202');
  });

  it('un reintento ya guardado (mismo requestId) se informa como yaGuardado', async () => {
    rpc.mockResolvedValue({ data: { idRegistro: 7, yaGuardado: true }, error: null });
    const res = await call(request([empanada]));
    expect(await res.json()).toMatchObject({ ok: true, yaGuardado: true });
  });
});
