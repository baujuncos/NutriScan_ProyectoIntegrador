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
  fuente_alimento: null,
  kcal: 100,
  proteinas_g: 5,
  grasas_g: 3,
  carbs_g: 12,
};

const item = (over: Partial<ItemExportable>): ItemExportable => ({ ...base, ...over });

describe('etiquetaDatoNutricional — de dónde salió el dato', () => {
  it.each([
    ['legado del catálogo SARA2', { id_alimento: 4, fuente_alimento: 'SARA2' }, 'SARA2'],
    ['legado del catálogo ANMAT', { id_alimento: 1000001, fuente_alimento: 'ANMAT' }, 'ANMAT'],
    ['legado del catálogo, fuente desconocida', { id_alimento: 4 }, 'Catálogo'],
    ['legado con código de barras', { id_alimento_barcode: 9 }, 'Código de barras'],
    ['legado manual', { nombre_manual: 'algo' }, 'Manual'],
    ['catalogo SARA2 (detección)', { origen_macros: 'catalogo', id_alimento: 4, fuente_alimento: 'SARA2' }, 'SARA2'],
    ['catalogo ANMAT (detección)', { origen_macros: 'catalogo', id_alimento: 9, fuente_alimento: 'ANMAT' }, 'ANMAT'],
    ['estimado_ia', { origen_macros: 'estimado_ia', kcal_100g: 200 }, 'IA (Gemini)'],
    ['pendiente con valores de IA', { origen_macros: 'pendiente', kcal_100g: 200 }, 'IA (pendiente de validación)'],
    ['pendiente sin valores', { origen_macros: 'pendiente', kcal_100g: null }, 'IA pendiente (sin datos)'],
    ['validado por un investigador', { origen_macros: 'validado', id_alimento: 2000000, fuente_alimento: 'VALIDADO' }, 'Validado'],
    ['validado y vinculado a SARA2 sigue siendo Validado', { origen_macros: 'validado', id_alimento: 7, fuente_alimento: 'SARA2' }, 'Validado'],
    ['descartado', { origen_macros: 'descartado' }, 'Descartado'],
    ['sin_datos', { origen_macros: 'sin_datos' }, 'Sin datos'],
  ] as const)('%s → %s', (_n, over, esperado) => {
    expect(etiquetaDatoNutricional(item(over))).toBe(esperado);
  });
});

describe('macrosExportables', () => {
  const NUMEROS = { kcal: 100, proteinas: 5, grasas: 3, carbs: 12 };
  const VACIO = { kcal: '', proteinas: '', grasas: '', carbs: '' };

  it('SARA2, ANMAT, barcode, IA, IA pendiente con valores y validado → números', () => {
    for (const over of [
      { id_alimento: 4, fuente_alimento: 'SARA2' },
      { id_alimento: 4, fuente_alimento: 'ANMAT' },
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
