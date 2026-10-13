// NUT-188/190 — Servicio del chat de registro de comida. UNA sola llamada a Gemini por request:
//   1) Gemini descompone la conversación en alimentos con gramaje y su propia estimación de macros.
//   2) El backend busca cada alimento en SARA2 con un matching determinístico (sara2Matcher.ts).
//   3) Match confiable => macros de SARA2 ("sara2"); si no => la estimación de Gemini ("estimado_ia").
// Macros de SARA2 = misma fórmula que el trigger de items (macrosForQuantity).
// Stateless: recibe el historial completo en cada request. No persiste nada.

import { z } from 'zod';
import { AiError, callLlmJson, type LlmCallOptions, type LlmContent, type LlmTransport } from '@/lib/ai/gemini';
import { toFixed2 } from '@/lib/nutrition';
import {
  modelMealOutputSchema,
  type ChatMealMessage,
  type ChatMealResponse,
  type InvalidReason,
  type Macros,
  type MealIngredientResult,
  type ModelMealOutput,
} from './mealSchemas';
import { MEAL_DESCRIPTION_SYSTEM_PROMPT } from './prompts/mealDescription';
import { matchIngredient, type MatchDecision } from './sara2Matcher';
import { macrosForQuantity, sara2Per100, type FoodCatalog } from './sara2Catalog';

export const OFF_TOPIC_MESSAGE =
  'Solo puedo ayudarte a registrar lo que comiste o tomaste. Contame, por ejemplo: "almorcé milanesa con puré y un vaso de agua".';

export const INVALID_INPUT_MESSAGES: Record<InvalidReason | 'vacio', string> = {
  vacio: 'Escribí qué comiste o tomaste para poder registrarlo.',
  sin_sentido: 'No entendí tu mensaje. ¿Me contás qué comiste o tomaste?',
  sin_consumo: '¡Entendido! Cuando comas o tomes algo, contámelo y lo registramos.',
};

export const BLOCKED_MESSAGE = 'No pude procesar ese mensaje. Contame solo qué comiste o tomaste.';

const MEAL_MAX_OUTPUT_TOKENS = 2500;

/**
 * JSON Schema para la salida estructurada nativa de Gemini, derivado del mismo Zod.
 * Gemini rechaza con 400 INVALID_ARGUMENT los topes `minimum`/`maximum` dentro del objeto
 * anidado `estimatedMacros` (verificado con gemini-3.6-flash), así que se quitan SOLO del
 * schema que se le manda. Los topes siguen validándose en el servidor con Zod.
 */
export function buildMealJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(modelMealOutputSchema) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const macros = schema.properties.detectedIngredients.items.properties.estimatedMacros.properties as Record<string, Record<string, unknown>>;
  for (const field of Object.values(macros)) {
    delete field.minimum;
    delete field.maximum;
  }
  return schema;
}

const MEAL_JSON_SCHEMA = buildMealJsonSchema();

export interface MealServiceDeps {
  llm: LlmTransport;
  catalog: FoodCatalog;
  llmOptions?: LlmCallOptions;
  /** Se llama con cada decisión de matching (aceptada o rechazada). Por defecto, log en consola. */
  onMatch?: (decision: MatchDecision) => void;
}

const ZERO_MACROS: Macros = { kcal: 0, proteinas_g: 0, carbs_g: 0, grasas_g: 0 };

function emptyResponse(status: ChatMealResponse['status'], assistantMessage: string): ChatMealResponse {
  return {
    status,
    assistantMessage,
    detectedIngredients: [],
    totalEstimatedWeightGrams: 0,
    totalMacros: { ...ZERO_MACROS },
  };
}

/** Gemini exige que la conversación arranque con el usuario (el saludo de la UI no aporta). */
function toContents(messages: ChatMealMessage[]): LlmContent[] {
  const firstUser = messages.findIndex((m) => m.role === 'user');
  return messages.slice(firstUser).map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    text: m.content.trim(),
  }));
}

/** Coherencia status <-> preguntas, sin depender de que el modelo la respete. */
function normalizeOutput(out: ModelMealOutput): ModelMealOutput {
  if (out.status === 'off_topic' || out.status === 'invalid_input') {
    return { ...out, detectedIngredients: [] };
  }
  const items = out.detectedIngredients.map((i) => ({
    ...i,
    questionForUser: i.questionForUser?.trim() ? i.questionForUser.trim() : null,
  }));
  const hasQuestion = items.some((i) => i.questionForUser !== null);
  // Sin ítems y sin preguntas: el modelo pregunta qué comió ("comí algo rico").
  const status = hasQuestion || items.length === 0 ? 'needs_clarification' : 'complete';
  return { ...out, detectedIngredients: items, status };
}

function logMatchDecision(d: MatchDecision): void {
  const fmt = (x: MatchDecision['best']) => (x ? `${x.food.id_alimento} "${x.food.nombre.slice(0, 50)}" ${x.score.toFixed(2)}` : '-');
  console.info(`[sara2-match] ${JSON.stringify({ ingredient: d.ingredient, result: d.reason, best: fmt(d.best), second: fmt(d.second) })}`);
}

/**
 * La estimación del modelo es un respaldo sin verificar: se acota a lo físicamente posible
 * (un alimento no tiene más gramos de macronutriente que gramos totales, ni más de ~9 kcal/g).
 */
export function sanitizeEstimate(estimate: Macros, grams: number): Macros {
  const cap = (value: number, max: number) => toFixed2(Math.min(Math.max(value, 0), max));
  return {
    kcal: cap(estimate.kcal, grams * 9),
    proteinas_g: cap(estimate.proteinas_g, grams),
    carbs_g: cap(estimate.carbs_g, grams),
    grasas_g: cap(estimate.grasas_g, grams),
  };
}

function sumMacros(items: Macros[]): Macros {
  return items.reduce<Macros>(
    (acc, m) => ({
      kcal: toFixed2(acc.kcal + m.kcal),
      proteinas_g: toFixed2(acc.proteinas_g + m.proteinas_g),
      carbs_g: toFixed2(acc.carbs_g + m.carbs_g),
      grasas_g: toFixed2(acc.grasas_g + m.grasas_g),
    }),
    { ...ZERO_MACROS },
  );
}

/** Mensajes ya validados con chatMealRequestSchema (último = usuario, no vacío). */
export async function analyzeMeal(messages: ChatMealMessage[], deps: MealServiceDeps): Promise<ChatMealResponse> {
  const last = messages[messages.length - 1];
  // Solo emojis/símbolos: no hay nada que interpretar, no gastamos tokens.
  if (!/[\p{L}\p{N}]/u.test(last.content)) {
    return emptyResponse('invalid_input', INVALID_INPUT_MESSAGES.sin_sentido);
  }

  let raw: ModelMealOutput;
  try {
    raw = await callLlmJson(
      deps.llm,
      {
        kind: 'meal',
        systemInstruction: MEAL_DESCRIPTION_SYSTEM_PROMPT,
        contents: toContents(messages),
        jsonSchema: MEAL_JSON_SCHEMA,
        maxOutputTokens: MEAL_MAX_OUTPUT_TOKENS,
      },
      modelMealOutputSchema,
      deps.llmOptions,
    );
  } catch (err) {
    if (err instanceof AiError && err.code === 'AI_BLOCKED') {
      return emptyResponse('invalid_input', BLOCKED_MESSAGE);
    }
    throw err;
  }

  const out = normalizeOutput(raw);
  if (out.status === 'off_topic') return emptyResponse('off_topic', OFF_TOPIC_MESSAGE);
  if (out.status === 'invalid_input') {
    return emptyResponse('invalid_input', INVALID_INPUT_MESSAGES[out.invalidReason ?? 'sin_sentido']);
  }

  const foods = await deps.catalog.getAll();
  const report = deps.onMatch ?? logMatchDecision;
  const detectedIngredients: MealIngredientResult[] = out.detectedIngredients.map((item) => {
    const { estimatedMacros, ...ingredient } = item;
    const decision = matchIngredient(item.ingredient, foods);
    report(decision);
    return {
      ...ingredient,
      // ml ≈ g: SARA2 expresa las bebidas cada 100 g/ml.
      ...(decision.food
        ? macrosForQuantity(sara2Per100(decision.food), item.estimatedWeightGrams)
        : sanitizeEstimate(estimatedMacros, item.estimatedWeightGrams)),
      macroSource: decision.food ? 'sara2' : 'estimado_ia',
      sara2Match: decision.food ? { id_alimento: decision.food.id_alimento, nombre: decision.food.nombre } : null,
    };
  });

  return {
    status: out.status,
    assistantMessage: out.assistantMessage.trim(),
    detectedIngredients,
    totalEstimatedWeightGrams: toFixed2(detectedIngredients.reduce((a, i) => a + i.estimatedWeightGrams, 0)),
    totalMacros: sumMacros(detectedIngredients),
  };
}
