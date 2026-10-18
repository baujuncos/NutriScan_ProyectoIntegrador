/**
 * NUT-119 — Formato de números del "Revisar alimento" (coma decimal, como en el diseño).
 */
import { describe, expect, it } from 'vitest';
import { fmt } from '@/lib/numeros';

describe('fmt', () => {
  it('usa coma decimal y hasta 1 decimal por defecto', () => {
    expect(fmt(513.5)).toBe('513,5');
    expect(fmt(6.04)).toBe('6');
    expect(fmt(0.1)).toBe('0,1');
  });
  it('los enteros no llevan decimales', () => {
    expect(fmt(605)).toBe('605');
    expect(fmt(0)).toBe('0');
  });
  it('acepta otra cantidad de decimales', () => {
    expect(fmt(1.2345, 2)).toBe('1,23');
  });
  it('un valor no finito se muestra como guion', () => {
    expect(fmt(Number.NaN)).toBe('—');
  });
});
