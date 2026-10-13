import type { ChatMealResponse, MealIngredientResult } from '@/lib/chat/mealSchemas';
import {
  MealChatError,
  type ChatMessage,
  type FoodChatEntry,
  type MealChatErrorCode,
  type MealChatReply,
  type MealChatService,
} from './chatFood';

// NUT-189/190 — Servicio real del chat: POST /api/chat/meal con el historial completo.
// La sesión viaja en las cookies (mismo origen), igual que el resto de la app.

const ENDPOINT = '/api/chat/meal';

const ERROR_MESSAGES: Record<MealChatErrorCode, { message: string; retryable: boolean }> = {
  BAD_REQUEST: {
    message: 'No pude procesar ese mensaje. Revisá el texto o empezá una conversación nueva.',
    retryable: false,
  },
  UNAUTHORIZED: { message: 'Tu sesión venció. Volvé a iniciar sesión para usar el chat.', retryable: false },
  RATE_LIMITED: {
    message: 'El asistente recibió demasiados mensajes. Esperá un momento y reintentá.',
    retryable: true,
  },
  AI_UNAVAILABLE: { message: 'El asistente no está disponible en este momento. Probá de nuevo en un rato.', retryable: true },
  AI_INVALID_RESPONSE: { message: 'No pude entender la respuesta del asistente. Probá de nuevo.', retryable: true },
  PERSISTENCE_ERROR: { message: 'Algo salió mal. Probá de nuevo.', retryable: true },
  NETWORK: { message: 'No pudimos conectarnos. Revisá tu conexión y reintentá.', retryable: true },
};

function chatError(code: MealChatErrorCode): MealChatError {
  const { message, retryable } = ERROR_MESSAGES[code];
  return new MealChatError(code, message, retryable);
}

function isKnownCode(code: unknown): code is MealChatErrorCode {
  return typeof code === 'string' && code in ERROR_MESSAGES;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function toEntry(item: MealIngredientResult): FoodChatEntry {
  const gramos = Math.round(item.estimatedWeightGrams);
  return {
    alimento: capitalize(item.ingredient),
    cantidad: `${gramos} ${item.unit}`,
    gramos,
    unidad: item.unit,
    confidence: item.confidence,
    macroSource: item.macroSource,
    tipo: item.type,
    idAlimento: item.sara2Match?.id_alimento ?? null,
    macros: { kcal: item.kcal, proteinas_g: item.proteinas_g, carbs_g: item.carbs_g, grasas_g: item.grasas_g },
  };
}

/** Convierte la respuesta del endpoint al contrato que usa la UI. */
export function toMealChatReply(data: ChatMealResponse): MealChatReply {
  if (data.status !== 'complete') return { status: data.status, message: data.assistantMessage };
  return {
    status: 'complete',
    message: data.assistantMessage,
    result: {
      alimentos: data.detectedIngredients.map(toEntry),
      totalGramos: data.totalEstimatedWeightGrams,
      totalMacros: data.totalMacros,
    },
  };
}

/**
 * El saludo inicial del asistente no aporta nada al modelo y cuenta para el
 * límite de 20 mensajes del backend: se manda desde el primer mensaje del usuario.
 */
export function toRequestMessages(history: ChatMessage[]) {
  const firstUser = history.findIndex((m) => m.sender === 'user');
  return history.slice(firstUser < 0 ? history.length : firstUser).map((m) => ({ role: m.sender, content: m.content }));
}

export const realMealChatService: MealChatService = {
  async sendMessage(history, signal) {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: toRequestMessages(history) }),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw chatError('NETWORK');
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (!res.ok) {
      const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
      if (isKnownCode(code)) throw chatError(code);
      throw chatError(res.status === 401 ? 'UNAUTHORIZED' : res.status === 429 ? 'RATE_LIMITED' : 'AI_UNAVAILABLE');
    }

    const data = body as ChatMealResponse | null;
    if (!data || typeof data.status !== 'string' || typeof data.assistantMessage !== 'string') {
      throw chatError('AI_INVALID_RESPONSE');
    }
    return toMealChatReply({ ...data, detectedIngredients: data.detectedIngredients ?? [] });
  },
};
