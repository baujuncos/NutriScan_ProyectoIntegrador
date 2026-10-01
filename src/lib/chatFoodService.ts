import type { MealChatService } from './chatFood';
import { fetchMockChatReply } from './chatFoodMockService';
import { realMealChatService } from './chatFoodRealService';

// NUT-189 — Elige el servicio del chat según NEXT_PUBLIC_CHAT_SERVICE:
//   mock (default) → guion fijo, sin red ni cuota de Gemini (para trabajar la UI)
//   real           → POST /api/chat/meal (gasta cuota de Gemini en cada mensaje)
// Es una variable NEXT_PUBLIC_: se fija al levantar/buildear, hay que reiniciar `npm run dev`.

/** Adapta el mock de NUT-187 (sin tocarlo) al contrato MealChatService. */
export const mockMealChatService: MealChatService = {
  async sendMessage(history) {
    const reply = await fetchMockChatReply(history);
    return reply.kind === 'result' && reply.result
      ? { status: 'complete', message: reply.message, result: reply.result }
      : { status: 'needs_clarification', message: reply.message };
  },
};

export function getMealChatService(): MealChatService {
  return process.env.NEXT_PUBLIC_CHAT_SERVICE === 'real' ? realMealChatService : mockMealChatService;
}
