import type { FoodChatEntry, FoodChatResult, MealChatService } from './chatFood';
import { fetchMockChatReply } from './chatFoodMockService';
import { realMealChatService } from './chatFoodRealService';

// NUT-189 — Elige el servicio del chat según NEXT_PUBLIC_CHAT_SERVICE:
//   mock (default) → guion fijo, sin red ni cuota de Gemini (para trabajar la UI)
//   real           → POST /api/chat/meal (gasta cuota de Gemini en cada mensaje)
// Es una variable NEXT_PUBLIC_: se fija al levantar/buildear, hay que reiniciar `npm run dev`.

/**
 * Resultado enriquecido del mock: para poder probar de punta a punta el guardado (editar,
 * quitar, hidratación, ítem sin catálogo) con datos del formato real. Banana usa el id real
 * de SARA2 (375); la empanada no tiene catálogo (estimado_ia); el agua va a hidratación.
 */
function enrichMockResult(base: FoodChatResult): FoodChatResult {
  const empanada: FoodChatEntry = {
    ...base.alimentos[0],
    gramos: 240,
    unidad: 'g',
    confidence: 0.7,
    macroSource: 'estimado_ia',
    tipo: 'otro',
    idAlimento: null,
    macros: { kcal: 600, proteinas_g: 25.2, carbs_g: 64.8, grasas_g: 26.4 },
  };
  const banana: FoodChatEntry = {
    alimento: 'Banana',
    cantidad: '120 g',
    gramos: 120,
    unidad: 'g',
    confidence: 0.9,
    macroSource: 'sara2',
    tipo: 'fruta',
    idAlimento: 375,
    macros: { kcal: 110.4, proteinas_g: 1.44, carbs_g: 24.48, grasas_g: 0.24 },
  };
  const agua: FoodChatEntry = {
    alimento: 'Agua',
    cantidad: '250 ml',
    gramos: 250,
    unidad: 'ml',
    confidence: 0.9,
    macroSource: 'estimado_ia',
    tipo: 'bebida',
    idAlimento: null,
    macros: { kcal: 0, proteinas_g: 0, carbs_g: 0, grasas_g: 0 },
  };
  return {
    ...base,
    alimentos: [empanada, banana, agua],
    totalGramos: 610,
    totalMacros: { kcal: 710.4, proteinas_g: 26.64, carbs_g: 89.28, grasas_g: 26.64 },
  };
}

/** Adapta el mock de NUT-187 (sin tocarlo) al contrato MealChatService. */
export const mockMealChatService: MealChatService = {
  async sendMessage(history) {
    const reply = await fetchMockChatReply(history);
    return reply.kind === 'result' && reply.result
      ? { status: 'complete', message: reply.message, result: enrichMockResult(reply.result) }
      : { status: 'needs_clarification', message: reply.message };
  },
};

export function getMealChatService(): MealChatService {
  return process.env.NEXT_PUBLIC_CHAT_SERVICE === 'real' ? realMealChatService : mockMealChatService;
}
