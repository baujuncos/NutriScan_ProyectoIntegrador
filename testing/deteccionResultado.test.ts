import { describe, it, expect } from 'vitest';
import {
  aplicarRespuesta,
  ajustarPeso,
  armarSaveRequest,
  contarDudas,
  crearItemManual,
  crearWorkingItems,
  deshacerPeso,
  esConfianzaAlta,
  itemActivo,
  opcionesDudaOriginal,
  reemplazarAlimento,
  tieneDudasPendientes,
  CONFIDENCE_ALTA_UMBRAL,
  PESO_INICIAL_MANUAL_G,
} from '@/lib/deteccionResultado';
import { DETECTION_MOCKUP, DETECTION_DOBLE_AMBIGUEDAD, DETECTION_SIN_AMBIGUEDAD } from './fixtures/deteccionResponse';

describe('crearWorkingItems', () => {
  it('mapea cada DetectedItem 1 a 1, con las preguntas originales conservadas', () => {
    const items = crearWorkingItems(DETECTION_MOCKUP);
    expect(items).toHaveLength(3);
    const topping = items.find((i) => i.uiId === 'item-topping')!;
    expect(topping.pendingQuestions).toHaveLength(2);
    expect(topping.originalQuestions).toHaveLength(2);
    expect(topping.origin).toBe('ai');
    expect(topping.aiGrams).toBe(35);
    expect(topping.grams).toBe(35);
  });
});

describe('contarDudas / tieneDudasPendientes / itemActivo', () => {
  it('cuenta sólo los ítems con preguntas pendientes', () => {
    const items = crearWorkingItems(DETECTION_MOCKUP);
    expect(contarDudas(items)).toBe(1);
    expect(tieneDudasPendientes(items)).toBe(true);
    expect(itemActivo(items)?.uiId).toBe('item-topping');
  });

  it('sin ambigüedad, no hay dudas ni ítem activo', () => {
    const items = crearWorkingItems(DETECTION_SIN_AMBIGUEDAD);
    expect(contarDudas(items)).toBe(0);
    expect(tieneDudasPendientes(items)).toBe(false);
    expect(itemActivo(items)).toBeNull();
  });

  it('con dos ítems ambiguos a la vez, cada uno conserva su propia pregunta y el activo es el primero de la lista', () => {
    const items = crearWorkingItems(DETECTION_DOBLE_AMBIGUEDAD);
    expect(contarDudas(items)).toBe(2);
    expect(itemActivo(items)?.uiId).toBe('item-empanada');

    const resuelto = items.map((i) => (i.uiId === 'item-empanada' ? aplicarRespuesta(i, 'Carne') : i));
    expect(contarDudas(resuelto)).toBe(1);
    expect(itemActivo(resuelto)?.uiId).toBe('item-milanesa');
  });
});

describe('aplicarRespuesta', () => {
  it('identity reemplaza el nombre del ítem', () => {
    const items = crearWorkingItems(DETECTION_MOCKUP);
    const topping = items.find((i) => i.uiId === 'item-topping')!;
    const resuelto = aplicarRespuesta(topping, 'Yogur griego');
    expect(resuelto.name).toBe('Yogur griego');
    expect(resuelto.origin).toBe('answered');
    expect(resuelto.pendingQuestions).toHaveLength(1);
    expect(resuelto.answers).toEqual([{ question: '¿Qué es el topping blanco?', answer: 'Yogur griego' }]);
    // el peso nunca cambia al responder
    expect(resuelto.grams).toBe(35);
  });

  it('attribute agrega el atributo entre paréntesis, después de un identity ya aplicado', () => {
    const items = crearWorkingItems(DETECTION_MOCKUP);
    const topping = items.find((i) => i.uiId === 'item-topping')!;
    const paso1 = aplicarRespuesta(topping, 'Yogur griego');
    const paso2 = aplicarRespuesta(paso1, 'Light');
    expect(paso2.name).toBe('Yogur griego (Light)');
    expect(paso2.pendingQuestions).toHaveLength(0);
    expect(paso2.answers).toHaveLength(2);
  });

  it('"No sé" (respuesta null) cuenta como resuelta pero no cambia nombre ni origin', () => {
    const items = crearWorkingItems(DETECTION_MOCKUP);
    const topping = items.find((i) => i.uiId === 'item-topping')!;
    const omitido = aplicarRespuesta(topping, null);
    expect(omitido.name).toBe('Topping blanco');
    expect(omitido.origin).toBe('ai');
    expect(omitido.pendingQuestions).toHaveLength(1);
    expect(omitido.answers).toEqual([{ question: '¿Qué es el topping blanco?', answer: null }]);
  });

  it('respuesta "Otro…" (custom) se guarda con custom:true', () => {
    const items = crearWorkingItems(DETECTION_MOCKUP);
    const topping = items.find((i) => i.uiId === 'item-topping')!;
    const resuelto = aplicarRespuesta(topping, 'Dulce de leche', true);
    expect(resuelto.name).toBe('Dulce de leche');
    expect(resuelto.answers[0]).toEqual({ question: '¿Qué es el topping blanco?', answer: 'Dulce de leche', custom: true });
  });

  it('sin preguntas pendientes, no hace nada', () => {
    const items = crearWorkingItems(DETECTION_SIN_AMBIGUEDAD);
    const arroz = items.find((i) => i.uiId === 'item-arroz')!;
    expect(aplicarRespuesta(arroz, 'lo que sea')).toBe(arroz);
  });
});

describe('nunca se muestran más de 3 preguntas (defensa de UI, además del truncado de backend)', () => {
  it('un ítem con 3 preguntas originales nunca deja más de 3 en pendingQuestions', () => {
    const items = crearWorkingItems(DETECTION_MOCKUP);
    const topping = items.find((i) => i.uiId === 'item-topping')!;
    expect(topping.pendingQuestions.length).toBeLessThanOrEqual(3);
  });
});

describe('reemplazarAlimento / ajustarPeso / deshacerPeso', () => {
  it('reemplazar conserva el peso y cambia origin a "replaced"', () => {
    const items = crearWorkingItems(DETECTION_SIN_AMBIGUEDAD);
    const arroz = items.find((i) => i.uiId === 'item-arroz')!;
    const reemplazado = reemplazarAlimento(arroz, { nombre: 'Arroz integral', categoria: 'Cereal' });
    expect(reemplazado.grams).toBe(150);
    expect(reemplazado.name).toBe('Arroz integral');
    expect(reemplazado.category).toBe('Cereal');
    expect(reemplazado.origin).toBe('replaced');
  });

  it('ajustar peso nunca baja de un paso (PASO_PESO_G) y deshacer vuelve al valor de la IA', () => {
    const items = crearWorkingItems(DETECTION_SIN_AMBIGUEDAD);
    const arroz = items.find((i) => i.uiId === 'item-arroz')!;
    const ajustado = ajustarPeso(arroz, 80);
    expect(ajustado.grams).toBe(80);
    const deshecho = deshacerPeso(ajustado);
    expect(deshecho.grams).toBe(150);
  });
});

describe('crearItemManual', () => {
  it('arranca sin sourceItemId, sin aiGrams, origin added_manually y peso inicial 100g', () => {
    const manual = crearItemManual('Palta', 'Fruta');
    expect(manual.sourceItemId).toBeNull();
    expect(manual.aiGrams).toBeNull();
    expect(manual.origin).toBe('added_manually');
    expect(manual.grams).toBe(PESO_INICIAL_MANUAL_G);
    expect(manual.confidence).toBeNull();
  });
});

describe('opcionesDudaOriginal', () => {
  it('devuelve las options de la pregunta identity original, aunque ya se haya resuelto', () => {
    const items = crearWorkingItems(DETECTION_MOCKUP);
    const topping = items.find((i) => i.uiId === 'item-topping')!;
    const resuelto = aplicarRespuesta(topping, 'Yogur griego');
    expect(opcionesDudaOriginal(resuelto)).toEqual(['Crema chantilly', 'Yogur griego', 'Queso blanco']);
  });

  it('vacío si el ítem nunca tuvo una pregunta identity', () => {
    const items = crearWorkingItems(DETECTION_SIN_AMBIGUEDAD);
    expect(opcionesDudaOriginal(items[0])).toEqual([]);
  });
});

describe('esConfianzaAlta', () => {
  it('respeta el umbral configurado', () => {
    expect(esConfianzaAlta(CONFIDENCE_ALTA_UMBRAL)).toBe(true);
    expect(esConfianzaAlta(CONFIDENCE_ALTA_UMBRAL - 0.01)).toBe(false);
    expect(esConfianzaAlta(null)).toBe(false);
  });
});

describe('armarSaveRequest', () => {
  it('arma el SaveRequest completo, incluidos quitados', () => {
    const items = crearWorkingItems(DETECTION_SIN_AMBIGUEDAD);
    const req = armarSaveRequest('2', 'desayuno', items, ['item-pollo']);
    expect(req.predictionId).toBe('2');
    expect(req.mealType).toBe('desayuno');
    expect(req.removedItemIds).toEqual(['item-pollo']);
    expect(req.items).toHaveLength(2);
    expect(req.items[0]).toMatchObject({
      sourceItemId: 'item-arroz',
      name: 'Arroz blanco',
      category: 'cereal',
      grams: 150,
      aiGrams: 150,
      origin: 'ai',
      answers: [],
      foodRef: null,
    });
  });

  it('un ítem aceptado sin cambios es simplemente origin "ai" con grams === aiGrams', () => {
    const items = crearWorkingItems(DETECTION_SIN_AMBIGUEDAD);
    const req = armarSaveRequest('2', 'desayuno', items, []);
    for (const item of req.items) {
      expect(item.origin).toBe('ai');
      expect(item.grams).toBe(item.aiGrams);
    }
  });
});
