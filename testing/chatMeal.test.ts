// NUT-188/190 — Manejo de errores y lógica del chat de comidas con un cliente
// Gemini FALSO (no usa red ni cuota).
import { describe, expect, it, vi } from 'vitest';
import { AiError, callLlmJson, type LlmRawResponse, type LlmRequest, type LlmTransport } from '@/lib/ai/gemini';
import { chatMealRequestSchema, modelMealOutputSchema } from '@/lib/chat/mealSchemas';
import { analyzeMeal, BLOCKED_MESSAGE, INVALID_INPUT_MESSAGES, OFF_TOPIC_MESSAGE } from '@/lib/chat/mealService';
import { checkRateLimit, RATE_LIMIT_MAX_REQUESTS } from '@/lib/chat/rateLimit';
import { macrosForQuantity, pickObviousMatch, rankCandidates, type FoodCatalog, type Sara2Food } from '@/lib/chat/sara2Catalog';

type Step = LlmRawResponse | Error | 'hang';

const usage = { promptTokens: 100, outputTokens: 50, thoughtsTokens: 0 };
const ok = (json: unknown): LlmRawResponse => ({ text: JSON.stringify(json), finishReason: 'STOP', usage });
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

function fakeTransport(steps: Step[]): LlmTransport & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    model: 'fake-model',
    calls,
    async generate(req, signal) {
      calls.push(req);
      const step = steps.shift();
      if (step === undefined) throw new Error('El fake no tiene más respuestas');
      if (step === 'hang') {
        return new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
      }
      if (step instanceof Error) throw step;
      return step;
    },
  };
}

const fastOptions = { timeoutMs: 50, retryDelayMs: 0, log: () => {} };

const mealOk = {
  detectedIngredients: [
    { ingredient: 'banana', type: 'fruta', confidence: 0.9, estimatedWeightGrams: 120, unit: 'g', questionForUser: null },
  ],
  status: 'complete',
  invalidReason: null,
  assistantMessage: 'Listo, registré una banana.',
};

const food = (id: number, nombre: string, kcal = 100): Sara2Food => ({
  id_alimento: id, nombre, kcal_100g: kcal, proteinas_100g: 1, grasas_100g: 1, carbs_100g: 20,
});
const CATALOG_ROWS = [
  food(375, 'Banana', 92),
  food(425, 'Arroz blanco, crudo', 339),
  food(426, 'Arroz blanco, hervido', 126),
  food(314, 'Café preparado a partir de grano molido (tipo café de filtro)', 1),
];
const catalog: FoodCatalog = { findCandidates: async (ing) => rankCandidates(ing, CATALOG_ROWS) };
const userMsg = (content: string) => [{ role: 'user' as const, content }];

describe('callLlmJson — resiliencia', () => {
  const req: LlmRequest = { kind: 'test', systemInstruction: 's', contents: [], jsonSchema: {}, maxOutputTokens: 10 };

  it('timeout: reintenta una vez y termina en AI_UNAVAILABLE', async () => {
    const t = fakeTransport(['hang', 'hang']);
    await expect(callLlmJson(t, req, modelMealOutputSchema, fastOptions)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(t.calls).toHaveLength(2);
  });

  it('429 seguido de éxito: devuelve el resultado del reintento', async () => {
    const t = fakeTransport([httpError(429), ok(mealOk)]);
    await expect(callLlmJson(t, req, modelMealOutputSchema, fastOptions)).resolves.toMatchObject({ status: 'complete' });
    expect(t.calls).toHaveLength(2);
  });

  it('429 dos veces: RATE_LIMITED', async () => {
    const t = fakeTransport([httpError(429), httpError(429)]);
    await expect(callLlmJson(t, req, modelMealOutputSchema, fastOptions)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('503 y error de red: reintenta y termina en AI_UNAVAILABLE', async () => {
    const t = fakeTransport([httpError(503), new TypeError('fetch failed')]);
    await expect(callLlmJson(t, req, modelMealOutputSchema, fastOptions)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(t.calls).toHaveLength(2);
  });

  it('400 (config inválida): no reintenta', async () => {
    const t = fakeTransport([httpError(400)]);
    await expect(callLlmJson(t, req, modelMealOutputSchema, fastOptions)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(t.calls).toHaveLength(1);
  });

  it('JSON inválido dos veces: AI_INVALID_RESPONSE', async () => {
    const bad = { text: '{"status": "comp', finishReason: 'MAX_TOKENS', usage };
    const t = fakeTransport([bad, bad]);
    await expect(callLlmJson(t, req, modelMealOutputSchema, fastOptions)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(t.calls).toHaveLength(2);
  });

  it('JSON que no cumple el schema: reintenta y se recupera', async () => {
    const t = fakeTransport([ok({ status: 'otro' }), ok(mealOk)]);
    await expect(callLlmJson(t, req, modelMealOutputSchema, fastOptions)).resolves.toMatchObject({ status: 'complete' });
  });

  it('respuesta vacía dos veces: AI_INVALID_RESPONSE', async () => {
    const empty = { text: '', finishReason: 'STOP', usage };
    const t = fakeTransport([empty, { ...empty, text: undefined }]);
    await expect(callLlmJson(t, req, modelMealOutputSchema, fastOptions)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });

  it('bloqueo por safety (finishReason o promptFeedback): AI_BLOCKED sin reintento', async () => {
    const t1 = fakeTransport([{ text: undefined, finishReason: 'SAFETY', usage }]);
    await expect(callLlmJson(t1, req, modelMealOutputSchema, fastOptions)).rejects.toMatchObject({ code: 'AI_BLOCKED' });
    expect(t1.calls).toHaveLength(1);
    const t2 = fakeTransport([{ text: undefined, blockReason: 'PROHIBITED_CONTENT', usage }]);
    await expect(callLlmJson(t2, req, modelMealOutputSchema, fastOptions)).rejects.toBeInstanceOf(AiError);
  });

  it('loguea status, latencia y tokens sin incluir la key', async () => {
    const log = vi.fn();
    await callLlmJson(fakeTransport([ok(mealOk)]), req, modelMealOutputSchema, { ...fastOptions, log });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ok', promptTokens: 100, outputTokens: 50 }));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/key/i);
  });
});

describe('analyzeMeal', () => {
  it('safety block => invalid_input con mensaje amigable', async () => {
    const llm = fakeTransport([{ text: undefined, finishReason: 'SAFETY', usage }]);
    const res = await analyzeMeal(userMsg('algo'), { llm, catalog, llmOptions: fastOptions });
    expect(res).toMatchObject({ status: 'invalid_input', assistantMessage: BLOCKED_MESSAGE, detectedIngredients: [] });
  });

  it('solo emojis => invalid_input sin llamar a Gemini', async () => {
    const llm = fakeTransport([]);
    const res = await analyzeMeal(userMsg('😀😀'), { llm, catalog, llmOptions: fastOptions });
    expect(res.status).toBe('invalid_input');
    expect(llm.calls).toHaveLength(0);
  });

  it('off_topic => mensaje constante del backend (no el del modelo)', async () => {
    const llm = fakeTransport([ok({ detectedIngredients: [], status: 'off_topic', invalidReason: null, assistantMessage: 'París' })]);
    const res = await analyzeMeal(userMsg('capital de Francia'), { llm, catalog, llmOptions: fastOptions });
    expect(res).toMatchObject({ status: 'off_topic', assistantMessage: OFF_TOPIC_MESSAGE });
  });

  it('invalid_input sin_consumo => constante correspondiente', async () => {
    const llm = fakeTransport([ok({ detectedIngredients: [], status: 'invalid_input', invalidReason: 'sin_consumo', assistantMessage: 'x' })]);
    const res = await analyzeMeal(userMsg('no comí nada'), { llm, catalog, llmOptions: fastOptions });
    expect(res.assistantMessage).toBe(INVALID_INPUT_MESSAGES.sin_consumo);
  });

  it('match obvio en SARA2: una sola llamada y macros con la fórmula del trigger', async () => {
    const llm = fakeTransport([ok(mealOk)]);
    const res = await analyzeMeal(userMsg('comí una banana'), { llm, catalog, llmOptions: fastOptions });
    expect(llm.calls).toHaveLength(1);
    expect(res.detectedIngredients[0]).toMatchObject({ macroSource: 'sara2', kcal: 110.4, sara2Match: { id_alimento: 375 } });
    expect(res.totalMacros.kcal).toBe(110.4);
  });

  it('ambiguo + sin match: una llamada de matching para ambos (sara2 y estimado_ia)', async () => {
    const meal = {
      ...mealOk,
      detectedIngredients: [
        { ...mealOk.detectedIngredients[0], ingredient: 'arroz hervido', type: 'cereal', estimatedWeightGrams: 200 },
        { ...mealOk.detectedIngredients[0], ingredient: 'empanada de carne', type: 'otro', estimatedWeightGrams: 80 },
      ],
    };
    const match = {
      results: [
        { ref: 0, matchId: 426, estimatedPer100: null },
        { ref: 1, matchId: null, estimatedPer100: { kcal: 290, proteinas: 10, grasas: 15, carbs: 28 } },
      ],
    };
    const llm = fakeTransport([ok(meal), ok(match)]);
    const res = await analyzeMeal(userMsg('arroz y una empanada'), { llm, catalog, llmOptions: fastOptions });
    expect(llm.calls.map((c) => c.kind)).toEqual(['meal', 'match']);
    expect(res.detectedIngredients.map((i) => i.macroSource)).toEqual(['sara2', 'estimado_ia']);
    expect(res.detectedIngredients[0].kcal).toBe(252);
    expect(res.totalMacros.kcal).toBe(252 + 232);
    expect(res.totalEstimatedWeightGrams).toBe(280);
  });

  it('status "complete" con una pregunta pendiente se corrige a needs_clarification', async () => {
    const meal = { ...mealOk, detectedIngredients: [{ ...mealOk.detectedIngredients[0], questionForUser: '¿Cuántas?' }] };
    const res = await analyzeMeal(userMsg('bananas'), { llm: fakeTransport([ok(meal)]), catalog, llmOptions: fastOptions });
    expect(res.status).toBe('needs_clarification');
  });

  it('descarta el saludo inicial del asistente y mapea roles', async () => {
    const llm = fakeTransport([ok(mealOk)]);
    await analyzeMeal(
      [{ role: 'assistant', content: 'Hola' }, { role: 'user', content: 'banana' }, { role: 'assistant', content: '¿Cuántas?' }, { role: 'user', content: 'una' }],
      { llm, catalog, llmOptions: fastOptions },
    );
    expect(llm.calls[0].contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
  });
});

describe('validación del request (antes de Gemini)', () => {
  const parse = (messages: unknown) => chatMealRequestSchema.safeParse({ messages });

  it('rechaza vacío, solo espacios, >500 caracteres, >20 mensajes y último del asistente', () => {
    expect(parse([{ role: 'user', content: '' }]).success).toBe(false);
    expect(parse([{ role: 'user', content: '   ' }]).success).toBe(false);
    expect(parse([{ role: 'user', content: 'a'.repeat(5000) }]).success).toBe(false);
    expect(parse(Array.from({ length: 21 }, () => ({ role: 'user', content: 'hola' }))).success).toBe(false);
    expect(parse([{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'x' }]).success).toBe(false);
    expect(parse([]).success).toBe(false);
  });

  it('acepta una conversación válida', () => {
    expect(parse([{ role: 'user', content: 'comí empanadas' }, { role: 'assistant', content: '¿Cuántas?' }, { role: 'user', content: '3' }]).success).toBe(true);
  });
});

describe('SARA2 helpers', () => {
  it('macrosForQuantity replica round(valor_100g * cantidad / 100, 2)', () => {
    expect(macrosForQuantity({ kcal: 126, proteinas: 2.4, grasas: 0.2, carbs: 28.6 }, 150)).toEqual({
      kcal: 189, proteinas_g: 3.6, grasas_g: 0.3, carbs_g: 42.9,
    });
  });

  it('match obvio solo si no hay variantes', () => {
    expect(pickObviousMatch('banana', rankCandidates('banana', CATALOG_ROWS))?.id_alimento).toBe(375);
    expect(pickObviousMatch('arroz', rankCandidates('arroz', CATALOG_ROWS))).toBeNull();
    expect(rankCandidates('cafe', CATALOG_ROWS)[0].id_alimento).toBe(314);
  });
});

describe('rate limit', () => {
  it(`permite ${RATE_LIMIT_MAX_REQUESTS} por minuto y después corta`, () => {
    const now = 1_000_000;
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) expect(checkRateLimit('u-test', now)).toBe(true);
    expect(checkRateLimit('u-test', now)).toBe(false);
    expect(checkRateLimit('u-test', now + 61_000)).toBe(true);
  });
});
