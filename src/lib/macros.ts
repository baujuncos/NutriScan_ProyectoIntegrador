/**
 * NUT-119 — Macros por 100 g y su escalado al gramaje. El cálculo vive acá
 * (no en Gemini ni en el cliente): valor_item = valor_100g × gramos / 100.
 */

/** Snapshot nutricional por 100 g (mismos nombres que las columnas de la DB). */
export interface Macros100 {
  kcal_100g: number;
  proteinas_100g: number;
  grasas_100g: number;
  carbs_100g: number;
}

/** Macros de un ítem ya escalados a su gramaje (mismos nombres que las columnas de `items`). */
export interface MacrosItem {
  kcal: number;
  proteinas_g: number;
  grasas_g: number;
  carbs_g: number;
}

const redondear2 = (v: number) => Math.round(v * 100) / 100;

/** valor_item = valor_100g × gramos / 100, redondeado a 2 decimales. Usar siempre los gramos FINALES (los corregidos por el usuario). */
export function macrosItem(m: Macros100, gramos: number): MacrosItem {
  const k = gramos / 100;
  return {
    kcal: redondear2(m.kcal_100g * k),
    proteinas_g: redondear2(m.proteinas_100g * k),
    grasas_g: redondear2(m.grasas_100g * k),
    carbs_g: redondear2(m.carbs_100g * k),
  };
}

/**
 * ¿Son creíbles estos valores por 100 g? Los usa tanto el fallback de Gemini
 * (descarta lo implausible → "sin datos") como el formulario del investigador
 * (solo avisa). Todos finitos y ≥ 0; cada macro ≤ 100 g; P+C+G ≤ 105 g;
 * kcal ≤ 900; y kcal coherente con 4/4/9 dentro de max(25 kcal, 35 %)
 * (fibra y alcohol desvían un poco el 4/4/9).
 */
export function macrosPlausibles(m: Macros100): boolean {
  const { kcal_100g: kcal, proteinas_100g: p, grasas_100g: g, carbs_100g: c } = m;
  const todos = [kcal, p, g, c];
  if (!todos.every((v) => Number.isFinite(v) && v >= 0)) return false;
  if (p > 100 || g > 100 || c > 100) return false;
  if (p + g + c > 105) return false;
  if (kcal > 900) return false;
  const calculado = 4 * p + 4 * c + 9 * g;
  return Math.abs(kcal - calculado) <= Math.max(25, 0.35 * kcal);
}

/**
 * Macros por 100 g de una MEZCLA de varios alimentos del catálogo (ej. "aceite y
 * vinagre", un aderezo que no existe como entrada propia). Los gramos son
 * proporciones: se promedia ponderando por ellos y el resultado queda siempre
 * por 100 g de mezcla. null si no hay componentes o algún gramaje no es válido.
 */
export function macrosMezcla(componentes: { macros: Macros100; gramos: number }[]): Macros100 | null {
  if (componentes.length === 0) return null;
  if (!componentes.every((c) => Number.isFinite(c.gramos) && c.gramos > 0)) return null;
  const total = componentes.reduce((acc, c) => acc + c.gramos, 0);
  const prom = (campo: keyof Macros100) =>
    redondear2(componentes.reduce((acc, c) => acc + c.macros[campo] * c.gramos, 0) / total);
  return {
    kcal_100g: prom('kcal_100g'),
    proteinas_100g: prom('proteinas_100g'),
    grasas_100g: prom('grasas_100g'),
    carbs_100g: prom('carbs_100g'),
  };
}
