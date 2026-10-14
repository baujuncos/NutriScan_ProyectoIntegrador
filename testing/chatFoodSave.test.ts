// NUT-191 — Servicio de guardado del cliente (fetch simulado) y lógica de ediciones. Sin red.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmRequestSchema } from '@/lib/chat/confirmSchemas';
import { MealChatError, type FoodChatResult } from '@/lib/chatFood';
import { buildConfirmRequest, isSaveable, newRequestId, resolveItems, summarize, toConfirmedResult } from '@/lib/chatFoodEdits';
import { realMealSaveService } from '@/lib/chatFoodSaveService';
import { mockMealChatService } from '@/lib/chatFoodService';
import { createChatMessage } from '@/lib/chatFood';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const result: FoodChatResult = {
  alimentos: [
    { alimento: 'Empanada de carne', cantidad: '240 g', gramos: 240, unidad: 'g', tipo: 'otro', idAlimento: null,
      confidence: 0.7, macroSource: 'estimado_ia', macros: { kcal: 600, proteinas_g: 25.2, carbs_g: 64.8, grasas_g: 26.4 } },
    { alimento: 'Banana', cantidad: '120 g', gramos: 120, unidad: 'g', tipo: 'fruta', idAlimento: 375,
      confidence: 0.9, macroSource: 'sara2', macros: { kcal: 110.4, proteinas_g: 1.44, carbs_g: 24.48, grasas_g: 0.24 } },
  ],
  totalMacros: { kcal: 710.4, proteinas_g: 26.64, carbs_g: 89.28, grasas_g: 26.64 },
};

afterEach(() => vi.unstubAllGlobals());

describe('realMealSaveService', () => {
  const request = buildConfirmRequest(result, {}, { requestId: newRequestId(), fecha: '2026-10-08', tipoIngesta: 'cena' });

  it('manda el payload a /api/chat/meal/confirm y devuelve el resumen', async () => {
    const fetchMock = vi.fn(async () => json(200, { ok: true, mlAgua: 250, itemsDiario: 2, yaGuardado: false }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(realMealSaveService.save(request)).resolves.toEqual({ ok: true, mlAgua: 250, itemsDiario: 2, yaGuardado: false });
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/meal/confirm', expect.objectContaining({ method: 'POST' }));
  });

  it.each([
    [400, 'BAD_REQUEST', false],
    [401, 'UNAUTHORIZED', false],
    [500, 'PERSISTENCE_ERROR', true],
  ] as const)('HTTP %i → %s (reintentable: %s)', async (status, code, retryable) => {
    vi.stubGlobal('fetch', vi.fn(async () => json(status, { error: { code, message: 'Solo podés cargar comidas de hoy hasta 7 días atrás.' } })));
    const err = await realMealSaveService.save(request).catch((e) => e);
    expect(err).toBeInstanceOf(MealChatError);
    expect(err).toMatchObject({ code, retryable });
  });

  it('el 400 muestra el mensaje de validación del servidor; los demás errores, uno genérico', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(400, { error: { code: 'BAD_REQUEST', message: 'Solo podés cargar comidas de hoy hasta 7 días atrás.' } })));
    expect((await realMealSaveService.save(request).catch((e) => e)).message).toContain('7 días');
    vi.stubGlobal('fetch', vi.fn(async () => json(500, { error: { code: 'PERSISTENCE_ERROR', message: 'detalle interno' } })));
    expect((await realMealSaveService.save(request).catch((e) => e)).message).not.toContain('detalle interno');
  });

  it('falla de red → NETWORK reintentable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(realMealSaveService.save(request)).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
  });
});

describe('ediciones del resultado del chat', () => {
  it('resolveItems escala las macros del ítem editado y marca los quitados', () => {
    const [empanada, banana] = resolveItems(result, { 0: { gramos: 120 }, 1: { removed: true } });
    expect(empanada).toMatchObject({ edited: true, gramos: 120, cantidad: '120 g', macros: { kcal: 300 } });
    expect(banana.removed).toBe(true);
  });

  it('summarize suma solo lo no quitado y redondea', () => {
    expect(summarize(resolveItems(result, { 1: { removed: true } }))).toEqual({
      macros: { kcal: 600, proteinas_g: 25.2, carbs_g: 64.8, grasas_g: 26.4 }, gramos: 240,
    });
  });

  it('buildConfirmRequest genera un payload que cumple el schema del endpoint', () => {
    const request = buildConfirmRequest(result, { 0: { gramos: 100 }, 1: { removed: true } }, { requestId: newRequestId(), fecha: '2026-10-08', tipoIngesta: 'merienda' });
    expect(request.items.map((i) => i.origin)).toEqual(['edited', 'removed']);
    expect(confirmRequestSchema.safeParse(request).success).toBe(true);
  });

  it('un tipo desconocido se manda como "otro"', () => {
    const odd: FoodChatResult = { alimentos: [{ ...result.alimentos[0], tipo: 'algo-raro' }] };
    expect(buildConfirmRequest(odd, {}, { requestId: newRequestId(), fecha: '2026-10-08', tipoIngesta: 'cena' }).items[0].tipo).toBe('otro');
  });

  it('toConfirmedResult excluye los quitados y refleja las cantidades editadas', () => {
    const confirmed = toConfirmedResult(result, { 0: { gramos: 120 }, 1: { removed: true } });
    expect(confirmed.alimentos).toHaveLength(1);
    expect(confirmed.alimentos[0]).toMatchObject({ alimento: 'Empanada de carne', gramos: 120, cantidad: '120 g' });
    expect(confirmed).toMatchObject({ totalGramos: 120, totalMacros: { kcal: 300 } });
  });

  it('isSaveable exige gramos, macros y fuente en cada ítem', () => {
    expect(isSaveable(result)).toBe(true);
    expect(isSaveable({ alimentos: [{ alimento: 'x', cantidad: '1' }] })).toBe(false);
    expect(isSaveable({ alimentos: [] })).toBe(false);
  });

  it('newRequestId genera UUIDs válidos y distintos', () => {
    const a = newRequestId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newRequestId()).not.toBe(a);
  });
});

describe('mock enriquecido', () => {
  it('el resultado del mock tiene el formato que acepta el endpoint de guardado', async () => {
    const history = ['comí empanadas', '3 de carne'].map((text) => createChatMessage('user', text));
    const reply = await mockMealChatService.sendMessage(history);
    expect(reply.status).toBe('complete');
    const request = buildConfirmRequest(reply.result!, {}, { requestId: newRequestId(), fecha: '2026-10-08', tipoIngesta: 'almuerzo' });
    expect(confirmRequestSchema.safeParse(request).success).toBe(true);
    expect(request.items.map((i) => i.ingrediente)).toEqual(['Empanada de carne', 'Banana', 'Agua']);
  });
});
