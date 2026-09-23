import { describe, it, expect } from 'vitest';
import { SchemaType } from '@google/generative-ai';
import {
  construirMensajeRespuestaUsuario,
  construirSystemPrompt,
  FOOD_DETECTION_RESPONSE_SCHEMA,
  MAX_PREGUNTAS_POR_ALIMENTO,
  normalizarIngrediente,
  type ContextoCaptura,
} from '@/lib/geminiFoodPrompt';

const contexto: ContextoCaptura = {
  tipoVajilla: 'plato_playo',
  diametroCm: 26,
  anguloCapturaGrados: 34,
};

describe('construirSystemPrompt (NUT-155)', () => {
  it('interpola tipo de vajilla, diámetro y ángulo de captura', () => {
    const prompt = construirSystemPrompt(contexto);
    expect(prompt).toContain('Tipo de vajilla: plato_playo');
    expect(prompt).toContain('Diámetro real: 26 cm');
    expect(prompt).toContain('Ángulo de captura: 34°');
  });

  it('incluye la frase de ingredientes agotados cuando alguno llegó al máximo', () => {
    const prompt = construirSystemPrompt(contexto, { milanesa: MAX_PREGUNTAS_POR_ALIMENTO });
    expect(prompt).toContain('milanesa');
    expect(prompt).toContain('ya alcanzaron el máximo de preguntas permitidas');
  });

  it('no incluye la frase de ingredientes agotados si ninguno llegó al límite', () => {
    const prompt = construirSystemPrompt(contexto, { milanesa: MAX_PREGUNTAS_POR_ALIMENTO - 1 });
    expect(prompt).not.toContain('ya alcanzaron el máximo de preguntas permitidas');
  });

  it('menciona el límite de preguntas por alimento', () => {
    const prompt = construirSystemPrompt(contexto);
    expect(prompt).toContain(`${MAX_PREGUNTAS_POR_ALIMENTO} preguntas aclaratorias`);
  });
});

describe('construirMensajeRespuestaUsuario', () => {
  it('incluye el ingrediente y la respuesta textual del usuario', () => {
    const mensaje = construirMensajeRespuestaUsuario('milanesa', 'de pollo');
    expect(mensaje).toContain('milanesa');
    expect(mensaje).toContain('de pollo');
  });
});

describe('normalizarIngrediente', () => {
  it('trimea y pasa a minúsculas', () => {
    expect(normalizarIngrediente('  Milanesa de Pollo  ')).toBe('milanesa de pollo');
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
        items: { required: string[] };
      };
    };
  };

  it('define un objeto con detectedIngredients y totalEstimatedWeightGrams', () => {
    expect(schema.type).toBe(SchemaType.OBJECT);
    expect(schema.required).toEqual(['detectedIngredients', 'totalEstimatedWeightGrams']);
  });

  it('cada ingrediente detectado requiere exactamente los 5 campos documentados', () => {
    expect(schema.properties.detectedIngredients.items.required).toEqual([
      'ingredient',
      'type',
      'confidence',
      'estimatedWeightGrams',
      'questionForUser',
    ]);
  });
});
