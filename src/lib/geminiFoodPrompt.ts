/**
 * NUT-155 — Prompt de identificación + estimación de peso vía Gemini (vajilla +
 * ángulo como escala). Épica NUT-12 — Reconocimiento visual por IA.
 *
 * Una sola llamada a Gemini identifica todos los alimentos del plato y estima
 * su peso a la vez (NUT-154 + NUT-156 combinados — ver `geminiClient.ts`).
 *
 * Depende de:
 *  - NUT-157/158/159: tipo de vajilla + diámetro real (cm) confirmado por el usuario.
 *  - NUT-163: ángulo de captura leído por giroscopio (esperado ~35° oblicuo, no cenital).
 *  - NUT-165: la imagen ya llega recortada/reencuadrada antes de esta llamada.
 */
import { SchemaType, type Schema } from '@google/generative-ai';
import type { VajillaTipo } from './vajilla';

export interface ContextoCaptura {
  tipoVajilla: VajillaTipo;
  diametroCm: number;
  anguloCapturaGrados: number;
}

/** Cuántas preguntas aclaratorias ya se le hicieron al usuario, POR ALIMENTO,
 * a lo largo de esta conversación (no por registro/plato completo). */
export interface PreguntasPorIngrediente {
  [ingredienteNormalizado: string]: number;
}

export const MAX_PREGUNTAS_POR_ALIMENTO = 3;

/** Normaliza un nombre de ingrediente para usarlo como clave de `PreguntasPorIngrediente`. */
export function normalizarIngrediente(nombre: string): string {
  return nombre.trim().toLowerCase();
}

export function construirSystemPrompt(
  contexto: ContextoCaptura,
  preguntasHechas: PreguntasPorIngrediente = {},
): string {
  const ingredientesAgotados = Object.entries(preguntasHechas)
    .filter(([, count]) => count >= MAX_PREGUNTAS_POR_ALIMENTO)
    .map(([ingrediente]) => ingrediente);

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

## Cuándo generar una pregunta aclaratoria
Si un alimento tiene variantes que cambian sustancialmente su valor nutricional y no podés distinguir la variante con certeza a partir de la imagen, generá una pregunta corta para ese alimento en vez de adivinar. Ejemplos:
- Relleno de un alimento compuesto (ej. empanada: carne, pollo, jamón y queso, verdura).
- Método de cocción cuando cambia notablemente el aporte calórico (ej. frito vs. al horno/hervido).
- Confusión entre dos alimentos visualmente similares pero nutricionalmente muy distintos (ej. yogur griego vs. crema chantilly).

${
  ingredientesAgotados.length > 0
    ? `Los siguientes alimentos ya alcanzaron el máximo de preguntas permitidas en esta conversación: ${ingredientesAgotados.join(
        ', ',
      )}. Para ESTOS alimentos NO generes una nueva pregunta bajo ninguna circunstancia — resolvé con la opción más probable y dejá "questionForUser" en null.`
    : ''
}

Regla dura: nunca generes más de ${MAX_PREGUNTAS_POR_ALIMENTO} preguntas aclaratorias en total para un mismo alimento a lo largo de la conversación (el límite es por alimento individual, no por plato/registro completo). Pasado ese límite para un alimento dado, resolvé con tu mejor estimación sin preguntar más.

## Formato de salida
Respondé ÚNICAMENTE con un JSON que cumpla el schema provisto (ver responseSchema de la llamada). No incluyas texto, explicación ni markdown fuera del JSON.
`.trim();
}

export function construirMensajeRespuestaUsuario(
  ingrediente: string,
  respuestaUsuario: string,
): string {
  return `El usuario respondió a la pregunta aclaratoria sobre "${ingrediente}": "${respuestaUsuario}". Usá esta respuesta para refinar la identificación y la estimación de peso de ese alimento específico. Si con esta respuesta ya no queda ambigüedad, dejá "questionForUser" en null para ese alimento en tu próxima respuesta.`;
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
          questionForUser: {
            type: SchemaType.STRING,
            nullable: true,
          },
        },
        required: [
          'ingredient',
          'type',
          'confidence',
          'estimatedWeightGrams',
          'questionForUser',
        ],
      },
    },
    totalEstimatedWeightGrams: { type: SchemaType.NUMBER },
  },
  required: ['detectedIngredients', 'totalEstimatedWeightGrams'],
};

export interface DetectedIngredient {
  ingredient: string;
  type: string;
  confidence: number;
  estimatedWeightGrams: number;
  questionForUser: string | null;
}

export interface FoodDetectionResult {
  detectedIngredients: DetectedIngredient[];
  totalEstimatedWeightGrams: number;
}
