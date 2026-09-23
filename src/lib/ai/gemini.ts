// NUT-188/190 — Único punto de contacto con Gemini. Para cambiar de modelo
// alcanza con GEMINI_MODEL; el resto del código habla con `LlmTransport`.
// SOLO server-side: la key nunca se loguea ni se expone al cliente.

import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { z } from 'zod';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

export type AiErrorCode = 'RATE_LIMITED' | 'AI_UNAVAILABLE' | 'AI_INVALID_RESPONSE' | 'AI_BLOCKED';

export class AiError extends Error {
  readonly code: AiErrorCode;
  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = 'AiError';
    this.code = code;
  }
}

export interface LlmContent {
  role: 'user' | 'model';
  text: string;
}

export interface LlmRequest {
  /** Etiqueta para logs ("meal", "match", ...). */
  kind: string;
  systemInstruction: string;
  contents: LlmContent[];
  jsonSchema: unknown;
  maxOutputTokens: number;
}

export interface LlmUsage {
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
}

export interface LlmRawResponse {
  text: string | undefined;
  finishReason?: string;
  blockReason?: string;
  usage: LlmUsage;
}

/** Abstracción mínima sobre el SDK para poder inyectar un cliente falso en tests. */
export interface LlmTransport {
  model: string;
  generate(req: LlmRequest, signal: AbortSignal): Promise<LlmRawResponse>;
}

export interface LlmCallStat {
  kind: string;
  model: string;
  attempts: number;
  outcome: string;
  latencyMs: number;
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
}

export interface LlmCallOptions {
  timeoutMs?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (stat: LlmCallStat & { attempt: number }) => void;
  /** Se llama con el resumen de cada llamada (para el script de pruebas). */
  onStat?: (stat: LlmCallStat) => void;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const BLOCK_FINISH_REASONS = new Set(['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'RECITATION']);

let cachedTransport: LlmTransport | null = null;

/**
 * Los 3.7+ ya no aceptan thinking MINIMAL (ver ai.google.dev/gemini-api/docs/thinking);
 * para esos usamos LOW, que es el mínimo disponible.
 */
function thinkingLevelFor(model: string): ThinkingLevel {
  const match = /^gemini-(\d+)\.(\d+)/.exec(model);
  if (!match) return ThinkingLevel.LOW;
  const version = Number(match[1]) + Number(match[2]) / 10;
  return version <= 3.6 ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;
}

export function getGeminiTransport(): LlmTransport {
  if (cachedTransport) return cachedTransport;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AiError('AI_UNAVAILABLE', 'GEMINI_API_KEY no configurada.');
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

  // Reintentos propios (1 solo) en callLlmJson; desactivamos los del SDK (default: 5).
  const ai = new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
  const thinkingLevel = thinkingLevelFor(model);

  cachedTransport = {
    model,
    async generate(req, signal) {
      const res = await ai.models.generateContent({
        model,
        contents: req.contents.map((c) => ({ role: c.role, parts: [{ text: c.text }] })),
        config: {
          systemInstruction: req.systemInstruction,
          temperature: 0.2,
          maxOutputTokens: req.maxOutputTokens,
          responseMimeType: 'application/json',
          responseJsonSchema: req.jsonSchema,
          thinkingConfig: { thinkingLevel },
          abortSignal: signal,
        },
      });
      return {
        text: res.text,
        finishReason: res.candidates?.[0]?.finishReason,
        blockReason: res.promptFeedback?.blockReason,
        usage: {
          promptTokens: res.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
          thoughtsTokens: res.usageMetadata?.thoughtsTokenCount ?? 0,
        },
      };
    },
  };
  return cachedTransport;
}

type AttemptFailure = { retryable: boolean; error: AiError; outcome: string };

function classifyThrown(err: unknown, timedOut: boolean): AttemptFailure {
  if (timedOut) {
    return { retryable: true, outcome: 'timeout', error: new AiError('AI_UNAVAILABLE', 'Timeout de Gemini.') };
  }
  const status = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status: unknown }).status) : NaN;
  if (status === 429) {
    return { retryable: true, outcome: 'http_429', error: new AiError('RATE_LIMITED', 'Gemini 429.') };
  }
  if (Number.isFinite(status) && status >= 500) {
    return { retryable: true, outcome: `http_${status}`, error: new AiError('AI_UNAVAILABLE', `Gemini ${status}.`) };
  }
  if (Number.isFinite(status)) {
    // 400/401/403/404: config o request inválidos; reintentar no cambia nada.
    return { retryable: false, outcome: `http_${status}`, error: new AiError('AI_UNAVAILABLE', `Gemini ${status}.`) };
  }
  return { retryable: true, outcome: 'network_error', error: new AiError('AI_UNAVAILABLE', 'Error de red con Gemini.') };
}

function defaultLog(stat: LlmCallStat & { attempt: number }) {
  console.info(`[gemini] ${JSON.stringify(stat)}`);
}

/**
 * Llama al modelo pidiendo JSON, con timeout por intento, 1 reintento con backoff
 * (429 / 5xx / red / timeout / JSON vacío o inválido) y validación Zod del resultado.
 */
export async function callLlmJson<T>(
  transport: LlmTransport,
  req: LlmRequest,
  schema: z.ZodType<T>,
  options: LlmCallOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = options.log ?? defaultLog;
  const maxAttempts = 2;

  const totals = { latencyMs: 0, promptTokens: 0, outputTokens: 0, thoughtsTokens: 0 };
  let lastFailure: AttemptFailure | null = null;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await sleep(retryDelayMs * (lastFailure?.outcome === 'http_429' ? 2 : 1));

    attemptsMade = attempt;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const started = Date.now();

    let raw: LlmRawResponse | null = null;
    let failure: AttemptFailure | null = null;
    try {
      raw = await Promise.race([
        transport.generate(req, controller.signal),
        // El SDK respeta abortSignal, pero cortamos igual por si el transporte no lo hace.
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
      ]);
    } catch (err) {
      failure = classifyThrown(err, timedOut);
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = Date.now() - started;
    totals.latencyMs += latencyMs;
    if (raw) {
      totals.promptTokens += raw.usage.promptTokens;
      totals.outputTokens += raw.usage.outputTokens;
      totals.thoughtsTokens += raw.usage.thoughtsTokens;
    }

    let parsed: T | null = null;
    if (raw && !failure) {
      if (raw.blockReason || (raw.finishReason && BLOCK_FINISH_REASONS.has(raw.finishReason))) {
        failure = {
          retryable: false,
          outcome: `blocked_${raw.blockReason ?? raw.finishReason}`,
          error: new AiError('AI_BLOCKED', 'Respuesta bloqueada por seguridad.'),
        };
      } else if (!raw.text?.trim()) {
        failure = {
          retryable: true,
          outcome: `empty_${raw.finishReason ?? 'unknown'}`,
          error: new AiError('AI_INVALID_RESPONSE', 'Respuesta vacía de Gemini.'),
        };
      } else {
        let json: unknown;
        try {
          json = JSON.parse(raw.text);
        } catch {
          json = undefined;
        }
        const result = json === undefined ? null : schema.safeParse(json);
        if (result?.success) {
          parsed = result.data;
        } else {
          failure = {
            retryable: true,
            outcome: json === undefined ? `invalid_json_${raw.finishReason ?? 'unknown'}` : 'schema_mismatch',
            error: new AiError('AI_INVALID_RESPONSE', 'Respuesta de Gemini con formato inválido.'),
          };
        }
      }
    }

    log({
      kind: req.kind,
      model: transport.model,
      attempt,
      attempts: attempt,
      outcome: failure ? failure.outcome : 'ok',
      latencyMs,
      promptTokens: raw?.usage.promptTokens ?? 0,
      outputTokens: raw?.usage.outputTokens ?? 0,
      thoughtsTokens: raw?.usage.thoughtsTokens ?? 0,
    });

    if (!failure && parsed !== null) {
      options.onStat?.({ kind: req.kind, model: transport.model, attempts: attempt, outcome: 'ok', ...totals });
      return parsed;
    }

    lastFailure = failure;
    if (!failure?.retryable) break;
  }

  const final = lastFailure ?? {
    outcome: 'unknown',
    retryable: false,
    error: new AiError('AI_INVALID_RESPONSE', 'Respuesta inválida.'),
  };
  options.onStat?.({
    kind: req.kind,
    model: transport.model,
    attempts: attemptsMade,
    outcome: final.outcome,
    ...totals,
  });
  throw final.error;
}
