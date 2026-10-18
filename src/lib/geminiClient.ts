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
  type Schema,
} from '@google/generative-ai';
import { z } from 'zod';
import {
  construirSystemPrompt,
  FOOD_DETECTION_RESPONSE_SCHEMA,
  type ContextoCaptura,
  type GeminiFoodDetectionResult,
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

const geminiClarifyingQuestionSchema = z.object({
  question: z.string(),
  kind: z.string(),
  options: z.array(z.string()),
});

const geminiBoundingBoxSchema = z.object({
  ymin: z.number(),
  xmin: z.number(),
  ymax: z.number(),
  xmax: z.number(),
});

const geminiDetectedIngredientSchema = z.object({
  ingredient: z.string(),
  type: z.string(),
  confidence: z.number(),
  estimatedWeightGrams: z.number(),
  questions: z.array(geminiClarifyingQuestionSchema),
  boundingBox: geminiBoundingBoxSchema.nullable(),
});

// Sólo valida la FORMA (para detectar JSON malformado/truncado). Nunca
// límites de cantidad (ej. "máximo 3 preguntas") — eso es truncado
// defensivo en `deteccionPostproceso.ts`, no motivo para rechazar y
// reintentar una respuesta que en el fondo es JSON válido.
const geminiFoodDetectionResultSchema = z.object({
  detectedIngredients: z.array(geminiDetectedIngredientSchema),
  totalEstimatedWeightGrams: z.number(),
});

export interface ReconocerAlimentosParams {
  contexto: ContextoCaptura;
  imagen: { base64: string; mimeType: string };
  /** `true` cuando no había lectura de giroscopio y se usó un ángulo por defecto. */
  anguloAproximado: boolean;
}

export interface ReconocerAlimentosResultado {
  resultado: GeminiFoodDetectionResult;
  /** Modelo que efectivamente respondió (principal o de respaldo) — se persiste junto a la predicción. */
  modeloUsado: string;
}

interface LlamadaGemini {
  text: string;
  modelo: string;
}

function parseGeminiFoodDetectionResult(text: string): GeminiFoodDetectionResult | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = geminiFoodDetectionResultSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function buildContents(params: ReconocerAlimentosParams): Content[] {
  const imagePart = {
    inlineData: { data: params.imagen.base64, mimeType: params.imagen.mimeType },
  };
  const instruccionInicial = {
    text: 'Identificá los alimentos de esta foto según las instrucciones.',
  };
  return [{ role: 'user', parts: [imagePart, instruccionInicial] }];
}

export interface LlamarGeminiJsonOpts<T> {
  systemInstruction: string;
  contents: Content[];
  responseSchema: Schema;
  /** Devuelve null si el texto no es válido → se reintenta una vez con una instrucción más estricta. */
  parse: (text: string) => T | null;
  /** Presupuesto total compartido por TODAS las llamadas (principal + respaldo + reintento JSON). */
  maxTotalMs: number;
  /** Techo por intento individual (además acotado por lo que quede del presupuesto total). */
  timeoutMs: number;
}

/**
 * NUT-119 — Llamada a Gemini que devuelve JSON validado: modelo principal con
 * un único respaldo ante 503/timeout (ver `callWithFallback`), mapeo de
 * errores a las clases `Gemini*Error` y un único reintento si el JSON no
 * valida. La comparten el reconocimiento por foto y el fallback de macros.
 */
export async function llamarGeminiJson<T>(opts: LlamarGeminiJsonOpts<T>): Promise<{ resultado: T; modeloUsado: string }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiConfigError('GEMINI_API_KEY no está configurada.');
  }
  const modelName = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const fallbackModelName = process.env.GEMINI_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL;

  const genAI = new GoogleGenerativeAI(apiKey);

  // Presupuesto de tiempo compartido por TODAS las llamadas de esta invocación
  // (principal + fallback + reintento por JSON malformado), para que el total
  // nunca exceda `maxTotalMs` sin importar cuántos intentos hagan falta.
  const deadlineAt = Date.now() + opts.maxTotalMs;

  async function callGemini(instruction: string, model: string): Promise<LlamadaGemini> {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      throw new GeminiTimeoutError('El reconocimiento tardó demasiado. Probá de nuevo.');
    }
    const generativeModel = genAI.getGenerativeModel({
      model,
      systemInstruction: instruction,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: opts.responseSchema,
        // Sin esto los modelos 3.x "piensan" ~900 tokens y tardan 35s+; el SDK reenvía el campo tal cual.
        thinkingConfig: { thinkingLevel: 'minimal' },
      } as GenerationConfig,
    });
    try {
      const result = await generativeModel.generateContent(
        { contents: opts.contents },
        { timeout: Math.min(opts.timeoutMs, remaining) },
      );
      return { text: result.response.text(), modelo: model };
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
  async function callWithFallback(instruction: string): Promise<LlamadaGemini> {
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

  const first = await callWithFallback(opts.systemInstruction);
  const firstParsed = opts.parse(first.text);
  if (firstParsed) return { resultado: firstParsed, modeloUsado: first.modelo };

  const retry = await callWithFallback(opts.systemInstruction + INSTRUCCION_RETRY_JSON);
  const retryParsed = opts.parse(retry.text);
  if (retryParsed) return { resultado: retryParsed, modeloUsado: retry.modelo };

  throw new GeminiInvalidResponseError('Gemini no devolvió un JSON válido tras reintentar.');
}

/** Identifica y estima el peso de todos los alimentos de una foto en una sola llamada a Gemini. */
export async function reconocerAlimentos(
  params: ReconocerAlimentosParams,
): Promise<ReconocerAlimentosResultado> {
  const contexto: ContextoCaptura = params.contexto;
  let systemInstruction = construirSystemPrompt(contexto);
  if (params.anguloAproximado) {
    systemInstruction += NOTA_ANGULO_APROXIMADO;
  }

  return llamarGeminiJson<GeminiFoodDetectionResult>({
    systemInstruction,
    contents: buildContents(params),
    responseSchema: FOOD_DETECTION_RESPONSE_SCHEMA,
    parse: parseGeminiFoodDetectionResult,
    maxTotalMs: MAX_TOTAL_MS,
    timeoutMs: TIMEOUT_MS,
  });
}
