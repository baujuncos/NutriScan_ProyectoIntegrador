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
