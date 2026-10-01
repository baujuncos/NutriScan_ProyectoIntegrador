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
      esSuplemento: false,
      porcionEtiqueta: null,
      pesoNetoTotal: null,
      infoAmpliada: { nutriscore: null, novaGroup: null, sinGluten: false, vegano: false, vegetariano: false },
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

  it('redondea los 4 macros a 1 decimal', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Producto con decimales largos',
        nutriments: {
          'energy-kcal_100g': 120.566,
          proteins_100g: 3.249,
          fat_100g: 1.05,
          carbohydrates_100g: 24.84,
        },
      },
    });
    const result = await obtenerProductoPorEAN('7790040000800');
    expect(result.encontrado).toBe(true);
    if (result.encontrado) {
      expect(result.nutrientes100g).toEqual({ kcal: 120.6, proteinas: 3.2, grasas: 1.1, carbs: 24.8 });
    }
  });

  describe('esSuplemento', () => {
    const base = {
      status: 1,
      product: {
        nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
      },
    };

    it.each([
      ['Suplemento Multivitamínico', '', ''],
      ['Whey Protein', 'supplement', ''],
      ['Barrita', 'proteina', ''],
      ['Monohidrato', 'creatina', ''],
      ['Complejo B', 'multivitaminico', ''],
    ])('detecta "%s" / categoria "%s" / marca "%s" como suplemento', async (nombre, categoria, marca) => {
      mockFetchOnce({
        ...base,
        product: { ...base.product, product_name: nombre, categories: categoria, brands: marca },
      });
      const result = await obtenerProductoPorEAN('7790040000900');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.esSuplemento).toBe(true);
    });

    it('un alimento común no se marca como suplemento', async () => {
      mockFetchOnce({
        ...base,
        product: { ...base.product, product_name: 'Arroz blanco', categories: 'Cereales', brands: 'Marca X' },
      });
      const result = await obtenerProductoPorEAN('7790040001000');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.esSuplemento).toBe(false);
    });
  });

  describe('porcionEtiqueta', () => {
    it('toma el texto de serving_size cuando está presente', async () => {
      mockFetchOnce({
        status: 1,
        product: {
          product_name: 'Galletitas',
          serving_size: '2.5 galletitas (30g)',
          nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
        },
      });
      const result = await obtenerProductoPorEAN('7790040001100');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.porcionEtiqueta).toBe('2.5 galletitas (30g)');
    });

    it('es null cuando serving_size está ausente o vacío', async () => {
      mockFetchOnce({
        status: 1,
        product: {
          product_name: 'Producto sin etiqueta de porción',
          serving_size: '   ',
          nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
        },
      });
      const result = await obtenerProductoPorEAN('7790040001200');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.porcionEtiqueta).toBeNull();
    });
  });

  describe('pesoNetoTotal', () => {
    const conQuantity = (quantity?: unknown, product_quantity?: unknown) => ({
      status: 1,
      product: {
        product_name: 'Producto con peso neto',
        quantity,
        product_quantity,
        nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
      },
    });

    it('usa product_quantity numérico cuando está presente', async () => {
      mockFetchOnce(conQuantity('150 g', '150'));
      const result = await obtenerProductoPorEAN('7790040001300');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.pesoNetoTotal).toBe(150);
    });

    it('parsea quantity en gramos cuando falta product_quantity', async () => {
      mockFetchOnce(conQuantity('250 g', undefined));
      const result = await obtenerProductoPorEAN('7790040001400');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.pesoNetoTotal).toBe(250);
    });

    it('convierte quantity en kg a gramos', async () => {
      mockFetchOnce(conQuantity('1.5 kg', undefined));
      const result = await obtenerProductoPorEAN('7790040001500');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.pesoNetoTotal).toBe(1500);
    });

    it('convierte quantity en litros a "gramos" (ml, densidad ~1)', async () => {
      mockFetchOnce(conQuantity('1.5 l', undefined));
      const result = await obtenerProductoPorEAN('7790040001600');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.pesoNetoTotal).toBe(1500);
    });

    it('es null cuando no hay quantity ni product_quantity', async () => {
      mockFetchOnce(conQuantity(undefined, undefined));
      const result = await obtenerProductoPorEAN('7790040001700');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.pesoNetoTotal).toBeNull();
    });

    it('es null para texto de multipack ambiguo (ej. "4 x 25 g") en vez de calcular mal', async () => {
      mockFetchOnce(conQuantity('4 x 25 g', undefined));
      const result = await obtenerProductoPorEAN('7790040001800');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.pesoNetoTotal).toBeNull();
    });
  });

  describe('infoAmpliada', () => {
    it('extrae nutriscore, nova group y los 3 labels cuando vienen completos', async () => {
      mockFetchOnce({
        status: 1,
        product: {
          product_name: 'Producto con info completa',
          nutriscore_grade: 'B',
          nova_group: 3,
          labels_tags: ['en:vegan', 'en:gluten-free'],
          nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
        },
      });
      const result = await obtenerProductoPorEAN('7790040001900');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) {
        expect(result.infoAmpliada).toEqual({
          nutriscore: 'b',
          novaGroup: 3,
          sinGluten: true,
          vegano: true,
          vegetariano: true, // vegano implica vegetariano
        });
      }
    });

    it('nutriscore inválido y nova_group fuera de rango caen a null; sin labels, los 3 booleanos son false', async () => {
      mockFetchOnce({
        status: 1,
        product: {
          product_name: 'Producto con info rara',
          nutriscore_grade: 'z',
          nova_group: 7,
          nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
        },
      });
      const result = await obtenerProductoPorEAN('7790040002000');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) {
        expect(result.infoAmpliada).toEqual({
          nutriscore: null,
          novaGroup: null,
          sinGluten: false,
          vegano: false,
          vegetariano: false,
        });
      }
    });

    it('vegetariano true sin ser vegano cuando el label es solo en:vegetarian', async () => {
      mockFetchOnce({
        status: 1,
        product: {
          product_name: 'Producto vegetariano no vegano',
          labels_tags: ['en:vegetarian'],
          nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
        },
      });
      const result = await obtenerProductoPorEAN('7790040002100');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) {
        expect(result.infoAmpliada.vegano).toBe(false);
        expect(result.infoAmpliada.vegetariano).toBe(true);
      }
    });
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
