// NUT-190 — POST /api/chat/meal: interpreta la descripción de una comida con Gemini
// y devuelve los alimentos con gramaje y macros (SARA2 o estimados). No persiste nada.
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { AiError, getGeminiTransport } from '@/lib/ai/gemini';
import { chatMealRequestSchema } from '@/lib/chat/mealSchemas';
import { analyzeMeal } from '@/lib/chat/mealService';
import { checkRateLimit } from '@/lib/chat/rateLimit';
import { createSupabaseSara2Catalog } from '@/lib/chat/sara2Catalog';

export const runtime = 'nodejs';

type ErrorCode = 'BAD_REQUEST' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'AI_UNAVAILABLE' | 'AI_INVALID_RESPONSE';

const ERRORS: Record<ErrorCode, { status: number; message: string }> = {
  BAD_REQUEST: { status: 400, message: 'La solicitud no es válida.' },
  UNAUTHORIZED: { status: 401, message: 'Tenés que iniciar sesión para usar el chat.' },
  RATE_LIMITED: { status: 429, message: 'Mandaste muchos mensajes seguidos. Esperá un minuto y probá de nuevo.' },
  AI_UNAVAILABLE: { status: 503, message: 'El asistente no está disponible en este momento. Probá de nuevo en unos minutos.' },
  AI_INVALID_RESPONSE: { status: 502, message: 'No pude interpretar la respuesta del asistente. Probá de nuevo.' },
};

function errorResponse(code: ErrorCode, message = ERRORS[code].message) {
  return NextResponse.json({ error: { code, message } }, { status: ERRORS[code].status });
}

/**
 * Sesión por cookie (app web) o `Authorization: Bearer <access_token>` (Postman/scripts),
 * mismo criterio que /api/delete-account pero sin service role: con Bearer se usa la
 * anon key + el token del usuario, así las queries respetan RLS.
 */
async function authenticate(request: NextRequest): Promise<{ userId: string; supabase: SupabaseClient } | null> {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (token) {
    const supabase = createSupabaseClient(
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_ANON_KEY ?? '',
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      },
    );
    const { data: { user }, error } = await supabase.auth.getUser(token);
    return error || !user ? null : { userId: user.id, supabase };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { userId: user.id, supabase } : null;
}

export async function POST(request: NextRequest) {
  const started = Date.now();

  const auth = await authenticate(request);
  if (!auth) return errorResponse('UNAUTHORIZED');

  if (!checkRateLimit(auth.userId)) return errorResponse('RATE_LIMITED');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('BAD_REQUEST', 'El cuerpo debe ser JSON válido.');
  }

  // Se valida ANTES de llamar a Gemini: un 400 no gasta tokens.
  const parsed = chatMealRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('BAD_REQUEST', parsed.error.issues[0]?.message ?? ERRORS.BAD_REQUEST.message);
  }

  try {
    const result = await analyzeMeal(parsed.data.messages, {
      llm: getGeminiTransport(),
      catalog: createSupabaseSara2Catalog(auth.supabase),
    });
    console.info(`[chat-meal] ${JSON.stringify({ status: result.status, items: result.detectedIngredients.length, latencyMs: Date.now() - started })}`);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AiError) {
      const code: ErrorCode = err.code === 'AI_BLOCKED' ? 'AI_INVALID_RESPONSE' : err.code;
      console.warn(`[chat-meal] ${JSON.stringify({ error: code, detail: err.message, latencyMs: Date.now() - started })}`);
      return errorResponse(code);
    }
    // Errores de Supabase u otros inesperados: sin detalles crudos al cliente.
    console.error('[chat-meal] error inesperado', err instanceof Error ? err.message : err);
    return errorResponse('AI_UNAVAILABLE');
  }
}
