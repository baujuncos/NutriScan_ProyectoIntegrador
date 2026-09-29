/**
 * NUT-172 — Guardado de correcciones del usuario sobre una predicción de IA
 * (épica NUT-119). Recibe `SaveRequest`, valida que la predicción exista y
 * sea del usuario, y persiste el resultado vinculado a ella.
 *
 * IMPORTANTE: este endpoint NUNCA escribe en el diario real (`ingestas`/
 * `items`) — todavía no existe matching de alimentos ni cálculo de macros.
 * Ver `registrarEnDiario` más abajo para el punto de integración futuro.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { MAX_QUESTIONS_PER_ITEM, type FinalItem, type SaveRequest } from '@/lib/deteccion';
import { errorResponse } from '@/lib/httpErrors';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const itemAnswerSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1).nullable(),
  custom: z.boolean().optional(),
});

const finalItemSchema = z.object({
  sourceItemId: z.string().min(1).nullable(),
  name: z.string().min(1),
  category: z.string().min(1),
  grams: z.number().positive(),
  aiGrams: z.number().positive().nullable(),
  origin: z.enum(['ai', 'answered', 'replaced', 'added_manually']),
  answers: z.array(itemAnswerSchema).max(MAX_QUESTIONS_PER_ITEM),
  foodRef: z.string().min(1).nullable().optional(),
});

const saveRequestSchema = z.object({
  predictionId: z.string().regex(/^\d+$/, 'predictionId inválido'),
  mealType: z.string().min(1),
  items: z.array(finalItemSchema).min(1),
  removedItemIds: z.array(z.string().min(1)),
});

/**
 * TODO(nutrición-macros): cuando exista el matching de alimentos + cálculo
 * de macros, conectar acá para escribir en el diario real (ingestas/items).
 * Ver src/app/alimentacion/actions.ts (addItemAction) para el patrón de
 * upsert-ingesta + insert-items a replicar. NO llamar hasta entonces.
 */
async function registrarEnDiario(
  _userId: string,
  _mealType: string,
  _items: FinalItem[],
): Promise<void> {
  // no-op intencional — ver TODO arriba.
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'INVALID', 'Cuerpo de la solicitud inválido.');
  }

  const parsed = saveRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return errorResponse(400, 'INVALID', issue?.message ?? 'Payload inválido.', issue?.path?.join('.'));
  }
  const saveRequest: SaveRequest = parsed.data;

  const { data: deteccion, error: findError } = await supabase
    .from('detecciones_ia')
    .select('id_deteccion, id_usuario')
    .eq('id_deteccion', saveRequest.predictionId)
    .single();

  if (findError || !deteccion) {
    return errorResponse(404, 'NOT_FOUND', 'La predicción no existe.');
  }
  if (deteccion.id_usuario !== user.id) {
    return errorResponse(403, 'FORBIDDEN', 'No podés modificar esta predicción.');
  }

  const { data: itemsPrediccion, error: itemsError } = await supabase
    .from('detecciones_ia_items')
    .select('item_uuid')
    .eq('id_deteccion', deteccion.id_deteccion);

  if (itemsError) {
    console.error('No se pudieron leer los ítems de la predicción:', itemsError);
    return errorResponse(502, 'PERSISTENCE_ERROR', 'No pudimos validar la predicción. Probá de nuevo.');
  }

  const idsValidos = new Set((itemsPrediccion ?? []).map((row: { item_uuid: string }) => row.item_uuid));

  // Regla de negocio no expresable como FK simple: un ítem agregado a mano no
  // puede referenciar un ítem de la predicción; los demás sí, y tiene que
  // pertenecer a ESTA predicción (no a otra del mismo usuario).
  for (const item of saveRequest.items) {
    if (item.origin === 'added_manually') {
      if (item.sourceItemId !== null || item.aiGrams !== null) {
        return errorResponse(
          400,
          'INVALID',
          'Un ítem agregado manualmente no puede tener sourceItemId ni aiGrams.',
        );
      }
    } else if (!item.sourceItemId || !idsValidos.has(item.sourceItemId)) {
      return errorResponse(400, 'INVALID', `sourceItemId ${item.sourceItemId} no pertenece a esta predicción.`);
    }
  }

  const { data: guardado, error: insertGuardadoError } = await supabase
    .from('detecciones_guardados')
    .insert({
      id_usuario: user.id,
      id_deteccion: deteccion.id_deteccion,
      tipo_comida: saveRequest.mealType,
      removed_item_uuids: saveRequest.removedItemIds,
    })
    .select('id_guardado')
    .single();

  if (insertGuardadoError || !guardado) {
    console.error('No se pudo persistir el guardado:', insertGuardadoError);
    return errorResponse(502, 'PERSISTENCE_ERROR', 'No pudimos guardar los cambios. Probá de nuevo.');
  }

  const { error: insertItemsError } = await supabase.from('detecciones_guardados_items').insert(
    saveRequest.items.map((item) => ({
      id_guardado: guardado.id_guardado,
      source_item_uuid: item.sourceItemId,
      name: item.name,
      category: item.category,
      grams: item.grams,
      ai_grams: item.aiGrams,
      origin: item.origin,
      answers: item.answers,
      food_ref: item.foodRef ?? null,
    })),
  );

  if (insertItemsError) {
    console.error('No se pudieron persistir los items del guardado:', insertItemsError);
    return errorResponse(502, 'PERSISTENCE_ERROR', 'No pudimos guardar los cambios. Probá de nuevo.');
  }

  await registrarEnDiario(user.id, saveRequest.mealType, saveRequest.items);

  return NextResponse.json({ ok: true, savedId: String(guardado.id_guardado) }, { status: 200 });
}
