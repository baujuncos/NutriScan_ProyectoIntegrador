export interface ProductoEncontrado {
  encontrado: true;
  ean: string;
  nombre: string;
  categoria: string;
  marca: string | null;
  porcion: number;
  nutrientes100g: {
    kcal: number;
    proteinas: number;
    grasas: number;
    carbs: number;
  };
  imagenUrl: string | null;
}

export interface ProductoNoEncontrado {
  encontrado: false;
  ean: string;
}

export type ProductoOFF = ProductoEncontrado | ProductoNoEncontrado;

const OFF_TIMEOUT_MS = 8000;

function numeroOCero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function numeroPositivoONulo(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function primeraCategoria(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'Sin categoría';
  const primera = value.split(',')[0]?.trim();
  return primera || 'Sin categoría';
}

export async function obtenerProductoPorEAN(ean: string): Promise<ProductoOFF> {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${ean}.json`, {
      signal: AbortSignal.timeout(OFF_TIMEOUT_MS),
    });
    if (!res.ok) return { encontrado: false, ean };

    const data = await res.json();
    if (data?.status === 0 || !data?.product) return { encontrado: false, ean };

    const product = data.product;
    const n = product.nutriments ?? {};

    const kcalRaw = n['energy-kcal_100g'];
    const proteinasRaw = n['proteins_100g'];
    const grasasRaw = n['fat_100g'];
    const carbsRaw = n['carbohydrates_100g'];

    const todosAusentes =
      kcalRaw == null && proteinasRaw == null && grasasRaw == null && carbsRaw == null;
    if (todosAusentes) return { encontrado: false, ean };

    return {
      encontrado: true,
      ean,
      nombre:
        typeof product.product_name === 'string' && product.product_name.trim()
          ? product.product_name.trim()
          : 'Producto sin nombre',
      categoria: primeraCategoria(product.categories),
      marca: typeof product.brands === 'string' && product.brands.trim() ? product.brands.trim() : null,
      porcion: numeroPositivoONulo(product.serving_quantity) ?? 100,
      nutrientes100g: {
        kcal: numeroOCero(kcalRaw),
        proteinas: numeroOCero(proteinasRaw),
        grasas: numeroOCero(grasasRaw),
        carbs: numeroOCero(carbsRaw),
      },
      imagenUrl: typeof product.image_url === 'string' && product.image_url ? product.image_url : null,
    };
  } catch {
    return { encontrado: false, ean };
  }
}
