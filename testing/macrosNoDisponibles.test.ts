import { describe, it, expect } from 'vitest';
import { contarSinMacros, macrosNoDisponibles } from '@/lib/macrosNoDisponibles';

describe('macrosNoDisponibles (NUT-192)', () => {
  it.each(['pendiente', 'descartado'])("origen_macros '%s': kcal y macros no disponibles", (origen) => {
    expect(macrosNoDisponibles({ origen_macros: origen })).toBe(true);
  });

  it.each(['validado', 'catalogo', 'estimado_ia'])("origen_macros '%s': sí hay dato", (origen) => {
    expect(macrosNoDisponibles({ origen_macros: origen })).toBe(false);
  });

  it('ítem legado (origen_macros null o ausente): se muestra como hasta ahora', () => {
    expect(macrosNoDisponibles({ origen_macros: null })).toBe(false);
    expect(macrosNoDisponibles({})).toBe(false);
  });

  it('el valor numérico nunca decide: lo decide origen_macros', () => {
    expect(macrosNoDisponibles({ origen_macros: 'pendiente', ...{ kcal: 0 } })).toBe(true);
    expect(macrosNoDisponibles({ origen_macros: 'validado', ...{ kcal: 0 } })).toBe(false);
  });

  it('contarSinMacros cuenta solo los no disponibles y tolera null/undefined', () => {
    expect(contarSinMacros([{ origen_macros: 'pendiente' }, { origen_macros: 'validado' }, { origen_macros: 'descartado' }, {}])).toBe(2);
    expect(contarSinMacros(null)).toBe(0);
    expect(contarSinMacros(undefined)).toBe(0);
  });
});
