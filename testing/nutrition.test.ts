import { describe, expect, it } from 'vitest';
import { normalizarTipoIngesta } from '@/lib/nutrition';

describe('normalizarTipoIngesta', () => {
  it.each([
    ['desayuno', 'desayuno'],
    ['Desayuno', 'desayuno'],
    ['Colación', 'colacion'],
    [' CENA ', 'cena'],
  ])('%s → %s', (raw, esperado) => {
    expect(normalizarTipoIngesta(raw)).toBe(esperado);
  });

  it('devuelve null si no es un tipo válido', () => {
    expect(normalizarTipoIngesta('brunch')).toBeNull();
    expect(normalizarTipoIngesta('')).toBeNull();
  });
});
