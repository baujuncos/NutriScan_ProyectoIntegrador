// NUT-191 — Contrato (Zod) de POST /api/chat/meal/confirm: lo que el chat manda al
// confirmar. Trae, por ítem, lo que estimó la IA y lo que el usuario dejó al final.

import { z } from 'zod';
import { INGESTA_TIPOS } from '@/lib/nutrition';
import { conversationSchema } from './conversation';
import { INGREDIENT_TYPES } from './mealSchemas';

/** Mismo tope por ítem que la carga manual del diario (MAX_CANTIDAD en alimentacion/actions.ts). */
export const MAX_DIARY_ITEM_AMOUNT = 2000;
export const MAX_CONFIRM_ITEMS = 15;

const macrosSchema = z.object({
  kcal: z.number().min(0).max(20000),
  proteinas_g: z.number().min(0).max(5000),
  carbs_g: z.number().min(0).max(5000),
  grasas_g: z.number().min(0).max(5000),
});

export const ORIGINS = ['ai', 'edited', 'added_manually', 'removed'] as const;

export const confirmItemSchema = z
  .object({
    ingrediente: z.string().trim().min(1).max(80),
    tipo: z.enum(INGREDIENT_TYPES),
    unidad: z.enum(['g', 'ml']),
    origin: z.enum(ORIGINS),
    macroSource: z.enum(['sara2', 'estimado_ia']).nullable(),
    /** Alimento de SARA2 que matcheó; null si es estimado_ia o fue agregado a mano. */
    idAlimento: z.number().int().positive().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    gramosIa: z.number().positive().max(5000).nullable(),
    /** Estimación del modelo para gramosIa. Para ítems sara2 el backend la ignora y recalcula. */
    macrosIa: macrosSchema.nullable(),
    /** Lo que quedó tras la edición. null si el ítem fue quitado. */
    gramosFinal: z.number().positive().max(5000).nullable(),
  })
  .superRefine((item, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: 'custom', message });

    if (item.origin === 'added_manually') {
      if (
        item.gramosIa !== null || item.macrosIa !== null || item.macroSource !== null ||
        item.idAlimento !== null || item.confidence !== null
      ) {
        bad('Un ítem agregado a mano no puede traer datos de la IA.');
      }
      if (item.gramosFinal === null) bad('Falta la cantidad del ítem agregado a mano.');
      return;
    }

    if (item.gramosIa === null || item.macroSource === null) bad('Falta la estimación de la IA del ítem.');
    if (item.macroSource === 'sara2' && item.idAlimento === null) bad('Un ítem de SARA2 necesita su idAlimento.');
    if (item.macroSource === 'estimado_ia' && (item.idAlimento !== null || item.macrosIa === null)) {
      bad('Un ítem estimado por la IA necesita sus macros y no puede tener idAlimento.');
    }
    if (item.origin === 'removed' && item.gramosFinal !== null) bad('Un ítem quitado no puede tener cantidad final.');
    if (item.origin === 'ai' && item.gramosFinal !== item.gramosIa) {
      bad('Un ítem sin editar tiene que conservar los gramos de la IA.');
    }
    if (item.origin === 'edited' && item.gramosFinal === null) bad('Falta la cantidad final del ítem editado.');
  });

export const confirmRequestSchema = z.object({
  /** Se genera una vez por confirmación: reintentar con el mismo id no duplica el guardado. */
  requestId: z.uuid({ error: 'requestId inválido.' }),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'La fecha tiene que tener formato AAAA-MM-DD.' }),
  tipoIngesta: z.enum(INGESTA_TIPOS, { error: 'La comida seleccionada no es válida.' }),
  items: z
    .array(confirmItemSchema)
    .min(1, { error: 'No hay ningún alimento para guardar.' })
    .max(MAX_CONFIRM_ITEMS, { error: `Podés guardar hasta ${MAX_CONFIRM_ITEMS} alimentos por vez.` }),
  /** NUT-228: opcional. Solo se guarda si algún ítem entra a la cola de validación. */
  conversacion: conversationSchema.optional(),
});

export type ConfirmItem = z.infer<typeof confirmItemSchema>;
export type ConfirmRequest = z.infer<typeof confirmRequestSchema>;
export type ConfirmOrigin = (typeof ORIGINS)[number];
