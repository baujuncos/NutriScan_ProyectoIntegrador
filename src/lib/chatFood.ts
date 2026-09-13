// NUT-187 — Modelos de datos del chat de registro de comida por texto.

export type ChatSender = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  sender: ChatSender;
  content: string;
  timestamp: string; // ISO 8601
}

/** Un alimento estructurado que el chat extrajo de la conversación. */
export interface FoodChatEntry {
  alimento: string;
  cantidad: string;
  observaciones?: string;
}

/** Payload final que el chat entrega al módulo de desglose/confirmación (NUT-191). */
export interface FoodChatResult {
  alimentos: FoodChatEntry[];
  resumen?: string;
}

export function createChatMessage(sender: ChatSender, content: string): ChatMessage {
  return {
    id: typeof crypto !== 'undefined' ? crypto.randomUUID() : `${sender}-${Date.now()}-${Math.random()}`,
    sender,
    content,
    timestamp: new Date().toISOString(),
  };
}
