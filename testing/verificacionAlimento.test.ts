/**
 * NUT-119 — Reglas de §6.2 que no necesitan la base (el servidor repite todas).
 */
import { describe, expect, it } from 'vitest';
import { kcalCoherentes } from '@/lib/macros';
import { FUENTES_DATO, MENSAJE_ADVERTENCIA, MENSAJE_BLOQUEO, verificarValores } from '@/lib/verificacionAlimento';

const OK = { kcal: 165, proteinas: 31, grasas: 3.6, carbs: 0 };

describe('kcalCoherentes', () => {
  it('pollo (165 kcal, 31/3,6/0) es coherente', () => {
    expect(kcalCoherentes({ kcal_100g: 165, proteinas_100g: 31, grasas_100g: 3.6, carbs_100g: 0 })).toBe(true);
  });
  it('800 kcal con 5 g de proteína no lo es', () => {
    expect(kcalCoherentes({ kcal_100g: 800, proteinas_100g: 5, grasas_100g: 0, carbs_100g: 0 })).toBe(false);
  });
  it('tolera hasta 25 kcal de diferencia en valores bajos (y no más)', () => {
    expect(kcalCoherentes({ kcal_100g: 29, proteinas_100g: 0, grasas_100g: 0, carbs_100g: 1 })).toBe(true); // |29 − 4| = 25
    expect(kcalCoherentes({ kcal_100g: 30, proteinas_100g: 0, grasas_100g: 0, carbs_100g: 1 })).toBe(false); // |30 − 4| = 26
  });
});

describe('verificarValores', () => {
  it('valores razonables: sin bloqueos ni advertencias', () => {
    expect(verificarValores('Pollo grillado', OK)).toEqual({ bloqueos: [], advertencias: [] });
  });

  it('nombre vacío o de espacios bloquea', () => {
    expect(verificarValores('   ', OK).bloqueos).toContain('NOMBRE_VACIO');
  });

  it.each([
    ['falta un valor', { ...OK, grasas: null }],
    ['valor negativo', { ...OK, carbs: -1 }],
    ['NaN', { ...OK, kcal: Number.NaN }],
  ])('%s bloquea como valores inválidos (y no sigue con el resto)', (_n, v) => {
    expect(verificarValores('Algo', v)).toEqual({ bloqueos: ['VALORES_INVALIDOS'], advertencias: [] });
  });

  it('un macro mayor a 100 g bloquea', () => {
    expect(verificarValores('Algo', { kcal: 500, proteinas: 101, grasas: 0, carbs: 0 }).bloqueos).toContain('MACRO_MAYOR_100');
  });

  it('proteínas + grasas + carbs mayor a 105 g bloquea', () => {
    const r = verificarValores('Algo', { kcal: 800, proteinas: 40, grasas: 40, carbs: 30 });
    expect(r.bloqueos).toContain('SUMA_MACROS');
    expect(r.bloqueos).not.toContain('MACRO_MAYOR_100');
  });

  it('exactamente 105 g y 900 kcal NO bloquean (los límites son inclusivos)', () => {
    const r = verificarValores('Algo', { kcal: 900, proteinas: 35, grasas: 35, carbs: 35 });
    expect(r.bloqueos).toEqual([]);
  });

  it('más de 900 kcal bloquea', () => {
    expect(verificarValores('Algo', { kcal: 901, proteinas: 0, grasas: 100, carbs: 0 }).bloqueos).toContain('KCAL_MAYOR_900');
  });

  it('kcal incoherentes con 4/4/9 advierten (no bloquean)', () => {
    const r = verificarValores('Algo', { kcal: 800, proteinas: 5, grasas: 0, carbs: 0 });
    expect(r.bloqueos).toEqual([]);
    expect(r.advertencias).toEqual(['KCAL_INCOHERENTE']);
  });
});

describe('textos y fuentes', () => {
  it('hay un mensaje para cada código y las 5 fuentes del spec', () => {
    expect(Object.keys(MENSAJE_BLOQUEO).sort()).toEqual(
      ['DUPLICADO', 'KCAL_MAYOR_900', 'MACRO_MAYOR_100', 'NOMBRE_VACIO', 'SUMA_MACROS', 'VALORES_INVALIDOS'],
    );
    expect(Object.keys(MENSAJE_ADVERTENCIA).sort()).toEqual(['KCAL_INCOHERENTE', 'SIMILAR']);
    expect(FUENTES_DATO.map((f) => f.valor)).toEqual([
      'etiqueta_producto', 'tabla_composicion', 'calculo_propio', 'estimacion_ia_revisada', 'otra',
    ]);
  });
});
