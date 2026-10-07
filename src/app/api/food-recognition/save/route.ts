/**
 * NUT-172 / NUT-119 — Guardado de correcciones del usuario sobre una
 * predicción de IA (épica NUT-119) + registro en el diario real.
 *
 * Node hace lo lento e idempotente (matching contra `alimentos`, fallback de
 * Gemini para lo que no se encuentra) y delega TODA la escritura a una única
 * RPC transaccional (`registrar_guardado_deteccion`, solo service_role): log de
 * la detección, ingesta/ítems del diario y cola de validación de deportistas.
 * El rol lo decide la RPC leyendo `profiles` — nunca el cliente.
 *
 * La respuesta NUNCA lleva kcal/macros (estudio a ciegas con deportistas UCC).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { estaEnRangoEditable, todayAR } from '@/lib/date';
import {
  MAX_QUESTIONS_PER_ITEM,
  NUTRITION_PROMPT_VERSION,
  type FinalItem,
  type SaveRequest,
  type SaveResponse,
} from '@/lib/deteccion';
import { cargarCatalogoAutomatico, type EntradaCatalogo } from '@/lib/catalogoAutomatico';
import { resolverAlimentosConIA, type ResolucionIA, type ResultadoIA } from '@/lib/geminiNutritionFallback';
import { errorResponse } from '@/lib/httpErrors';
import type { Macros100 } from '@/lib/macros';
import { matchearAlimentos, type MatchResultado } from '@/lib/matchingAlimentos';
import { MAX_CANTIDAD, isValidDateInput, normalizarTipoIngesta } from '@/lib/nutrition';
import { createAdminClient } from '@/lib/supabase/admin';
import { ATHLETE_ROLE } from '@/lib/researcher/athletes';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
// Cubre matching + el presupuesto de Gemini para macros (12 s, ver geminiNutritionFallback) + la RPC de commit.
export const maxDuration = 30;

const itemAnswerSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1).nullable(),
  custom: z.boolean().optional(),
});

const finalItemSchema = z.object({
  sourceItemId: z.string().min(1).nullable(),
  name: z.string().min(1),
  category: z.string().min(1),
  grams: z.number().positive().max(MAX_CANTIDAD),
  aiGrams: z.number().positive().nullable(),
  origin: z.enum(['ai', 'answered', 'replaced', 'added_manually']),
  answers: z.array(itemAnswerSchema).max(MAX_QUESTIONS_PER_ITEM),
  // id de `alimentos` elegido en el buscador; el servidor lo verifica (FK) al escribir.
  foodRef: z.string().regex(/^\d+$/, 'foodRef inválido').nullable().optional(),
});

const saveRequestSchema = z.object({
  predictionId: z.string().regex(/^\d+$/, 'predictionId inválido'),
  mealType: z.string().min(1),
  items: z.array(finalItemSchema).min(1),
  removedItemIds: z.array(z.string().min(1)),
  fecha: z.string().optional(),
});

/** Ítem tal como lo espera la RPC (snake_case, ver el comentario de `registrar_guardado_deteccion` en supabase/013). */
interface ItemParaRpc {
  source_item_uuid: string | null;
  name: string;
  category: string;
  grams: number;
  ai_grams: number | null;
  origin: FinalItem['origin'];
  answers: FinalItem['answers'];
  food_ref: string | null;
  id_alimento: number | null;
  metodo_match: 'food_ref' | 'exacto' | 'sara2_ia' | 'gemini' | 'cola' | 'ninguno';
  score_match: number | null;
  ia: Macros100 | null;
}

/** ¿El usuario es deportista UCC? Se lee de `profiles` en el servidor, nunca del cliente. Ante cualquier duda, no. */
async function esDeportista(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('profiles').select('role').eq('user_id', userId).single();
  if (error) console.error('No se pudo leer el rol del usuario:', error);
  return data?.role === ATHLETE_ROLE;
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

  const tipo = normalizarTipoIngesta(saveRequest.mealType);
  if (!tipo) {
    return errorResponse(400, 'INVALID', 'El tipo de comida no es válido.', 'mealType');
  }

  const fecha = saveRequest.fecha ?? todayAR();
  if (!isValidDateInput(fecha) || !estaEnRangoEditable(fecha)) {
    return errorResponse(400, 'INVALID', 'Solo podés cargar comidas de los últimos 7 días.', 'fecha');
  }

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

  // Pre-check barato: antes de pagar matching y Gemini. La RPC lo vuelve a
  // verificar bajo lock (carrera entre dos guardados simultáneos).
  const { data: guardadoPrevio, error: previoError } = await supabase
    .from('detecciones_guardados')
    .select('id_guardado')
    .eq('id_deteccion', deteccion.id_deteccion)
    .limit(1);
  if (previoError) {
    console.error('No se pudo verificar el guardado previo:', previoError);
    return errorResponse(502, 'PERSISTENCE_ERROR', 'No pudimos validar la predicción. Probá de nuevo.');
  }
  if ((guardadoPrevio ?? []).length > 0) {
    return errorResponse(409, 'ALREADY_SAVED', 'Esta comida ya fue guardada.');
  }

  // 1) Matching contra el catálogo: UNA llamada para todos los nombres sin foodRef.
  const idxSinFoodRef = saveRequest.items.map((it, i) => (it.foodRef ? -1 : i)).filter((i) => i >= 0);
  let matches: MatchResultado[];
  try {
    matches = await matchearAlimentos(
      supabase,
      idxSinFoodRef.map((i) => saveRequest.items[i].name),
    );
  } catch (err) {
    console.error('Falló el matching de alimentos:', err);
    return errorResponse(502, 'PERSISTENCE_ERROR', 'No pudimos guardar los cambios. Probá de nuevo.');
  }
  const matchPorItem = new Map<number, MatchResultado>(idxSinFoodRef.map((itemIdx, k) => [itemIdx, matches[k]]));

  // 2) Fallback de Gemini para lo que no se encontró (dedup por nombre normalizado).
  const sinMatch = idxSinFoodRef.filter((i) => matchPorItem.get(i)?.idAlimento == null);
  const claveDe = (i: number) =>
    matchPorItem.get(i)?.nombreNormalizado ?? saveRequest.items[i].name.trim().toLowerCase();
  const unicos = new Map<string, { nombre: string; categoria: string }>();
  for (const i of sinMatch) {
    const clave = claveDe(i);
    if (!unicos.has(clave)) unicos.set(clave, { nombre: saveRequest.items[i].name, categoria: saveRequest.items[i].category });
  }
  const claves = [...unicos.keys()];

  // 2b) Deportistas: lo que ya está en la cola de validación (pendiente con valores, validado o descartado)
  // no se vuelve a estimar con Gemini — la RPC de commit lo vincula a la fila existente.
  const enCola = new Set<string>();
  if (claves.length > 0 && (await esDeportista(supabase, user.id))) {
    const normalizadas = claves.filter((c) => sinMatch.some((i) => matchPorItem.get(i)?.nombreNormalizado === c));
    if (normalizadas.length > 0) {
      const { data: filas, error: colaError } = await createAdminClient().rpc('cola_lookup', {
        p_nombres: normalizadas.map((c) => unicos.get(c)!.nombre),
      });
      if (colaError) {
        console.error('Falló cola_lookup (se estima todo con Gemini):', colaError);
      } else {
        for (const f of (filas ?? []) as Array<{ nombre_normalizado: string | null; necesita_ia: boolean }>) {
          if (f.nombre_normalizado && f.necesita_ia === false) enCola.add(f.nombre_normalizado);
        }
      }
    }
  }

  const clavesAEstimar = claves.filter((c) => !enCola.has(c));

  // 2c) La IA resuelve el resto en UNA llamada: ELIGE de la lista de SARA2/VALIDADO (nunca ANMAT: son
  // productos envasados y un match equivocado, ej. "Huevo" → un huevo de chocolate, es muy probable)
  // o, si no hay equivalente, estima los macros por 100 g.
  let resolucion: ResolucionIA = { resultados: [], modelo: null };
  if (clavesAEstimar.length > 0) {
    let catalogo: EntradaCatalogo[] = [];
    try {
      catalogo = await cargarCatalogoAutomatico(supabase);
    } catch (err) {
      console.error('No se pudo cargar el catálogo automático (se estiman sólo los macros):', err);
    }
    resolucion = await resolverAlimentosConIA(clavesAEstimar.map((c) => unicos.get(c)!), catalogo);
  }
  const resultadoPorClave = new Map<string, ResultadoIA>(
    clavesAEstimar.map((c, k) => [c, resolucion.resultados[k] ?? null]),
  );

  // 3) Ítems para la RPC.
  const itemsRpc: ItemParaRpc[] = saveRequest.items.map((it, i) => {
    const base = {
      source_item_uuid: it.sourceItemId,
      name: it.name,
      category: it.category,
      grams: it.grams,
      ai_grams: it.aiGrams,
      origin: it.origin,
      answers: it.answers,
      food_ref: it.foodRef ?? null,
    };
    if (it.foodRef) {
      return { ...base, id_alimento: Number(it.foodRef), metodo_match: 'food_ref', score_match: null, ia: null };
    }
    const m = matchPorItem.get(i)!;
    if (m.idAlimento != null) {
      return { ...base, id_alimento: m.idAlimento, metodo_match: m.metodo ?? 'exacto', score_match: m.score, ia: null };
    }
    if (enCola.has(claveDe(i))) {
      return { ...base, id_alimento: null, metodo_match: 'cola', score_match: null, ia: null };
    }
    const r = resultadoPorClave.get(claveDe(i)) ?? null;
    if (r && 'idCatalogo' in r) {
      // Elegido de la lista por la IA (el id ya se validó contra esa lista): los macros salen del catálogo.
      return { ...base, id_alimento: r.idCatalogo, metodo_match: 'sara2_ia', score_match: null, ia: null };
    }
    const ia = r && 'macros' in r ? r.macros : null;
    return { ...base, id_alimento: null, metodo_match: ia ? 'gemini' : 'ninguno', score_match: null, ia };
  });

  // 4) Una sola transacción para todo lo que se escribe (cliente admin: la RPC no es invocable por el usuario).
  const { data: resultado, error: rpcError } = await createAdminClient().rpc('registrar_guardado_deteccion', {
    p_user_id: user.id,
    p_id_deteccion: deteccion.id_deteccion,
    p_fecha: fecha,
    p_tipo: tipo,
    p_removed: saveRequest.removedItemIds,
    p_items: itemsRpc,
    p_modelo_nutricion: resolucion.modelo,
    p_nutrition_prompt_version: NUTRITION_PROMPT_VERSION,
  });

  if (rpcError) {
    const msg = String(rpcError.message ?? '');
    if (msg.includes('ALREADY_SAVED')) {
      return errorResponse(409, 'ALREADY_SAVED', 'Esta comida ya fue guardada.');
    }
    if (msg.includes('NOT_FOUND')) {
      return errorResponse(404, 'NOT_FOUND', 'La predicción no existe.');
    }
    if (msg.includes('FOOD_REF_INVALIDO')) {
      const idx = saveRequest.items.findIndex((it) => it.foodRef === String(rpcError.details ?? ''));
      return errorResponse(400, 'INVALID', 'El alimento elegido no existe.', `items.${Math.max(idx, 0)}.foodRef`);
    }
    console.error('No se pudo registrar el guardado:', rpcError);
    return errorResponse(502, 'PERSISTENCE_ERROR', 'No pudimos guardar los cambios. Probá de nuevo.');
  }

  const response: SaveResponse = {
    ok: true,
    savedId: String(resultado.id_guardado),
    diario: {
      itemsRegistrados: Number(resultado.items_registrados) || 0,
      sinDatos: Number(resultado.sin_datos) || 0,
    },
  };
  return NextResponse.json(response, { status: 200 });
}
