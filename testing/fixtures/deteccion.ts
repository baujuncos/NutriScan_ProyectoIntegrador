/**
 * NUT-166/NUT-168 — Fixtures de respuestas crudas de Gemini (forma
 * `GeminiFoodDetectionResult`, antes del postprocesamiento) para mockear
 * `generateContent` en tests, sin llamar nunca a la API real.
 */
import type { GeminiFoodDetectionResult } from '@/lib/geminiFoodPrompt';

/** Caso del mockup: dos alimentos sin duda + uno con 2 preguntas (identity + attribute). */
export const FIXTURE_MOCKUP: GeminiFoodDetectionResult = {
  detectedIngredients: [
    {
      ingredient: 'Waffle',
      type: 'cereal',
      confidence: 0.85,
      estimatedWeightGrams: 75,
      questions: [],
      boundingBox: { ymin: 120, xmin: 80, ymax: 420, xmax: 500 },
    },
    {
      ingredient: 'Frutillas cortadas',
      type: 'fruta',
      confidence: 0.9,
      estimatedWeightGrams: 90,
      questions: [],
      boundingBox: { ymin: 430, xmin: 100, ymax: 600, xmax: 480 },
    },
    {
      ingredient: 'Topping blanco',
      type: 'lácteo',
      confidence: 0.6,
      estimatedWeightGrams: 35,
      questions: [
        {
          question: '¿Qué es el topping blanco?',
          kind: 'identity',
          options: ['Crema chantilly', 'Yogur griego', 'Queso blanco'],
        },
        { question: '¿Es entero o light?', kind: 'attribute', options: ['Entero', 'Light'] },
      ],
      boundingBox: { ymin: 100, xmin: 480, ymax: 260, xmax: 700 },
    },
  ],
  totalEstimatedWeightGrams: 200,
};

/** Un plato sin ninguna ambigüedad. */
export const FIXTURE_SIN_AMBIGUEDAD: GeminiFoodDetectionResult = {
  detectedIngredients: [
    {
      ingredient: 'Arroz blanco',
      type: 'cereal',
      confidence: 0.88,
      estimatedWeightGrams: 150,
      questions: [],
      boundingBox: { ymin: 200, xmin: 100, ymax: 500, xmax: 450 },
    },
    {
      ingredient: 'Pollo grillado',
      type: 'proteína animal',
      confidence: 0.91,
      estimatedWeightGrams: 180,
      questions: [],
      boundingBox: { ymin: 210, xmin: 460, ymax: 520, xmax: 820 },
    },
  ],
  totalEstimatedWeightGrams: 330,
};

/** Dos alimentos ambiguos a la vez, cada uno con su propia pregunta. */
export const FIXTURE_DOBLE_AMBIGUEDAD: GeminiFoodDetectionResult = {
  detectedIngredients: [
    {
      ingredient: 'Empanada',
      type: 'alimento compuesto',
      confidence: 0.55,
      estimatedWeightGrams: 90,
      questions: [
        {
          question: '¿De qué relleno es la empanada?',
          kind: 'identity',
          options: ['Carne', 'Pollo', 'Jamón y queso', 'Verdura'],
        },
      ],
      boundingBox: { ymin: 50, xmin: 50, ymax: 300, xmax: 300 },
    },
    {
      ingredient: 'Milanesa',
      type: 'proteína animal',
      confidence: 0.7,
      estimatedWeightGrams: 150,
      questions: [{ question: '¿Está frita o al horno?', kind: 'attribute', options: ['Frita', 'Al horno'] }],
      boundingBox: { ymin: 310, xmin: 50, ymax: 600, xmax: 400 },
    },
  ],
  totalEstimatedWeightGrams: 240,
};

/** Un ítem sin bounding box (Gemini no pudo delimitarlo con confianza). */
export const FIXTURE_SIN_BBOX: GeminiFoodDetectionResult = {
  detectedIngredients: [
    {
      ingredient: 'Guiso mixto',
      type: 'preparación combinada',
      confidence: 0.4,
      estimatedWeightGrams: 220,
      questions: [],
      boundingBox: null,
    },
  ],
  totalEstimatedWeightGrams: 220,
};

/** Gemini devuelve 5 preguntas para un ítem — el backend debe truncar a 3 (NUT-168). */
export const FIXTURE_EXCESO_PREGUNTAS: GeminiFoodDetectionResult = {
  detectedIngredients: [
    {
      ingredient: 'Sándwich',
      type: 'alimento compuesto',
      confidence: 0.5,
      estimatedWeightGrams: 200,
      questions: [
        { question: 'q1', kind: 'identity', options: ['a', 'b'] },
        { question: 'q2', kind: 'attribute', options: ['a', 'b'] },
        { question: 'q3', kind: 'attribute', options: ['a', 'b'] },
        { question: 'q4', kind: 'attribute', options: ['a', 'b'] },
        { question: 'q5', kind: 'attribute', options: ['a', 'b'] },
      ],
      boundingBox: null,
    },
  ],
  totalEstimatedWeightGrams: 200,
};

/** Una de las preguntas trae una sola opción — inválida, se descarta. */
export const FIXTURE_PREGUNTA_UNA_OPCION: GeminiFoodDetectionResult = {
  detectedIngredients: [
    {
      ingredient: 'Tarta',
      type: 'alimento compuesto',
      confidence: 0.5,
      estimatedWeightGrams: 100,
      questions: [
        { question: 'pregunta inválida', kind: 'identity', options: ['única'] },
        { question: 'pregunta válida', kind: 'attribute', options: ['a', 'b'] },
      ],
      boundingBox: null,
    },
  ],
  totalEstimatedWeightGrams: 100,
};
