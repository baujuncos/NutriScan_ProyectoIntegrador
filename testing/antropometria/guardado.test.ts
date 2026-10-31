/**
 * Guardado de una medición: limpieza de series y regla de la masa ósea de referencia
 * (fija desde los 21 años: la fija la primera medición y se reutiliza).
 */
import { describe, expect, it } from 'vitest';
import { calcularAntropometria } from '@/lib/antropometria';
import { decidirMasaOsea, esLaMedicionMasAntigua, sanearSeries } from '@/lib/researcher/antropometria/guardado';
import { ENTRADA_JULIETA, MASA_OSEA_REFERENCIA_JULIETA, SERIES_JULIETA } from '../fixtures/antropometria';

const { masaOseaReferencia: _ref, ...ENTRADA } = ENTRADA_JULIETA;
void _ref;

describe('sanearSeries', () => {
  it('descarta claves desconocidas y deja hasta 3 valores positivos', () => {
    const s = sanearSeries({ peso: [53.1, 53, 52.9, 99], talla: [163.5, 'x', -2, 0], inventada: [1, 2], __proto__x: [1] });
    expect(s).toEqual({ peso: [53.1, 53, 52.9], talla: [163.5, null, null] });
  });

  it.each([null, undefined, 'texto', 7, [1, 2]])('entrada no válida (%j) → {}', (x) => {
    expect(sanearSeries(x)).toEqual({});
  });

  it('ignora lo que no es un array y los NaN/Infinity', () => {
    expect(sanearSeries({ peso: 53, talla: [Number.NaN, Number.POSITIVE_INFINITY, 160] })).toEqual({ talla: [null, null, 160] });
  });
});

describe('esLaMedicionMasAntigua', () => {
  const otras = [{ fecha_medicion: '2026-05-10' }, { fecha_medicion: '2026-08-01' }];
  it('más vieja que todas las demás, o empate → sí', () => {
    expect(esLaMedicionMasAntigua('2026-04-01', otras)).toBe(true);
    expect(esLaMedicionMasAntigua('2026-05-10', otras)).toBe(true);
  });
  it('hay una anterior → no', () => {
    expect(esLaMedicionMasAntigua('2026-06-01', otras)).toBe(false);
  });
  it('sin otras vigentes → es la primera', () => {
    expect(esLaMedicionMasAntigua('2026-06-01', [])).toBe(true);
  });
});

describe('decidirMasaOsea', () => {
  it('primera medición (≥ 21 años, sin referencia): guarda la masa ósea calculada', () => {
    const d = decidirMasaOsea(ENTRADA, null, true);
    expect(d.guardarReferencia).toBeCloseTo(d.resultado.masas.masaOsea.calculadaKg, 10);
    expect(d.resultado.masas.masaOsea.origen).toBe('calculada');
    expect(d.guardarReferencia).toBeCloseTo(MASA_OSEA_REFERENCIA_JULIETA, 2);
  });

  it('con la referencia de la planilla reproduce los valores ancla (adiposa 17,64 · muscular 21,26)', () => {
    const d = decidirMasaOsea(ENTRADA, MASA_OSEA_REFERENCIA_JULIETA, false);
    expect(d.resultado.masas.masas.adiposa.kg).toBeCloseTo(17.64, 2);
    expect(d.resultado.masas.masas.muscular.kg).toBeCloseTo(21.26, 2);
    expect(d.guardarReferencia).toBeNull();
    expect(d.resultado.masas.masaOsea.origen).toBe('referencia');
  });

  it('una medición posterior reutiliza la referencia guardada aunque su peso cambie', () => {
    const series = { ...SERIES_JULIETA, peso: [56.2, 56.2] };
    const d = decidirMasaOsea({ ...ENTRADA, series, fechaMedicion: '2026-12-10' }, 6.1, false);
    expect(d.resultado.masas.masaOsea.usadaKg).toBe(6.1);
    expect(d.guardarReferencia).toBeNull();
  });

  it('al editar la medición más antigua, la referencia se recalcula desde ella', () => {
    const series = { ...SERIES_JULIETA, pliegue_triceps: [20, 21] };
    const d = decidirMasaOsea({ ...ENTRADA, series }, 6.1, true);
    const calculada = calcularAntropometria({ ...ENTRADA, series, masaOseaReferencia: null }).masas.masaOsea.calculadaKg;
    expect(d.guardarReferencia).toBeCloseTo(calculada, 10);
  });

  it('si la referencia ya coincide con la recalculada no hay nada que guardar', () => {
    const calculada = decidirMasaOsea(ENTRADA, null, true).guardarReferencia!;
    expect(decidirMasaOsea(ENTRADA, calculada, true).guardarReferencia).toBeNull();
  });

  it('menor de 21 años: se calcula siempre y no se guarda referencia', () => {
    const d = decidirMasaOsea({ ...ENTRADA, fechaNacimiento: '2006-10-24' }, null, true); // 20 años cumplidos a la medición (2026-10-24)
    expect(d.resultado.edad.anios).toBe(20);
    expect(d.guardarReferencia).toBeNull();
  });

  it('un menor de edad lo rechaza el motor (lanza)', () => {
    expect(() => decidirMasaOsea({ ...ENTRADA, fechaNacimiento: '2015-01-01' }, null, true)).toThrow(/mayores de 18/);
  });
});
