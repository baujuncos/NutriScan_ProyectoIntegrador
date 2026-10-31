/**
 * Modelo de vista del informe, con la paciente ficticia "Julieta" (valores ancla de la planilla):
 * masa adiposa 17,64 kg · muscular 21,26 kg · somatotipo 2,8–3,6–3,3 · IMC 19,8.
 */
import { describe, expect, it } from 'vitest';
import { calcularAntropometria, compararMediciones } from '@/lib/antropometria';
import {
  barrasPhantom,
  ETIQUETA_MASA,
  filasMasas,
  filasProporcionalidad,
  nombreArchivoInforme,
} from '@/lib/researcher/antropometria/informe';
import { ENTRADA_JULIETA, SERIES_JULIETA } from '../fixtures/antropometria';

const actual = calcularAntropometria(ENTRADA_JULIETA);
const anterior = calcularAntropometria({
  ...ENTRADA_JULIETA,
  fechaMedicion: '2026-09-20',
  series: { ...SERIES_JULIETA, peso: [54.1, 54.1], pliegue_triceps: [14, 14] },
});

describe('valores ancla de la planilla en el resultado que muestra el informe', () => {
  it('masas, somatotipo e IMC', () => {
    expect(actual.masas.masas.adiposa.kg).toBeCloseTo(17.64, 2);
    expect(actual.masas.masas.muscular.kg).toBeCloseTo(21.26, 2);
    const { endomorfia, mesomorfia, ectomorfia } = actual.somatotipo;
    expect([endomorfia, mesomorfia, ectomorfia].map((v) => Math.round(v * 10) / 10)).toEqual([2.8, 3.6, 3.3]);
    expect(Math.round(actual.indices.imc * 10) / 10).toBe(19.8);
  });
});

describe('filasProporcionalidad', () => {
  it('trae las 25 variables en el orden del protocolo; la talla no tiene Phantom', () => {
    const filas = filasProporcionalidad(actual, null);
    expect(filas).toHaveLength(25);
    expect(filas[0].clave).toBe('peso');
    const talla = filas.find((f) => f.clave === 'talla')!;
    expect(talla.ajustado).toBeNull();
    expect(talla.z).toBeNull();
    expect(talla.medido).toBeCloseTo(163.5, 6);
    expect(filas.filter((f) => f.z === null)).toHaveLength(1);
  });

  it('sin medición anterior no hay diferencias', () => {
    expect(filasProporcionalidad(actual, null).every((f) => f.diferencia === null)).toBe(true);
  });

  it('con medición anterior: diferencia = actual − anterior de la mediana', () => {
    const filas = filasProporcionalidad(actual, compararMediciones(actual, anterior));
    expect(filas.find((f) => f.clave === 'peso')!.diferencia).toBeCloseTo(53.05 - 54.1, 6);
    expect(filas.find((f) => f.clave === 'pliegue_triceps')!.diferencia).toBeCloseTo(12.5 - 14, 6);
    expect(filas.find((f) => f.clave === 'talla')!.diferencia).toBeCloseTo(0, 6);
  });

  it('el % de error es informativo y viene de la estadística', () => {
    const t = filasProporcionalidad(actual, null).find((f) => f.clave === 'pliegue_triceps')!;
    expect(t.errorPorcentual).toBeCloseTo(5.657, 3);
  });
});

describe('filasMasas', () => {
  it('5 masas más el total, con etiquetas fijas', () => {
    const filas = filasMasas(actual, null);
    expect(filas.map((f) => f.etiqueta)).toEqual(['Masa adiposa', 'Masa muscular', 'Masa residual', 'Masa ósea', 'Masa de la piel', 'Total']);
    expect(filas[0].kg).toBeCloseTo(17.64, 2);
    expect(filas.at(-1)!.kg).toBeCloseTo(53.05, 1);
    expect(filas.at(-1)!.porcentaje).toBeNull();
  });

  it('los % suman 100 y la piel no tiene Z', () => {
    const filas = filasMasas(actual, null).filter((f) => f.clave !== 'total');
    expect(filas.reduce((a, f) => a + (f.porcentaje ?? 0), 0)).toBeCloseTo(100, 1);
    expect(filas.find((f) => f.clave === 'piel')!.z).toBeNull();
  });

  it('la diferencia con la anterior sale de compararMediciones', () => {
    const c = compararMediciones(actual, anterior);
    const filas = filasMasas(actual, c);
    expect(filas.find((f) => f.clave === 'adiposa')!.diferencia).toBeCloseTo(c.masas.adiposa, 10);
    expect(filas.find((f) => f.clave === 'total')!.diferencia).toBeCloseTo(c.masas.total, 10);
    expect(ETIQUETA_MASA.total).toBe('Total');
  });
});

describe('barrasPhantom', () => {
  it('agrupa los Z por grupo sin la talla', () => {
    const g = barrasPhantom(actual);
    expect(g.basicas.map((b) => b.clave)).toEqual(['peso', 'talla_sentado']);
    expect(g.diametros).toHaveLength(6);
    expect(g.perimetros).toHaveLength(10);
    expect(g.pliegues).toHaveLength(6);
    expect(g.pliegues[0].z).toBeCloseTo(actual.phantom.pliegue_triceps.z, 10);
  });
});

describe('nombreArchivoInforme', () => {
  it('apellido + nombre + fecha, sin tildes ni espacios', () => {
    expect(nombreArchivoInforme({ nombre: 'Julieta', apellido: 'Marchetti' }, '2026-10-24')).toBe('Marchetti_Julieta_2026-10-24');
    expect(nombreArchivoInforme({ nombre: 'María José', apellido: 'Pérez Ñandú' }, '2026-10-24')).toBe('Perez_Nandu_Maria_Jose_2026-10-24');
  });
  it('sin nombre no deja el archivo vacío', () => {
    expect(nombreArchivoInforme({ nombre: '', apellido: '' }, '2026-10-24')).toBe('Paciente_2026-10-24');
  });
});
