// NUT-188/190 — Manejo de errores y lógica del chat de comidas con un cliente
// Gemini FALSO (no usa red ni cuota).
import { describe, expect, it, vi } from 'vitest';
import { AiError, callLlmJson, type LlmRawResponse, type LlmRequest, type LlmTransport } from '@/lib/ai/gemini';
import { chatMealRequestSchema, modelMealOutputSchema } from '@/lib/chat/mealSchemas';
import { analyzeMeal, BLOCKED_MESSAGE, INVALID_INPUT_MESSAGES, OFF_TOPIC_MESSAGE, sanitizeEstimate } from '@/lib/chat/mealService';
import { checkRateLimit, RATE_LIMIT_MAX_REQUESTS } from '@/lib/chat/rateLimit';
import { macrosForQuantity, type FoodCatalog, type Sara2Food } from '@/lib/chat/sara2Catalog';
import { matchIngredient, scoreMatch } from '@/lib/chat/sara2Matcher';

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

const estimatedMacros = { kcal: 100, proteinas_g: 1, carbs_g: 23, grasas_g: 0.3 };
const mealOk = {
  detectedIngredients: [
    { ingredient: 'banana', type: 'fruta', confidence: 0.9, estimatedWeightGrams: 120, unit: 'g', estimatedMacros, questionForUser: null },
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
  food(427, 'Arroz yamaní, hervido', 104),
  food(649, 'Pan blanco, tipo molde, lacteado', 244),
  food(314, 'Café preparado a partir de grano molido (tipo café de filtro)', 1),
];
const catalog: FoodCatalog = { getAll: async () => CATALOG_ROWS };
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

  it('match confiable en SARA2: una sola llamada, macros con la fórmula del trigger y sin estimación de IA', async () => {
    const llm = fakeTransport([ok(mealOk)]);
    const res = await analyzeMeal(userMsg('comí una banana'), { llm, catalog, llmOptions: fastOptions, onMatch: () => {} });
    expect(llm.calls).toHaveLength(1);
    expect(res.detectedIngredients[0]).toMatchObject({ macroSource: 'sara2', kcal: 110.4, sara2Match: { id_alimento: 375 } });
    expect(res.detectedIngredients[0]).not.toHaveProperty('estimatedMacros');
    expect(res.totalMacros.kcal).toBe(110.4);
  });

  it('sin match confiable: usa la estimación que vino en la MISMA respuesta (nunca una 2ª llamada)', async () => {
    const meal = {
      ...mealOk,
      detectedIngredients: [
        { ...mealOk.detectedIngredients[0], ingredient: 'arroz hervido', type: 'cereal', estimatedWeightGrams: 200,
          estimatedMacros: { kcal: 260, proteinas_g: 5, carbs_g: 57, grasas_g: 0.5 } },
        { ...mealOk.detectedIngredients[0], ingredient: 'arroz blanco hervido', type: 'cereal', estimatedWeightGrams: 200 },
      ],
    };
    const llm = fakeTransport([ok(meal)]);
    const res = await analyzeMeal(userMsg('arroz'), { llm, catalog, llmOptions: fastOptions, onMatch: () => {} });
    expect(llm.calls).toHaveLength(1);
    // "arroz hervido" es ambiguo (blanco / yamaní): estimación del modelo. "arroz blanco hervido" es exacto.
    expect(res.detectedIngredients.map((i) => i.macroSource)).toEqual(['estimado_ia', 'sara2']);
    expect(res.detectedIngredients[0]).toMatchObject({ kcal: 260, proteinas_g: 5, sara2Match: null });
    expect(res.detectedIngredients[1]).toMatchObject({ kcal: 252, sara2Match: { id_alimento: 426 } });
    expect(res.totalMacros.kcal).toBe(260 + 252);
    expect(res.totalEstimatedWeightGrams).toBe(400);
  });

  it('el caso de la tostada: "tostada de pan blanco" ya no se presenta como dato oficial de SARA2', async () => {
    const meal = {
      ...mealOk,
      detectedIngredients: [
        { ...mealOk.detectedIngredients[0], ingredient: 'tostada de pan blanco', type: 'cereal', estimatedWeightGrams: 50,
          estimatedMacros: { kcal: 135, proteinas_g: 4.5, carbs_g: 26, grasas_g: 1.5 } },
      ],
    };
    const res = await analyzeMeal(userMsg('tostada'), { llm: fakeTransport([ok(meal)]), catalog, llmOptions: fastOptions, onMatch: () => {} });
    expect(res.detectedIngredients[0]).toMatchObject({ macroSource: 'estimado_ia', sara2Match: null, kcal: 135 });
  });

  it('informa cada decisión de matching (aceptada o rechazada)', async () => {
    const onMatch = vi.fn();
    await analyzeMeal(userMsg('comí una banana'), { llm: fakeTransport([ok(mealOk)]), catalog, llmOptions: fastOptions, onMatch });
    expect(onMatch).toHaveBeenCalledWith(expect.objectContaining({ ingredient: 'banana', reason: 'accepted' }));
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

  it('sanitizeEstimate acota la estimación del modelo a lo físicamente posible', () => {
    expect(sanitizeEstimate({ kcal: 5000, proteinas_g: 400, carbs_g: 10, grasas_g: -3 }, 100)).toEqual({
      kcal: 900, proteinas_g: 100, carbs_g: 10, grasas_g: 0,
    });
  });
});

describe('sara2Matcher — matching determinístico', () => {
  const f = (id: number, nombre: string, kcal = 100): Sara2Food => food(id, nombre, kcal);
  const rows = [
    f(1, 'Cereza', 63), f(2, 'Cerveza con alcohol', 43), f(3, 'Papas fritas de copetín', 534), f(4, 'Papa, hervida', 81),
    f(5, 'Pan blanco, tipo molde, lacteado', 244), f(6, 'Huevo de gallina, entero, hervido', 156),
    f(7, 'Pollo con piel (horno/parrilla)', 215), f(8, 'Pollo sin piel (horno/parrilla)', 165),
    f(9, 'Tostadas light', 400), f(10, 'Tostadas de mesa', 430), f(11, 'Banana', 92),
  ];
  const decide = (ingredient: string) => matchIngredient(ingredient, rows);

  it('acepta coincidencias exactas ignorando tildes, mayúsculas, plural y género', () => {
    expect(decide('BANANA').food?.id_alimento).toBe(11);
    expect(decide('papas  hervidas').food?.id_alimento).toBe(4);
    expect(decide('pollo sin piel grillado').food?.id_alimento).toBe(8);
    expect(decide('pollo con piel asado').food?.id_alimento).toBe(7);
  });

  it('distingue "con piel" de "sin piel" y "cerveza" de "cereza" (sin comparación difusa)', () => {
    expect(decide('cerveza').food).toBeNull();
    expect(decide('cereza').food?.id_alimento).toBe(1);
    expect(scoreMatch('pollo con piel', 'Pollo sin piel')).toBeLessThan(0.85);
  });

  it('rechaza el match "casi": candidato con palabras de más o ingrediente con palabras de menos', () => {
    expect(decide('papa frita')).toMatchObject({ food: null, reason: 'low_score' });
    expect(decide('tostada de pan blanco')).toMatchObject({ food: null, reason: 'low_score' });
    expect(decide('pan blanco')).toMatchObject({ food: null, reason: 'low_score' });
    expect(decide('huevo revuelto').food).toBeNull();
    expect(decide('ñoquis de papa hervidos').food).toBeNull();
  });

  it('genérico con varias variantes distintas: no hay match', () => {
    expect(decide('tostada').food).toBeNull();
    expect(decide('pollo grillado').food).toBeNull();
  });

  it('dos candidatos exactos con valores distintos son ambiguos; con los mismos valores no', () => {
    const twins = [f(20, 'Galletitas de agua', 438), f(21, 'Galletitas de agua', 410)];
    expect(matchIngredient('galletitas de agua', twins)).toMatchObject({ food: null, reason: 'ambiguous' });
    const sameValues = [f(22, 'Papas grandes', 292), f(23, 'Papas grandes', 292)];
    expect(matchIngredient('papas grandes', sameValues).food).not.toBeNull();
  });

  it('los umbrales se pueden ajustar por parámetro', () => {
    expect(matchIngredient('papa frita', rows, { minScore: 0.8 }).food?.id_alimento).toBe(3);
  });

  it('sin candidatos: no_candidates', () => {
    expect(decide('medialuna')).toMatchObject({ food: null, reason: 'no_candidates', best: null });
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
