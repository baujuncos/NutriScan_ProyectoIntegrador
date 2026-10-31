// NUT-228 — Conversación del chat que viaja con la confirmación. Solo se usa para que el
// investigador vea, en /validacion, qué escribió el usuario y qué aclaró. Minimización: solo
// {role, content}, con tope de cantidad y de tamaño (los mismos en el cliente, el servidor y la 021).

import { z } from 'zod';

export const MAX_CONVERSATION_MESSAGES = 20;
export const MAX_CONVERSATION_MESSAGE_CHARS = 2000;
export const MAX_CONVERSATION_TOTAL_CHARS = 12000;

export const conversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(MAX_CONVERSATION_MESSAGE_CHARS),
});

export const conversationSchema = z
  .array(conversationMessageSchema)
  .min(1)
  .max(MAX_CONVERSATION_MESSAGES)
  .refine((msgs) => msgs.reduce((acc, m) => acc + m.content.length, 0) <= MAX_CONVERSATION_TOTAL_CHARS, {
    error: 'La conversación es demasiado larga.',
  });

export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

/** Corta a `max` caracteres sin partir un par sustituto (emoji) por la mitad. */
function safeSlice(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * Deja solo {role, content} y respeta los topes: conserva los últimos mensajes si hay de más y
 * recorta el contenido y el total sin romper caracteres. Devuelve null si no queda nada.
 */
export function sanitizeConversation(
  messages: ReadonlyArray<{ role: string; content: string }>,
): ConversationMessage[] | null {
  const valid = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_CONVERSATION_MESSAGES)
    .map((m) => ({
      role: m.role as ConversationMessage['role'],
      content: safeSlice(m.content, MAX_CONVERSATION_MESSAGE_CHARS),
    }));

  let total = 0;
  const out: ConversationMessage[] = [];
  for (const m of valid) {
    const room = MAX_CONVERSATION_TOTAL_CHARS - total;
    if (room <= 0) break;
    const content = safeSlice(m.content, room);
    out.push({ role: m.role, content });
    total += content.length;
  }
  return out.length > 0 ? out : null;
}
