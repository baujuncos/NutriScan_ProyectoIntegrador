/**
 * NUT-149 — Qué ítems de Gemini entran a la cola de revisión. Datos de prueba, sin I/O.
 */
import { describe, it, expect } from 'vitest';
import {
  UMBRAL_CONFIANZA_BAJA,
  UMBRAL_DIFERENCIA_PESO,
  calcularRevisiones,
  type ItemPredicho,
} from '@/lib/revisionIa';

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';

const predicho = (over: Partial<ItemPredicho> = {}): ItemPredicho => ({
  item_uuid: U1,
  confidence: 0.9,
  estimated_weight_grams: 100,
  ...over,
});
const final = (over: Record<string, unknown> = {}) => ({
  sourceItemId: U1 as string | null,
  grams: 100,
  origin: 'ai' as const,
  ...over,
});

const motivosDe = (
  p: ItemPredicho[],
  f: ReturnType<typeof final>[],
  removidos: string[] = [],
  umbrales?: Parameters<typeof calcularRevisiones>[3],
) => calcularRevisiones(p, f, removidos, umbrales).map((r) => r.motivos);

describe('calcularRevisiones', () => {
  it('los umbrales por defecto son 0.6 y 20%', () => {
    expect(UMBRAL_CONFIANZA_BAJA).toBe(0.6);
    expect(UMBRAL_DIFERENCIA_PESO).toBe(0.2);
  });

  it('confianza baja entra aunque no haya corrección', () => {
    expect(motivosDe([predicho({ confidence: 0.5 })], [final()])).toEqual([['confianza_baja']]);
  });

  it('confianza justo en el umbral no entra', () => {
    expect(motivosDe([predicho({ confidence: 0.6 })], [final()])).toEqual([[]]);
  });

  it('cambio de alimento (replaced) entra siempre, aun con confianza alta y mismo peso', () => {
    expect(motivosDe([predicho()], [final({ origin: 'replaced' })])).toEqual([['cambio_alimento']]);
  });

  it('corrección de peso mayor al 20% entra', () => {
    expect(motivosDe([predicho()], [final({ grams: 121 })])).toEqual([['correccion_peso_grande']]);
    expect(motivosDe([predicho()], [final({ grams: 70 })])).toEqual([['correccion_peso_grande']]);
  });

  it('corrección menor o igual al umbral no entra', () => {
    expect(motivosDe([predicho()], [final({ grams: 115 })])).toEqual([[]]);
    expect(motivosDe([predicho()], [final({ grams: 120 })])).toEqual([[]]);
  });

  it('ítem quitado entra siempre, sin importar la confianza', () => {
    expect(motivosDe([predicho({ confidence: 0.99 })], [], [U1])).toEqual([['item_quitado']]);
  });

  it('acumula motivos: quitado + confianza baja', () => {
    expect(motivosDe([predicho({ confidence: 0.3 })], [], [U1])).toEqual([['item_quitado', 'confianza_baja']]);
  });

  it('acumula motivos: peso grande + confianza baja', () => {
    expect(motivosDe([predicho({ confidence: 0.4 })], [final({ grams: 200 })])).toEqual([
      ['correccion_peso_grande', 'confianza_baja'],
    ]);
  });

  it('si el alimento cambió no suma correccion_peso_grande, pero sí confianza_baja', () => {
    expect(motivosDe([predicho({ confidence: 0.4 })], [final({ origin: 'replaced', grams: 500 })])).toEqual([
      ['cambio_alimento', 'confianza_baja'],
    ]);
  });

  it('compara contra el peso estimado de la DB y suma si el ítem quedó dividido en varias filas', () => {
    expect(motivosDe([predicho()], [final({ grams: 70 }), final({ grams: 70 })])).toEqual([['correccion_peso_grande']]);
    expect(motivosDe([predicho()], [final({ grams: 50 }), final({ grams: 50 })])).toEqual([[]]);
  });

  it('un alimento agregado a mano no genera entrada ni afecta a los demás', () => {
    const r = calcularRevisiones([predicho()], [final(), final({ sourceItemId: null, origin: 'added_manually', grams: 999 })], []);
    expect(r).toEqual([{ item_uuid: U1, motivos: [] }]);
  });

  it('devuelve una entrada por cada ítem predicho, en el mismo orden', () => {
    const r = calcularRevisiones(
      [predicho(), predicho({ item_uuid: U2, confidence: 0.2 })],
      [final()],
      [U2],
    );
    expect(r).toEqual([
      { item_uuid: U1, motivos: [] },
      { item_uuid: U2, motivos: ['item_quitado', 'confianza_baja'] },
    ]);
  });

  it('los umbrales se pueden ajustar por parámetro', () => {
    expect(motivosDe([predicho({ confidence: 0.7 })], [final({ grams: 115 })], [], { confianzaBaja: 0.8, diferenciaPeso: 0.1 })).toEqual([
      ['correccion_peso_grande', 'confianza_baja'],
    ]);
  });
});
