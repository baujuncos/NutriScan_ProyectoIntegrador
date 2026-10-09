/**
 * NUT-154/156/167/168/172/119 — Endpoint combinado de reconocimiento de
 * alimentos + estimación de peso vía Gemini (épica NUT-12/NUT-119). Persiste
 * la predicción original (`detecciones_ia`/`detecciones_ia_items`) para el
 * loop de mejora continua. Ver NUT-155/166 para el prompt.
 *
 * NUT-119: la imagen ya recortada/procesada que se manda a Gemini también se
 * guarda en Storage (bucket privado), EN PARALELO con la llamada a Gemini. Si la
 * subida falla la detección sigue (log); si la detección falla después de
 * subir, se borra la foto huérfana.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ELEVACION_OBJETIVO_DEG } from '@/lib/anguloDispositivo';
import { PROMPT_VERSION, type DetectionResponse } from '@/lib/deteccion';
import { postprocesarDeteccion } from '@/lib/deteccionPostproceso';
import {
  GeminiConfigError,
  GeminiInvalidResponseError,
  GeminiRateLimitError,
  GeminiTimeoutError,
  GeminiUnavailableError,
  reconocerAlimentos,
} from '@/lib/geminiClient';
import type { ContextoCaptura } from '@/lib/geminiFoodPrompt';
import { comprimirImagenParaGemini, ImagenInvalidaError } from '@/lib/geminiImagePrep';
import { borrarFoto, subirFotoDeteccion } from '@/lib/fotosDeteccion';
import { errorResponse } from '@/lib/httpErrors';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
// Cubre el presupuesto interno de reintentos de Gemini (25s, ver MAX_TOTAL_MS
// en geminiClient.ts) más margen para la compresión de imagen, la persistencia y la red.
export const maxDuration = 30;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

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

/** Borra una foto huérfana con el cliente admin (los usuarios no tienen DELETE en el bucket). Nunca lanza. */
async function limpiarFotoHuerfana(path: string | null): Promise<void> {
  if (!path) return;
  try {
    await borrarFoto(createAdminClient(), path);
  } catch (err) {
    console.error('No se pudo limpiar la foto huérfana:', err);
  }
}

export async function POST(req: NextRequest) {
  // Requiere sesión: sin esto, cualquiera podría pegarle al endpoint sin
  // loguearse y gastar la cuota de Gemini (que además ahora es facturada).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión para usar el reconocimiento por IA.');
  }

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

  const { tipo, diametroCm } = vajillaResult.data;
  const { beta } = anguloResult.data;
  const anguloAproximado = beta == null;
  const anguloCapturaGrados = beta != null ? Math.round(90 - beta) : ELEVACION_OBJETIVO_DEG;

  const contexto: ContextoCaptura = { tipoVajilla: tipo, diametroCm, anguloCapturaGrados };

  let imagen: { base64: string; mimeType: string };
  try {
    const buffer = Buffer.from(await imageEntry.arrayBuffer());
    imagen = await comprimirImagenParaGemini(buffer);
  } catch (err) {
    if (err instanceof ImagenInvalidaError) {
      return errorResponse(400, 'IMAGE_INVALID_TYPE', err.message);
    }
    throw err;
  }

  // Arranca la subida YA, en paralelo con Gemini. Nunca rechaza (devuelve null si falla).
  const fotoPromise = subirFotoDeteccion(supabase, user.id, Buffer.from(imagen.base64, 'base64'));
  let imagenPath: string | null = null;

  try {
    let reconocimiento: Awaited<ReturnType<typeof reconocerAlimentos>>;
    try {
      reconocimiento = await reconocerAlimentos({ contexto, imagen, anguloAproximado });
    } catch (err) {
      await limpiarFotoHuerfana(await fotoPromise);
      throw err;
    }
    const { resultado, modeloUsado } = reconocimiento;
    imagenPath = await fotoPromise;
    const { items, totalEstimatedWeightGrams } = postprocesarDeteccion(resultado);

    const { data: deteccionRow, error: insertDeteccionError } = await supabase
      .from('detecciones_ia')
      .insert({
        id_usuario: user.id,
        prompt_version: PROMPT_VERSION,
        modelo: modeloUsado,
        vajilla_tipo: tipo,
        vajilla_diametro_cm: diametroCm,
        angulo_captura_grados: anguloCapturaGrados,
        angulo_aproximado: anguloAproximado,
        imagen_path: imagenPath, // NUT-119: path en el bucket privado (null si la subida falló); imagen_url queda sin usar
        total_estimated_weight_grams: totalEstimatedWeightGrams,
      })
      .select('id_deteccion')
      .single();

    if (insertDeteccionError || !deteccionRow) {
      console.error('No se pudo persistir la detección:', insertDeteccionError);
      await limpiarFotoHuerfana(imagenPath);
      return errorResponse(502, 'PERSISTENCE_ERROR', 'No pudimos guardar el resultado. Probá de nuevo.');
    }

    if (items.length > 0) {
      const { error: insertItemsError } = await supabase.from('detecciones_ia_items').insert(
        items.map((item) => ({
          id_deteccion: deteccionRow.id_deteccion,
          item_uuid: item.id,
          ingredient: item.ingredient,
          tipo: item.type,
          confidence: item.confidence,
          estimated_weight_grams: item.estimatedWeightGrams,
          questions: item.questions,
          bbox_x: item.boundingBox?.x ?? null,
          bbox_y: item.boundingBox?.y ?? null,
          bbox_width: item.boundingBox?.width ?? null,
          bbox_height: item.boundingBox?.height ?? null,
        })),
      );
      if (insertItemsError) {
        console.error('No se pudieron persistir los items de la detección:', insertItemsError);
        await limpiarFotoHuerfana(imagenPath);
        return errorResponse(502, 'PERSISTENCE_ERROR', 'No pudimos guardar el resultado. Probá de nuevo.');
      }
    }

    const response: DetectionResponse = {
      predictionId: String(deteccionRow.id_deteccion),
      items,
      totalEstimatedWeightGrams,
    };
    return NextResponse.json({ ok: true, ...response }, { status: 200 });
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
    if (err instanceof GeminiUnavailableError) {
      return errorResponse(
        502,
        'GEMINI_UNAVAILABLE',
        'El servicio de reconocimiento está saturado. Probá de nuevo en unos segundos.',
      );
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
