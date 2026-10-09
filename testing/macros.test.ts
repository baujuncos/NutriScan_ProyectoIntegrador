/**
 * NUT-119 — Escalado de macros por 100 g al gramaje y chequeo de plausibilidad.
 */
import { describe, expect, it } from 'vitest';
import { macrosItem, macrosMezcla, macrosPlausibles, type Macros100 } from '@/lib/macros';

const ARROZ: Macros100 = { kcal_100g: 130, proteinas_100g: 2.7, grasas_100g: 0.3, carbs_100g: 28 };
const POLLO: Macros100 = { kcal_100g: 165, proteinas_100g: 31, grasas_100g: 3.6, carbs_100g: 0 };
const ACEITE: Macros100 = { kcal_100g: 884, proteinas_100g: 0, grasas_100g: 100, carbs_100g: 0 };

describe('macrosItem', () => {
  it('escala por gramos/100 (gramos corregidos por el usuario, no los de la IA)', () => {
    expect(macrosItem(ARROZ, 250)).toEqual({ kcal: 325, proteinas_g: 6.75, grasas_g: 0.75, carbs_g: 70 });
    expect(macrosItem(ARROZ, 100)).toEqual({ kcal: 130, proteinas_g: 2.7, grasas_g: 0.3, carbs_g: 28 });
  });

  it('redondea a 2 decimales', () => {
    expect(macrosItem({ kcal_100g: 33.33, proteinas_100g: 1, grasas_100g: 1, carbs_100g: 1 }, 7)).toMatchObject({
      kcal: 2.33,
    });
  });

  it('0 g de diferencia no inventa ceros: gramos 0 da 0', () => {
    expect(macrosItem(ARROZ, 0).kcal).toBe(0);
  });
});

describe('macrosPlausibles', () => {
  it('acepta alimentos reales', () => {
    expect(macrosPlausibles(ARROZ)).toBe(true);
    expect(macrosPlausibles(POLLO)).toBe(true);
    expect(macrosPlausibles(ACEITE)).toBe(true);
  });

  it.each([
    ['negativo', { ...ARROZ, grasas_100g: -1 }],
    ['NaN', { ...ARROZ, kcal_100g: NaN }],
    ['Infinity', { ...ARROZ, carbs_100g: Infinity }],
    ['macro > 100', { kcal_100g: 500, proteinas_100g: 101, grasas_100g: 0, carbs_100g: 0 }],
    ['P+C+G > 105', { kcal_100g: 400, proteinas_100g: 50, grasas_100g: 30, carbs_100g: 30 }],
    ['kcal > 900', { kcal_100g: 950, proteinas_100g: 0, grasas_100g: 100, carbs_100g: 0 }],
    ['kcal incoherente con 4/4/9', { kcal_100g: 600, proteinas_100g: 2, grasas_100g: 1, carbs_100g: 20 }],
  ])('rechaza %s', (_nombre, m) => {
    expect(macrosPlausibles(m as Macros100)).toBe(false);
  });

  it('tolera diferencias chicas (fibra, alcohol): 25 kcal absolutas', () => {
    // 4*0 + 4*10 + 9*0 = 40 kcal calculadas, declara 60 → diferencia 20 ≤ 25.
    expect(macrosPlausibles({ kcal_100g: 60, proteinas_100g: 0, grasas_100g: 0, carbs_100g: 10 })).toBe(true);
  });
});

describe('macrosMezcla — varios alimentos del catálogo combinados en uno ("aceite y vinagre")', () => {
  const VINAGRE: Macros100 = { kcal_100g: 19, proteinas_100g: 0, grasas_100g: 0, carbs_100g: 0.6 };

  it('promedia ponderando por los gramos y devuelve los valores POR 100 g de mezcla', () => {
    // 70 g de aceite + 30 g de vinagre = 100 g de mezcla
    const r = macrosMezcla([
      { macros: ACEITE, gramos: 70 },
      { macros: VINAGRE, gramos: 30 },
    ])!;
    expect(r.kcal_100g).toBeCloseTo(624.5, 1);
    expect(r.grasas_100g).toBeCloseTo(70, 1);
    expect(r.carbs_100g).toBeCloseTo(0.18, 2);
    expect(macrosPlausibles(r)).toBe(true);
  });

  it('los gramos son proporciones: 7 + 3 da lo mismo que 70 + 30 (se normaliza a 100 g)', () => {
    const a = macrosMezcla([{ macros: ACEITE, gramos: 7 }, { macros: VINAGRE, gramos: 3 }]);
    const b = macrosMezcla([{ macros: ACEITE, gramos: 70 }, { macros: VINAGRE, gramos: 30 }]);
    expect(a).toEqual(b);
  });

  it('con 200 g (no suman 100) igual devuelve por 100 g', () => {
    const r = macrosMezcla([{ macros: ARROZ, gramos: 100 }, { macros: POLLO, gramos: 100 }])!;
    expect(r.kcal_100g).toBeCloseTo((130 + 165) / 2, 1);
    expect(r.proteinas_100g).toBeCloseTo((2.7 + 31) / 2, 1);
  });

  it('un solo componente devuelve ese mismo alimento', () => {
    expect(macrosMezcla([{ macros: POLLO, gramos: 40 }])).toEqual(POLLO);
  });

  it('sin componentes, con gramos 0, negativos o no numéricos → null (no inventa)', () => {
    expect(macrosMezcla([])).toBeNull();
    expect(macrosMezcla([{ macros: POLLO, gramos: 0 }])).toBeNull();
    expect(macrosMezcla([{ macros: POLLO, gramos: 10 }, { macros: ARROZ, gramos: -5 }])).toBeNull();
    expect(macrosMezcla([{ macros: POLLO, gramos: NaN }])).toBeNull();
  });
});
