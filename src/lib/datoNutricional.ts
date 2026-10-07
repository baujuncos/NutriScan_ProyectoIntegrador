/**
 * NUT-119 — De dónde salió el dato nutricional de cada ítem del diario y cómo
 * se ve en el panel y en la exportación de investigadores: SARA2, ANMAT, código
 * de barras, IA (Gemini), validado por un investigador, etc. Las celdas de
 * macros de un dato descartado, ausente o manual NUNCA se exportan como 0:
 * vacío = "no hay dato", 0 = "dio cero".
 */

export interface ItemExportable {
  id_alimento: number | null;
  id_alimento_barcode: number | null;
  nombre_manual: string | null;
  /** null = ítem legado (anterior a NUT-119): se deduce del vínculo con el catálogo/barcode. */
  origen_macros: string | null;
  /** Snapshot por 100 g (solo los ítems estimados/pendientes lo tienen). */
  kcal_100g: number | null;
  /** `alimentos.fuente` del `id_alimento` (SARA2 / ANMAT / VALIDADO), si se la trajo en la consulta. */
  fuente_alimento?: string | null;
  kcal: number;
  proteinas_g: number;
  grasas_g: number;
  carbs_g: number;
}

type Origen =
  | 'sara2'
  | 'anmat'
  | 'catalogo'
  | 'barcode'
  | 'manual'
  | 'ia'
  | 'ia_pendiente'
  | 'ia_pendiente_sin_datos'
  | 'validado'
  | 'descartado'
  | 'sin_datos';

const ETIQUETAS: Record<Origen, string> = {
  sara2: 'SARA2',
  anmat: 'ANMAT',
  catalogo: 'Catálogo',
  barcode: 'Código de barras',
  manual: 'Manual',
  ia: 'IA (Gemini)',
  ia_pendiente: 'IA (pendiente de validación)',
  ia_pendiente_sin_datos: 'IA pendiente (sin datos)',
  validado: 'Validado',
  descartado: 'Descartado',
  sin_datos: 'Sin datos',
};

/** Orígenes cuyas celdas de macros se exportan vacías. */
const SIN_MACROS: ReadonlySet<Origen> = new Set(['descartado', 'sin_datos', 'manual', 'ia_pendiente_sin_datos']);

function deCatalogo(item: ItemExportable): Origen {
  if (item.fuente_alimento === 'SARA2') return 'sara2';
  if (item.fuente_alimento === 'ANMAT') return 'anmat';
  if (item.fuente_alimento === 'VALIDADO') return 'validado';
  return 'catalogo';
}

function origenDe(item: ItemExportable): Origen {
  switch (item.origen_macros) {
    case 'validado':
      return 'validado';
    case 'estimado_ia':
      return 'ia';
    case 'pendiente':
      return item.kcal_100g == null ? 'ia_pendiente_sin_datos' : 'ia_pendiente';
    case 'descartado':
      return 'descartado';
    case 'sin_datos':
      return 'sin_datos';
    case 'catalogo':
      return deCatalogo(item);
  }
  // Ítem legado: se deduce del vínculo.
  if (item.id_alimento_barcode != null) return 'barcode';
  if (item.id_alimento != null) return deCatalogo(item);
  return 'manual';
}

export function etiquetaDatoNutricional(item: ItemExportable): string {
  return ETIQUETAS[origenDe(item)];
}

export interface MacrosExportables {
  kcal: number | '';
  proteinas: number | '';
  grasas: number | '';
  carbs: number | '';
}

const VACIO: MacrosExportables = { kcal: '', proteinas: '', grasas: '', carbs: '' };

export function macrosExportables(item: ItemExportable): MacrosExportables {
  if (SIN_MACROS.has(origenDe(item))) return VACIO;
  return {
    kcal: Number(item.kcal) || 0,
    proteinas: Number(item.proteinas_g) || 0,
    grasas: Number(item.grasas_g) || 0,
    carbs: Number(item.carbs_g) || 0,
  };
}
