import type { ConfirmItem, ConfirmRequest } from '@/lib/chat/confirmSchemas';
import { sanitizeConversation } from '@/lib/chat/conversation';
import { INGREDIENT_TYPES } from '@/lib/chat/mealSchemas';
import type { IngestaTipo } from '@/lib/nutrition';
import type { FoodChatEntry, FoodChatResult, FoodMacros } from './chatFood';

// NUT-191 — Ediciones del usuario sobre el resultado del chat, antes de confirmar.
// Por ítem solo hay dos ediciones posibles: cambiar la cantidad (gramos/ml) o quitarlo.

export interface ItemEdit {
  removed?: boolean;
  gramos?: number;
}

/** Ediciones por índice de ítem dentro de FoodChatResult.alimentos. */
export type ItemEdits = Record<number, ItemEdit>;

export interface ResolvedItem {
  index: number;
  entry: FoodChatEntry;
  removed: boolean;
  /** Gramos/ml vigentes (los editados, o los de la IA). null si el ítem no trae gramos. */
  gramos: number | null;
  edited: boolean;
  /** Macros para la cantidad vigente (la estimación original escalada proporcionalmente). */
  macros: FoodMacros | null;
  /** Texto de cantidad para mostrar. */
  cantidad: string;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function scaleMacros(macros: FoodMacros, from: number, to: number): FoodMacros {
  const ratio = to / from;
  return {
    kcal: round2(macros.kcal * ratio),
    proteinas_g: round2(macros.proteinas_g * ratio),
    carbs_g: round2(macros.carbs_g * ratio),
    grasas_g: round2(macros.grasas_g * ratio),
  };
}

export function resolveItems(result: FoodChatResult, edits: ItemEdits): ResolvedItem[] {
  return result.alimentos.map((entry, index) => {
    const edit = edits[index];
    const original = entry.gramos ?? null;
    const gramos = edit?.gramos ?? original;
    const edited = original !== null && gramos !== null && gramos !== original;
    return {
      index,
      entry,
      removed: edit?.removed === true,
      gramos,
      edited,
      macros:
        entry.macros && original !== null && gramos !== null && edited
          ? scaleMacros(entry.macros, original, gramos)
          : (entry.macros ?? null),
      cantidad: edited ? `${gramos} ${entry.unidad ?? 'g'}` : entry.cantidad,
    };
  });
}

export function summarize(items: ResolvedItem[], fallback?: FoodMacros): { macros: FoodMacros | null; gramos: number | null } {
  const kept = items.filter((i) => !i.removed);
  if (kept.some((i) => i.macros === null)) return { macros: fallback ?? null, gramos: null };
  const sum = kept.reduce<FoodMacros>(
    (acc, i) => ({
      kcal: acc.kcal + (i.macros?.kcal ?? 0),
      proteinas_g: acc.proteinas_g + (i.macros?.proteinas_g ?? 0),
      carbs_g: acc.carbs_g + (i.macros?.carbs_g ?? 0),
      grasas_g: acc.grasas_g + (i.macros?.grasas_g ?? 0),
    }),
    { kcal: 0, proteinas_g: 0, carbs_g: 0, grasas_g: 0 },
  );
  const macros: FoodMacros = {
    kcal: round2(sum.kcal),
    proteinas_g: round2(sum.proteinas_g),
    carbs_g: round2(sum.carbs_g),
    grasas_g: round2(sum.grasas_g),
  };
  const gramos = kept.every((i) => i.gramos !== null) ? round2(kept.reduce((acc, i) => acc + (i.gramos ?? 0), 0)) : null;
  return { macros, gramos };
}

/** Un resultado se puede guardar solo si cada ítem trae lo que pide el endpoint de guardado. */
export function isSaveable(result: FoodChatResult): boolean {
  return (
    result.alimentos.length > 0 &&
    result.alimentos.every((a) => a.gramos !== undefined && a.macros !== undefined && a.macroSource !== undefined)
  );
}

const INGREDIENT_TYPE_SET = new Set<string>(INGREDIENT_TYPES);

/** Arma el payload de POST /api/chat/meal/confirm con lo que estimó la IA y lo que quedó al final. */
export function buildConfirmRequest(
  result: FoodChatResult,
  edits: ItemEdits,
  context: {
    requestId: string;
    fecha: string;
    tipoIngesta: IngestaTipo;
    /** NUT-228: mensajes del chat; viajan solo si algún ítem es estimado por la IA (entra a la cola). */
    conversacion?: ReadonlyArray<{ role: string; content: string }>;
  },
): ConfirmRequest {
  const items: ConfirmItem[] = resolveItems(result, edits).map(({ entry, removed, gramos }) => {
    const gramosIa = entry.gramos as number;
    const gramosFinal = removed ? null : (gramos as number);
    return {
      ingrediente: entry.alimento,
      tipo: (INGREDIENT_TYPE_SET.has(entry.tipo ?? '') ? entry.tipo : 'otro') as ConfirmItem['tipo'],
      unidad: entry.unidad ?? 'g',
      origin: removed ? 'removed' : gramosFinal !== gramosIa ? 'edited' : 'ai',
      macroSource: entry.macroSource ?? null,
      idAlimento: entry.idAlimento ?? null,
      confidence: entry.confidence ?? null,
      gramosIa,
      macrosIa: entry.macros ?? null,
      gramosFinal,
    };
  });
  const hayEstimado = items.some((i) => i.macroSource === 'estimado_ia' && i.origin !== 'removed');
  const conversacion = hayEstimado && context.conversacion ? sanitizeConversation(context.conversacion) : null;
  return {
    requestId: context.requestId,
    fecha: context.fecha,
    tipoIngesta: context.tipoIngesta,
    items,
    ...(conversacion ? { conversacion } : {}),
  };
}

/** El resultado confirmado, sin los ítems quitados y con las cantidades editadas. */
export function toConfirmedResult(result: FoodChatResult, edits: ItemEdits): FoodChatResult {
  const resolved = resolveItems(result, edits);
  const kept = resolved.filter((i) => !i.removed);
  const { macros, gramos } = summarize(resolved, result.totalMacros);
  return {
    ...result,
    alimentos: kept.map((i) => ({
      ...i.entry,
      cantidad: i.cantidad,
      ...(i.gramos !== null ? { gramos: i.gramos } : {}),
      ...(i.macros ? { macros: i.macros } : {}),
    })),
    ...(macros ? { totalMacros: macros } : {}),
    ...(gramos !== null ? { totalGramos: gramos } : {}),
  };
}

/** UUID v4 para requestId (idempotencia del guardado), con respaldo si no hay crypto.randomUUID. */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
