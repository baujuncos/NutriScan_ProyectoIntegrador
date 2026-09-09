import { describe, it, expect } from 'vitest';
import {
  VAJILLA_TIPOS,
  VAJILLA_INFO,
  getDiametroDefault,
  getVajillaInfo,
  requiereDiametro,
  usaCalibracionPorFoto,
  validarDiametro,
  construirMetadataVajilla,
} from '@/lib/vajilla';

describe('catálogo de vajilla (NUT-158)', () => {
  it('expone exactamente los 4 tipos de la historia', () => {
    expect(VAJILLA_TIPOS).toEqual(['plato_playo', 'plato_postre', 'plato_hondo', 'otro']);
  });

  it('cada tipo tiene su info con label legible', () => {
    expect(getVajillaInfo('plato_playo').label).toBe('Plato playo');
    expect(getVajillaInfo('plato_postre').label).toBe('Plato de postre');
    expect(getVajillaInfo('plato_hondo').label).toBe('Plato hondo');
    expect(getVajillaInfo('otro').label).toBe('Otro');
    for (const tipo of VAJILLA_TIPOS) {
      expect(VAJILLA_INFO[tipo].tipo).toBe(tipo);
      expect(VAJILLA_INFO[tipo].descripcion.length).toBeGreaterThan(0);
    }
  });

  it('precarga un diámetro por defecto razonable para cada plato y null para "Otro"', () => {
    expect(getDiametroDefault('plato_playo')).toBe(26);
    expect(getDiametroDefault('plato_postre')).toBe(20);
    expect(getDiametroDefault('plato_hondo')).toBe(22);
    expect(getDiametroDefault('otro')).toBeNull();
  });

  it('el default de cada plato cae dentro de su propio rango', () => {
    for (const tipo of ['plato_playo', 'plato_postre', 'plato_hondo'] as const) {
      const info = getVajillaInfo(tipo);
      expect(info.diametroDefaultCm).toBeGreaterThanOrEqual(info.diametroMinCm!);
      expect(info.diametroDefaultCm).toBeLessThanOrEqual(info.diametroMaxCm!);
    }
  });
});

describe('requiereDiametro (NUT-159)', () => {
  it('pide diámetro para los platos y no para "Otro"', () => {
    expect(requiereDiametro('plato_playo')).toBe(true);
    expect(requiereDiametro('plato_postre')).toBe(true);
    expect(requiereDiametro('plato_hondo')).toBe(true);
    expect(requiereDiametro('otro')).toBe(false);
  });
});

describe('validarDiametro (NUT-159)', () => {
  it('acepta un valor dentro del rango', () => {
    expect(validarDiametro('plato_playo', 26)).toEqual({ valido: true });
    expect(validarDiametro('plato_playo', '25')).toEqual({ valido: true });
  });

  it('acepta los límites mínimo y máximo (inclusive)', () => {
    expect(validarDiametro('plato_playo', 22).valido).toBe(true);
    expect(validarDiametro('plato_playo', 32).valido).toBe(true);
  });

  it('rechaza valores fuera del rango con mensaje de rango', () => {
    const bajo = validarDiametro('plato_playo', 21);
    expect(bajo.valido).toBe(false);
    expect(bajo.error).toBe('El diámetro debe estar entre 22 y 32 cm');

    const alto = validarDiametro('plato_postre', 25);
    expect(alto.valido).toBe(false);
    expect(alto.error).toBe('El diámetro debe estar entre 16 y 24 cm');
  });

  it('rechaza negativos y cero', () => {
    expect(validarDiametro('plato_hondo', -5)).toEqual({
      valido: false,
      error: 'El diámetro debe ser mayor a 0',
    });
    expect(validarDiametro('plato_hondo', 0).valido).toBe(false);
  });

  it('rechaza valores no numéricos', () => {
    expect(validarDiametro('plato_playo', 'abc').valido).toBe(false);
    expect(validarDiametro('plato_playo', '').valido).toBe(false);
    expect(validarDiametro('plato_playo', Number.NaN)).toEqual({
      valido: false,
      error: 'Ingresá un número válido',
    });
  });

  it('para "Otro" no valida diámetro (no aplica)', () => {
    expect(validarDiametro('otro', 999)).toEqual({ valido: true });
    expect(validarDiametro('otro', '')).toEqual({ valido: true });
  });
});

describe('usaCalibracionPorFoto / redirección al elegir "Otro" (NUT-160)', () => {
  it('los platos usan calibración por foto', () => {
    expect(usaCalibracionPorFoto('plato_playo')).toBe(true);
    expect(usaCalibracionPorFoto('plato_postre')).toBe(true);
    expect(usaCalibracionPorFoto('plato_hondo')).toBe(true);
  });

  it('"Otro" NO usa calibración por foto (dispara la redirección a carga manual)', () => {
    expect(usaCalibracionPorFoto('otro')).toBe(false);
  });
});

describe('construirMetadataVajilla — metadato que viaja con la foto', () => {
  it('incluye tipo, diámetro y flag de calibración para un plato', () => {
    expect(construirMetadataVajilla('plato_playo', 26)).toEqual({
      tipo: 'plato_playo',
      diametroCm: 26,
      calibracionPorFoto: true,
    });
  });

  it('para "Otro" descarta el diámetro y marca calibracionPorFoto en false', () => {
    expect(construirMetadataVajilla('otro', 30)).toEqual({
      tipo: 'otro',
      diametroCm: null,
      calibracionPorFoto: false,
    });
  });
});
