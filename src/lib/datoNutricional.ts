/**
 * NUT-119 — Cómo se ve cada ítem del diario en la exportación de
 * investigadores: de dónde salió su dato nutricional y si las celdas de
 * macros se exportan o quedan vacías (un dato descartado, ausente o manual
 * NUNCA se exporta como 0: vacío = "no hay dato", 0 = "dio cero").
 */

export interface ItemExportable {
  id_alimento: number | null;
  id_alimento_barcode: number | null;
  nombre_manual: string | null;
  /** null = ítem legado (anterior a NUT-119): se deduce del vínculo con el catálogo/barcode. */
  origen_macros: string | null;
  /** Snapshot por 100 g (solo los ítems estimados/pendientes lo tienen). */
  kcal_100g: number | null;
  kcal: number;
  proteinas_g: number;
  grasas_g: number;
  carbs_g: number;
}

export function etiquetaDatoNutricional(item: ItemExportable): string {
  switch (item.origen_macros) {
    case 'validado':
      return 'Validado';
    case 'estimado_ia':
      return 'Estimado IA';
    case 'pendiente':
      return item.kcal_100g == null ? 'Pendiente (sin datos)' : 'Pendiente';
    case 'descartado':
      return 'Descartado';
    case 'sin_datos':
      return 'Sin datos';
    case 'catalogo':
      return 'Catálogo';
  }
  if (item.id_alimento_barcode != null) return 'Código de barras';
  if (item.id_alimento != null) return 'Catálogo';
  return 'Manual';
}

export interface MacrosExportables {
  kcal: number | '';
  proteinas: number | '';
  grasas: number | '';
  carbs: number | '';
}

const VACIO: MacrosExportables = { kcal: '', proteinas: '', grasas: '', carbs: '' };

export function macrosExportables(item: ItemExportable): MacrosExportables {
  const etiqueta = etiquetaDatoNutricional(item);
  if (['Descartado', 'Sin datos', 'Manual', 'Pendiente (sin datos)'].includes(etiqueta)) return VACIO;
  return {
    kcal: Number(item.kcal) || 0,
    proteinas: Number(item.proteinas_g) || 0,
    grasas: Number(item.grasas_g) || 0,
    carbs: Number(item.carbs_g) || 0,
  };
}
