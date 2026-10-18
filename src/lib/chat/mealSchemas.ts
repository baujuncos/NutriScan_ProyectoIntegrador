// NUT-188/190 — Contratos (Zod) del chat de registro de comida con Gemini.

import { z } from 'zod';

export const MAX_MESSAGES = 20;
export const MAX_USER_MESSAGE_CHARS = 500;
const MAX_ASSISTANT_MESSAGE_CHARS = 2000;

export const INGREDIENT_TYPES = [
  'cereal', 'vegetal', 'fruta', 'legumbre', 'carne', 'pescado',
  'huevo', 'lacteo', 'grasa', 'dulce', 'bebida', 'otro',
] as const;

export const MEAL_STATUSES = ['complete', 'needs_clarification', 'off_topic', 'invalid_input'] as const;
export const INVALID_REASONS = ['sin_sentido', 'sin_consumo'] as const;

export type MealStatus = (typeof MEAL_STATUSES)[number];
export type InvalidReason = (typeof INVALID_REASONS)[number];

// ---------- Request del endpoint ----------

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant'], { error: 'role debe ser "user" o "assistant".' }),
  content: z.string({ error: 'content debe ser texto.' }).max(MAX_ASSISTANT_MESSAGE_CHARS, {
    error: 'El mensaje es demasiado largo.',
  }),
});

export const chatMealRequestSchema = z
  .object({
    messages: z
      .array(chatMessageSchema, { error: 'messages debe ser una lista.' })
      .min(1, { error: 'Escribí qué comiste o tomaste.' })
      .max(MAX_MESSAGES, { error: `La conversación supera los ${MAX_MESSAGES} mensajes. Empezá una nueva.` }),
  })
  .superRefine(({ messages }, ctx) => {
    messages.forEach((m, i) => {
      if (m.role !== 'user') return;
      if (!m.content.trim()) {
        ctx.addIssue({ code: 'custom', path: ['messages', i, 'content'], message: 'Escribí qué comiste o tomaste.' });
      } else if (m.content.length > MAX_USER_MESSAGE_CHARS) {
        ctx.addIssue({
          code: 'custom',
          path: ['messages', i, 'content'],
          message: `Cada mensaje puede tener hasta ${MAX_USER_MESSAGE_CHARS} caracteres.`,
        });
      }
    });
    if (messages.length > 0 && messages[messages.length - 1].role !== 'user') {
      ctx.addIssue({ code: 'custom', path: ['messages'], message: 'El último mensaje debe ser del usuario.' });
    }
  });

export type ChatMealRequest = z.infer<typeof chatMealRequestSchema>;
export type ChatMealMessage = ChatMealRequest['messages'][number];

// ---------- Salida del modelo (descomposición) ----------
// El orden de las claves importa: Gemini genera en ese orden, y armar los ítems
// antes que el status hace que el status sea coherente con las preguntas.

// Estimación propia del modelo para la cantidad detectada (totales, no cada 100 g).
// Es un respaldo: el backend la usa solo si el matching contra SARA2 no es confiable.
// Los topes son holgados a propósito: un ítem que SÍ matchea SARA2 no debe fallar por esto;
// la verosimilitud se controla recién cuando la estimación se usa (ver mealService.ts).
export const modelEstimatedMacrosSchema = z.object({
  kcal: z.number().min(0).max(20000),
  proteinas_g: z.number().min(0).max(5000),
  carbs_g: z.number().min(0).max(5000),
  grasas_g: z.number().min(0).max(5000),
});

export const modelIngredientSchema = z.object({
  ingredient: z.string().min(1).max(80),
  type: z.enum(INGREDIENT_TYPES),
  confidence: z.number().min(0).max(1),
  estimatedWeightGrams: z.number().positive().max(5000),
  unit: z.enum(['g', 'ml']),
  estimatedMacros: modelEstimatedMacrosSchema,
  questionForUser: z.string().max(300).nullable(),
});

export const modelMealOutputSchema = z.object({
  detectedIngredients: z.array(modelIngredientSchema).max(15),
  status: z.enum(MEAL_STATUSES),
  invalidReason: z.enum(INVALID_REASONS).nullable(),
  assistantMessage: z.string().max(1000),
});

export type ModelIngredient = z.infer<typeof modelIngredientSchema>;
export type ModelMealOutput = z.infer<typeof modelMealOutputSchema>;

// ---------- Respuesta del endpoint ----------

export interface Macros {
  kcal: number;
  proteinas_g: number;
  carbs_g: number;
  grasas_g: number;
}

export interface MealIngredientResult extends Omit<ModelIngredient, 'estimatedMacros'>, Macros {
  macroSource: 'sara2' | 'estimado_ia';
  sara2Match: { id_alimento: number; nombre: string } | null;
}

export interface ChatMealResponse {
  status: MealStatus;
  assistantMessage: string;
  detectedIngredients: MealIngredientResult[];
  totalEstimatedWeightGrams: number;
  totalMacros: Macros;
}
