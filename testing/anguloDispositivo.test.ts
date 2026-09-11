import { describe, it, expect } from 'vitest';
import {
  BETA_OBJETIVO_DEG,
  ELEVACION_OBJETIVO_DEG,
  TOLERANCIA_DEG,
  evaluarAngulo,
  mensajeAngulo,
} from '@/lib/anguloDispositivo';

describe('constantes de ángulo (NUT-163) — oblicuo, no cenital', () => {
  it('la elevación objetivo es oblicua (~35°), ni rasante ni cenital', () => {
    expect(ELEVACION_OBJETIVO_DEG).toBeGreaterThanOrEqual(25);
    expect(ELEVACION_OBJETIVO_DEG).toBeLessThanOrEqual(45);
  });

  it('el beta objetivo está lejos de 0° (cenital) y de 90° (vertical)', () => {
    expect(BETA_OBJETIVO_DEG).toBeGreaterThanOrEqual(45);
    expect(BETA_OBJETIVO_DEG).toBeLessThanOrEqual(65);
  });
});

describe('evaluarAngulo (NUT-163)', () => {
  it('marca "ok" en el objetivo y en los bordes de la tolerancia', () => {
    expect(evaluarAngulo(BETA_OBJETIVO_DEG).estado).toBe('ok');
    expect(evaluarAngulo(BETA_OBJETIVO_DEG - TOLERANCIA_DEG).estado).toBe('ok');
    expect(evaluarAngulo(BETA_OBJETIVO_DEG + TOLERANCIA_DEG).estado).toBe('ok');
    expect(evaluarAngulo(BETA_OBJETIVO_DEG).dentroDeRango).toBe(true);
  });

  it('celular demasiado plano (foto cenital) → "muy_cenital", fuera de rango', () => {
    const r = evaluarAngulo(BETA_OBJETIVO_DEG - TOLERANCIA_DEG - 8);
    expect(r.estado).toBe('muy_cenital');
    expect(r.dentroDeRango).toBe(false);
    expect(evaluarAngulo(3).estado).toBe('muy_cenital');
  });

  it('celular demasiado vertical (foto de costado) → "muy_rasante", fuera de rango', () => {
    const r = evaluarAngulo(BETA_OBJETIVO_DEG + TOLERANCIA_DEG + 8);
    expect(r.estado).toBe('muy_rasante');
    expect(r.dentroDeRango).toBe(false);
  });

  it('sin lectura (null / NaN) → "desconocido" y NO bloquea', () => {
    expect(evaluarAngulo(null)).toMatchObject({ estado: 'desconocido', dentroDeRango: true, beta: null });
    expect(evaluarAngulo(undefined).estado).toBe('desconocido');
    expect(evaluarAngulo(Number.NaN)).toMatchObject({ estado: 'desconocido', dentroDeRango: true });
  });
});

describe('mensajeAngulo', () => {
  it('devuelve texto para cada estado salvo "desconocido"', () => {
    expect(mensajeAngulo('ok')).not.toBe('');
    expect(mensajeAngulo('muy_cenital')).toMatch(/arriba/i);
    expect(mensajeAngulo('muy_rasante')).toMatch(/vertical|mesa/i);
    expect(mensajeAngulo('desconocido')).toBe('');
  });
});
