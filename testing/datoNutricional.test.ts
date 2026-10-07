/**
 * NUT-119 — Etiqueta de origen del dato nutricional y celdas de macros de la
 * exportación de investigadores (D8: descartados y sin datos salen vacíos).
 */
import { describe, expect, it } from 'vitest';
import { etiquetaDatoNutricional, macrosExportables, type ItemExportable } from '@/lib/datoNutricional';

const base: ItemExportable = {
  id_alimento: null,
  id_alimento_barcode: null,
  nombre_manual: null,
  origen_macros: null,
  kcal_100g: null,
  kcal: 100,
  proteinas_g: 5,
  grasas_g: 3,
  carbs_g: 12,
};

const item = (over: Partial<ItemExportable>): ItemExportable => ({ ...base, ...over });

describe('etiquetaDatoNutricional', () => {
  it.each([
    ['legado con id_alimento', { id_alimento: 4 }, 'Catálogo'],
    ['legado con código de barras', { id_alimento_barcode: 9 }, 'Código de barras'],
    ['legado manual', { nombre_manual: 'algo' }, 'Manual'],
    ['catalogo', { origen_macros: 'catalogo', id_alimento: 4 }, 'Catálogo'],
    ['estimado_ia', { origen_macros: 'estimado_ia', kcal_100g: 200 }, 'Estimado IA'],
    ['pendiente con valores', { origen_macros: 'pendiente', kcal_100g: 200 }, 'Pendiente'],
    ['pendiente sin valores', { origen_macros: 'pendiente', kcal_100g: null }, 'Pendiente (sin datos)'],
    ['validado', { origen_macros: 'validado', id_alimento: 2000000 }, 'Validado'],
    ['descartado', { origen_macros: 'descartado' }, 'Descartado'],
    ['sin_datos', { origen_macros: 'sin_datos' }, 'Sin datos'],
  ] as const)('%s → %s', (_n, over, esperado) => {
    expect(etiquetaDatoNutricional(item(over))).toBe(esperado);
  });
});

describe('macrosExportables', () => {
  const NUMEROS = { kcal: 100, proteinas: 5, grasas: 3, carbs: 12 };
  const VACIO = { kcal: '', proteinas: '', grasas: '', carbs: '' };

  it('catálogo, barcode, estimado IA, validado y pendiente con valores → números', () => {
    for (const over of [
      { id_alimento: 4 },
      { id_alimento_barcode: 9 },
      { origen_macros: 'estimado_ia', kcal_100g: 200 },
      { origen_macros: 'validado', id_alimento: 2000000 },
      { origen_macros: 'pendiente', kcal_100g: 200 },
    ]) {
      expect(macrosExportables(item(over))).toEqual(NUMEROS);
    }
  });

  it('descartado, sin datos, manual y pendiente sin snapshot → celdas vacías (no ceros)', () => {
    for (const over of [
      { origen_macros: 'descartado' },
      { origen_macros: 'sin_datos' },
      { nombre_manual: 'algo' },
      { origen_macros: 'pendiente', kcal_100g: null },
    ]) {
      expect(macrosExportables(item({ ...over, kcal: 0, proteinas_g: 0, grasas_g: 0, carbs_g: 0 }))).toEqual(VACIO);
    }
  });

  it('convierte los numeric que llegan como string', () => {
    const r = macrosExportables(item({ id_alimento: 1, kcal: '12.5' as never }));
    expect(r.kcal).toBe(12.5);
  });
});
