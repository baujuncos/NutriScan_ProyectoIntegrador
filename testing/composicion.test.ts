/**
 * NUT-119 — Composición de un alimento pendiente a partir del catálogo.
 */
import { describe, expect, it } from 'vitest';
import {
  aComponentes,
  aEditables,
  composicionSchema,
  resumirComposicion,
  restaurarComposicion,
  type ComponenteComposicion,
  type ComponenteEditable,
} from '@/lib/composicion';

const ACEITE: ComponenteComposicion = {
  origen: 'catalogo', id: 31, nombre: 'Aceite de oliva', fuente: 'SARA2', gramos: 15,
  kcal_100g: 800, proteinas_100g: 0, grasas_100g: 90, carbs_100g: 0,
};
const VINAGRE: ComponenteComposicion = {
  origen: 'catalogo', id: 32, nombre: 'Vinagre', fuente: 'SARA2', gramos: 5,
  kcal_100g: 20, proteinas_100g: 0, grasas_100g: 0, carbs_100g: 4,
};

describe('resumirComposicion', () => {
  it('15 g de aceite + 5 g de vinagre en una foto de 20 g: valores por 100 g, suma completa', () => {
    const r = resumirComposicion([ACEITE, VINAGRE], 20);
    expect(r.macros).toEqual({ kcal_100g: 605, proteinas_100g: 0, grasas_100g: 67.5, carbs_100g: 1 });
    expect(r.suma).toBe(20);
    expect(r.diferencia).toBe(0);
    expect(r.estado).toBe('completa');
    expect(r.esVinculoPuro).toBe(false);
  });

  it('falta peso: informa cuántos gramos restan', () => {
    const r = resumirComposicion([{ ...ACEITE, gramos: 8 }], 20);
    expect(r.estado).toBe('falta');
    expect(r.diferencia).toBe(12);
    expect(r.esVinculoPuro).toBe(false);
  });

  it('sobra peso: diferencia negativa', () => {
    const r = resumirComposicion([{ ...ACEITE, gramos: 25 }], 20);
    expect(r.estado).toBe('sobra');
    expect(r.diferencia).toBe(-5);
  });

  it('tolera 0,5 g de diferencia y un solo ingrediente que iguala el peso es vínculo puro', () => {
    expect(resumirComposicion([{ ...ACEITE, gramos: 19.6 }], 20).estado).toBe('completa');
    expect(resumirComposicion([{ ...ACEITE, gramos: 20 }], 20).esVinculoPuro).toBe(true);
    expect(resumirComposicion([{ ...ACEITE, gramos: 10 }, { ...VINAGRE, gramos: 10 }], 20).esVinculoPuro).toBe(false);
  });

  it('sin ingredientes: estado propio y sin valores', () => {
    const r = resumirComposicion([], 20);
    expect(r).toMatchObject({ estado: 'sin_ingredientes', macros: null, suma: 0, esVinculoPuro: false });
  });

  it('peso de la foto 0: no calcula', () => {
    expect(resumirComposicion([ACEITE], 0).macros).toBeNull();
  });
});

describe('aEditables / aComponentes', () => {
  it('ida y vuelta conserva los datos', () => {
    const editables = aEditables([ACEITE]);
    expect(editables[0]).toMatchObject({ id: 31, nombre: 'Aceite de oliva', gramos: '15' });
    expect(aComponentes(editables)).toEqual({ componentes: [ACEITE], problemas: [] });
  });

  it('un ingrediente sin datos nutricionales se reporta por nombre y no se incluye', () => {
    const sinDatos: ComponenteEditable = { id: 9, nombre: 'Misterio', fuente: 'ANMAT', gramos: '10', macros: null };
    const r = aComponentes([...aEditables([ACEITE]), sinDatos]);
    expect(r.componentes).toHaveLength(1);
    expect(r.problemas).toEqual(['Misterio no tiene datos nutricionales en el catálogo']);
  });

  it.each([['', 'vacío'], ['0', 'cero'], ['-3', 'negativo'], ['abc', 'no numérico'], ['1001', 'sobre el tope']])(
    'gramos %j (%s) se reporta como problema',
    (gramos) => {
      const e = { ...aEditables([ACEITE])[0], gramos };
      const r = aComponentes([e]);
      expect(r.componentes).toHaveLength(0);
      expect(r.problemas).toHaveLength(1);
      expect(r.problemas[0]).toContain('Aceite de oliva');
    },
  );
});

describe('restaurarComposicion / composicionSchema', () => {
  const valida = { modo: 'catalogo', id_guardado_item: 412, gramos_foto: 20, componentes: [ACEITE] };

  it('restaura una composición guardada', () => {
    expect(restaurarComposicion(valida)).toEqual(valida);
  });

  it('modos ia/manual sin componentes y con campos null', () => {
    expect(restaurarComposicion({ modo: 'ia', componentes: [] })).toEqual({
      modo: 'ia', id_guardado_item: null, gramos_foto: null, componentes: [],
    });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['modo inválido', { ...valida, modo: 'otro' }],
    ['gramos cero', { ...valida, componentes: [{ ...ACEITE, gramos: 0 }] }],
    ['gramos sobre el tope', { ...valida, componentes: [{ ...ACEITE, gramos: 1001 }] }],
    ['macro negativo', { ...valida, componentes: [{ ...ACEITE, kcal_100g: -1 }] }],
    ['sin componentes (campo ausente)', { modo: 'catalogo' }],
  ])('%s → null (un borrador viejo o corrupto no rompe la pantalla)', (_n, raw) => {
    expect(restaurarComposicion(raw)).toBeNull();
  });

  it('el esquema acepta composiciones vacías de borrador en modo catálogo', () => {
    expect(composicionSchema.safeParse({ modo: 'catalogo', id_guardado_item: 1, gramos_foto: null, componentes: [] }).success).toBe(true);
  });
});
