/**
 * NUT-169/170/171 (sesión 2/2, épica NUT-119) — Datos nutricionales MOCK para
 * la pantalla de resultado editable.
 *
 * Todavía no existe matching real de alimentos contra una base con macros, así
 * que toda la UI de esta épica consume exclusivamente `NutritionProvider` para
 * mostrar kcal/macros (nunca números hardcodeados en los componentes). Esta
 * implementación es la única que hay que reemplazar el día que exista el
 * matching real — nada más en la UI debería cambiar.
 *
 * IMPORTANTE: estos valores NUNCA se mandan al backend (`SaveRequest` no
 * lleva kcal/macros) — son sólo para mostrarle un estimado al usuario.
 */

export interface NutritionValues {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface NutritionProvider {
  /** Valores por 100 g del alimento (mock, ver arriba). */
  per100g(name: string): NutritionValues;
  /** Valores escalados a `grams` gramos. */
  forGrams(name: string, grams: number): NutritionValues;
}

function normalizar(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** MOCK — fixtures por 100 g para los alimentos del mockup de NUT-169/170/171. */
const FIXTURES_MOCK: Record<string, NutritionValues> = {
  waffle: { kcal: 280, protein: 6, carbs: 35, fat: 13 },
  'frutillas cortadas': { kcal: 32, protein: 0.7, carbs: 7.7, fat: 0.3 },
  frutillas: { kcal: 32, protein: 0.7, carbs: 7.7, fat: 0.3 },
  'crema chantilly': { kcal: 300, protein: 2, carbs: 3, fat: 32 },
  'topping blanco': { kcal: 150, protein: 5, carbs: 6, fat: 12 },
  'yogur griego': { kcal: 97, protein: 9, carbs: 4, fat: 5 },
  'yogur griego natural': { kcal: 97, protein: 9, carbs: 4, fat: 5 },
  'yogur griego descremado': { kcal: 59, protein: 10, carbs: 3, fat: 0.4 },
  'yogur griego con frutas': { kcal: 118, protein: 6, carbs: 15, fat: 4 },
  'yogur griego saborizado': { kcal: 105, protein: 5, carbs: 13, fat: 3 },
  'queso blanco': { kcal: 150, protein: 12, carbs: 3, fat: 10 },
};

/**
 * Valor MOCK determinista para cualquier alimento sin fixture: un hash simple
 * del nombre normalizado, acotado a rangos plausibles. No es nutrición real.
 */
function valorDerivadoDeNombre(nombreNormalizado: string): NutritionValues {
  let hash = 0;
  for (let i = 0; i < nombreNormalizado.length; i++) {
    hash = (hash * 31 + nombreNormalizado.charCodeAt(i)) >>> 0;
  }
  return {
    kcal: 60 + (hash % 340), // 60–400
    protein: 1 + ((hash >>> 3) % 24), // 1–25
    carbs: 1 + ((hash >>> 6) % 49), // 1–50
    fat: 0.5 + ((hash >>> 9) % 30), // 0.5–30.5
  };
}

function per100gMock(name: string): NutritionValues {
  const key = normalizar(name);
  return FIXTURES_MOCK[key] ?? valorDerivadoDeNombre(key);
}

function escalar(valores: NutritionValues, grams: number): NutritionValues {
  const factor = grams / 100;
  return {
    kcal: valores.kcal * factor,
    protein: valores.protein * factor,
    carbs: valores.carbs * factor,
    fat: valores.fat * factor,
  };
}

/** MOCK — reemplazar por un provider real cuando exista matching de alimentos contra la base. */
export const nutritionProviderMock: NutritionProvider = {
  per100g: per100gMock,
  forGrams: (name, grams) => escalar(per100gMock(name), grams),
};
