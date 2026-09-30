import { describe, it, expect, vi, afterEach } from 'vitest';
import { obtenerProductoPorEAN } from '@/lib/openFoodFacts';

function mockFetchOnce(response: unknown, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(response),
  }) as unknown as typeof fetch;
}

describe('obtenerProductoPorEAN', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normaliza un producto con todos los campos presentes', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Alfajor Triple',
        categories: 'Snacks dulces, Alfajores',
        brands: 'Havanna',
        serving_quantity: 45,
        nutriments: {
          'energy-kcal_100g': 450,
          proteins_100g: 5,
          fat_100g: 20,
          carbohydrates_100g: 60,
        },
        image_url: 'https://example.com/img.jpg',
      },
    });

    const result = await obtenerProductoPorEAN('7790040000100');

    expect(result).toEqual({
      encontrado: true,
      ean: '7790040000100',
      nombre: 'Alfajor Triple',
      categoria: 'Snacks dulces',
      marca: 'Havanna',
      porcion: 45,
      nutrientes100g: { kcal: 450, proteinas: 5, grasas: 20, carbs: 60 },
      imagenUrl: 'https://example.com/img.jpg',
    });
  });

  it('usa porcion=100 cuando OFF no trae serving_quantity', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Agua saborizada',
        nutriments: { 'energy-kcal_100g': 2, proteins_100g: 0, fat_100g: 0, carbohydrates_100g: 0.5 },
      },
    });

    const result = await obtenerProductoPorEAN('7790040000200');
    expect(result.encontrado).toBe(true);
    if (result.encontrado) expect(result.porcion).toBe(100);
  });

  it('usa porcion=100 cuando serving_quantity es 0 o negativo', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Producto con serving_quantity inválido',
        serving_quantity: 0,
        nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
      },
    });

    const result = await obtenerProductoPorEAN('7790040000210');
    expect(result.encontrado).toBe(true);
    if (result.encontrado) expect(result.porcion).toBe(100);
  });

  it('usa categoria "Sin categoría" y marca null cuando faltan', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Producto genérico',
        nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
      },
    });

    const result = await obtenerProductoPorEAN('7790040000300');
    expect(result.encontrado).toBe(true);
    if (result.encontrado) {
      expect(result.categoria).toBe('Sin categoría');
      expect(result.marca).toBeNull();
    }
  });

  it('toma solo la primera categoría, trimeada, cuando vienen varias separadas por coma', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Producto con categorías raras',
        categories: '  Snacks dulces ,Alfajores , Otros ',
        nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
      },
    });

    const result = await obtenerProductoPorEAN('7790040000350');
    expect(result.encontrado).toBe(true);
    if (result.encontrado) expect(result.categoria).toBe('Snacks dulces');
  });

  it('devuelve encontrado:false cuando status es 0', async () => {
    mockFetchOnce({ status: 0 });
    const result = await obtenerProductoPorEAN('0000000000000');
    expect(result).toEqual({ encontrado: false, ean: '0000000000000' });
  });

  it('devuelve encontrado:false cuando los 4 macros son null (ficha vacía)', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Producto sin datos nutricionales',
        nutriments: {},
      },
    });
    const result = await obtenerProductoPorEAN('7790040000400');
    expect(result).toEqual({ encontrado: false, ean: '7790040000400' });
  });

  it('devuelve encontrado:true con 0 en los campos que falten cuando NO faltan los 4', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Producto con datos parciales',
        nutriments: { 'energy-kcal_100g': 200, proteins_100g: 3 },
      },
    });
    const result = await obtenerProductoPorEAN('7790040000500');
    expect(result.encontrado).toBe(true);
    if (result.encontrado) {
      expect(result.nutrientes100g).toEqual({ kcal: 200, proteinas: 3, grasas: 0, carbs: 0 });
    }
  });

  it('parsea los macros y la porción cuando OFF los manda como string en vez de number', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Producto con macros mal tipados',
        serving_quantity: '45',
        nutriments: {
          'energy-kcal_100g': '450',
          proteins_100g: '5',
          fat_100g: '20',
          carbohydrates_100g: '60',
        },
      },
    });
    const result = await obtenerProductoPorEAN('7790040000550');
    expect(result.encontrado).toBe(true);
    if (result.encontrado) {
      expect(result.nutrientes100g).toEqual({ kcal: 450, proteinas: 5, grasas: 20, carbs: 60 });
      expect(result.porcion).toBe(45);
    }
  });

  it('trata un macro como ausente (no lo confunde con 0) cuando el string no es numérico', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Producto con un macro corrupto',
        nutriments: {
          'energy-kcal_100g': 'no disponible',
          proteins_100g: 5,
          fat_100g: 20,
          carbohydrates_100g: 60,
        },
      },
    });
    const result = await obtenerProductoPorEAN('7790040000560');
    expect(result.encontrado).toBe(true);
    if (result.encontrado) {
      expect(result.nutrientes100g).toEqual({ kcal: 0, proteinas: 5, grasas: 20, carbs: 60 });
    }
  });

  it('devuelve encontrado:false ante un error de red', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await obtenerProductoPorEAN('7790040000600');
    expect(result).toEqual({ encontrado: false, ean: '7790040000600' });
  });

  it('devuelve encontrado:false cuando la respuesta HTTP no es ok', async () => {
    mockFetchOnce({}, false);
    const result = await obtenerProductoPorEAN('7790040000700');
    expect(result).toEqual({ encontrado: false, ean: '7790040000700' });
  });
});
