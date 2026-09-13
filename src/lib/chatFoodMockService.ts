import type { ChatMessage, FoodChatResult } from './chatFood';

// NUT-187 — Servicio mock desacoplado que simula la conversación del chat de
// registro de comida. Reemplazar por la integración real (Gemini / LLM) sin
// tocar el componente de UI: solo hay que cambiar la implementación de
// `fetchMockChatReply` por una llamada real que respete el mismo contrato.

const MOCK_REPLY_DELAY_MS = 1000;

export type ChatBotReplyKind = 'question' | 'result';

export interface ChatBotReply {
  kind: ChatBotReplyKind;
  message: string;
  result?: FoodChatResult;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simula la respuesta del asistente ante el historial de mensajes actual.
 * Guion fijo de prueba: la primera vez que el usuario describe la comida,
 * el bot repregunta un dato aclaratorio; en el siguiente turno, confirma
 * un listado de alimentos estructurado (mock, sin NLP real).
 */
export async function fetchMockChatReply(history: ChatMessage[]): Promise<ChatBotReply> {
  await delay(MOCK_REPLY_DELAY_MS);

  const userTurns = history.filter((m) => m.sender === 'user').length;

  if (userTurns <= 1) {
    return {
      kind: 'question',
      message: '¿De qué era el relleno de las empanadas y cuántas comiste?',
    };
  }

  return {
    kind: 'result',
    message: 'Perfecto, esto es lo que entendí. Revisá el detalle y confirmá para guardarlo:',
    result: {
      alimentos: [
        { alimento: 'Empanada de carne', cantidad: '3 unidades', observaciones: 'Horneadas' },
      ],
      resumen: 'Empanadas de carne al horno',
    },
  };
}
