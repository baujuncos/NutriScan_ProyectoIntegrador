// NUT-187 — Modelos de datos del chat de registro de comida por texto.

export type ChatSender = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  sender: ChatSender;
  content: string;
  timestamp: string; // ISO 8601
}

export type MacroSource = 'sara2' | 'estimado_ia';

export interface FoodMacros {
  kcal: number;
  proteinas_g: number;
  carbs_g: number;
  grasas_g: number;
}

/**
 * Un alimento estructurado que el chat extrajo de la conversación.
 * Los campos opcionales solo los completa el servicio real (NUT-190); el mock no.
 */
export interface FoodChatEntry {
  alimento: string;
  cantidad: string;
  observaciones?: string;
  gramos?: number;
  unidad?: 'g' | 'ml';
  /** 0 a 1. Por debajo de LOW_CONFIDENCE_THRESHOLD la UI pide revisar el dato. */
  confidence?: number;
  macroSource?: MacroSource;
  macros?: FoodMacros;
}

/** Payload final que el chat entrega al módulo de desglose/confirmación (NUT-191). */
export interface FoodChatResult {
  alimentos: FoodChatEntry[];
  resumen?: string;
  totalGramos?: number;
  totalMacros?: FoodMacros;
}

export const LOW_CONFIDENCE_THRESHOLD = 0.6;

// ---------- NUT-189/190: contrato del servicio de chat (mock o real) ----------

export type MealChatStatus = 'complete' | 'needs_clarification' | 'off_topic' | 'invalid_input';

export interface MealChatReply {
  status: MealChatStatus;
  message: string;
  /** Solo con status "complete": es lo que habilita "Confirmar y guardar registro". */
  result?: FoodChatResult;
}

export interface MealChatService {
  /** Recibe el historial completo (el backend es stateless). */
  sendMessage(history: ChatMessage[], signal?: AbortSignal): Promise<MealChatReply>;
}

export type MealChatErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'AI_UNAVAILABLE'
  | 'AI_INVALID_RESPONSE'
  | 'NETWORK';

/** Error con un mensaje ya apto para mostrarle al usuario (sin detalles técnicos). */
export class MealChatError extends Error {
  readonly code: MealChatErrorCode;
  /** Si tiene sentido reenviar el mismo mensaje ("Reintentar"). */
  readonly retryable: boolean;
  constructor(code: MealChatErrorCode, userMessage: string, retryable: boolean) {
    super(userMessage);
    this.name = 'MealChatError';
    this.code = code;
    this.retryable = retryable;
  }
}

/** Mismos límites que valida el backend (src/lib/chat/mealSchemas.ts). */
export const MAX_CHAT_MESSAGE_CHARS = 500;
export const MAX_CHAT_HISTORY_MESSAGES = 20;

export function createChatMessage(sender: ChatSender, content: string): ChatMessage {
  return {
    id: typeof crypto !== 'undefined' ? crypto.randomUUID() : `${sender}-${Date.now()}-${Math.random()}`,
    sender,
    content,
    timestamp: new Date().toISOString(),
  };
}
