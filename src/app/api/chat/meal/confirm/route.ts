// NUT-191 — POST /api/chat/meal/confirm: "Confirmar y guardar registro" del chat de comidas.
// Guarda, en UNA sola transacción (función SQL confirmar_chat_ia_registro): el diario real
// (ingestas/items), el agua en hidratación y la auditoría para investigadores
// (chat_ia_registros / chat_ia_registros_items). Ver supabase/012_chat_ia_registros_nut191.sql.
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { DEFAULT_GEMINI_MODEL } from '@/lib/ai/gemini';
import { authenticate } from '@/lib/chat/authenticate';
import { confirmRequestSchema } from '@/lib/chat/confirmSchemas';
import { buildConfirmPayload, catalogIdsOf, ConfirmValidationError } from '@/lib/chat/confirmService';
import { MEAL_PROMPT_VERSION } from '@/lib/chat/prompts/mealDescription';
import type { Per100 } from '@/lib/chat/sara2Catalog';
import { daysAgoAR, todayAR } from '@/lib/date';

export const runtime = 'nodejs';

type ErrorCode = 'BAD_REQUEST' | 'UNAUTHORIZED' | 'PERSISTENCE_ERROR';

const ERRORS: Record<ErrorCode, { status: number; message: string }> = {
  BAD_REQUEST: { status: 400, message: 'La solicitud no es válida.' },
  UNAUTHORIZED: { status: 401, message: 'Tenés que iniciar sesión para guardar el registro.' },
  PERSISTENCE_ERROR: { status: 500, message: 'No pudimos guardar el registro. Probá de nuevo.' },
};

function errorResponse(code: ErrorCode, message = ERRORS[code].message) {
  return NextResponse.json({ error: { code, message } }, { status: ERRORS[code].status });
}

const isRealService = () => process.env.NEXT_PUBLIC_CHAT_SERVICE === 'real';

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return errorResponse('UNAUTHORIZED');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('BAD_REQUEST', 'El cuerpo debe ser JSON válido.');
  }

  const parsed = confirmRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('BAD_REQUEST', parsed.error.issues[0]?.message ?? ERRORS.BAD_REQUEST.message);
  }

  // Los macros de los ítems de SARA2 se recalculan acá con el catálogo, no se toman del cliente.
  const per100ById = new Map<number, Per100>();
  const ids = catalogIdsOf(parsed.data);
  if (ids.length > 0) {
    const { data, error } = await auth.supabase
      .from('alimentos')
      .select('id_alimento, kcal_100g, proteinas_100g, grasas_100g, carbs_100g')
      .in('id_alimento', ids);
    if (error) {
      console.error('[chat-confirm] no se pudo leer el catálogo:', error.message);
      return errorResponse('PERSISTENCE_ERROR');
    }
    for (const row of data ?? []) {
      per100ById.set(row.id_alimento, {
        kcal: Number(row.kcal_100g ?? 0),
        proteinas: Number(row.proteinas_100g ?? 0),
        grasas: Number(row.grasas_100g ?? 0),
        carbs: Number(row.carbs_100g ?? 0),
      });
    }
  }

  let payload;
  try {
    payload = buildConfirmPayload(parsed.data, per100ById, {
      // Con el servicio mock no interviene ningún modelo: se audita como "mock".
      modelo: isRealService() ? process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL : 'mock',
      promptVersion: isRealService() ? MEAL_PROMPT_VERSION : 'mock',
      minDate: daysAgoAR(7),
      maxDate: todayAR(),
    });
  } catch (err) {
    if (err instanceof ConfirmValidationError) return errorResponse('BAD_REQUEST', err.message);
    throw err;
  }

  const { data, error } = await auth.supabase.rpc('confirmar_chat_ia_registro', { p_payload: payload });
  if (error) {
    // PGRST202 = la función no existe: falta aplicar supabase/012_chat_ia_registros_nut191.sql.
    console.error(`[chat-confirm] falló el guardado (${error.code}): ${error.message}`);
    return errorResponse('PERSISTENCE_ERROR');
  }

  revalidatePath('/alimentacion');
  revalidatePath('/home');
  console.info(`[chat-confirm] ${JSON.stringify({ items: payload.items.length, yaGuardado: data?.yaGuardado === true })}`);
  return NextResponse.json({ ok: true, ...data });
}
