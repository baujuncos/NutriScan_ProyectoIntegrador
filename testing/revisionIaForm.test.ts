/**
 * NUT-149 — Formulario "Tu corrección": las combinaciones de mantener / ingresar, las
 * validaciones, el ítem quitado y qué se guarda en cada caso.
 */
import { describe, expect, it } from 'vitest';
import {
  FORM_INICIAL,
  PESO_MAXIMO_G,
  diferencia,
  normalizarNombre,
  parsearGramos,
  resultadoCorreccion,
  textoDiferencia,
  validarCorreccion,
  type ContextoForm,
  type EstadoForm,
} from '@/lib/revisionIaForm';
import { MAX_CANTIDAD } from '@/lib/nutrition';

const CTX: ContextoForm = { quitado: false, nombreUsuario: 'Empanada (pollo)', gramosUsuario: 110, gramosIa: 100 };
const QUITADO: ContextoForm = { quitado: true, nombreUsuario: null, gramosUsuario: null, gramosIa: 15 };
const form = (over: Partial<EstadoForm> = {}): EstadoForm => ({ ...FORM_INICIAL, ...over });

describe('valores por defecto', () => {
  it('"Mantener" en nombre y peso, y el formulario ya es válido', () => {
    expect(FORM_INICIAL).toMatchObject({ modoNombre: 'mantener', modoPeso: 'mantener' });
    expect(validarCorreccion(FORM_INICIAL, CTX)).toEqual({ valido: true, errores: {} });
  });

  it('el peso máximo es el mismo tope que usa el resto de la app', () => {
    expect(PESO_MAXIMO_G).toBe(MAX_CANTIDAD);
  });
});

describe('las 4 combinaciones de mantener / ingresar, y qué se guarda (siempre los valores resultantes)', () => {
  it('mantener nombre + mantener peso → guarda los valores del deportista', () => {
    expect(resultadoCorreccion(form(), CTX)).toEqual({ accion: 'corregir', alimento: 'Empanada (pollo)', gramos: 110 });
  });

  it('mantener nombre + ingresar peso → nombre del deportista y peso nuevo', () => {
    expect(resultadoCorreccion(form({ modoPeso: 'otro', pesoOtro: '150' }), CTX)).toEqual({ accion: 'corregir', alimento: 'Empanada (pollo)', gramos: 150 });
  });

  it('ingresar nombre + mantener peso → nombre nuevo (normalizado) y peso del deportista', () => {
    expect(resultadoCorreccion(form({ modoNombre: 'otro', nombreOtro: '  Empanada   de carne ' }), CTX)).toEqual({
      accion: 'corregir',
      alimento: 'Empanada de carne',
      gramos: 110,
    });
  });

  it('ingresar nombre + ingresar peso → los dos nuevos', () => {
    expect(resultadoCorreccion(form({ modoNombre: 'otro', nombreOtro: 'Tarta', modoPeso: 'otro', pesoOtro: '200,5' }), CTX)).toEqual({
      accion: 'corregir',
      alimento: 'Tarta',
      gramos: 200.5,
    });
  });

  it('lo que se tipeó en un campo en "Ingresar otro" se ignora si se vuelve a "Mantener"', () => {
    expect(resultadoCorreccion(form({ modoNombre: 'mantener', nombreOtro: 'Otro', modoPeso: 'mantener', pesoOtro: '999' }), CTX)).toEqual({
      accion: 'corregir',
      alimento: 'Empanada (pollo)',
      gramos: 110,
    });
  });
});

describe('validaciones', () => {
  it('"Ingresar otro" pide un nombre de al menos 2 letras', () => {
    for (const nombreOtro of ['', ' ', 'a', '   x  ']) {
      const v = validarCorreccion(form({ modoNombre: 'otro', nombreOtro }), CTX);
      expect(v.valido).toBe(false);
      expect(v.errores.nombre).toMatch(/al menos 2 letras/);
    }
    expect(validarCorreccion(form({ modoNombre: 'otro', nombreOtro: 'Pan' }), CTX).valido).toBe(true);
  });

  it('el nombre tiene un máximo', () => {
    expect(validarCorreccion(form({ modoNombre: 'otro', nombreOtro: 'x'.repeat(201) }), CTX).errores.nombre).toMatch(/muy largo/);
  });

  it('"Ingresar otro" pide un peso mayor a 0 y hasta el máximo', () => {
    for (const pesoOtro of ['', '0', '-5', 'abc']) {
      expect(validarCorreccion(form({ modoPeso: 'otro', pesoOtro }), CTX).errores.peso).toMatch(/mayor a 0/);
    }
    expect(validarCorreccion(form({ modoPeso: 'otro', pesoOtro: String(PESO_MAXIMO_G + 1) }), CTX).errores.peso).toMatch(/máximo/);
    expect(validarCorreccion(form({ modoPeso: 'otro', pesoOtro: String(PESO_MAXIMO_G) }), CTX).valido).toBe(true);
  });

  it('un formulario inválido no devuelve nada para guardar', () => {
    expect(resultadoCorreccion(form({ modoPeso: 'otro', pesoOtro: '' }), CTX)).toBeNull();
  });

  it('no se puede "mantener" un valor que el deportista no tiene', () => {
    expect(validarCorreccion(form(), { ...CTX, gramosUsuario: null }).errores.peso).toBeDefined();
    expect(validarCorreccion(form(), { ...CTX, nombreUsuario: null }).errores.nombre).toBeDefined();
  });

  it('parsea gramos con coma o punto y rechaza lo que no es número', () => {
    expect(parsearGramos('12,5')).toBe(12.5);
    expect(parsearGramos(' 7 ')).toBe(7);
    expect(parsearGramos('')).toBeNull();
    expect(parsearGramos('doce')).toBeNull();
  });

  it('normaliza el nombre (espacios de más)', () => {
    expect(normalizarNombre('  Pollo   al    horno ')).toBe('Pollo al horno');
  });
});

describe('ítem quitado por el deportista', () => {
  it('por defecto "No estaba: mantener quitado": es válido y equivale a Confirmar (nada que guardar)', () => {
    expect(validarCorreccion(FORM_INICIAL, QUITADO).valido).toBe(true);
    expect(resultadoCorreccion(FORM_INICIAL, QUITADO)).toEqual({ accion: 'confirmar' });
  });

  it('"Estaba en el plato: restaurar" pide nombre Y peso', () => {
    const f = form({ modoQuitado: 'restaurar' });
    const v = validarCorreccion(f, QUITADO);
    expect(v.valido).toBe(false);
    expect(Object.keys(v.errores).sort()).toEqual(['nombre', 'peso']);
    expect(validarCorreccion({ ...f, nombreOtro: 'Perejil' }, QUITADO).errores).toEqual({ peso: expect.any(String) });
  });

  it('restaurar con nombre y peso válidos guarda ambos', () => {
    expect(resultadoCorreccion(form({ modoQuitado: 'restaurar', nombreOtro: ' Perejil ', pesoOtro: '12' }), QUITADO)).toEqual({
      accion: 'corregir',
      alimento: 'Perejil',
      gramos: 12,
    });
  });

  it('restaurar respeta el peso máximo', () => {
    expect(validarCorreccion(form({ modoQuitado: 'restaurar', nombreOtro: 'Perejil', pesoOtro: String(PESO_MAXIMO_G + 1) }), QUITADO).valido).toBe(false);
  });
});

describe('diferencia en vivo', () => {
  it('en gramos y en % de la referencia', () => {
    expect(diferencia(150, 100)).toEqual({ gramos: 50, porcentaje: 50 });
    expect(diferencia(90, 120)).toEqual({ gramos: -30, porcentaje: -25 });
    expect(diferencia(10, 0)).toEqual({ gramos: 10, porcentaje: null });
  });

  it('se muestra con signo, redondeado, y "sin diferencia" si no cambió', () => {
    expect(textoDiferencia(diferencia(150, 100))).toBe('+50 g (+50 %)');
    expect(textoDiferencia(diferencia(90, 120))).toBe('−30 g (−25 %)');
    expect(textoDiferencia(diferencia(100, 100))).toBe('sin diferencia');
    expect(textoDiferencia(diferencia(10, 0))).toBe('+10 g');
  });
});
