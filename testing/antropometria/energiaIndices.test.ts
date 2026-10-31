import { describe, it, expect } from 'vitest';
import {
  calcularEnergia,
  factorActividad,
  harrisBenedict,
  pesoIdeal,
} from '@/lib/antropometria/energia';
import { calcularIndices, riesgoIcc } from '@/lib/antropometria/indices';
import { calcularKerr } from '@/lib/antropometria/kerr';
import { calcularEstadisticas, medianasDe } from '@/lib/antropometria/series';
import { FACTORES_ACTIVIDAD, NIVELES_ACTIVIDAD } from '@/lib/antropometria/datos/actividad';
import { RIESGO_ICC } from '@/lib/antropometria/datos/riesgoIcc';
import {
  EDAD_PLANILLA_JULIETA,
  MASA_OSEA_REFERENCIA_JULIETA,
  SERIES_JULIETA,
} from '../fixtures/antropometria';
import { EXCEL_HOMBRE, SERIES_HOMBRE } from '../fixtures/antropometriaExcelHombre';

const medianasMujer = medianasDe(calcularEstadisticas(SERIES_JULIETA));
const medianasHombre = medianasDe(calcularEstadisticas(SERIES_HOMBRE));

describe('peso ideal y ajuste por sobrepeso — Presentación!B148:G151', () => {
  const e = calcularEnergia('F', 53.05, 163.5, EDAD_PLANILLA_JULIETA, 'moderada');

  it('peso ideal 57,474 kg y rango ±10 % (51,727 – 63,222)', () => {
    expect(e.pesoIdeal).toBeCloseTo(57.474, 3);
    expect(e.rangoPesoIdeal.minimo).toBeCloseTo(51.727, 3);
    expect(e.rangoPesoIdeal.maximo).toBeCloseTo(63.222, 3);
  });

  it('diferencia −4,424; ajuste del 25 % = −1,106; peso para cálculo 56,368', () => {
    expect(e.diferenciaConIdeal).toBeCloseTo(-4.424, 3);
    expect(e.ajusteSobrepeso).toBeCloseTo(-1.106, 3);
    expect(e.pesoParaCalculo).toBeCloseTo(56.368, 3);
  });

  it('hombres: talla² × 23; mujeres: talla² × 21,5', () => {
    expect(pesoIdeal(180, 'M')).toBeCloseTo(1.8 ** 2 * 23, 10);
    expect(pesoIdeal(180, 'F')).toBeCloseTo(1.8 ** 2 * 21.5, 10);
  });

  it('bajo el peso ideal, el metabolismo se calcula con el peso medido (G151)', () => {
    expect(e.pesoUsadoEnMetabolismo).toBe(53.05);
  });

  it('con sobrepeso usa el peso para cálculo (caso masculino cruzado con la planilla)', () => {
    const x = EXCEL_HOMBRE.energia;
    const h = calcularEnergia('M', medianasHombre.peso, medianasHombre.talla, EXCEL_HOMBRE.edadDecimal, 'moderada');
    expect(h.pesoIdeal).toBeCloseTo(x.pesoIdeal, 6);
    expect(h.diferenciaConIdeal).toBeCloseTo(x.diferencia, 6);
    expect(h.ajusteSobrepeso).toBeCloseTo(x.ajuste, 6);
    expect(h.pesoParaCalculo).toBeCloseTo(x.pesoCalculo, 6);
    expect(h.pesoUsadoEnMetabolismo).toBeCloseTo(x.pesoUsadoMB, 6);
    expect(h.metabolismoBasal).toBeCloseTo(x.mb, 4); // la fixture guarda 10 cifras significativas
    expect(h.rangoPesoIdeal.minimo).toBeCloseTo(x.rangoMin, 6);
    expect(h.rangoPesoIdeal.maximo).toBeCloseTo(x.rangoMax, 6);
  });

  it('con peso == peso ideal no hay ajuste', () => {
    const ideal = pesoIdeal(170, 'F');
    const r = calcularEnergia('F', ideal, 170, 30, 'sedentaria');
    expect(r.pesoUsadoEnMetabolismo).toBeCloseTo(ideal, 10);
  });
});

describe('metabolismo basal — Harris & Benedict (1919), Presentación!F151', () => {
  it('mujer: 655 + 9,6·kg + 1,7·cm − 4,7·años = 1326,86 kcal con la edad de la planilla', () => {
    expect(harrisBenedict('F', 53.05, 163.5, EDAD_PLANILLA_JULIETA)).toBeCloseTo(1326.86, 2);
  });

  it('hombre: 66 + 13,7·kg + 5·cm − 6,8·años', () => {
    expect(harrisBenedict('M', 70, 175, 25)).toBeCloseTo(66 + 13.7 * 70 + 5 * 175 - 6.8 * 25, 10);
  });

  it('la edad es decimal: medio año más resta 0,5 × 4,7 kcal', () => {
    const a = harrisBenedict('F', 60, 165, 25);
    const b = harrisBenedict('F', 60, 165, 25.5);
    expect(a - b).toBeCloseTo(2.35, 10);
  });
});

describe('factor de actividad (OMS, 1985) y gasto total', () => {
  it('mujeres: 1,3 / 1,5 / 1,6 / 1,9 / 2,2', () => {
    expect(NIVELES_ACTIVIDAD.map((n) => factorActividad('F', n))).toEqual([1.3, 1.5, 1.6, 1.9, 2.2]);
  });

  it('hombres (Proc datos brutos!S2:S6): 1,3 / 1,6 / 1,7 / 2,1 / 2,4', () => {
    expect(NIVELES_ACTIVIDAD.map((n) => factorActividad('M', n))).toEqual([1.3, 1.6, 1.7, 2.1, 2.4]);
  });

  it('los códigos son A–E en orden', () => {
    expect(NIVELES_ACTIVIDAD.map((n) => FACTORES_ACTIVIDAD[n].codigo)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('gasto total = MB × factor', () => {
    const e = calcularEnergia('F', 53.05, 163.5, EDAD_PLANILLA_JULIETA, 'intensa');
    expect(e.factorActividad).toBe(1.9);
    expect(e.gastoEnergeticoTotal).toBeCloseTo(1326.86 * 1.9, 1);
  });
});

describe('índices — paciente de ejemplo (Presentación!D173:F190)', () => {
  const kerr = calcularKerr(medianasMujer, 'F', 24, MASA_OSEA_REFERENCIA_JULIETA);
  const i = calcularIndices(medianasMujer, kerr, 'F', 24);

  it('IMC 19,845 y suma de 6 pliegues 78,5', () => {
    expect(i.imc).toBeCloseTo(19.845, 3);
    expect(i.sumaSeisPliegues).toBeCloseTo(78.5, 2);
  });

  it('ICC 0,659 con riesgo bajo (mujer 20-29)', () => {
    expect(i.icc).toBeCloseTo(0.659, 3);
    expect(i.riesgoIcc).toEqual({ nivel: 'bajo', banda: '20-29', bandaExtrapolada: false });
  });

  it('índice músculo/óseo 3,43 e índice adiposo/muscular 0,83', () => {
    expect(i.indiceMusculoOseo).toBeCloseTo(3.43, 2);
    expect(i.indiceAdiposoMuscular).toBeCloseTo(0.83, 2);
  });

  it('talla sentado / talla 0,523', () => {
    expect(i.tallaSentadoTalla).toBeCloseTo(0.523, 3);
  });

  it('BSA 1,565 m² y BSA/peso 294,97 cm²/kg', () => {
    expect(i.superficieCorporal).toBeCloseTo(1.565, 3);
    expect(i.superficieCorporalPorPeso).toBeCloseTo(294.97, 2);
  });
});

describe('índices — caso masculino cruzado con la planilla recalculada', () => {
  const x = EXCEL_HOMBRE.indices;
  const kerr = calcularKerr(medianasHombre, 'M', 26);
  const i = calcularIndices(medianasHombre, kerr, 'M', 26);

  it('coincide con Presentación!D173, F175, D178, I178, F181, D184, F187 y F190', () => {
    expect(i.icc).toBeCloseTo(x.icc, 6);
    expect(i.sumaSeisPliegues).toBeCloseTo(x.suma6Pliegues, 6);
    expect(i.indiceMusculoOseo).toBeCloseTo(x.musculoOseo, 6);
    expect(i.indiceAdiposoMuscular).toBeCloseTo(x.adiposoMuscular, 6);
    expect(i.imc).toBeCloseTo(x.imc, 6);
    expect(i.tallaSentadoTalla).toBeCloseTo(x.tallaSentadoTalla, 6);
    expect(i.superficieCorporal).toBeCloseTo(x.bsa, 6);
    expect(i.superficieCorporalPorPeso).toBeCloseTo(x.bsaPorPeso, 6);
  });
});

describe('riesgo ICC por edad y sexo — Presentación!C162:J171', () => {
  it.each([
    ['F', 25, 0.7, 'bajo'],
    ['F', 25, 0.77, 'moderado'],
    ['F', 25, 0.8, 'alto'],
    ['F', 25, 0.83, 'muy_alto'],
    ['M', 25, 0.82, 'bajo'],
    ['M', 25, 0.88, 'moderado'],
    ['M', 25, 0.94, 'alto'],
    ['M', 25, 0.95, 'muy_alto'],
    ['M', 45, 0.96, 'alto'],
    ['M', 45, 1.01, 'muy_alto'],
    ['F', 65, 0.9, 'alto'],
  ] as const)('%s, %i años, ICC %f → %s', (sexo, edad, icc, nivel) => {
    expect(riesgoIcc(icc, sexo, edad).nivel).toBe(nivel);
  });

  it('elige la banda de edad (los extremos incluyen el último año de cada banda)', () => {
    expect(riesgoIcc(0.8, 'F', 29).banda).toBe('20-29');
    expect(riesgoIcc(0.8, 'F', 30).banda).toBe('30-39');
    expect(riesgoIcc(0.8, 'F', 69).banda).toBe('60-69');
  });

  it('el ICC entre tramos (0,885) se ubica con 2 decimales: no queda sin clasificar', () => {
    expect(riesgoIcc(0.884, 'M', 25).nivel).toBe('moderado');
    expect(riesgoIcc(0.886, 'M', 25).nivel).toBe('alto');
  });

  it('18–19 y ≥ 70 años usan la banda más cercana y lo informan', () => {
    expect(riesgoIcc(0.8, 'F', 19)).toMatchObject({ banda: '20-29', bandaExtrapolada: true });
    expect(riesgoIcc(0.8, 'F', 72)).toMatchObject({ banda: '60-69', bandaExtrapolada: true });
  });

  it('las bandas de la tabla son crecientes y contiguas', () => {
    for (const bandas of Object.values(RIESGO_ICC)) {
      bandas.forEach((b, idx) => {
        expect(b.bajoMenorA).toBeLessThan(b.moderadoHasta);
        expect(b.moderadoHasta).toBeLessThan(b.altoHasta);
        if (idx > 0) expect(b.desde).toBe(bandas[idx - 1].hasta + 1);
      });
    }
  });
});
