import { describe, it, expect } from 'vitest';
import {
  parseDateLocal,
  ageOn,
  validateFechaNacimiento,
  birthDateRange,
  MIN_AGE,
  MAX_AGE,
} from '@/lib/dates';
import { todayAR } from '@/lib/date';

// `validateFechaNacimiento` compara contra `todayAR()` (fecha en horario de
// Argentina), no contra `new Date()` de la máquina que corre el test. Cerca
// del cambio de día (00:00–03:00 UTC), la fecha local del runner (p. ej. un
// build de Vercel en UTC) puede ir un día adelantada respecto de Argentina,
// dando una edad "off by one" y tests flaky. Estos helpers construyen las
// fechas de prueba a partir de `todayAR()` para quedar siempre alineados con
// la misma referencia que usa la función bajo test.
function hoyAR(): { year: number; month: number; day: number } {
  const [year, month, day] = todayAR().split('-').map(Number);
  return { year, month, day };
}

function fechaHaceAnios(anios: number): string {
  const { year, month, day } = hoyAR();
  return `${year - anios}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// parseDateLocal — parsea string ISO YYYY-MM-DD sin depender de la zona horaria
// ─────────────────────────────────────────────────────────────────────────────
describe('parseDateLocal', () => {
  it('parsea una fecha ISO válida', () => {
    const d = parseDateLocal('2000-06-15');
    expect(d).not.toBeNull();
    expect(d?.getFullYear()).toBe(2000);
    expect(d?.getMonth()).toBe(5); // Junio = índice 5
    expect(d?.getDate()).toBe(15);
  });

  it('devuelve null para string vacío', () => {
    expect(parseDateLocal('')).toBeNull();
  });

  it('devuelve null para formato DD-MM-YYYY', () => {
    expect(parseDateLocal('15-06-2000')).toBeNull();
  });

  it('devuelve null para mes 0 (inexistente)', () => {
    expect(parseDateLocal('2000-00-01')).toBeNull();
  });

  it('devuelve null para mes 13 (inexistente)', () => {
    expect(parseDateLocal('2000-13-01')).toBeNull();
  });

  it('devuelve null para día 0 (inexistente)', () => {
    expect(parseDateLocal('2000-01-00')).toBeNull();
  });

  it('devuelve null para 30 de febrero (fecha lógicamente inválida)', () => {
    expect(parseDateLocal('2023-02-30')).toBeNull();
  });

  it('acepta 29 de febrero en año bisiesto', () => {
    expect(parseDateLocal('2024-02-29')).not.toBeNull();
  });

  it('devuelve null para 29 de febrero en año no bisiesto', () => {
    expect(parseDateLocal('2023-02-29')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ageOn — calcula edad exacta tomando en cuenta día de cumpleaños
// ─────────────────────────────────────────────────────────────────────────────
describe('ageOn', () => {
  it('calcula 26 años correctamente', () => {
    const birth = new Date(2000, 0, 1); // 1 ene 2000
    const ref = new Date(2026, 0, 1);   // 1 ene 2026
    expect(ageOn(birth, ref)).toBe(26);
  });

  it('no suma el año hasta que pasa el día de cumpleaños', () => {
    const birth = new Date(2000, 11, 31); // 31 dic 2000
    const ref = new Date(2026, 11, 30);   // 30 dic 2026 (un día antes)
    expect(ageOn(birth, ref)).toBe(25);
  });

  it('suma el año exactamente en el día de cumpleaños', () => {
    const birth = new Date(2000, 11, 31); // 31 dic 2000
    const ref = new Date(2026, 11, 31);   // 31 dic 2026 (el mismo día)
    expect(ageOn(birth, ref)).toBe(26);
  });

  it('diferencia correcta entre meses', () => {
    const birth = new Date(2000, 5, 15); // 15 jun 2000
    const ref = new Date(2026, 4, 14);   // 14 may 2026 (un mes y un día antes)
    expect(ageOn(birth, ref)).toBe(25);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateFechaNacimiento — valida fecha de nacimiento según reglas del negocio
//   MIN_AGE = 10, MAX_AGE = 100
// ─────────────────────────────────────────────────────────────────────────────
describe('validateFechaNacimiento', () => {
  it('devuelve null para una fecha válida de adulto (25 años)', () => {
    expect(validateFechaNacimiento(fechaHaceAnios(25))).toBeNull();
  });

  it('rechaza fecha futura con mensaje apropiado', () => {
    const error = validateFechaNacimiento('2099-12-31');
    expect(error).not.toBeNull();
    expect(error).toMatch(/futura/i);
  });

  it('rechaza formato inválido con mensaje apropiado', () => {
    const error = validateFechaNacimiento('07/06/1990');
    expect(error).not.toBeNull();
    expect(error).toMatch(/inválida/i);
  });

  it(`rechaza menor de ${MIN_AGE} años con mensaje apropiado`, () => {
    const error = validateFechaNacimiento(fechaHaceAnios(MIN_AGE - 1));
    expect(error).not.toBeNull();
    expect(error).toMatch(new RegExp(`${MIN_AGE}`));
  });

  it(`rechaza mayor de ${MAX_AGE} años con mensaje apropiado`, () => {
    const error = validateFechaNacimiento(fechaHaceAnios(MAX_AGE + 1));
    expect(error).not.toBeNull();
    expect(error).toMatch(new RegExp(`${MAX_AGE}`));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// birthDateRange — genera rango de fechas para el input de nacimiento
// ─────────────────────────────────────────────────────────────────────────────
describe('birthDateRange', () => {
  it('devuelve todayISO en formato YYYY-MM-DD', () => {
    const { todayISO } = birthDateRange();
    expect(todayISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('devuelve minISO en formato YYYY-MM-DD', () => {
    const { minISO } = birthDateRange();
    expect(minISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('minISO es anterior a todayISO (el rango tiene sentido)', () => {
    const { todayISO, minISO } = birthDateRange();
    expect(minISO < todayISO).toBe(true);
  });

  it(`minISO corresponde aproximadamente a ${MAX_AGE} años atrás`, () => {
    const { todayISO, minISO } = birthDateRange();
    const todayYear = Number(todayISO.slice(0, 4));
    const minYear = Number(minISO.slice(0, 4));
    expect(todayYear - minYear).toBe(MAX_AGE);
  });
});
