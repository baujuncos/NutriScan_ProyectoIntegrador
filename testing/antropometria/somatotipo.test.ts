import { describe, it, expect } from 'vitest';
import {
  calcularSomatotipo,
  coordenadasSomatocarta,
  deportesDisponibles,
  ectomorfia,
  somatotipoDeDeporte,
} from '@/lib/antropometria/somatotipo';
import { DEPORTE_NINGUNO, DEPORTES_FEMENINO, DEPORTES_MASCULINO } from '@/lib/antropometria/datos/deportes';
import { calcularEstadisticas, medianasDe } from '@/lib/antropometria/series';
import { ErrorAntropometria } from '@/lib/antropometria/errores';
import { SERIES_JULIETA } from '../fixtures/antropometria';
import { EXCEL_HOMBRE, SERIES_HOMBRE } from '../fixtures/antropometriaExcelHombre';

describe('Heath-Carter — paciente de ejemplo (Presentación!C201:K227)', () => {
  const s = calcularSomatotipo(medianasDe(calcularEstadisticas(SERIES_JULIETA)));

  it('endomorfia 2,796; mesomorfia 3,624; ectomorfia 3,272', () => {
    expect(s.endomorfia).toBeCloseTo(2.796, 3);
    expect(s.mesomorfia).toBeCloseTo(3.624, 3);
    expect(s.ectomorfia).toBeCloseTo(3.272, 3);
  });

  it('somatocarta: X = ecto − endo = 0,476 e Y = 2·meso − (endo + ecto) = 1,18', () => {
    expect(s.x).toBeCloseTo(0.476, 3);
    expect(s.y).toBeCloseTo(1.18, 2);
  });

  it('HWR = talla / peso^0,33333 (Presentación!I199)', () => {
    expect(s.hwr).toBeCloseTo(43.5139, 3);
  });

  it('usa la ectomorfia de Presentación (3,272), no la de Proc datos brutos (3,276)', () => {
    expect(Math.abs(s.ectomorfia - 3.276)).toBeGreaterThan(0.003);
  });
});

describe('ectomorfia — regla completa por tramos de HWR', () => {
  it('HWR ≤ 38,25 → 0,1 (incluido el borde)', () => {
    expect(ectomorfia(38.25)).toBe(0.1);
    expect(ectomorfia(30)).toBe(0.1);
  });

  it('38,25 < HWR < 40,75 → 0,463 × HWR − 17,63', () => {
    expect(ectomorfia(40)).toBeCloseTo(0.463 * 40 - 17.63, 10);
    expect(ectomorfia(38.26)).toBeCloseTo(0.463 * 38.26 - 17.63, 10);
  });

  it('HWR ≥ 40,75 → 0,732 × HWR − 28,58 (incluido el borde)', () => {
    expect(ectomorfia(40.75)).toBeCloseTo(0.732 * 40.75 - 28.58, 10);
    expect(ectomorfia(45)).toBeCloseTo(0.732 * 45 - 28.58, 10);
  });
});

describe('Heath-Carter — caso masculino cruzado con la planilla recalculada', () => {
  const s = calcularSomatotipo(medianasDe(calcularEstadisticas(SERIES_HOMBRE)));
  const x = EXCEL_HOMBRE.somatotipo;

  it('coincide con Presentación!C201, F201, I201, K226 y K227 (HWR en el tramo intermedio)', () => {
    expect(s.hwr).toBeCloseTo(x.hwr, 6);
    expect(s.endomorfia).toBeCloseTo(x.endo, 6);
    expect(s.mesomorfia).toBeCloseTo(x.meso, 6);
    expect(s.ectomorfia).toBeCloseTo(x.ecto, 6);
    expect(s.x).toBeCloseTo(x.x, 6);
    expect(s.y).toBeCloseTo(x.y, 6);
  });
});

describe('comparación con el deporte', () => {
  it('Voleibol mujer: 3,0 – 3,5 – 3,5 → x 0,5; y 0,5 (fila real de la tabla)', () => {
    const d = somatotipoDeDeporte('voleibol', 'F');
    expect(d).toMatchObject({ endomorfia: 3, mesomorfia: 3.5, ectomorfia: 3.5 });
    expect(d?.x).toBeCloseTo(0.5, 10);
    expect(d?.y).toBeCloseTo(0.5, 10);
  });

  it('HALLAZGO: la planilla muestra 2,9–3,7–3,2 (x 0,3; y 1,3) para Voleibol mujer, pero esos son los valores de "NATACIÓN Freestyle 200+400 m"', () => {
    // Presentación!G232:I232 hace VLOOKUP aproximado sobre depf = V14:Y35 (rango truncado: Voleibol está
    // en V51) y devuelve la última fila del rango, V35. Este módulo no replica ese error.
    const natacion = somatotipoDeDeporte('natacion_freestyle_200_400_m', 'F');
    expect(natacion).toMatchObject({ endomorfia: 2.9, mesomorfia: 3.7, ectomorfia: 3.2 });
    expect(natacion?.x).toBeCloseTo(0.3, 10);
    expect(natacion?.y).toBeCloseTo(1.3, 10);
  });

  it('hombres: Voleibol 2,0 – 3,8 – 3,7', () => {
    expect(somatotipoDeDeporte('voleibol', 'M')).toMatchObject({ endomorfia: 2, mesomorfia: 3.8, ectomorfia: 3.7 });
  });

  it('"ninguno", null y undefined → sin comparación', () => {
    expect(somatotipoDeDeporte(DEPORTE_NINGUNO, 'F')).toBeNull();
    expect(somatotipoDeDeporte(null, 'M')).toBeNull();
    expect(somatotipoDeDeporte(undefined, 'M')).toBeNull();
  });

  it('un deporte que no existe para ese sexo es un error claro', () => {
    expect(() => somatotipoDeDeporte('esgrima', 'M')).toThrowError(ErrorAntropometria);
    expect(() => somatotipoDeDeporte('inexistente', 'F')).toThrowError(/Deporte desconocido/);
  });

  it('las tablas tienen ids únicos y valores plausibles de somatotipo', () => {
    for (const tabla of [DEPORTES_FEMENINO, DEPORTES_MASCULINO]) {
      expect(new Set(tabla.map((d) => d.id)).size).toBe(tabla.length);
      for (const d of tabla) {
        for (const v of [d.endomorfia, d.mesomorfia, d.ectomorfia]) expect(v).toBeGreaterThan(0);
        expect(d.celdas).toMatch(/^Proc datos brutos!/);
      }
    }
    expect(deportesDisponibles('F')).toHaveLength(38);
    expect(deportesDisponibles('M')).toHaveLength(51);
  });

  it('las coordenadas del deporte salen de la misma fórmula que las del paciente', () => {
    expect(coordenadasSomatocarta(2, 5, 3)).toEqual({ x: 1, y: 5 });
  });
});
