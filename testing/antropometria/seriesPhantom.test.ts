import { describe, it, expect } from 'vitest';
import {
  CLAVES_VARIABLES,
  GRUPOS_VARIABLE,
  VARIABLES,
  variablesDelGrupo,
} from '@/lib/antropometria/variables';
import {
  calcularEstadisticas,
  estadisticaSerie,
  medianasDe,
  variablesFaltantes,
} from '@/lib/antropometria/series';
import { ErrorAntropometria } from '@/lib/antropometria/errores';
import { PHANTOM } from '@/lib/antropometria/datos/phantom';
import { calcularPhantom, factorPhantom } from '@/lib/antropometria/phantom';
import { SERIES_JULIETA } from '../fixtures/antropometria';

describe('variables obligatorias', () => {
  it('son 25, con claves únicas, agrupadas 3 / 6 / 10 / 6', () => {
    expect(VARIABLES).toHaveLength(25);
    expect(new Set(CLAVES_VARIABLES).size).toBe(25);
    expect(GRUPOS_VARIABLE.map((g) => variablesDelGrupo(g).length)).toEqual([3, 6, 10, 6]);
  });

  it('cada variable apunta a una fila distinta de la planilla', () => {
    expect(new Set(VARIABLES.map((v) => v.filaProc)).size).toBe(25);
    expect(new Set(VARIABLES.map((v) => v.filaPresentacion)).size).toBe(25);
  });
});

describe('estadisticaSerie — Proc datos brutos!G:I', () => {
  it('2 series: mediana = promedio, DE muestral y % de error (peso, fila 6)', () => {
    const e = estadisticaSerie([53.1, 53.0]);
    expect(e.mediana).toBeCloseTo(53.05, 6);
    expect(e.desvioEstandar).toBeCloseTo(0.0707107, 6); // planilla: 0,071 (ROUND a 3)
    expect(e.errorPorcentual).toBeCloseTo(0.13328, 4); // planilla: 0,134 (ROUND a 3 del DE)
  });

  it('3 series: la mediana es el valor central, sin importar el orden de carga', () => {
    const e = estadisticaSerie([11, 10, 10]);
    expect(e.mediana).toBe(10);
    expect(e.desvioEstandar).toBeCloseTo(0.57735, 5); // planilla (3 series 10/11/10): 0,577
    expect(e.errorPorcentual).toBeCloseTo(5.7735, 4); // planilla: 5,77
    expect(e.valores).toEqual([11, 10, 10]);
  });

  it('series idénticas → desvío y error exactamente 0', () => {
    expect(estadisticaSerie([163.5, 163.5])).toMatchObject({ desvioEstandar: 0, errorPorcentual: 0 });
    const tres = estadisticaSerie([0.1, 0.1, 0.1]);
    expect(tres.desvioEstandar).toBe(0);
  });

  it('el % de error es informativo: no hay umbral ni alertas, aunque sea enorme', () => {
    const e = estadisticaSerie([5, 40]);
    expect(e.errorPorcentual).toBeGreaterThan(100);
    expect(Object.keys(e).sort()).toEqual(['desvioEstandar', 'errorPorcentual', 'mediana', 'valores']);
  });

  it('una celda vacía o 0 no cuenta como serie (igual que la planilla)', () => {
    expect(estadisticaSerie([12, null, 13]).mediana).toBe(12.5);
    expect(estadisticaSerie([12, 0, 13, undefined]).valores).toEqual([12, 13]);
  });

  it('rechaza 1 serie y más de 3 con SERIE_INVALIDA', () => {
    for (const serie of [[53.1], [53.1, null], [1, 2, 3, 4], []]) {
      expect(() => estadisticaSerie(serie, 'peso')).toThrowError(ErrorAntropometria);
    }
    try {
      estadisticaSerie([53.1], 'peso');
    } catch (e) {
      expect((e as ErrorAntropometria).codigo).toBe('SERIE_INVALIDA');
      expect((e as ErrorAntropometria).detalle).toMatchObject({ variable: 'peso', cantidad: 1 });
    }
  });
});

describe('completitud', () => {
  it('sin datos faltan las 25; con la fixture completa no falta ninguna', () => {
    expect(variablesFaltantes({})).toHaveLength(25);
    expect(variablesFaltantes(SERIES_JULIETA)).toEqual([]);
  });

  it('devuelve exactamente cuáles faltan (ausente, con 1 sola serie o vacía)', () => {
    const { pliegue_abdominal: _omitida, ...resto } = SERIES_JULIETA;
    const series = { ...resto, perimetro_cabeza: [53.5], diametro_humeral: [null, undefined] };
    expect(variablesFaltantes(series)).toEqual([
      'diametro_humeral',
      'perimetro_cabeza',
      'pliegue_abdominal',
    ]);
  });

  it('calcularEstadisticas lista las faltantes en el error', () => {
    try {
      calcularEstadisticas({ peso: [53.1, 53.0] });
      expect.unreachable();
    } catch (e) {
      expect((e as ErrorAntropometria).codigo).toBe('VARIABLES_FALTANTES');
      expect((e as ErrorAntropometria).detalle?.faltantes).toHaveLength(24);
    }
  });

  it('medianasDe arma el valor usado por variable', () => {
    const m = medianasDe(calcularEstadisticas(SERIES_JULIETA));
    expect(m.peso).toBeCloseTo(53.05, 6);
    expect(m.perimetro_torax_mesoesternal).toBe(77.5);
  });
});

describe('Phantom — Presentación!F10:K37', () => {
  const medianas = medianasDe(calcularEstadisticas(SERIES_JULIETA));
  const phantom = calcularPhantom(medianas);

  it('factor 170,18 / talla = 1,0409 (Presentación!C199)', () => {
    expect(factorPhantom(163.5)).toBeCloseTo(1.0409, 4);
    expect(factorPhantom(163.5, 3)).toBeCloseTo(1.0409 ** 3, 3);
  });

  it('peso: ajustado con d = 3 (F10) y Z (K10)', () => {
    expect(phantom.peso.ajustado).toBeCloseTo(59.8216, 3);
    expect(phantom.peso.z).toBeCloseTo(-0.5533, 3);
  });

  it.each([
    ['talla_sentado', -0.21],
    ['diametro_biacromial', -0.43],
    ['perimetro_cabeza', -0.15],
    ['perimetro_antebrazo', -1.18],
    ['pliegue_triceps', -0.53],
    ['pliegue_subescapular', -1.96],
    ['pliegue_supraespinal', -1.82],
    ['pliegue_abdominal', -1.66],
  ] as const)('Z de %s ≈ %f', (clave, esperado) => {
    expect(phantom[clave].z).toBeCloseTo(esperado, 2);
  });

  it('la talla no tiene Z (la planilla no lo calcula)', () => {
    expect('talla' in phantom).toBe(false);
    expect(Object.keys(phantom)).toHaveLength(24);
  });

  it('DIFERENCIA INTENCIONAL: el Z del perímetro de muslo medial usa el valor ajustado', () => {
    // Presentación!K29 de la planilla hace (E29-53.2)/4.56 con el valor SIN ajustar → −1,14 (error).
    const { p, s } = PHANTOM.perimetro_muslo_medial;
    const zPlanilla = (medianas.perimetro_muslo_medial - p) / s;
    expect(zPlanilla).toBeCloseTo(-1.14, 2);

    // Corregido: (F29-53.2)/4.56 con F29 = E29 × 170,18 / talla.
    expect(phantom.perimetro_muslo_medial.ajustado).toBeCloseTo(49.9611, 3);
    expect(phantom.perimetro_muslo_medial.z).toBeCloseTo(-0.71, 2);
  });

  it('el pliegue de muslo medial (fila 36) ya estaba bien en la planilla', () => {
    expect(phantom.pliegue_muslo_medial.z).toBeCloseTo(-0.3049, 3);
  });
});
