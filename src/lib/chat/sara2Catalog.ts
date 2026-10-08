// NUT-188 — Catálogo SARA2 para el chat de registro de comida.
//
// No usa searchAlimentosAction (src/app/alimentacion/actions.ts) porque depende de la
// sesión por cookie (no sirve con Bearer ni desde scripts), mezcla productos ANMAT, ordena
// alfabéticamente y corta en 60 resultados. Acá:
//  - el cliente Supabase se recibe por parámetro;
//  - solo fuente = 'SARA2' (~930 filas): se carga una vez y se cachea en memoria;
//  - el matching contra un ingrediente vive en sara2Matcher.ts (determinístico, sin IA).

import type { SupabaseClient } from '@supabase/supabase-js';
import { toFixed2 } from '@/lib/nutrition';
import type { Macros } from './mealSchemas';

export interface Sara2Food {
  id_alimento: number;
  nombre: string;
  kcal_100g: number;
  proteinas_100g: number;
  grasas_100g: number;
  carbs_100g: number;
}

export interface FoodCatalog {
  /** Todo el catálogo SARA2 (cacheado). El matcher decide qué candidato sirve. */
  getAll(): Promise<Sara2Food[]>;
}

export interface Per100 {
  kcal: number;
  proteinas: number;
  grasas: number;
  carbs: number;
}

/**
 * Misma fórmula que el trigger public.calculate_item_nutrients()
 * (supabase/schema_consolidado.sql): round(valor_100g * cantidad / 100, 2).
 * No se puede invocar el trigger sin insertar un item; si cambia uno, cambiar el otro.
 */
export function macrosForQuantity(per100: Per100, cantidad: number): Macros {
  return {
    kcal: toFixed2((per100.kcal * cantidad) / 100),
    proteinas_g: toFixed2((per100.proteinas * cantidad) / 100),
    grasas_g: toFixed2((per100.grasas * cantidad) / 100),
    carbs_g: toFixed2((per100.carbs * cantidad) / 100),
  };
}

export function sara2Per100(food: Sara2Food): Per100 {
  return {
    kcal: food.kcal_100g,
    proteinas: food.proteinas_100g,
    grasas: food.grasas_100g,
    carbs: food.carbs_100g,
  };
}

const SELECT = 'id_alimento, nombre, kcal_100g, proteinas_100g, grasas_100g, carbs_100g' as const;
const PAGE_SIZE = 1000;
const CACHE_TTL_MS = 10 * 60 * 1000;

let cache: { rows: Sara2Food[]; loadedAt: number } | null = null;

const UNDEFINED_COLUMN = '42703';

async function fetchPage(supabase: SupabaseClient, from: number, filterBySource: boolean) {
  let query = supabase.from('alimentos').select(SELECT).not('kcal_100g', 'is', null);
  if (filterBySource) query = query.eq('fuente', 'SARA2');
  return query.order('id_alimento').range(from, from + PAGE_SIZE - 1);
}

async function loadSara2(supabase: SupabaseClient): Promise<Sara2Food[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.rows;
  const rows: Sara2Food[] = [];
  let filterBySource = true;
  for (let from = 0; ; from += PAGE_SIZE) {
    let { data, error } = await fetchPage(supabase, from, filterBySource);
    if (error?.code === UNDEFINED_COLUMN && filterBySource) {
      // Base sin la migración 009 (ANMAT): no existe `fuente` y todo el catálogo es SARA2.
      filterBySource = false;
      ({ data, error } = await fetchPage(supabase, from, filterBySource));
    }
    if (error) throw error;
    for (const r of data ?? []) {
      rows.push({
        id_alimento: r.id_alimento,
        nombre: r.nombre,
        kcal_100g: Number(r.kcal_100g),
        proteinas_100g: Number(r.proteinas_100g ?? 0),
        grasas_100g: Number(r.grasas_100g ?? 0),
        carbs_100g: Number(r.carbs_100g ?? 0),
      });
    }
    if (!data || data.length < PAGE_SIZE) break;
  }
  cache = { rows, loadedAt: Date.now() };
  return rows;
}

export function createSupabaseSara2Catalog(supabase: SupabaseClient): FoodCatalog {
  return { getAll: () => loadSara2(supabase) };
}
