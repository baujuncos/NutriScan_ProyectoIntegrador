// NUT-189 — Servicio real del chat con fetch simulado (sin red ni cuota de Gemini).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatMessage, MealChatError } from '@/lib/chatFood';
import { realMealChatService, toRequestMessages } from '@/lib/chatFoodRealService';
import { getMealChatService, mockMealChatService } from '@/lib/chatFoodService';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const history = [
  createChatMessage('assistant', 'Contame qué comiste'),
  createChatMessage('user', 'comí una banana'),
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('realMealChatService', () => {
  it('manda el historial desde el primer mensaje del usuario, sin el saludo', () => {
    expect(toRequestMessages(history)).toEqual([{ role: 'user', content: 'comí una banana' }]);
  });

  it('mapea una respuesta complete a FoodChatResult con macros y fuente', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        status: 'complete',
        assistantMessage: 'Te anoté una banana.',
        detectedIngredients: [{
          ingredient: 'banana', type: 'fruta', confidence: 0.9, estimatedWeightGrams: 120, unit: 'g',
          questionForUser: null, kcal: 110.4, proteinas_g: 1.44, carbs_g: 24.48, grasas_g: 0.24,
          macroSource: 'sara2', sara2Match: { id_alimento: 375, nombre: 'Banana' },
        }],
        totalEstimatedWeightGrams: 120,
        totalMacros: { kcal: 110.4, proteinas_g: 1.44, carbs_g: 24.48, grasas_g: 0.24 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reply = await realMealChatService.sendMessage(history);

    expect(fetchMock).toHaveBeenCalledWith('/api/chat/meal', expect.objectContaining({ method: 'POST' }));
    expect(reply).toEqual({
      status: 'complete',
      message: 'Te anoté una banana.',
      result: {
        alimentos: [{
          alimento: 'Banana', cantidad: '120 g', gramos: 120, unidad: 'g', confidence: 0.9, macroSource: 'sara2',
          tipo: 'fruta', idAlimento: 375,
          macros: { kcal: 110.4, proteinas_g: 1.44, carbs_g: 24.48, grasas_g: 0.24 },
        }],
        totalGramos: 120,
        totalMacros: { kcal: 110.4, proteinas_g: 1.44, carbs_g: 24.48, grasas_g: 0.24 },
      },
    });
  });

  it('needs_clarification no trae resultado (no habilita confirmar)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse(200, { status: 'needs_clarification', assistantMessage: '¿Cuántas?', detectedIngredients: [], totalEstimatedWeightGrams: 0, totalMacros: { kcal: 0, proteinas_g: 0, carbs_g: 0, grasas_g: 0 } }),
    ));
    expect(await realMealChatService.sendMessage(history)).toEqual({ status: 'needs_clarification', message: '¿Cuántas?' });
  });

  it.each([
    ['BAD_REQUEST', 400, false],
    ['UNAUTHORIZED', 401, false],
    ['RATE_LIMITED', 429, true],
    ['AI_UNAVAILABLE', 503, true],
    ['AI_INVALID_RESPONSE', 502, true],
  ] as const)('error %s → MealChatError con mensaje amigable', async (code, status, retryable) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(status, { error: { code, message: 'detalle del server' } })));
    const err = await realMealChatService.sendMessage(history).catch((e) => e);
    expect(err).toBeInstanceOf(MealChatError);
    expect(err).toMatchObject({ code, retryable });
    expect(err.message).not.toContain('detalle del server');
  });

  it('falla de red → NETWORK reintentable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(realMealChatService.sendMessage(history)).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
  });

  it('respuesta 200 sin el formato esperado → AI_INVALID_RESPONSE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
    await expect(realMealChatService.sendMessage(history)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });

  it('error sin código conocido usa el status HTTP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 500 })));
    await expect(realMealChatService.sendMessage(history)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
  });
});

describe('getMealChatService', () => {
  it('siempre es el servicio real, sin importar ninguna variable de entorno', () => {
    expect(getMealChatService()).toBe(realMealChatService);
    vi.stubEnv('NEXT_PUBLIC_CHAT_SERVICE', 'mock');
    expect(getMealChatService()).toBe(realMealChatService);
    expect(getMealChatService()).not.toBe(mockMealChatService);
  });
});
