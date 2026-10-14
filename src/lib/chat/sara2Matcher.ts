// NUT-188 — Matching determinístico de un ingrediente contra el catálogo SARA2.
// Sin IA, sin SQL, sin llamadas de red: puro cálculo de texto en el backend.
//
// Principio: es mejor perder un match válido que aceptar uno incorrecto como si fuera
// dato oficial. Si no hay un ganador claro, NO hay match y el ítem usa la estimación
// de macros que ya trajo Gemini en su misma respuesta (macroSource "estimado_ia").

import type { Sara2Food } from './sara2Catalog';

/**
 * Puntaje mínimo (0 a 1) para aceptar un match: palabras iguales, o a lo sumo UNA palabra
 * de más en el candidato cuando el ingrediente tiene 3 o más ("pollo sin piel grillado" vs
 * "Pollo, pechuga sin piel (horno/parrilla)"). Con 0,80 se colaban errores como
 * "papa frita" → "Papas fritas de copetín" (el snack envasado).
 */
export const MATCH_MIN_SCORE = 0.85;
/** Ventaja mínima del mejor candidato sobre el segundo; si no, es ambiguo y no se usa. */
export const MATCH_MIN_MARGIN = 0.1;

// Solo artículos y preposiciones. "con" y "sin" se conservan: "pollo con piel" ≠ "pollo sin piel".
const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'al', 'en', 'y', 'e', 'o', 'u', 'a', 'un', 'una', 'tipo']);
// Palabras del catálogo que no cambian qué alimento es ("Gaseosa con azúcar, PROMEDIO").
const NEUTRAL_WORDS = new Set(['promedio', 'natural', 'fresco', 'fresca', 'entero', 'entera']);

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Formas de cocción equivalentes entre el catálogo y los nombres que genera el modelo. */
function canonicalWord(word: string): string {
  if (/^(hervid|cocid)[oa]s?$/.test(word)) return 'hervido';
  if (/^(grillad|asad|rehogad)[oa]s?$/.test(word) || ['plancha', 'parrilla', 'horno', 'grill'].includes(word)) return 'asado';
  if (/^crud[oa]s?$/.test(word)) return 'crudo';
  return word;
}

export function tokenize(text: string): string[] {
  const words = normalizeText(text)
    .split(' ')
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w) && !NEUTRAL_WORDS.has(w))
    .map(canonicalWord);
  return [...new Set(words)];
}

/**
 * Formas de una palabra para compararla sin distinguir plural ni género:
 * "papas" ~ "papa", "carnes" ~ "carne", "blanca" ~ "blanco", "fritas" ~ "frito".
 * Deliberadamente NO hay comparación difusa por distancia de edición: en comida una letra
 * cambia el alimento ("cerveza" ≠ "cereza", "pera" ≠ "perra").
 */
function wordForms(word: string): Set<string> {
  const forms = new Set([word]);
  if (word.length > 4 && word.endsWith('es')) forms.add(word.slice(0, -2));
  if (word.length > 3 && word.endsWith('s')) forms.add(word.slice(0, -1));
  for (const form of [...forms]) {
    if (form.length >= 5 && /[ao]$/.test(form)) forms.add(form.slice(0, -1));
  }
  return forms;
}

export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const formsB = wordForms(b);
  return [...wordForms(a)].some((form) => formsB.has(form));
}

/**
 * Coeficiente de Dice sobre palabras: 2·comunes / (palabras del ingrediente + palabras
 * del candidato). Penaliza por igual lo que el ingrediente dice y el candidato no
 * ("huevo revuelto" vs "huevo hervido") y lo que el candidato agrega ("pan blanco" vs
 * "Pan blanco, tipo molde, lacteado"). 1 = mismas palabras.
 */
export function scoreMatch(ingredient: string, candidateName: string): number {
  const ing = tokenize(ingredient);
  const cand = tokenize(candidateName);
  if (ing.length === 0 || cand.length === 0) return 0;
  const free = [...cand];
  let common = 0;
  for (const word of ing) {
    const at = free.findIndex((c) => sameWord(word, c));
    if (at >= 0) {
      common++;
      free.splice(at, 1);
    }
  }
  return (2 * common) / (ing.length + cand.length);
}

export interface ScoredFood {
  food: Sara2Food;
  score: number;
}

export type MatchRejection = 'no_candidates' | 'low_score' | 'ambiguous';

export interface MatchDecision {
  ingredient: string;
  /** El alimento aceptado, o null si no hay match confiable. */
  food: Sara2Food | null;
  reason: 'accepted' | MatchRejection;
  /** Mejor y segundo mejor candidato (aunque se hayan rechazado), para depurar el umbral. */
  best: ScoredFood | null;
  second: ScoredFood | null;
}

const sameNutrients = (a: Sara2Food, b: Sara2Food) =>
  a.kcal_100g === b.kcal_100g &&
  a.proteinas_100g === b.proteinas_100g &&
  a.grasas_100g === b.grasas_100g &&
  a.carbs_100g === b.carbs_100g;

export function rankFoods(ingredient: string, foods: Sara2Food[], limit = 5): ScoredFood[] {
  return foods
    .map((food) => ({ food, score: scoreMatch(ingredient, food.nombre) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.food.nombre.length - b.food.nombre.length)
    .slice(0, limit);
}

export function matchIngredient(
  ingredient: string,
  foods: Sara2Food[],
  thresholds: { minScore?: number; minMargin?: number } = {},
): MatchDecision {
  const minScore = thresholds.minScore ?? MATCH_MIN_SCORE;
  const minMargin = thresholds.minMargin ?? MATCH_MIN_MARGIN;
  const [best = null, second = null] = rankFoods(ingredient, foods, 2);
  const reject = (reason: MatchRejection): MatchDecision => ({ ingredient, food: null, reason, best, second });

  if (!best) return reject('no_candidates');
  if (best.score < minScore) return reject('low_score');
  // Casi empatado con otro candidato: solo es inocuo si ambos tienen los mismos valores
  // (ej. "Papas fritas McDonald's" chicas, medianas y grandes).
  if (second && best.score - second.score < minMargin && !sameNutrients(best.food, second.food)) {
    return reject('ambiguous');
  }
  return { ingredient, food: best.food, reason: 'accepted', best, second };
}
