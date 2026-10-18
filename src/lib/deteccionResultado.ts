/**
 * NUT-169/170/171 (sesión 2/2) — Estado y lógica pura de la Pantalla 2
 * (Resultado editable). Sin llamadas a Gemini: las respuestas del usuario se
 * aplican del lado del cliente sobre `WorkingItem`, el estado de trabajo de
 * cada ítem detectado, hasta armar el `SaveRequest` final (contrato de
 * `src/lib/deteccion.ts`, definido en la sesión 1).
 */
import type {
  BoundingBox,
  ClarifyingQuestion,
  DetectionResponse,
  FinalItem,
  FinalItemOrigin,
  ItemAnswer,
  SaveRequest,
} from './deteccion';

/** Confianza mínima para el punto verde; por debajo (o con dudas) es ámbar. */
export const CONFIDENCE_ALTA_UMBRAL = 0.75;

/** Peso inicial editable para un ítem agregado a mano ("+ Agregar alimento que falta"). */
export const PESO_INICIAL_MANUAL_G = 100;

/** Paso del stepper de peso (mockup: "− [80 g] +"). */
export const PASO_PESO_G = 5;

export interface WorkingItem {
  /** Identificador estable de UI (key de lista). */
  uiId: string;
  /** `DetectedItem.id` de origen, o `null` para un ítem agregado a mano. */
  sourceItemId: string | null;
  name: string;
  category: string;
  /** `null` para ítems agregados a mano: no hay confianza de IA que mostrar. */
  confidence: number | null;
  grams: number;
  /** Estimación original de la IA; `null` para agregados a mano. Sirve para "IA: X g". */
  aiGrams: number | null;
  boundingBox: BoundingBox | null;
  origin: FinalItemOrigin;
  /** Preguntas del ítem aún sin resolver, en el orden en que se muestran. */
  pendingQuestions: ClarifyingQuestion[];
  /** Todas las preguntas originales (incluso ya resueltas) — para los chips de "Cambiar alimento". */
  originalQuestions: ClarifyingQuestion[];
  /** Respuestas ya aplicadas, incluidas las omitidas ("No sé"). */
  answers: ItemAnswer[];
  /** NUT-119: `id_alimento` (string) elegido en el buscador; null si el nombre es el de la IA. Evita el matching en el servidor. */
  foodRef: string | null;
}

export function crearWorkingItems(deteccion: DetectionResponse): WorkingItem[] {
  return deteccion.items.map((item) => ({
    uiId: item.id,
    sourceItemId: item.id,
    name: item.ingredient,
    category: item.type,
    confidence: item.confidence,
    grams: item.estimatedWeightGrams,
    aiGrams: item.estimatedWeightGrams,
    boundingBox: item.boundingBox,
    origin: 'ai',
    pendingQuestions: [...item.questions],
    originalQuestions: [...item.questions],
    answers: [],
    foodRef: null,
  }));
}

export function crearItemManual(nombre: string, categoria: string, idAlimento?: number | null): WorkingItem {
  return {
    uiId: crypto.randomUUID(),
    sourceItemId: null,
    name: nombre,
    category: categoria,
    confidence: null,
    grams: PESO_INICIAL_MANUAL_G,
    aiGrams: null,
    boundingBox: null,
    origin: 'added_manually',
    pendingQuestions: [],
    originalQuestions: [],
    answers: [],
    foodRef: idAlimento != null ? String(idAlimento) : null,
  };
}

export function contarDudas(items: WorkingItem[]): number {
  return items.filter((i) => i.pendingQuestions.length > 0).length;
}

export function tieneDudasPendientes(items: WorkingItem[]): boolean {
  return contarDudas(items) > 0;
}

/** El ítem cuya pregunta está activa: el primero (en orden de lista) con dudas pendientes. */
export function itemActivo(items: WorkingItem[]): WorkingItem | null {
  return items.find((i) => i.pendingQuestions.length > 0) ?? null;
}

export function esConfianzaAlta(confidence: number | null): boolean {
  return confidence != null && confidence >= CONFIDENCE_ALTA_UMBRAL;
}

/**
 * Aplica una respuesta a la pregunta activa (la primera pendiente) del ítem.
 * `respuesta === null` es "No sé": cuenta como resuelta pero no cambia nombre
 * ni origin. `identity` reemplaza el nombre; `attribute` lo complementa entre
 * paréntesis. El peso nunca cambia acá.
 */
export function aplicarRespuesta(item: WorkingItem, respuesta: string | null, custom = false): WorkingItem {
  const [pregunta, ...resto] = item.pendingQuestions;
  if (!pregunta) return item;

  const nombre =
    respuesta == null ? item.name : pregunta.kind === 'identity' ? respuesta : `${item.name} (${respuesta})`;

  const answer: ItemAnswer = {
    question: pregunta.question,
    answer: respuesta,
    ...(custom ? { custom: true } : {}),
  };

  return {
    ...item,
    name: nombre,
    pendingQuestions: resto,
    answers: [...item.answers, answer],
    origin: respuesta == null ? item.origin : 'answered',
    // Una respuesta "identity" cambia QUÉ es el alimento: el id del buscador ya no vale.
    foodRef: pregunta.kind === 'identity' && respuesta != null ? null : item.foodRef,
  };
}

export function reemplazarAlimento(
  item: WorkingItem,
  nuevo: { nombre: string; categoria: string; idAlimento?: number | null },
): WorkingItem {
  return {
    ...item,
    name: nuevo.nombre,
    category: nuevo.categoria,
    origin: 'replaced',
    foodRef: nuevo.idAlimento != null ? String(nuevo.idAlimento) : null,
  };
}

export function ajustarPeso(item: WorkingItem, gramos: number): WorkingItem {
  return { ...item, grams: Math.max(PASO_PESO_G, Math.round(gramos)) };
}

export function deshacerPeso(item: WorkingItem): WorkingItem {
  return item.aiGrams != null ? { ...item, grams: item.aiGrams } : item;
}

/** Las `options` de la primera pregunta `identity` original del ítem, si hubo. */
export function opcionesDudaOriginal(item: WorkingItem): string[] {
  return item.originalQuestions.find((q) => q.kind === 'identity')?.options ?? [];
}

function aFinalItem(item: WorkingItem): FinalItem {
  return {
    sourceItemId: item.sourceItemId,
    name: item.name,
    category: item.category,
    grams: item.grams,
    aiGrams: item.aiGrams,
    origin: item.origin,
    answers: item.answers,
    foodRef: item.foodRef,
  };
}

export function armarSaveRequest(
  predictionId: string,
  mealType: string,
  items: WorkingItem[],
  removedItemIds: string[],
  fecha?: string,
): SaveRequest {
  return {
    predictionId,
    mealType,
    items: items.map(aFinalItem),
    removedItemIds,
    ...(fecha ? { fecha } : {}),
  };
}
