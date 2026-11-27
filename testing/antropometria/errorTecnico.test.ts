/**
 * NUT-246 — Error técnico de medición (ETM/TEM) intra-evaluador: ejemplos calculados a mano.
 */
import { describe, expect, it } from 'vitest';
import { calcularErrorTecnico, resumirErrorTecnico } from '@/lib/antropometria';
import { VARIABLES, type SeriesPorVariable } from '@/lib/antropometria/variables';
import { SERIES_JULIETA } from '../fixtures/antropometria';

describe('calcularErrorTecnico — 2 series por medición', () => {
  // Mediciones de peso: (50 ; 52) y (60 ; 59). d = 2 y 1 → Σd² = 5, n = 2.
  const mediciones: SeriesPorVariable[] = [{ peso: [50, 52] }, { peso: [60, 59] }];

  it('TEM = √(Σd² / 2n) = √(5 / 4)', () => {
    const peso = calcularErrorTecnico(mediciones).variables.peso!;
    expect(peso.tem).toBeCloseTo(Math.sqrt(5 / 4), 10);
    expect(peso.tem).toBeCloseTo(1.118034, 6);
  });

  it('%TEM = TEM / media de todos los valores × 100 (media 55,25)', () => {
    const peso = calcularErrorTecnico(mediciones).variables.peso!;
    expect(peso.porcentaje).toBeCloseTo((Math.sqrt(1.25) / 55.25) * 100, 10);
    expect(peso.porcentaje).toBeCloseTo(2.0236, 4);
  });

  it('informa cuántas mediciones usó y la unidad de la variable', () => {
    const peso = calcularErrorTecnico(mediciones).variables.peso!;
    expect(peso).toMatchObject({ clave: 'peso', unidad: 'kg', n: 2 });
  });

  it('coincide con √(Σd²/2n) para cualquier conjunto de pares', () => {
    const pares: [number, number][] = [[12, 13], [7, 7], [23, 24], [16.5, 17.5], [9.1, 8.7]];
    const esperado = Math.sqrt(pares.reduce((acc, [a, b]) => acc + (a - b) ** 2, 0) / (2 * pares.length));
    const r = calcularErrorTecnico(pares.map(([a, b]) => ({ pliegue_triceps: [a, b] })));
    expect(r.variables.pliegue_triceps!.tem).toBeCloseTo(esperado, 10);
    expect(r.variables.pliegue_triceps!.unidad).toBe('mm');
  });
});

describe('calcularErrorTecnico — 3 series y series mezcladas', () => {
  it('3 series: (10,11,12) y (20,20,23) → ΣSC = 2 + 6, gl = 2 + 2 → TEM = √2', () => {
    const peso = calcularErrorTecnico([{ peso: [10, 11, 12] }, { peso: [20, 20, 23] }]).variables.peso!;
    expect(peso.tem).toBeCloseTo(Math.SQRT2, 10);
    // media de los 6 valores = 96 / 6 = 16
    expect(peso.porcentaje).toBeCloseTo((Math.SQRT2 / 16) * 100, 10);
    expect(peso.n).toBe(2);
  });

  it('mezcla de 2 y 3 series: (10,12) y (20,21,22) → ΣSC = 2 + 2, gl = 1 + 2 → TEM = √(4/3)', () => {
    const talla = calcularErrorTecnico([{ talla: [10, 12] }, { talla: [20, 21, 22] }]).variables.talla!;
    expect(talla.tem).toBeCloseTo(Math.sqrt(4 / 3), 10);
    // media de los 5 valores = 85 / 5 = 17
    expect(talla.porcentaje).toBeCloseTo((Math.sqrt(4 / 3) / 17) * 100, 10);
  });

  it('un solo valor repetido en una sola medición: sin diferencias el ETM es exactamente 0', () => {
    const r = calcularErrorTecnico([{ peso: [5, 5] }, { peso: [7, 7, 7] }]).variables.peso!;
    expect(r.tem).toBe(0);
    expect(r.porcentaje).toBe(0);
  });

  it('con una sola medición se calcula igual (n = 1)', () => {
    const peso = calcularErrorTecnico([{ peso: [53.1, 53.0] }]).variables.peso!;
    expect(peso.tem).toBeCloseTo(Math.abs(53.1 - 53.0) / Math.SQRT2, 10);
    expect(peso.n).toBe(1);
  });
});

describe('calcularErrorTecnico — datos incompletos', () => {
  it('sin mediciones: todas las variables en null, 0 mediciones y resumen vacío', () => {
    const r = calcularErrorTecnico([]);
    expect(Object.values(r.variables).every((v) => v === null)).toBe(true);
    expect(Object.keys(r.variables)).toHaveLength(25);
    expect(r.mediciones).toBe(0);
    expect(r.resumen).toEqual({ pliegues: null, otras: null });
  });

  it('ignora series con menos de 2 valores válidos (vacías, 0, NaN, texto) sin romper', () => {
    const sucias = [
      { peso: [50, null] },
      { peso: [50, 0] },
      { peso: [Number.NaN, 52] },
      { peso: ['53', '54'] },
      { peso: 'no es una serie' },
      { peso: [60, 59] },
    ] as unknown as SeriesPorVariable[];
    const peso = calcularErrorTecnico(sucias).variables.peso!;
    expect(peso.n).toBe(1);
    expect(peso.tem).toBeCloseTo(1 / Math.SQRT2, 10);
  });

  it('un valor inválido dentro de una medición con 3 series se descarta y usa los 2 válidos', () => {
    const peso = calcularErrorTecnico([{ peso: [50, null, 52] }]).variables.peso!;
    expect(peso.tem).toBeCloseTo(2 / Math.SQRT2, 10);
  });

  it('una variable sin datos da null aunque otras sí se puedan calcular', () => {
    const r = calcularErrorTecnico([{ peso: [50, 52] }]);
    expect(r.variables.peso).not.toBeNull();
    expect(r.variables.talla).toBeNull();
    expect(r.mediciones).toBe(1);
  });

  it('una medición {} o con series vacías no cuenta como medición', () => {
    expect(calcularErrorTecnico([{}, { peso: [] }]).mediciones).toBe(0);
  });
});

describe('resumirErrorTecnico', () => {
  it('promedia el %ETM de los pliegues por un lado y el de las otras variables por otro', () => {
    const r = calcularErrorTecnico([
      { pliegue_triceps: [10, 12], pliegue_abdominal: [20, 22], peso: [50, 52], talla: [160, 162] },
      { pliegue_triceps: [11, 13], pliegue_abdominal: [21, 23], peso: [60, 59], talla: [170, 170] },
    ]);
    const v = r.variables;
    expect(r.resumen.pliegues).toBeCloseTo((v.pliegue_triceps!.porcentaje + v.pliegue_abdominal!.porcentaje) / 2, 10);
    expect(r.resumen.otras).toBeCloseTo((v.peso!.porcentaje + v.talla!.porcentaje) / 2, 10);
    expect(resumirErrorTecnico(v)).toEqual(r.resumen);
  });

  it('si solo hay pliegues, "otras" es null (y al revés)', () => {
    expect(calcularErrorTecnico([{ pliegue_triceps: [10, 12] }]).resumen.otras).toBeNull();
    expect(calcularErrorTecnico([{ peso: [10, 12] }]).resumen.pliegues).toBeNull();
  });
});

describe('calcularErrorTecnico — medición completa', () => {
  it('con las 25 variables de la paciente ficticia calcula las 25', () => {
    const r = calcularErrorTecnico([SERIES_JULIETA]);
    expect(VARIABLES.every((v) => r.variables[v.clave] !== null)).toBe(true);
    expect(r.mediciones).toBe(1);
    // Series idénticas (talla 163,5 ; 163,5) → ETM 0.
    expect(r.variables.talla!.tem).toBe(0);
    expect(r.resumen.pliegues).toBeGreaterThan(0);
  });
});
