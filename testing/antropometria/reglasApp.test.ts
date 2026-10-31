/**
 * Reglas de negocio de Antropometrías (validadas por los nutricionistas):
 * solo mayores, hasta 12 mediciones, aviso de mismo mes, duplicados y decimales con coma.
 */
import { describe, expect, it } from 'vitest';
import {
  buscarDuplicado,
  edadEn,
  esMayorDeEdad,
  fechaLegible,
  medicionesDelMismoMes,
  mismoMes,
  normalizarNombre,
  parsearDecimal,
  puedeAgregarMedicion,
  textoDecimal,
} from '@/lib/researcher/antropometria/reglas';
import { MAX_MEDICIONES_POR_PACIENTE } from '@/types/antropometria';

const HOY = new Date(2026, 9, 24); // 24/10/2026

describe('mayoría de edad', () => {
  it('cumple 18 hoy → mayor; mañana → menor', () => {
    expect(esMayorDeEdad('2008-10-24', HOY)).toBe(true);
    expect(esMayorDeEdad('2008-10-25', HOY)).toBe(false);
  });

  it('17 años y fechas inválidas o futuras no son mayores', () => {
    expect(esMayorDeEdad('2009-01-01', HOY)).toBe(false);
    expect(esMayorDeEdad('no-es-fecha', HOY)).toBe(false);
    expect(esMayorDeEdad('2030-01-01', HOY)).toBe(false);
  });

  it('edadEn calcula años cumplidos (paciente ficticia, 24 años)', () => {
    expect(edadEn('2002-04-05', HOY)).toBe(24);
    expect(edadEn('xx', HOY)).toBeNull();
  });
});

describe('duplicados', () => {
  const existentes = [
    { id: '1', nombre: 'María José', apellido: 'Pérez', fechaNacimiento: '2000-01-02' },
    { id: '2', nombre: 'Ana', apellido: 'Gómez', fechaNacimiento: null },
  ];

  it('mismo nombre, apellido y nacimiento, sin importar tildes, mayúsculas ni espacios', () => {
    const d = buscarDuplicado({ nombre: ' maria  jose ', apellido: 'PEREZ', fechaNacimiento: '2000-01-02' }, existentes);
    expect(d?.id).toBe('1');
  });

  it('otra fecha de nacimiento → no es duplicado', () => {
    expect(buscarDuplicado({ nombre: 'María José', apellido: 'Pérez', fechaNacimiento: '2000-01-03' }, existentes)).toBeNull();
  });

  it('un deportista sin fecha cargada no se confunde con otro', () => {
    expect(buscarDuplicado({ nombre: 'Ana', apellido: 'Gómez', fechaNacimiento: '1999-05-05' }, existentes)).toBeNull();
  });

  it('normalizarNombre', () => {
    expect(normalizarNombre('  ÁÉÍ  Ñandú ')).toBe('aei nandu');
  });
});

describe('límite de 12 mediciones', () => {
  it('11 vigentes → puede; 12 → no puede', () => {
    expect(puedeAgregarMedicion(MAX_MEDICIONES_POR_PACIENTE - 1)).toBe(true);
    expect(puedeAgregarMedicion(MAX_MEDICIONES_POR_PACIENTE)).toBe(false);
  });
});

describe('una medición por mes (aviso, no bloqueo)', () => {
  const vigentes = [
    { id: 'a', fecha_medicion: '2026-09-30' },
    { id: 'b', fecha_medicion: '2026-10-03' },
  ];

  it('mismoMes compara año y mes', () => {
    expect(mismoMes('2026-10-24', '2026-10-01')).toBe(true);
    expect(mismoMes('2026-10-24', '2025-10-24')).toBe(false);
    expect(mismoMes('2026-10-24', '2026-09-24')).toBe(false);
  });

  it('encuentra las del mismo mes y excluye la que se edita', () => {
    expect(medicionesDelMismoMes('2026-10-24', vigentes).map((m) => m.id)).toEqual(['b']);
    expect(medicionesDelMismoMes('2026-10-24', vigentes, 'b')).toEqual([]);
  });
});

describe('decimales con coma', () => {
  it.each([
    ['12,5', 12.5],
    ['12.5', 12.5],
    [' 7 ', 7],
    ['0,3', 0.3],
  ])('parsea %s', (texto, esperado) => {
    expect(parsearDecimal(texto)).toBe(esperado);
  });

  it.each(['', ' ', 'abc', '1,2,3', '-4', '1e3', ',5', '5,'])('rechaza "%s"', (texto) => {
    expect(parsearDecimal(texto)).toBeNull();
  });

  it('textoDecimal muestra con coma y tolera vacíos', () => {
    expect(textoDecimal(12.5)).toBe('12,5');
    expect(textoDecimal(null)).toBe('');
    expect(textoDecimal(undefined)).toBe('');
  });

  it('fechaLegible', () => {
    expect(fechaLegible('2026-10-24')).toBe('24/10/2026');
  });
});
