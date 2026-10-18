/**
 * NUT-119 — Estudio a ciegas: a un deportista UCC no deben llegarle kcal/macros
 * NI en el payload que Next serializa hacia los componentes cliente (ocultarlos
 * solo en el JSX no alcanza: los números viajan en el código fuente de la
 * página). Con NUT-119 esos números son los de Gemini o los validados por los
 * investigadores. Pone en 0 todos los campos nutricionales de las ingestas y
 * sus ítems; el resto de los datos (nombre, cantidad) queda intacto.
 */

const CAMPOS_INGESTA = ['kcal_total', 'proteinas_total_g', 'grasas_total_g', 'carbs_total_g'] as const;
const CAMPOS_ITEM = ['kcal', 'proteinas_g', 'grasas_g', 'carbs_g'] as const;
const CAMPOS_BARCODE = ['kcal_100g', 'proteinas_100g', 'grasas_100g', 'carbs_100g'] as const;

type Fila = Record<string, unknown>;

const poner0 = (fila: Fila, campos: readonly string[]): Fila => {
  const copia = { ...fila };
  for (const c of campos) if (c in copia) copia[c] = 0;
  return copia;
};

export function ocultarMacros<T extends object>(ingestas: T[], ocultar: boolean): T[] {
  if (!ocultar) return ingestas;
  return (ingestas as Fila[]).map((ingesta) => {
    const base = poner0(ingesta, CAMPOS_INGESTA);
    if (Array.isArray(ingesta.items)) {
      base.items = (ingesta.items as Fila[]).map((item) => {
        const it = poner0(item, CAMPOS_ITEM);
        if (it.alimentos_barcode && typeof it.alimentos_barcode === 'object') {
          it.alimentos_barcode = poner0(it.alimentos_barcode as Fila, CAMPOS_BARCODE);
        }
        return it;
      });
    }
    return base;
  }) as T[];
}
