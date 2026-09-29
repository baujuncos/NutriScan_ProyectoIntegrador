import { describe, expect, it } from 'vitest';
import { postprocesarDeteccion } from '@/lib/deteccionPostproceso';
import {
  FIXTURE_DOBLE_AMBIGUEDAD,
  FIXTURE_EXCESO_PREGUNTAS,
  FIXTURE_MOCKUP,
  FIXTURE_PREGUNTA_UNA_OPCION,
  FIXTURE_SIN_BBOX,
} from './fixtures/deteccion';

describe('postprocesarDeteccion — truncado de preguntas (NUT-168)', () => {
  it('trunca a 3 preguntas cuando Gemini devuelve 5', () => {
    const { items } = postprocesarDeteccion(FIXTURE_EXCESO_PREGUNTAS);
    expect(items[0].questions).toHaveLength(3);
    expect(items[0].questions.map((q) => q.question)).toEqual(['q1', 'q2', 'q3']);
  });

  it('descarta una pregunta con un solo option', () => {
    const { items } = postprocesarDeteccion(FIXTURE_PREGUNTA_UNA_OPCION);
    expect(items[0].questions).toHaveLength(1);
    expect(items[0].questions[0].question).toBe('pregunta válida');
  });

  it('trunca opciones a 4 cuando una pregunta trae más', () => {
    const raw = {
      detectedIngredients: [
        {
          ingredient: 'x',
          type: 'y',
          confidence: 0.5,
          estimatedWeightGrams: 10,
          questions: [{ question: 'q', kind: 'attribute', options: ['a', 'b', 'c', 'd', 'e'] }],
          boundingBox: null,
        },
      ],
      totalEstimatedWeightGrams: 10,
    };
    const { items } = postprocesarDeteccion(raw);
    expect(items[0].questions[0].options).toEqual(['a', 'b', 'c', 'd']);
  });

  it('kind desconocido cae a attribute por defecto', () => {
    const raw = {
      detectedIngredients: [
        {
          ingredient: 'x',
          type: 'y',
          confidence: 0.5,
          estimatedWeightGrams: 10,
          questions: [{ question: 'q', kind: 'algo-raro', options: ['a', 'b'] }],
          boundingBox: null,
        },
      ],
      totalEstimatedWeightGrams: 10,
    };
    const { items } = postprocesarDeteccion(raw);
    expect(items[0].questions[0].kind).toBe('attribute');
  });

  it('un plato con dos ítems ambiguos a la vez conserva las preguntas de cada uno', () => {
    const { items } = postprocesarDeteccion(FIXTURE_DOBLE_AMBIGUEDAD);
    expect(items).toHaveLength(2);
    expect(items[0].questions).toHaveLength(1);
    expect(items[0].questions[0].kind).toBe('identity');
    expect(items[1].questions).toHaveLength(1);
    expect(items[1].questions[0].kind).toBe('attribute');
  });
});

describe('postprocesarDeteccion — bounding box', () => {
  it('convierte bbox de escala 0-1000 a fracción 0-1', () => {
    const raw = {
      detectedIngredients: [
        {
          ingredient: 'x',
          type: 'y',
          confidence: 0.5,
          estimatedWeightGrams: 10,
          questions: [],
          boundingBox: { ymin: 100, xmin: 200, ymax: 600, xmax: 800 },
        },
      ],
      totalEstimatedWeightGrams: 10,
    };
    const { items } = postprocesarDeteccion(raw);
    expect(items[0].boundingBox).toEqual({ x: 0.2, y: 0.1, width: 0.6, height: 0.5 });
  });

  it('bbox null pasa como null', () => {
    const { items } = postprocesarDeteccion(FIXTURE_SIN_BBOX);
    expect(items[0].boundingBox).toBeNull();
  });

  it('bbox con max<=min se descarta a null', () => {
    const raw = {
      detectedIngredients: [
        {
          ingredient: 'x',
          type: 'y',
          confidence: 0.5,
          estimatedWeightGrams: 10,
          questions: [],
          boundingBox: { ymin: 500, xmin: 200, ymax: 400, xmax: 800 },
        },
      ],
      totalEstimatedWeightGrams: 10,
    };
    const { items } = postprocesarDeteccion(raw);
    expect(items[0].boundingBox).toBeNull();
  });

  it('bbox fuera del rango 0-1000 se descarta a null', () => {
    const raw = {
      detectedIngredients: [
        {
          ingredient: 'x',
          type: 'y',
          confidence: 0.5,
          estimatedWeightGrams: 10,
          questions: [],
          boundingBox: { ymin: -50, xmin: 200, ymax: 600, xmax: 800 },
        },
      ],
      totalEstimatedWeightGrams: 10,
    };
    const { items } = postprocesarDeteccion(raw);
    expect(items[0].boundingBox).toBeNull();
  });
});

describe('postprocesarDeteccion — ids e integridad general', () => {
  it('asigna un id distinto por ítem', () => {
    const { items } = postprocesarDeteccion(FIXTURE_MOCKUP);
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  });

  it('preserva totalEstimatedWeightGrams tal cual', () => {
    const { totalEstimatedWeightGrams } = postprocesarDeteccion(FIXTURE_MOCKUP);
    expect(totalEstimatedWeightGrams).toBe(200);
  });

  it('un ítem sin preguntas queda con questions vacío', () => {
    const { items } = postprocesarDeteccion(FIXTURE_MOCKUP);
    const waffle = items.find((i) => i.ingredient === 'Waffle');
    expect(waffle?.questions).toEqual([]);
  });
});
