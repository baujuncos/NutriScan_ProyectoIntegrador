// NUT-188 — Candidatos del catálogo SARA2 para un ingrediente detectado por el chat.
//
// No usa searchAlimentosAction (src/app/alimentacion/actions.ts) porque depende de la
// sesión por cookie (no sirve con Bearer ni desde scripts), mezcla productos ANMAT y
// ordena alfabéticamente. Acá:
//  - el cliente Supabase se recibe por parámetro;
//  - solo fuente = 'SARA2' (~930 filas): se carga una vez y se cachea en memoria,
//    así el matching es local, sin acentos ni plural, y no cuesta una query por ítem;
//  - los candidatos se ordenan por similitud con el ingrediente.

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
  /** Hasta `limit` candidatos ordenados por similitud (el primero es el mejor). */
  findCandidates(ingredient: string, limit?: number): Promise<Sara2Food[]>;
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

const STOPWORDS = new Set(['con', 'sin', 'de', 'del', 'la', 'el', 'los', 'las', 'al', 'en', 'y', 'a', 'o', 'tipo']);
// Palabras del catálogo que no cambian el alimento ("Gaseosa con azúcar, PROMEDIO").
const NEUTRAL_CATALOG_WORDS = new Set(['promedio', 'natural', 'fresco', 'fresca', 'entero', 'entera']);

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('es') && !word.endsWith('tes')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

// Formas de cocción equivalentes para el catálogo ("Chorizo (horno/parrilla)", "Hígado (rehogado/plancha)").
const COOKED = new Set(['cocido', 'cocida', 'grillado', 'grillada', 'grill', 'asado', 'asada', 'plancha', 'parrilla', 'horno', 'rehogado']);
// Variantes especiales: solo suman si el ingrediente las menciona.
const SPECIAL = new Set([
  'polvo', 'formula', 'materna', 'light', 'tacc', 'deslactosada', 'infantil', 'prematuro',
  'crudo', 'cruda', 'deshidratado', 'concentrado', 'instantaneo', 'envasado', 'industrializado', 'dietetico',
]);

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-zñ0-9]+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w))
    .map(stem)
    .map((w) => (COOKED.has(w) ? 'cocido' : w));
}

/** ~1 = el candidato contiene todas las palabras del ingrediente; penaliza palabras extra. */
export function similarity(ingredient: string, candidate: string): number {
  const ing = tokenize(ingredient);
  const cand = tokenize(candidate);
  if (ing.length === 0 || cand.length === 0) return 0;
  const matches = (c: string) => ing.some((w) => c === w || c.startsWith(w));
  const hits = ing.filter((w) => cand.some((c) => c === w || c.startsWith(w))).length;
  const extras = cand.filter((c) => !NEUTRAL_CATALOG_WORDS.has(c) && !matches(c));
  const special = extras.filter((c) => SPECIAL.has(c)).length;
  const headBonus = cand[0] === ing[0] ? 0.1 : 0;
  return hits / ing.length + headBonus - 0.04 * extras.length - 0.2 * special;
}

/**
 * Match "claramente correcto" sin preguntarle al modelo: el candidato tiene todas
 * las palabras del ingrediente y ninguna extra relevante (ej. "banana" => "Banana").
 */
export function pickObviousMatch(ingredient: string, candidates: Sara2Food[]): Sara2Food | null {
  const ing = tokenize(ingredient);
  const exact = candidates.filter((c) => {
    const cand = tokenize(c.nombre).filter((w) => !NEUTRAL_CATALOG_WORDS.has(w));
    return cand.length === ing.length && ing.every((w) => cand.includes(w));
  });
  return exact.length === 1 ? exact[0] : null;
}

const SELECT = 'id_alimento, nombre, kcal_100g, proteinas_100g, grasas_100g, carbs_100g' as const;
const PAGE_SIZE = 1000;
// El catálogo tiene muchas variantes por alimento (ej. ~40 leches); con 5 la opción
// correcta a veces queda afuera, así que mandamos hasta 8 (nombres truncados).
export const CANDIDATES_PER_ITEM = 8;
const CACHE_TTL_MS = 10 * 60 * 1000;

let cache: { rows: Sara2Food[]; loadedAt: number } | null = null;

async function loadSara2(supabase: SupabaseClient): Promise<Sara2Food[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.rows;
  const rows: Sara2Food[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('alimentos')
      .select(SELECT)
      .eq('fuente', 'SARA2')
      .not('kcal_100g', 'is', null)
      .order('id_alimento')
      .range(from, from + PAGE_SIZE - 1);
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

export function rankCandidates(ingredient: string, rows: Sara2Food[], limit = CANDIDATES_PER_ITEM): Sara2Food[] {
  return rows
    .map((r) => ({ r, score: similarity(ingredient, r.nombre) }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score || a.r.nombre.length - b.r.nombre.length)
    .slice(0, limit)
    .map((x) => x.r);
}

export function createSupabaseSara2Catalog(supabase: SupabaseClient): FoodCatalog {
  return {
    async findCandidates(ingredient, limit = CANDIDATES_PER_ITEM) {
      return rankCandidates(ingredient, await loadSara2(supabase), limit);
    },
  };
}
