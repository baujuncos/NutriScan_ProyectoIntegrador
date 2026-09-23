// NUT-188/190 — Servicio del chat de registro de comida:
//   1) Gemini descompone la conversación en alimentos con gramaje estimado.
//   2) Cada alimento se busca en SARA2; si el match es obvio se usa directo.
//   3) Los dudosos o sin match van en UNA llamada chica a Gemini, que elige el id
//      o, si ninguno sirve, estima los valores cada 100 g ("estimado_ia").
//   4) Macros = misma fórmula que el trigger de items (macrosForQuantity).
// Stateless: recibe el historial completo en cada request. No persiste nada.

import { z } from 'zod';
import { AiError, callLlmJson, type LlmCallOptions, type LlmContent, type LlmTransport } from '@/lib/ai/gemini';
import { toFixed2 } from '@/lib/nutrition';
import {
  modelMatchOutputSchema,
  modelMealOutputSchema,
  type ChatMealMessage,
  type ChatMealResponse,
  type InvalidReason,
  type Macros,
  type MealIngredientResult,
  type ModelIngredient,
  type ModelMealOutput,
} from './mealSchemas';
import { MEAL_DESCRIPTION_SYSTEM_PROMPT, SARA2_MATCH_SYSTEM_PROMPT } from './prompts/mealDescription';
import {
  macrosForQuantity,
  pickObviousMatch,
  sara2Per100,
  type FoodCatalog,
  type Per100,
  type Sara2Food,
} from './sara2Catalog';

export const OFF_TOPIC_MESSAGE =
  'Solo puedo ayudarte a registrar lo que comiste o tomaste. Contame, por ejemplo: "almorcé milanesa con puré y un vaso de agua".';

export const INVALID_INPUT_MESSAGES: Record<InvalidReason | 'vacio', string> = {
  vacio: 'Escribí qué comiste o tomaste para poder registrarlo.',
  sin_sentido: 'No entendí tu mensaje. ¿Me contás qué comiste o tomaste?',
  sin_consumo: '¡Entendido! Cuando comas o tomes algo, contámelo y lo registramos.',
};

export const BLOCKED_MESSAGE = 'No pude procesar ese mensaje. Contame solo qué comiste o tomaste.';

const MEAL_MAX_OUTPUT_TOKENS = 1500;
const MATCH_MAX_OUTPUT_TOKENS = 600;
const CANDIDATE_NAME_MAX_CHARS = 60;

// JSON Schemas para la salida estructurada nativa de Gemini (derivados de los mismos Zod).
const MEAL_JSON_SCHEMA = z.toJSONSchema(modelMealOutputSchema);
const MATCH_JSON_SCHEMA = z.toJSONSchema(modelMatchOutputSchema);

export interface MealServiceDeps {
  llm: LlmTransport;
  catalog: FoodCatalog;
  llmOptions?: LlmCallOptions;
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

type Resolution = { food: Sara2Food | null; per100: Per100 };

async function resolveMacros(
  items: ModelIngredient[],
  deps: MealServiceDeps,
): Promise<Resolution[]> {
  const candidates = await Promise.all(items.map((i) => deps.catalog.findCandidates(i.ingredient)));
  const resolved: (Resolution | null)[] = items.map((item, idx) => {
    const obvious = pickObviousMatch(item.ingredient, candidates[idx]);
    return obvious ? { food: obvious, per100: sara2Per100(obvious) } : null;
  });

  const pending = resolved.flatMap((r, idx) => (r === null ? [idx] : []));
  if (pending.length > 0) {
    const lines = pending.map((idx) => {
      const list = candidates[idx]
        .map((c) => `${c.id_alimento}=${c.nombre.slice(0, CANDIDATE_NAME_MAX_CHARS)}`)
        .join('; ');
      return `ref ${idx}: "${items[idx].ingredient}" (${items[idx].unit}) | candidatos: ${list || 'ninguno'}`;
    });
    const out = await callLlmJson(
      deps.llm,
      {
        kind: 'match',
        systemInstruction: SARA2_MATCH_SYSTEM_PROMPT,
        contents: [{ role: 'user', text: lines.join('\n') }],
        jsonSchema: MATCH_JSON_SCHEMA,
        maxOutputTokens: MATCH_MAX_OUTPUT_TOKENS,
      },
      modelMatchOutputSchema,
      deps.llmOptions,
    );

    for (const idx of pending) {
      const answer = out.results.find((r) => r.ref === idx);
      const food = answer?.matchId != null ? candidates[idx].find((c) => c.id_alimento === answer.matchId) : undefined;
      if (food) {
        resolved[idx] = { food, per100: sara2Per100(food) };
      } else if (answer?.estimatedPer100) {
        resolved[idx] = { food: null, per100: answer.estimatedPer100 };
      } else {
        // El modelo omitió el ítem o inventó un id sin estimación.
        throw new AiError('AI_INVALID_RESPONSE', `Matching incompleto para ref ${idx}.`);
      }
    }
  }
  return resolved as Resolution[];
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

  const resolutions = await resolveMacros(out.detectedIngredients, deps);
  const detectedIngredients: MealIngredientResult[] = out.detectedIngredients.map((item, idx) => {
    const { food, per100 } = resolutions[idx];
    return {
      ...item,
      // ml ≈ g: SARA2 expresa las bebidas cada 100 g/ml.
      ...macrosForQuantity(per100, item.estimatedWeightGrams),
      macroSource: food ? 'sara2' : 'estimado_ia',
      sara2Match: food ? { id_alimento: food.id_alimento, nombre: food.nombre } : null,
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
