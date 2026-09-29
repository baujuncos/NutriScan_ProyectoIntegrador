/**
 * NUT-155/NUT-166 — Prompt de identificación + estimación de peso vía Gemini
 * (vajilla + ángulo como escala), con preguntas aclaratorias de opción
 * múltiple y bounding box por alimento. Épica NUT-12/NUT-119.
 *
 * Una sola llamada a Gemini identifica todos los alimentos del plato y
 * estima su peso a la vez. Sin refinamiento: las preguntas aclaratorias se
 * responden del lado del cliente, no disparan una segunda llamada (NUT-166).
 *
 * Depende de:
 *  - NUT-157/158/159: tipo de vajilla + diámetro real (cm) confirmado por el usuario.
 *  - NUT-163: ángulo de captura leído por giroscopio (esperado ~35° oblicuo, no cenital).
 *  - NUT-165: la imagen ya llega recortada/reencuadrada antes de esta llamada.
 */
import { SchemaType, type Schema } from '@google/generative-ai';
import type { VajillaTipo } from './vajilla';
import { MAX_OPTIONS_PER_QUESTION, MAX_QUESTIONS_PER_ITEM, MIN_OPTIONS_PER_QUESTION } from './deteccion';

export interface ContextoCaptura {
  tipoVajilla: VajillaTipo;
  diametroCm: number;
  anguloCapturaGrados: number;
}

export function construirSystemPrompt(contexto: ContextoCaptura): string {
  return `
Sos el módulo de reconocimiento visual de alimentos de NutriScan, una app de seguimiento nutricional para deportistas universitarios (UCC). Tu tarea es identificar cada alimento visible en la foto de un plato y estimar su peso en gramos.

## Referencia de escala — NO uses otra
No inventes ni asumas una referencia de escala a partir de objetos de la imagen (manos, cubiertos, celular, etc.). La ÚNICA referencia de escala válida es la vajilla, con estos datos ya confirmados por el usuario antes de sacar la foto:
- Tipo de vajilla: ${contexto.tipoVajilla}
- Diámetro real: ${contexto.diametroCm} cm
- Ángulo de captura: ${contexto.anguloCapturaGrados}° respecto al plano de la mesa (foto tomada en ángulo oblicuo, NO cenital)

Usá el diámetro real del plato como ancla geométrica: estimá qué proporción del plato ocupa cada alimento y a partir de ahí calculá volumen y peso, corrigiendo la distorución/escorzo elíptico que introduce el ángulo de captura sobre el borde circular del plato.

## Identificación de alimentos
- Identificá cada alimento visible por separado, incluso si hay varios en el mismo plato.
- Asigná una categoría a cada uno (ej. "cereal", "vegetal", "proteína animal", "legumbre").
- Asigná un valor de confianza entre 0 y 1 a cada alimento identificado.
- Devolvé, por cada alimento, un recuadro (bounding box) ajustado que lo delimite en la imagen: \`ymin\`, \`xmin\`, \`ymax\`, \`xmax\`, en una escala de 0 a 1000 sobre el ancho/alto de la imagen (convención estándar de Gemini). Si no podés delimitarlo con confianza (ej. una preparación mixta sin bordes claros), dejá el bounding box en null en vez de inventar uno.

## Cuándo generar una pregunta aclaratoria
Si un alimento tiene variantes que cambian sustancialmente su valor nutricional y no podés distinguir la variante con certeza a partir de la imagen, generá una pregunta corta para ese alimento en vez de adivinar. Ejemplos:
- Relleno de un alimento compuesto (ej. empanada: carne, pollo, jamón y queso, verdura).
- Método de cocción cuando cambia notablemente el aporte calórico (ej. frito vs. al horno/hervido).
- Confusión entre dos alimentos visualmente similares pero nutricionalmente muy distintos (ej. yogur griego vs. crema chantilly).

No generes una pregunta si la respuesta no cambiaría la estimación de forma relevante — cada pregunta tiene un costo de atención para el usuario. Cuando haya más de una pregunta posible para un mismo alimento, ordenalas por impacto nutricional: la que más cambia el peso/composición estimada va primero.

Cada pregunta tiene un \`kind\`:
- \`"identity"\`: la opción elegida reemplaza el nombre del alimento (el alimento en sí está en duda). Ej. "¿Qué es el topping blanco?" con opciones ["Crema chantilly", "Yogur griego", "Queso blanco"].
- \`"attribute"\`: el alimento ya está identificado, la duda es sobre un atributo suyo (cocción, relleno, tipo de leche, etc.). Ej. "¿Frita o al horno?" con opciones ["Frita", "Al horno"].

Cada pregunta debe tener entre ${MIN_OPTIONS_PER_QUESTION} y ${MAX_OPTIONS_PER_QUESTION} opciones concretas, cortas y mutuamente excluyentes — NO incluyas una opción tipo "Otro" o "No sé", eso lo agrega la interfaz. Regla dura: nunca generes más de ${MAX_QUESTIONS_PER_ITEM} preguntas para un mismo alimento. Si un alimento no tiene ninguna ambigüedad relevante, devolvé su lista de preguntas vacía.

## Formato de salida
Respondé ÚNICAMENTE con un JSON que cumpla el schema provisto (ver responseSchema de la llamada). No incluyas texto, explicación ni markdown fuera del JSON.
`.trim();
}

/** Forma cruda tal como la devuelve Gemini — antes del postprocesamiento
 * (truncado defensivo, conversión de bounding box, asignación de id) que la
 * convierte a `DetectedItem`/`DetectionResponse` (ver `deteccionPostproceso.ts`). */
export interface GeminiBoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
} // escala nativa de Gemini, 0–1000

export interface GeminiClarifyingQuestion {
  question: string;
  kind: string; // sin validar contra el enum acá — se normaliza en postprocesamiento
  options: string[];
}

export interface GeminiDetectedIngredient {
  ingredient: string;
  type: string;
  confidence: number;
  estimatedWeightGrams: number;
  questions: GeminiClarifyingQuestion[];
  boundingBox: GeminiBoundingBox | null;
}

export interface GeminiFoodDetectionResult {
  detectedIngredients: GeminiDetectedIngredient[];
  totalEstimatedWeightGrams: number;
}

export const FOOD_DETECTION_RESPONSE_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    detectedIngredients: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          ingredient: { type: SchemaType.STRING },
          type: { type: SchemaType.STRING },
          confidence: { type: SchemaType.NUMBER },
          estimatedWeightGrams: { type: SchemaType.NUMBER },
          questions: {
            type: SchemaType.ARRAY,
            maxItems: MAX_QUESTIONS_PER_ITEM,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                question: { type: SchemaType.STRING },
                kind: {
                  type: SchemaType.STRING,
                  format: 'enum',
                  enum: ['identity', 'attribute'],
                },
                options: {
                  type: SchemaType.ARRAY,
                  minItems: MIN_OPTIONS_PER_QUESTION,
                  maxItems: MAX_OPTIONS_PER_QUESTION,
                  items: { type: SchemaType.STRING },
                },
              },
              required: ['question', 'kind', 'options'],
            },
          },
          boundingBox: {
            type: SchemaType.OBJECT,
            nullable: true,
            properties: {
              ymin: { type: SchemaType.NUMBER },
              xmin: { type: SchemaType.NUMBER },
              ymax: { type: SchemaType.NUMBER },
              xmax: { type: SchemaType.NUMBER },
            },
            required: ['ymin', 'xmin', 'ymax', 'xmax'],
          },
        },
        required: [
          'ingredient',
          'type',
          'confidence',
          'estimatedWeightGrams',
          'questions',
          'boundingBox',
        ],
      },
    },
    totalEstimatedWeightGrams: { type: SchemaType.NUMBER },
  },
  required: ['detectedIngredients', 'totalEstimatedWeightGrams'],
};
