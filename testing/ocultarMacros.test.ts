/**
 * NUT-119 — Los macros no viajan al cliente de un deportista (payload RSC).
 */
import { describe, expect, it } from 'vitest';
import { ocultarMacros } from '@/lib/ocultarMacros';

const ingesta = () => ({
  id_ingesta: 1,
  tipo: 'almuerzo',
  kcal_total: 540,
  proteinas_total_g: 30,
  grasas_total_g: 20,
  carbs_total_g: 60,
  items: [
    {
      id_item: 1,
      nombre_manual: 'Flan',
      cantidad: 120,
      kcal: 180,
      proteinas_g: 3.6,
      grasas_g: 6,
      carbs_g: 27.6,
      alimentos_barcode: { nombre: 'Yogur', porcion: 100, kcal_100g: 60, proteinas_100g: 3, grasas_100g: 2, carbs_100g: 8 },
    },
    { id_item: 2, nombre_manual: 'Pan', cantidad: 50, kcal: 130, proteinas_g: 4, grasas_g: 1, carbs_g: 25, alimentos_barcode: null },
  ],
});

describe('ocultarMacros', () => {
  it('con ocultar=false devuelve lo mismo', () => {
    const data = [ingesta()];
    expect(ocultarMacros(data, false)).toBe(data);
  });

  it('con ocultar=true pone en 0 todo campo nutricional y conserva el resto', () => {
    const [r] = ocultarMacros([ingesta()], true);
    expect(r).toMatchObject({ id_ingesta: 1, tipo: 'almuerzo', kcal_total: 0, proteinas_total_g: 0, grasas_total_g: 0, carbs_total_g: 0 });
    expect(r.items[0]).toMatchObject({ nombre_manual: 'Flan', cantidad: 120, kcal: 0, proteinas_g: 0, grasas_g: 0, carbs_g: 0 });
    expect(r.items[0].alimentos_barcode).toMatchObject({ nombre: 'Yogur', porcion: 100, kcal_100g: 0, proteinas_100g: 0 });
    expect(r.items[1].alimentos_barcode).toBeNull();
  });

  it('no deja ningún número nutricional original en el JSON serializado', () => {
    const json = JSON.stringify(ocultarMacros([ingesta()], true));
    for (const valor of ['540', '180', '27.6', '130', '"kcal_100g":60']) expect(json).not.toContain(valor);
  });

  it('no muta la entrada', () => {
    const data = [ingesta()];
    ocultarMacros(data, true);
    expect(data[0].kcal_total).toBe(540);
  });
});
