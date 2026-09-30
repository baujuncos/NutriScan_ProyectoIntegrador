import { describe, it, expect } from 'vitest';
import { nutritionProviderMock } from '@/lib/nutritionMock';

describe('nutritionProviderMock', () => {
  it('devuelve valores fijos por 100g para los alimentos del mockup', () => {
    expect(nutritionProviderMock.per100g('Yogur griego natural')).toEqual({
      kcal: 97,
      protein: 9,
      carbs: 4,
      fat: 5,
    });
    expect(nutritionProviderMock.per100g('Yogur griego descremado').kcal).toBe(59);
    expect(nutritionProviderMock.per100g('Yogur griego con frutas').kcal).toBe(118);
    expect(nutritionProviderMock.per100g('Yogur griego saborizado').kcal).toBe(105);
  });

  it('ignora mayúsculas/acentos al buscar el fixture', () => {
    expect(nutritionProviderMock.per100g('YOGUR GRIEGO NATURAL')).toEqual(nutritionProviderMock.per100g('yogur griego natural'));
  });

  it('forGrams escala linealmente respecto de per100g', () => {
    const base = nutritionProviderMock.per100g('Waffle');
    const escalado = nutritionProviderMock.forGrams('Waffle', 80);
    expect(escalado.kcal).toBeCloseTo(base.kcal * 0.8);
    expect(escalado.protein).toBeCloseTo(base.protein * 0.8);
  });

  it('un alimento sin fixture obtiene un valor determinista derivado del nombre', () => {
    const a = nutritionProviderMock.per100g('Un alimento inventado que no está en las fixtures');
    const b = nutritionProviderMock.per100g('Un alimento inventado que no está en las fixtures');
    expect(a).toEqual(b);
    expect(a.kcal).toBeGreaterThan(0);
  });

  it('nombres distintos sin fixture dan valores distintos (no todo colapsa a un default)', () => {
    const a = nutritionProviderMock.per100g('Alimento inventado uno');
    const b = nutritionProviderMock.per100g('Alimento inventado completamente distinto');
    expect(a).not.toEqual(b);
  });
});
