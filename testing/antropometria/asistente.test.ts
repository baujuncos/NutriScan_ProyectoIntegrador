import { describe, expect, it } from 'vitest';
import {
  campoInvalido,
  estadoVariable,
  PASOS,
  progresoPorGrupo,
  seriesDesdeTexto,
  textoDesdeSeries,
  textoVacio,
  TOTAL_VARIABLES,
  totalCompletas,
} from '@/lib/researcher/antropometria/asistente';
import { variablesFaltantes } from '@/lib/antropometria';
import { SERIES_JULIETA } from '../fixtures/antropometria';

describe('asistente de carga: texto ↔ series', () => {
  it('son 25 variables y 5 pasos (básicos, diámetros, perímetros, pliegues, revisión)', () => {
    expect(TOTAL_VARIABLES).toBe(25);
    expect(PASOS.map((p) => p.id)).toEqual(['basicas', 'diametros', 'perimetros', 'pliegues', 'revision']);
  });

  it('ida y vuelta con la paciente ficticia: las series se conservan y quedan las 25', () => {
    const texto = textoDesdeSeries(SERIES_JULIETA);
    expect(texto.perimetro_cintura).toEqual(['64', '64', '']);
    expect(texto.talla).toEqual(['163,5', '163,5', '']);
    const series = seriesDesdeTexto(texto);
    expect(series.talla).toEqual([163.5, 163.5, null]);
    expect(variablesFaltantes(series)).toEqual([]);
  });

  it('acepta coma y punto, y descarta basura sin romper', () => {
    const texto = textoVacio();
    texto.peso = ['53,1', '53.0', 'abc'];
    expect(seriesDesdeTexto(texto).peso).toEqual([53.1, 53, null]);
  });

  it('no incluye variables sin ningún dato', () => {
    expect(seriesDesdeTexto(textoVacio())).toEqual({});
  });

  it('campoInvalido marca solo lo escrito que no es número', () => {
    expect(campoInvalido('')).toBe(false);
    expect(campoInvalido('12,5')).toBe(false);
    expect(campoInvalido('12,5x')).toBe(true);
  });
});

describe('estado de cada variable (mediana, desvío y % de error en vivo)', () => {
  it('2 series completan la variable; calcula mediana, desvío y error', () => {
    const e = estadoVariable(['12', '13', ''], 'pliegue_triceps');
    expect(e.completa).toBe(true);
    expect(e.estadistica?.mediana).toBeCloseTo(12.5, 6);
    expect(e.estadistica?.desvioEstandar).toBeCloseTo(0.7071, 4);
    expect(e.estadistica?.errorPorcentual).toBeCloseTo(5.657, 3);
  });

  it('una sola serie o ninguna: incompleta, sin estadística', () => {
    expect(estadoVariable(['12', '', ''])).toEqual({ completa: false, estadistica: null });
    expect(estadoVariable(['', '', ''])).toEqual({ completa: false, estadistica: null });
  });

  it('un % de error alto no bloquea: sigue completa (solo informativo)', () => {
    const e = estadoVariable(['10', '30', ''], 'pliegue_triceps');
    expect(e.completa).toBe(true);
    expect(e.estadistica!.errorPorcentual).toBeGreaterThan(50);
  });

  it('3 series también valen', () => {
    expect(estadoVariable(['10', '11', '12']).estadistica?.mediana).toBe(11);
  });
});

describe('progreso 25/25 por grupo', () => {
  it('vacío: 0 de 25 y todas faltan', () => {
    const p = progresoPorGrupo(textoVacio());
    expect(totalCompletas(p)).toBe(0);
    expect(p.map((g) => g.total)).toEqual([3, 6, 10, 6]);
  });

  it('completo: 25 de 25 y sin faltantes', () => {
    const p = progresoPorGrupo(textoDesdeSeries(SERIES_JULIETA));
    expect(totalCompletas(p)).toBe(25);
    expect(p.every((g) => g.faltantes.length === 0)).toBe(true);
  });

  it('lista las que faltan con su nombre, en el orden del protocolo', () => {
    const texto = textoDesdeSeries(SERIES_JULIETA);
    texto.diametro_humeral = ['6,4', '', ''];
    texto.pliegue_triceps = ['', '', ''];
    const p = progresoPorGrupo(texto);
    expect(totalCompletas(p)).toBe(23);
    expect(p.find((g) => g.grupo === 'diametros')!.faltantes).toEqual([{ clave: 'diametro_humeral', etiqueta: 'Humeral (biepicondilar)' }]);
    expect(p.find((g) => g.grupo === 'pliegues')!.faltantes.map((f) => f.etiqueta)).toEqual(['Tríceps']);
  });
});
