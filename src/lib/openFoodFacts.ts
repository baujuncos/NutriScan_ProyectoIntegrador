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

// OFF a veces manda los números como string (ej. "450" en vez de 450).
// Parsearlos evita que un macro real se pierda como si estuviese ausente.
function aNumero(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function numeroPositivoONulo(value: unknown): number | null {
  const n = aNumero(value);
  return n != null && n > 0 ? n : null;
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

    const kcalNum = aNumero(n['energy-kcal_100g']);
    const proteinasNum = aNumero(n['proteins_100g']);
    const grasasNum = aNumero(n['fat_100g']);
    const carbsNum = aNumero(n['carbohydrates_100g']);

    const todosAusentes =
      kcalNum === null && proteinasNum === null && grasasNum === null && carbsNum === null;
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
        kcal: kcalNum ?? 0,
        proteinas: proteinasNum ?? 0,
        grasas: grasasNum ?? 0,
        carbs: carbsNum ?? 0,
      },
      imagenUrl: typeof product.image_url === 'string' && product.image_url ? product.image_url : null,
    };
  } catch {
    return { encontrado: false, ean };
  }
}
