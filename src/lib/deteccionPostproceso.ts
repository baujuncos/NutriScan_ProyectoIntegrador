/**
 * NUT-167/NUT-168 — Postprocesamiento de la respuesta cruda de Gemini a la
 * forma final del contrato (`DetectedItem`/`DetectionResponse`, ver
 * `deteccion.ts`). Módulo puro (sin red, sin Supabase) para poder testear
 * exhaustivamente el truncado y la conversión de bounding box sin mockear el
 * SDK de Gemini.
 */
import {
  MAX_OPTIONS_PER_QUESTION,
  MAX_QUESTIONS_PER_ITEM,
  MIN_OPTIONS_PER_QUESTION,
  esBoundingBoxValida,
  type BoundingBox,
  type ClarifyingQuestion,
  type DetectedItem,
  type QuestionKind,
} from './deteccion';
import type {
  GeminiBoundingBox,
  GeminiClarifyingQuestion,
  GeminiFoodDetectionResult,
} from './geminiFoodPrompt';

export interface PostprocesarResultado {
  items: DetectedItem[];
  totalEstimatedWeightGrams: number;
}

/** Convierte la respuesta cruda de Gemini a la forma final del contrato:
 * asigna `id` estable, trunca preguntas/opciones defensivamente (NUT-168) y
 * convierte el bounding box de la escala nativa de Gemini (0–1000) a
 * fracciones 0–1. Nunca confía únicamente en que el modelo respetó los
 * límites pedidos en el prompt. */
export function postprocesarDeteccion(raw: GeminiFoodDetectionResult): PostprocesarResultado {
  return {
    items: raw.detectedIngredients.map((ing) => ({
      id: crypto.randomUUID(),
      ingredient: ing.ingredient,
      type: ing.type,
      confidence: ing.confidence,
      estimatedWeightGrams: ing.estimatedWeightGrams,
      questions: truncarPreguntas(ing.questions),
      boundingBox: normalizarBoundingBox(ing.boundingBox),
    })),
    totalEstimatedWeightGrams: raw.totalEstimatedWeightGrams,
  };
}

function truncarPreguntas(preguntas: GeminiClarifyingQuestion[]): ClarifyingQuestion[] {
  return preguntas
    .filter((p) => p.options.length >= MIN_OPTIONS_PER_QUESTION)
    .slice(0, MAX_QUESTIONS_PER_ITEM)
    .map((p) => ({
      question: p.question,
      kind: normalizarKind(p.kind),
      options: p.options.slice(0, MAX_OPTIONS_PER_QUESTION),
    }));
}

function normalizarKind(kind: string): QuestionKind {
  return kind === 'identity' ? 'identity' : 'attribute';
}

function normalizarBoundingBox(bbox: GeminiBoundingBox | null): BoundingBox | null {
  if (!bbox) return null;
  const { ymin, xmin, ymax, xmax } = bbox;
  if ([ymin, xmin, ymax, xmax].some((v) => !Number.isFinite(v) || v < 0 || v > 1000)) return null;
  if (ymax <= ymin || xmax <= xmin) return null;

  const convertida: BoundingBox = {
    x: xmin / 1000,
    y: ymin / 1000,
    width: (xmax - xmin) / 1000,
    height: (ymax - ymin) / 1000,
  };
  return esBoundingBoxValida(convertida) ? convertida : null;
}
