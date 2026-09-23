/**
 * NUT-154 + NUT-156 — Endpoint combinado de reconocimiento de alimentos +
 * estimación de peso vía Gemini (épica NUT-12). Ver NUT-155 para el prompt.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ELEVACION_OBJETIVO_DEG } from '@/lib/anguloDispositivo';
import {
  GeminiConfigError,
  GeminiInvalidResponseError,
  GeminiRateLimitError,
  GeminiTimeoutError,
  reconocerAlimentos,
} from '@/lib/geminiClient';
import type { ContextoCaptura, FoodDetectionResult, PreguntasPorIngrediente } from '@/lib/geminiFoodPrompt';

export const runtime = 'nodejs';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function errorResponse(status: number, error: string, message: string, field?: string) {
  return NextResponse.json({ error, message, ...(field ? { field } : {}) }, { status });
}

// Deliberadamente sin 'otro': ese tipo de vajilla ya desvía a carga manual
// antes de llegar a este endpoint (ver AIRecognitionModal.tsx, stage 'otro').
const vajillaSchema = z.object({
  tipo: z.enum(['plato_playo', 'plato_postre', 'plato_hondo']),
  diametroCm: z.number().positive(),
});

const anguloSchema = z.object({
  beta: z.number().nullable(),
  estado: z.enum(['ok', 'muy_cenital', 'muy_rasante', 'desconocido']),
  dentroDeRango: z.boolean(),
});

const preguntasSchema = z.record(z.string(), z.number().int().min(0));

const respuestaUsuarioSchema = z.object({
  ingredient: z.string().min(1),
  respuesta: z.string().min(1),
});

const detectedIngredientSchema = z.object({
  ingredient: z.string(),
  type: z.string(),
  confidence: z.number(),
  estimatedWeightGrams: z.number(),
  questionForUser: z.string().nullable(),
});

const previousDetectionSchema = z.object({
  detectedIngredients: z.array(detectedIngredientSchema),
  totalEstimatedWeightGrams: z.number(),
});

type ParseResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

function parseJsonField<T>(
  schema: z.ZodType<T>,
  raw: FormDataEntryValue | null,
  field: string,
): ParseResult<T> {
  if (typeof raw !== 'string') {
    return { ok: false, response: errorResponse(400, 'INVALID', `Falta el campo ${field}.`, field) };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      response: errorResponse(400, 'INVALID', `El campo ${field} no es JSON válido.`, field),
    };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      response: errorResponse(
        400,
        'INVALID',
        parsed.error.issues[0]?.message ?? `El campo ${field} es inválido.`,
        field,
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorResponse(400, 'INVALID', 'Cuerpo de la solicitud inválido.');
  }

  const imageEntry = form.get('image');
  if (!(imageEntry instanceof File) || imageEntry.size === 0) {
    return errorResponse(400, 'IMAGE_REQUIRED', 'Falta la foto a reconocer.');
  }
  if (imageEntry.size > MAX_IMAGE_BYTES) {
    return errorResponse(400, 'IMAGE_TOO_LARGE', 'La foto es demasiado pesada.');
  }
  if (!imageEntry.type.startsWith('image/')) {
    return errorResponse(400, 'IMAGE_INVALID_TYPE', 'El archivo debe ser una imagen.');
  }

  const vajillaResult = parseJsonField(vajillaSchema, form.get('vajilla'), 'vajilla');
  if (!vajillaResult.ok) return vajillaResult.response;

  const anguloResult = parseJsonField(anguloSchema, form.get('angulo'), 'angulo');
  if (!anguloResult.ok) return anguloResult.response;

  const preguntasRaw = form.get('preguntasPorIngrediente') ?? '{}';
  const preguntasResult = parseJsonField(preguntasSchema, preguntasRaw, 'preguntasPorIngrediente');
  if (!preguntasResult.ok) return preguntasResult.response;

  const previousDetectionRaw = form.get('previousDetection');
  const respuestaUsuarioRaw = form.get('respuestaUsuario');
  if (Boolean(previousDetectionRaw) !== Boolean(respuestaUsuarioRaw)) {
    return errorResponse(
      400,
      'INVALID',
      'previousDetection y respuestaUsuario deben enviarse juntos.',
    );
  }

  let refinamiento:
    | {
        previousDetection: FoodDetectionResult;
        respuestaUsuario: { ingredient: string; respuesta: string };
      }
    | undefined;

  if (previousDetectionRaw && respuestaUsuarioRaw) {
    const previousDetectionResult = parseJsonField(
      previousDetectionSchema,
      previousDetectionRaw,
      'previousDetection',
    );
    if (!previousDetectionResult.ok) return previousDetectionResult.response;

    const respuestaUsuarioResult = parseJsonField(
      respuestaUsuarioSchema,
      respuestaUsuarioRaw,
      'respuestaUsuario',
    );
    if (!respuestaUsuarioResult.ok) return respuestaUsuarioResult.response;

    refinamiento = {
      previousDetection: previousDetectionResult.data,
      respuestaUsuario: respuestaUsuarioResult.data,
    };
  }

  const { tipo, diametroCm } = vajillaResult.data;
  const { beta } = anguloResult.data;
  const anguloAproximado = beta == null;
  const anguloCapturaGrados = beta != null ? Math.round(90 - beta) : ELEVACION_OBJETIVO_DEG;

  const contexto: ContextoCaptura = { tipoVajilla: tipo, diametroCm, anguloCapturaGrados };

  const base64 = Buffer.from(await imageEntry.arrayBuffer()).toString('base64');
  const mimeType = imageEntry.type || 'image/jpeg';

  try {
    const result = await reconocerAlimentos({
      contexto,
      preguntasHechas: preguntasResult.data as PreguntasPorIngrediente,
      imagen: { base64, mimeType },
      anguloAproximado,
      refinamiento,
    });
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    if (err instanceof GeminiConfigError) {
      console.error('GEMINI_API_KEY no configurada:', err);
      return errorResponse(500, 'SERVER_CONFIG', 'Servidor mal configurado.');
    }
    if (err instanceof GeminiTimeoutError) {
      return errorResponse(502, 'GEMINI_TIMEOUT', err.message);
    }
    if (err instanceof GeminiRateLimitError) {
      return errorResponse(502, 'GEMINI_RATE_LIMIT', err.message);
    }
    if (err instanceof GeminiInvalidResponseError) {
      return errorResponse(
        502,
        'GEMINI_INVALID_RESPONSE',
        'No pudimos interpretar la respuesta del reconocimiento. Probá de nuevo.',
      );
    }
    console.error('Fallo la llamada a Gemini:', err);
    return errorResponse(502, 'GEMINI_ERROR', 'No pudimos completar el reconocimiento. Probá de nuevo.');
  }
}
