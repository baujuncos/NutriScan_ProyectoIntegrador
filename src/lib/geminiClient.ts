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
  type GenerationConfig,
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
export class GeminiUnavailableError extends Error {}

const DEFAULT_MODEL = 'gemini-3.5-flash';
const DEFAULT_FALLBACK_MODEL = 'gemini-3.6-flash';
// Techo por intento individual, pero acotado además por el presupuesto total
// (ver `MAX_TOTAL_MS`): con fallback + reintento por JSON malformado puede
// haber hasta 4 llamadas en el peor caso, y no deben sumar más que eso.
const TIMEOUT_MS = 15_000;
const MAX_TOTAL_MS = 25_000;
// Backoff antes de probar el modelo de respaldo. Con un único reintento
// (2 intentos en total) el backoff "exponencial" es este único delay fijo.
const BACKOFF_MS = 1_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function esFallaTransitoria(err: unknown): boolean {
  return err instanceof GeminiUnavailableError || err instanceof GeminiTimeoutError;
}

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
  const fallbackModelName = process.env.GEMINI_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL;

  const contexto: ContextoCaptura = params.contexto;
  let systemInstruction = construirSystemPrompt(contexto, params.preguntasHechas);
  if (params.anguloAproximado) {
    systemInstruction += NOTA_ANGULO_APROXIMADO;
  }

  const contents = buildContents(params);
  const genAI = new GoogleGenerativeAI(apiKey);

  // Presupuesto de tiempo compartido por TODAS las llamadas de esta invocación
  // (principal + fallback + reintento por JSON malformado), para que el total
  // nunca exceda `MAX_TOTAL_MS` sin importar cuántos intentos hagan falta.
  const deadlineAt = Date.now() + MAX_TOTAL_MS;

  async function callGemini(instruction: string, model: string): Promise<string> {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      throw new GeminiTimeoutError('El reconocimiento tardó demasiado. Probá de nuevo.');
    }
    const generativeModel = genAI.getGenerativeModel({
      model,
      systemInstruction: instruction,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: FOOD_DETECTION_RESPONSE_SCHEMA,
        // Sin esto los modelos 3.x "piensan" ~900 tokens y tardan 35s+; el SDK reenvía el campo tal cual.
        thinkingConfig: { thinkingLevel: 'minimal' },
      } as GenerationConfig,
    });
    try {
      const result = await generativeModel.generateContent(
        { contents },
        { timeout: Math.min(TIMEOUT_MS, remaining) },
      );
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
      if (err instanceof GoogleGenerativeAIFetchError && err.status === 503) {
        throw new GeminiUnavailableError('El modelo de Gemini está saturado en este momento.');
      }
      throw new GeminiError(err instanceof Error ? err.message : 'Error llamando a Gemini.');
    }
  }

  // Un modelo principal + un único fallback, máximo 2 intentos. Ante 503
  // (saturado) o timeout del principal —no siempre viene un 503 explícito—
  // se espera un backoff corto y se prueba una sola vez con el modelo de
  // respaldo. Si ese segundo intento también falla por lo mismo, se corta ahí
  // con GEMINI_UNAVAILABLE: nada de rotar por más modelos ni reintentos
  // adicionales, para no multiplicar latencia ni gastar cuota en vano.
  // 429 (cuota) no entra en este camino: no se resuelve reintentando.
  async function callWithFallback(instruction: string): Promise<string> {
    try {
      return await callGemini(instruction, modelName);
    } catch (err) {
      if (!esFallaTransitoria(err) || fallbackModelName === modelName) {
        throw err;
      }
      await delay(BACKOFF_MS);
      try {
        return await callGemini(instruction, fallbackModelName);
      } catch (fallbackErr) {
        if (esFallaTransitoria(fallbackErr)) {
          throw new GeminiUnavailableError(
            'El servicio de reconocimiento está saturado. Probá de nuevo en unos segundos.',
          );
        }
        throw fallbackErr;
      }
    }
  }

  const firstText = await callWithFallback(systemInstruction);
  const firstParsed = parseFoodDetectionResult(firstText);
  if (firstParsed) return firstParsed;

  const retryText = await callWithFallback(systemInstruction + INSTRUCCION_RETRY_JSON);
  const retryParsed = parseFoodDetectionResult(retryText);
  if (retryParsed) return retryParsed;

  throw new GeminiInvalidResponseError('Gemini no devolvió un JSON válido tras reintentar.');
}
