/**
 * Valores límite y clases de equivalencia del dominio (documentados en docs/casos-de-prueba.md, grupos TC-DATE y TC-CALC).
 *
 * TC-DATE — fecha de nacimiento. Rango válido: edad entre MIN_AGE (10) y MAX_AGE (100) inclusive, no futura.
 *   Clases: futura / edad < 10 / 10 ≤ edad ≤ 100 / edad > 100 / formato inválido.
 *   Valores límite (respecto de hoy): mañana · hoy · hace 9a 364d · hace 10a exactos · hace 100a exactos · hace 100a 364d · hace 101a exactos.
 *
 * DEF-019 — el selector de fecha (birthDateRange.minISO) y el validador (validateFechaNacimiento) tenían
 *   límites distintos: el selector bloqueaba fechas de personas de 100 años que el validador aceptaba.
 */
import { describe, expect, it } from 'vitest';
import { MAX_AGE, MIN_AGE, birthDateRange, validateFechaNacimiento } from '@/lib/dates';
import { todayAR } from '@/lib/date';
import { calcularKcalRestantes, calcularMacros, calcularTMB } from '@/lib/calculations';

/** Fecha ISO = hoy − `anios` años − `dias` días (aritmética de calendario en UTC, sin husos). */
function haceDe(anios: number, dias = 0): string {
  const [y, m, d] = todayAR().split('-').map(Number);
  const f = new Date(Date.UTC(y - anios, m - 1, d));
  f.setUTCDate(f.getUTCDate() - dias);
  return f.toISOString().slice(0, 10);
}
const manana = () => {
  const [y, m, d] = todayAR().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

describe('TC-DATE — validateFechaNacimiento: valores límite', () => {
  it.each([
    ['mañana (futura)', manana(), 'La fecha no puede ser futura.'],
    ['hace 9 años y 364 días (aún 9 años)', haceDe(10, -1), `Debés tener al menos ${MIN_AGE} años.`],
    ['hace 10 años exactos (cumple 10 hoy)', haceDe(10), null],
    ['hoy menos 10 años y 1 día', haceDe(10, 1), null],
    ['hace 100 años exactos (cumple 100 hoy)', haceDe(100), null],
    ['hace 100 años y 364 días (aún 100 años)', haceDe(100, 364), null],
    ['hace 101 años exactos (cumple 101 hoy)', haceDe(101), `La edad máxima es ${MAX_AGE} años.`],
  ])('%s', (_caso, fecha, esperado) => {
    expect(validateFechaNacimiento(fecha)).toBe(esperado);
  });

  it.each([
    ['vacío', ''],
    ['solo año', '1990'],
    ['con barras', '15/03/1990'],
    ['mes 13', '1990-13-01'],
    ['30 de febrero', '1990-02-30'],
  ])('formato inválido (%s)', (_caso, valor) => {
    expect(validateFechaNacimiento(valor)).toBe('Fecha inválida. Usá el formato AAAA-MM-DD.');
  });

  it('hoy mismo (edad 0) se rechaza por menor de edad mínima', () => {
    expect(validateFechaNacimiento(todayAR())).toBe(`Debés tener al menos ${MIN_AGE} años.`);
  });
});

describe('DEF-019 — el selector de fecha y el validador usan el mismo límite', () => {
  it('la fecha más antigua que permite el selector es válida para el validador', () => {
    const { minISO } = birthDateRange();
    expect(validateFechaNacimiento(minISO)).toBeNull();
  });

  it('el día anterior al mínimo del selector es inválido para el validador (límites idénticos)', () => {
    const { minISO } = birthDateRange();
    const [y, m, d] = minISO.split('-').map(Number);
    const anterior = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
    expect(validateFechaNacimiento(anterior)).toBe(`La edad máxima es ${MAX_AGE} años.`);
  });

  it('el máximo del selector es hoy', () => {
    expect(birthDateRange().todayISO).toBe(todayAR());
  });
});

describe('TC-CALC — calcularTMB: valor de referencia calculado a mano', () => {
  // Arrange: hombre 70 kg, 175 cm, 30 años con la ecuación implementada (Harris-Benedict 1919, ver DEF-004):
  //   66.47 + 13.75·70 + 5.003·175 − 6.755·30 = 66.47 + 962.5 + 875.525 − 202.65 = 1701.845
  it('hombre 70 kg · 175 cm · 30 años = 1701.845 kcal', () => {
    expect(calcularTMB('M', 70, 175, 30)).toBeCloseTo(1701.845, 3);
  });
  //   655.1 + 9.563·60 + 1.85·165 − 4.676·25 = 655.1 + 573.78 + 305.25 − 116.9 = 1417.23
  it('mujer 60 kg · 165 cm · 25 años = 1417.23 kcal', () => {
    expect(calcularTMB('F', 60, 165, 25)).toBeCloseTo(1417.23, 3);
  });
});

describe('TC-CALC — calcularMacros: redondeo en el borde', () => {
  it.each([
    [0, { proteinas_g: 0, carbohidratos_g: 0, grasas_g: 0 }],
    [2000, { proteinas_g: 75, carbohidratos_g: 275, grasas_g: 67 }], // 66.67 → 67
    [1, { proteinas_g: 0, carbohidratos_g: 0, grasas_g: 0 }], // 0.0375 → 0
  ])('%i kcal', (kcal, esperado) => {
    expect(calcularMacros(kcal)).toEqual(esperado);
  });

  it('las kcal de los macros redondeados difieren de la meta menos de 1 % (coherencia 15/55/30)', () => {
    const m = calcularMacros(2500);
    const kcal = m.proteinas_g * 4 + m.carbohidratos_g * 4 + m.grasas_g * 9;
    expect(Math.abs(kcal - 2500) / 2500).toBeLessThan(0.01);
  });
});

describe('TC-CALC — calcularKcalRestantes: valores límite', () => {
  it.each([
    [2000, 1999.4, 1], // 0.6 → redondea a 1
    [2000, 1999.6, 0], // 0.4 → redondea a 0
    [2000, 2000, 0],
    [2000, 2000.4, 0],
    [0, 0, 0],
    [2000, -50, 2050], // consumo negativo: no se valida acá (lo evita la capa de entrada)
  ])('meta %f consumido %f → %i', (meta, consumido, esperado) => {
    expect(calcularKcalRestantes(meta, consumido)).toBe(esperado);
  });
});
