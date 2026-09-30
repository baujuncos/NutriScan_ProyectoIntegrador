/**
 * NUT-169/170/171 (sesión 2/2) — Fixtures ya en la forma del contrato
 * `DetectionResponse` (post-procesada), para testear la Pantalla 2 y la hoja
 * "Cambiar alimento" sin depender de Gemini ni del postprocesamiento de la
 * sesión 1 (esos fixtures crudos viven en `./deteccion.ts`).
 */
import type { DetectionResponse } from '@/lib/deteccion';

/** Caso del mockup: Waffle + Frutillas sin duda, Topping blanco con 2 preguntas. */
export const DETECTION_MOCKUP: DetectionResponse = {
  predictionId: '1',
  totalEstimatedWeightGrams: 200,
  items: [
    {
      id: 'item-waffle',
      ingredient: 'Waffle',
      type: 'cereal',
      confidence: 0.85,
      estimatedWeightGrams: 75,
      questions: [],
      boundingBox: { x: 0.08, y: 0.12, width: 0.42, height: 0.3 },
    },
    {
      id: 'item-frutillas',
      ingredient: 'Frutillas cortadas',
      type: 'fruta',
      confidence: 0.9,
      estimatedWeightGrams: 90,
      questions: [],
      boundingBox: { x: 0.1, y: 0.43, width: 0.38, height: 0.17 },
    },
    {
      id: 'item-topping',
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
      boundingBox: { x: 0.48, y: 0.1, width: 0.22, height: 0.16 },
    },
  ],
};

/** Un plato sin ninguna ambigüedad — arranca directo en estado "listo". */
export const DETECTION_SIN_AMBIGUEDAD: DetectionResponse = {
  predictionId: '2',
  totalEstimatedWeightGrams: 330,
  items: [
    {
      id: 'item-arroz',
      ingredient: 'Arroz blanco',
      type: 'cereal',
      confidence: 0.88,
      estimatedWeightGrams: 150,
      questions: [],
      boundingBox: null,
    },
    {
      id: 'item-pollo',
      ingredient: 'Pollo grillado',
      type: 'proteína animal',
      confidence: 0.91,
      estimatedWeightGrams: 180,
      questions: [],
      boundingBox: null,
    },
  ],
};

/** Dos ítems ambiguos a la vez, cada uno con su propia pregunta. */
export const DETECTION_DOBLE_AMBIGUEDAD: DetectionResponse = {
  predictionId: '3',
  totalEstimatedWeightGrams: 240,
  items: [
    {
      id: 'item-empanada',
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
      boundingBox: null,
    },
    {
      id: 'item-milanesa',
      ingredient: 'Milanesa',
      type: 'proteína animal',
      confidence: 0.7,
      estimatedWeightGrams: 150,
      questions: [{ question: '¿Está frita o al horno?', kind: 'attribute', options: ['Frita', 'Al horno'] }],
      boundingBox: null,
    },
  ],
};
