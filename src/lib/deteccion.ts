/**
 * NUT-166/NUT-172 — Contrato compartido entre el backend de detección (una
 * llamada a Gemini por foto, sin refinamiento) y el guardado de correcciones
 * del usuario. Épica NUT-119 — Post detección por imagen.
 *
 * Este archivo es el CONTRATO FINAL entre esta sesión (backend) y la
 * siguiente (UI de preguntas/opciones + guardado). No renombrar campos sin
 * coordinar con esa sesión.
 */

export type QuestionKind = 'identity' | 'attribute';
// identity: la opción elegida ES el alimento (reemplaza el nombre). Ej. "¿Qué es el topping blanco?" → "Yogur griego".
// attribute: modifica un atributo del alimento (cocción, relleno) y se agrega al nombre entre paréntesis. Ej. "¿Frita o al horno?" → "Empanada (al horno)".

export interface ClarifyingQuestion {
  question: string;
  kind: QuestionKind;
  options: string[]; // 2 a 4 opciones cortas y excluyentes; SIN "Otro" ni "No sé" (los agrega la UI)
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
} // fracciones 0–1 sobre la imagen enviada a Gemini

export interface DetectedItem {
  id: string; // estable durante la sesión, asignado por el backend
  ingredient: string;
  type: string; // categoría
  confidence: number; // 0–1
  estimatedWeightGrams: number;
  questions: ClarifyingQuestion[]; // 0 a 3; vacío = sin duda
  boundingBox: BoundingBox | null;
}

export interface DetectionResponse {
  predictionId: string; // id de la predicción original ya persistida
  items: DetectedItem[];
  totalEstimatedWeightGrams: number;
}

export interface ItemAnswer {
  question: string;
  answer: string | null; // null = "No sé"/omitida
  custom?: boolean; // texto libre ("Otro…")
}

export type FinalItemOrigin = 'ai' | 'answered' | 'replaced' | 'added_manually';

export interface FinalItem {
  sourceItemId: string | null; // null = agregado a mano
  name: string; // nombre final que ve el usuario
  category: string;
  grams: number;
  aiGrams: number | null; // null si fue agregado a mano
  origin: FinalItemOrigin;
  answers: ItemAnswer[];
  foodRef?: string | null; // referencia al alimento elegido en el buscador, si aplica
}

export interface SaveRequest {
  predictionId: string;
  mealType: string; // ej. "Desayuno", viene del contexto de la página
  items: FinalItem[];
  removedItemIds: string[]; // ítems de la IA que el usuario quitó (falsos positivos)
}

/**
 * Versión del prompt que generó una predicción — para poder auditar/comparar
 * resultados de distintas iteraciones sin ambigüedad. Se persiste tal cual en
 * `detecciones_ia.prompt_version` (NUT-172). Bumpear manualmente cuando
 * cambie la SEMÁNTICA del prompt (qué se pregunta, cómo se pondera), no por
 * ajustes de redacción.
 */
export const PROMPT_VERSION = 'nut166-v1';

/** Límite duro de preguntas por alimento (NUT-168). El prompt ya lo pide,
 * pero el backend SIEMPRE trunca defensivamente — nunca confiar sólo en el modelo. */
export const MAX_QUESTIONS_PER_ITEM = 3;
export const MIN_OPTIONS_PER_QUESTION = 2;
export const MAX_OPTIONS_PER_QUESTION = 4;

/** Valida que una bounding box tenga coordenadas geométricamente coherentes
 * (0–1, con max &gt; min en ambos ejes). Usado defensivamente en el
 * postprocesamiento para descartar cajas inválidas en vez de pasarlas al cliente. */
export function esBoundingBoxValida(bbox: BoundingBox): boolean {
  const { x, y, width, height } = bbox;
  return (
    [x, y, width, height].every((v) => Number.isFinite(v)) &&
    x >= 0 &&
    x <= 1 &&
    y >= 0 &&
    y <= 1 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1 + 1e-6 &&
    y + height <= 1 + 1e-6
  );
}

/**
 * NUT-119 — Versión del prompt de estimación de macros por 100 g (fallback de
 * Gemini cuando el alimento no está en la DB). Se persiste junto a cada
 * estimación. Bumpear cuando cambie la semántica del prompt.
 */
export const NUTRITION_PROMPT_VERSION = 'nut119-macros-v1';
