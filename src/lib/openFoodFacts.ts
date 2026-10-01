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
  esSuplemento: boolean;
  porcionEtiqueta: string | null;
  pesoNetoTotal: number | null;
  infoAmpliada: {
    nutriscore: 'a' | 'b' | 'c' | 'd' | 'e' | null;
    novaGroup: 1 | 2 | 3 | 4 | null;
    sinGluten: boolean;
    vegano: boolean;
    vegetariano: boolean;
  };
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

function redondear1(n: number): number {
  return Math.round(n * 10) / 10;
}

function primeraCategoria(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'Sin categoría';
  const primera = value.split(',')[0]?.trim();
  return primera || 'Sin categoría';
}

const PALABRAS_SUPLEMENTO = ['suplemento', 'supplement', 'proteina', 'creatina', 'multivitaminico'];

function normalizarTexto(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function detectarSuplemento(nombre: string, categoria: string, marca: string | null): boolean {
  const texto = normalizarTexto(`${nombre} ${categoria} ${marca ?? ''}`);
  return PALABRAS_SUPLEMENTO.some((palabra) => texto.includes(palabra));
}

function extraerPorcionEtiqueta(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Gramos del envase completo. Heurística, no un parseo garantizado: OFF no
 * siempre normaliza `quantity`/`product_quantity`. Casos ambiguos (ej.
 * multipacks "4 x 25 g") devuelven null a propósito — un valor incorrecto
 * silencioso sería peor que el fallback de "Personalizar" en el componente.
 */
function parsePesoNetoTotal(product: Record<string, unknown>): number | null {
  const directo = aNumero(product.product_quantity);
  if (directo != null && directo > 0) return directo;

  const texto = product.quantity;
  if (typeof texto !== 'string') return null;
  if (/\d+\s*x\s*\d/i.test(texto)) return null; // multipack ambiguo, no adivinar

  const match = texto.match(/([\d.,]+)\s*(kg|g|l|ml)\b/i);
  if (!match) return null;
  const valor = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(valor) || valor <= 0) return null;
  const unidad = match[2].toLowerCase();
  return unidad === 'kg' || unidad === 'l' ? valor * 1000 : valor;
}

const NUTRISCORE_VALIDOS = ['a', 'b', 'c', 'd', 'e'];

function extraerNutriscore(value: unknown): ProductoEncontrado['infoAmpliada']['nutriscore'] {
  if (typeof value !== 'string') return null;
  const normalizado = value.toLowerCase();
  return NUTRISCORE_VALIDOS.includes(normalizado)
    ? (normalizado as ProductoEncontrado['infoAmpliada']['nutriscore'])
    : null;
}

function extraerNovaGroup(value: unknown): ProductoEncontrado['infoAmpliada']['novaGroup'] {
  const n = aNumero(value);
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : null;
}

function extraerInfoAmpliada(product: Record<string, unknown>): ProductoEncontrado['infoAmpliada'] {
  const labels = Array.isArray(product.labels_tags) ? (product.labels_tags as unknown[]) : [];
  const tieneLabel = (tag: string) => labels.includes(tag);
  const vegano = tieneLabel('en:vegan');
  return {
    nutriscore: extraerNutriscore(product.nutriscore_grade),
    novaGroup: extraerNovaGroup(product.nova_group),
    sinGluten: tieneLabel('en:gluten-free') || tieneLabel('en:no-gluten'),
    vegano,
    vegetariano: vegano || tieneLabel('en:vegetarian'),
  };
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

    const nombre =
      typeof product.product_name === 'string' && product.product_name.trim()
        ? product.product_name.trim()
        : 'Producto sin nombre';
    const categoria = primeraCategoria(product.categories);
    const marca =
      typeof product.brands === 'string' && product.brands.trim() ? product.brands.trim() : null;

    return {
      encontrado: true,
      ean,
      nombre,
      categoria,
      marca,
      porcion: numeroPositivoONulo(product.serving_quantity) ?? 100,
      nutrientes100g: {
        kcal: redondear1(kcalNum ?? 0),
        proteinas: redondear1(proteinasNum ?? 0),
        grasas: redondear1(grasasNum ?? 0),
        carbs: redondear1(carbsNum ?? 0),
      },
      imagenUrl: typeof product.image_url === 'string' && product.image_url ? product.image_url : null,
      esSuplemento: detectarSuplemento(nombre, categoria, marca),
      porcionEtiqueta: extraerPorcionEtiqueta(product.serving_size),
      pesoNetoTotal: parsePesoNetoTotal(product),
      infoAmpliada: extraerInfoAmpliada(product),
    };
  } catch {
    return { encontrado: false, ean };
  }
}
