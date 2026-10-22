/**
 * NUT-192 — ocultarMacros() pone en 0 los números para deportista_ucc pero NO
 * toca origen_macros: la pantalla lo necesita para mostrar "no disponible" a
 * quien sí ve macros, y no es un dato nutricional (no lleva ningún número).
 */
import { describe, expect, it } from 'vitest';
import { ocultarMacros } from '@/lib/ocultarMacros';

const ingesta = () => ({
  id_ingesta: 1,
  tipo: 'almuerzo',
  kcal_total: 100,
  proteinas_total_g: 5,
  grasas_total_g: 2,
  carbs_total_g: 10,
  items: [
    { id_item: 1, nombre_manual: 'Tarta casera', cantidad: 150, kcal: 0, proteinas_g: 0, grasas_g: 0, carbs_g: 0, origen_macros: 'pendiente' },
    { id_item: 2, nombre_manual: 'Flan', cantidad: 100, kcal: 180, proteinas_g: 3, grasas_g: 6, carbs_g: 27, origen_macros: 'validado' },
    { id_item: 3, nombre_manual: 'Pan', cantidad: 50, kcal: 130, proteinas_g: 4, grasas_g: 1, carbs_g: 25, origen_macros: null },
  ],
});

describe('ocultarMacros y origen_macros (NUT-192)', () => {
  it('conserva origen_macros de cada ítem al ocultar para un deportista', () => {
    const [res] = ocultarMacros([ingesta()], true);
    expect(res.items.map((i) => i.origen_macros)).toEqual(['pendiente', 'validado', null]);
  });

  it('un ítem VALIDADO no deja pasar ningún número a un deportista', () => {
    const [res] = ocultarMacros([ingesta()], true);
    const validado = res.items[1];
    expect([validado.kcal, validado.proteinas_g, validado.grasas_g, validado.carbs_g]).toEqual([0, 0, 0, 0]);
    expect([res.kcal_total, res.proteinas_total_g, res.grasas_total_g, res.carbs_total_g]).toEqual([0, 0, 0, 0]);
  });

  it('el resto de los datos del ítem (nombre, cantidad) queda intacto', () => {
    const [res] = ocultarMacros([ingesta()], true);
    expect(res.items[0]).toMatchObject({ nombre_manual: 'Tarta casera', cantidad: 150 });
  });

  it('sin ocultar (particular) devuelve los ítems tal cual, con su origen_macros', () => {
    const original = [ingesta()];
    expect(ocultarMacros(original, false)).toBe(original);
  });
});
