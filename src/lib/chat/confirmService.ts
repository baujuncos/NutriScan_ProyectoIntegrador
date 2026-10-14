// NUT-191 — Arma el payload que se guarda (diario + hidratación + auditoría) a partir de lo que
// mandó el chat al confirmar. Los macros FINALES se recalculan acá, en el backend:
//   - ítems de SARA2: con los valores del catálogo y la misma fórmula que el trigger de items;
//   - ítems estimados por la IA: escalando proporcionalmente la estimación del modelo (acotada).
// Los números que manda el cliente nunca se usan tal cual, salvo la estimación de la IA como base.

import { toFixed2 } from '@/lib/nutrition';
import { MAX_DIARY_ITEM_AMOUNT, type ConfirmItem, type ConfirmRequest } from './confirmSchemas';
import type { Macros } from './mealSchemas';
import { sanitizeEstimate } from './mealService';
import { macrosForQuantity, type Per100 } from './sara2Catalog';
import { isWaterIngredient } from './water';

export type Destino = 'diario' | 'hidratacion' | 'ninguno';

export interface AmountAndMacros extends Macros {
  gramos: number;
}

export interface RpcItem {
  ingrediente: string;
  tipo: string;
  unidad: 'g' | 'ml';
  origin: ConfirmItem['origin'];
  destino: Destino;
  macroSource: 'sara2' | 'estimado_ia' | null;
  idAlimento: number | null;
  confidence: number | null;
  ia: AmountAndMacros | null;
  final: AmountAndMacros | null;
}

export interface RpcPayload {
  requestId: string;
  fecha: string;
  tipoIngesta: string;
  modelo: string;
  promptVersion: string;
  totales: AmountAndMacros;
  items: RpcItem[];
}

/** Error de validación de negocio: se responde 400 con este mensaje (apto para el usuario). */
export class ConfirmValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfirmValidationError';
  }
}

export interface ConfirmContext {
  modelo: string;
  promptVersion: string;
  /** Rango de fechas editables del diario (hoy y 7 días atrás), formato AAAA-MM-DD. */
  minDate: string;
  maxDate: string;
}

const ZERO_MACROS: Macros = { kcal: 0, proteinas_g: 0, carbs_g: 0, grasas_g: 0 };

/** Ids de SARA2 que hay que buscar en el catálogo para recalcular los macros. */
export function catalogIdsOf(request: ConfirmRequest): number[] {
  return [...new Set(request.items.flatMap((i) => (i.idAlimento !== null ? [i.idAlimento] : [])))];
}

function scale(estimate: Macros, from: number, to: number): Macros {
  const ratio = to / from;
  return {
    kcal: estimate.kcal * ratio,
    proteinas_g: estimate.proteinas_g * ratio,
    carbs_g: estimate.carbs_g * ratio,
    grasas_g: estimate.grasas_g * ratio,
  };
}

function computeMacros(item: ConfirmItem, per100ById: Map<number, Per100>): { ia: Macros | null; final: Macros | null } {
  if (item.origin === 'added_manually') {
    // Sin catálogo ni IA: igual que la carga manual del diario, sin macros.
    return { ia: null, final: { ...ZERO_MACROS } };
  }

  const gramosIa = item.gramosIa as number; // garantizado por el schema
  const gramosFinal = item.gramosFinal;

  if (item.macroSource === 'sara2') {
    const per100 = per100ById.get(item.idAlimento as number);
    if (!per100) throw new ConfirmValidationError('Uno de los alimentos ya no existe en el catálogo. Volvé a armar el registro.');
    return {
      ia: macrosForQuantity(per100, gramosIa),
      final: gramosFinal === null ? null : macrosForQuantity(per100, gramosFinal),
    };
  }

  const ia = sanitizeEstimate(item.macrosIa as Macros, gramosIa);
  return {
    ia,
    final: gramosFinal === null ? null : sanitizeEstimate(scale(ia, gramosIa, gramosFinal), gramosFinal),
  };
}

export function buildConfirmPayload(
  request: ConfirmRequest,
  per100ById: Map<number, Per100>,
  context: ConfirmContext,
): RpcPayload {
  if (request.fecha < context.minDate || request.fecha > context.maxDate) {
    throw new ConfirmValidationError('Solo podés cargar comidas de hoy hasta 7 días atrás.');
  }

  const items: RpcItem[] = request.items.map((item) => {
    const { ia, final } = computeMacros(item, per100ById);
    const destino: Destino =
      item.origin === 'removed' ? 'ninguno' : isWaterIngredient(item.ingrediente) ? 'hidratacion' : 'diario';

    if (destino === 'diario' && (item.gramosFinal as number) > MAX_DIARY_ITEM_AMOUNT) {
      throw new ConfirmValidationError(
        `"${item.ingrediente}" supera el máximo de ${MAX_DIARY_ITEM_AMOUNT} por alimento. Editá la cantidad.`,
      );
    }

    return {
      ingrediente: item.ingrediente,
      tipo: item.tipo,
      unidad: item.unidad,
      origin: item.origin,
      destino,
      macroSource: item.macroSource,
      idAlimento: item.idAlimento,
      confidence: item.confidence,
      ia: ia && item.gramosIa !== null ? { gramos: toFixed2(item.gramosIa), ...ia } : null,
      final: final && item.gramosFinal !== null ? { gramos: toFixed2(item.gramosFinal), ...final } : null,
    };
  });

  const confirmed = items.flatMap((i) => (i.final ? [i.final] : []));
  if (confirmed.length === 0) throw new ConfirmValidationError('No hay ningún alimento para guardar.');

  const sum = (pick: (m: AmountAndMacros) => number) => toFixed2(confirmed.reduce((acc, m) => acc + pick(m), 0));

  return {
    requestId: request.requestId,
    fecha: request.fecha,
    tipoIngesta: request.tipoIngesta,
    modelo: context.modelo,
    promptVersion: context.promptVersion,
    totales: {
      gramos: sum((m) => m.gramos),
      kcal: sum((m) => m.kcal),
      proteinas_g: sum((m) => m.proteinas_g),
      carbs_g: sum((m) => m.carbs_g),
      grasas_g: sum((m) => m.grasas_g),
    },
    items,
  };
}
