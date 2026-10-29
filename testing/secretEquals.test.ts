import { describe, expect, it } from 'vitest';
import { secretEquals } from '@/lib/secretEquals';

describe('secretEquals', () => {
  it('true para secretos idénticos', () => {
    expect(secretEquals('abc123', 'abc123')).toBe(true);
  });

  it.each([
    ['distinto último carácter', 'abc123', 'abc124'],
    ['prefijo del secreto', 'abc', 'abc123'],
    ['secreto más largo', 'abc123x', 'abc123'],
    ['mayúsculas', 'ABC123', 'abc123'],
  ])('false: %s', (_caso, a, b) => {
    expect(secretEquals(a, b)).toBe(false);
  });

  it.each([
    ['vacío vs vacío', '', ''],
    ['undefined vs undefined', undefined, undefined],
    ['null vs secreto', null, 'abc'],
    ['secreto vs vacío', 'abc', ''],
  ])('false: nunca coincide un secreto ausente (%s)', (_caso, a, b) => {
    expect(secretEquals(a, b)).toBe(false);
  });

  it('soporta caracteres no ASCII', () => {
    expect(secretEquals('clave-ñandú-✓', 'clave-ñandú-✓')).toBe(true);
    expect(secretEquals('clave-ñandú-✓', 'clave-nandu-✓')).toBe(false);
  });
});
