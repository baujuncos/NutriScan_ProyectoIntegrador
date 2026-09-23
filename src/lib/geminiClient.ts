/**
 * NUT-154 + NUT-156 — Wrapper de la llamada a la API de Gemini para
 * identificación de alimentos + estimación de peso (épica NUT-12).
 *
 * Una sola llamada a `generateContent` por invocación de `reconocerAlimentos`,
 * salvo la única excepción documentada: si la respuesta no es un JSON válido
 * se reintenta una vez con una instrucción más estricta antes de fallar.
 */
import {
  GoogleGenerativeAI,
  GoogleGenerativeAIAbortError,
  GoogleGenerativeAIFetchError,
  type Content,
} from '@google/generative-ai';
import { z } from 'zod';
import {
  construirMensajeRespuestaUsuario,
  construirSystemPrompt,
  FOOD_DETECTION_RESPONSE_SCHEMA,
  type ContextoCaptura,
  type FoodDetectionResult,
  type PreguntasPorIngrediente,
} from './geminiFoodPrompt';

export class GeminiConfigError extends Error {}
export class GeminiTimeoutError extends Error {}
export class GeminiRateLimitError extends Error {}
export class GeminiInvalidResponseError extends Error {}
export class GeminiError extends Error {}

const DEFAULT_MODEL = 'gemini-3.6-flash';
const TIMEOUT_MS = 20_000;

const INSTRUCCION_RETRY_JSON =
  '\n\nIMPORTANTE: tu respuesta anterior no cumplió el formato JSON requerido. Respondé EXCLUSIVAMENTE con un JSON válido que cumpla el schema, sin texto adicional, sin markdown y sin truncar la respuesta.';

const NOTA_ANGULO_APROXIMADO =
  '\n\nNota: no se pudo leer el ángulo real de captura del dispositivo; el ángulo indicado arriba es un valor asumido por defecto, no una medición. Tené esto en cuenta al asignar confianza a la estimación de peso.';

const detectedIngredientSchema = z.object({
  ingredient: z.string(),
  type: z.string(),
  confidence: z.number(),
  estimatedWeightGrams: z.number(),
  questionForUser: z.string().nullable(),
});

const foodDetectionResultSchema = z.object({
  detectedIngredients: z.array(detectedIngredientSchema),
  totalEstimatedWeightGrams: z.number(),
});

export interface ReconocerAlimentosParams {
  contexto: ContextoCaptura;
  preguntasHechas: PreguntasPorIngrediente;
  imagen: { base64: string; mimeType: string };
  /** `true` cuando no había lectura de giroscopio y se usó un ángulo por defecto. */
  anguloAproximado: boolean;
  refinamiento?: {
    previousDetection: FoodDetectionResult;
    respuestaUsuario: { ingredient: string; respuesta: string };
  };
}

function parseFoodDetectionResult(text: string): FoodDetectionResult | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = foodDetectionResultSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function buildContents(params: ReconocerAlimentosParams): Content[] {
  const imagePart = {
    inlineData: { data: params.imagen.base64, mimeType: params.imagen.mimeType },
  };
  const instruccionInicial = {
    text: 'Identificá los alimentos de esta foto según las instrucciones.',
  };

  if (!params.refinamiento) {
    return [{ role: 'user', parts: [imagePart, instruccionInicial] }];
  }

  return [
    { role: 'user', parts: [imagePart, instruccionInicial] },
    { role: 'model', parts: [{ text: JSON.stringify(params.refinamiento.previousDetection) }] },
    {
      role: 'user',
      parts: [
        {
          text: construirMensajeRespuestaUsuario(
            params.refinamiento.respuestaUsuario.ingredient,
            params.refinamiento.respuestaUsuario.respuesta,
          ),
        },
      ],
    },
  ];
}

/** Identifica y estima el peso de todos los alimentos de una foto en una sola llamada a Gemini. */
export async function reconocerAlimentos(
  params: ReconocerAlimentosParams,
): Promise<FoodDetectionResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiConfigError('GEMINI_API_KEY no está configurada.');
  }
  const modelName = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;

  const contexto: ContextoCaptura = params.contexto;
  let systemInstruction = construirSystemPrompt(contexto, params.preguntasHechas);
  if (params.anguloAproximado) {
    systemInstruction += NOTA_ANGULO_APROXIMADO;
  }

  const contents = buildContents(params);
  const genAI = new GoogleGenerativeAI(apiKey);

  async function callGemini(instruction: string): Promise<string> {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: instruction,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: FOOD_DETECTION_RESPONSE_SCHEMA,
      },
    });
    try {
      const result = await model.generateContent({ contents }, { timeout: TIMEOUT_MS });
      return result.response.text();
    } catch (err) {
      if (err instanceof GoogleGenerativeAIAbortError) {
        throw new GeminiTimeoutError('El reconocimiento tardó demasiado. Probá de nuevo.');
      }
      if (err instanceof GoogleGenerativeAIFetchError && err.status === 429) {
        throw new GeminiRateLimitError(
          'Estamos con mucha demanda ahora mismo. Esperá un momento y volvé a intentar.',
        );
      }
      throw new GeminiError(err instanceof Error ? err.message : 'Error llamando a Gemini.');
    }
  }

  const firstText = await callGemini(systemInstruction);
  const firstParsed = parseFoodDetectionResult(firstText);
  if (firstParsed) return firstParsed;

  const retryText = await callGemini(systemInstruction + INSTRUCCION_RETRY_JSON);
  const retryParsed = parseFoodDetectionResult(retryText);
  if (retryParsed) return retryParsed;

  throw new GeminiInvalidResponseError('Gemini no devolvió un JSON válido tras reintentar.');
}
