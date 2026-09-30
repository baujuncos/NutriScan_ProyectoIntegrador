import { describe, it, expect } from 'vitest';
import { SchemaType } from '@google/generative-ai';
import { construirSystemPrompt, FOOD_DETECTION_RESPONSE_SCHEMA } from '@/lib/geminiFoodPrompt';
import {
  MAX_OPTIONS_PER_QUESTION,
  MAX_QUESTIONS_PER_ITEM,
  MIN_OPTIONS_PER_QUESTION,
} from '@/lib/deteccion';
import type { ContextoCaptura } from '@/lib/geminiFoodPrompt';

const contexto: ContextoCaptura = {
  tipoVajilla: 'plato_playo',
  diametroCm: 26,
  anguloCapturaGrados: 34,
};

describe('construirSystemPrompt (NUT-155/NUT-166)', () => {
  it('interpola tipo de vajilla, diámetro y ángulo de captura', () => {
    const prompt = construirSystemPrompt(contexto);
    expect(prompt).toContain('Tipo de vajilla: plato_playo');
    expect(prompt).toContain('Diámetro real: 26 cm');
    expect(prompt).toContain('Ángulo de captura: 34°');
  });

  it('menciona el límite de preguntas por alimento', () => {
    const prompt = construirSystemPrompt(contexto);
    expect(prompt).toContain(`${MAX_QUESTIONS_PER_ITEM} preguntas`);
  });

  it('distingue kind identity de attribute', () => {
    const prompt = construirSystemPrompt(contexto);
    expect(prompt).toContain('"identity"');
    expect(prompt).toContain('"attribute"');
  });

  it('pide ordenar las preguntas por impacto nutricional', () => {
    const prompt = construirSystemPrompt(contexto);
    expect(prompt).toContain('impacto nutricional');
  });

  it('pide bounding box por alimento en la escala nativa de Gemini (0-1000)', () => {
    const prompt = construirSystemPrompt(contexto);
    expect(prompt).toContain('ymin');
    expect(prompt).toContain('xmax');
  });
});

describe('FOOD_DETECTION_RESPONSE_SCHEMA', () => {
  // El tipo `Schema` del SDK es una unión (StringSchema | ObjectSchema | ...);
  // acá se sabe en runtime que es un ObjectSchema, así que se castea para poder
  // navegar `.properties` sin pelear con el narrowing de TS en el test.
  const schema = FOOD_DETECTION_RESPONSE_SCHEMA as unknown as {
    type: SchemaType;
    required: string[];
    properties: {
      detectedIngredients: {
        items: {
          required: string[];
          properties: {
            questions: { maxItems: number; items: { properties: { options: { minItems: number; maxItems: number } } } };
            boundingBox: { nullable: boolean; required: string[] };
          };
        };
      };
    };
  };

  it('define un objeto con detectedIngredients y totalEstimatedWeightGrams', () => {
    expect(schema.type).toBe(SchemaType.OBJECT);
    expect(schema.required).toEqual(['detectedIngredients', 'totalEstimatedWeightGrams']);
  });

  it('cada ingrediente detectado requiere ingredient/type/confidence/estimatedWeightGrams/questions/boundingBox', () => {
    expect(schema.properties.detectedIngredients.items.required).toEqual([
      'ingredient',
      'type',
      'confidence',
      'estimatedWeightGrams',
      'questions',
      'boundingBox',
    ]);
  });

  it('define preguntas con máximo 3 y opciones entre 2 y 4', () => {
    const questionsSchema = schema.properties.detectedIngredients.items.properties.questions;
    expect(questionsSchema.maxItems).toBe(MAX_QUESTIONS_PER_ITEM);
    const optionsSchema = questionsSchema.items.properties.options;
    expect(optionsSchema.minItems).toBe(MIN_OPTIONS_PER_QUESTION);
    expect(optionsSchema.maxItems).toBe(MAX_OPTIONS_PER_QUESTION);
  });

  it('define boundingBox como objeto nullable con ymin/xmin/ymax/xmax', () => {
    const bboxSchema = schema.properties.detectedIngredients.items.properties.boundingBox;
    expect(bboxSchema.nullable).toBe(true);
    expect(bboxSchema.required).toEqual(['ymin', 'xmin', 'ymax', 'xmax']);
  });
});
