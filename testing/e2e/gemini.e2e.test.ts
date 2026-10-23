// E2E contra Gemini REAL (dependencia crítica del reconocimiento y del chat).
// Verifica: la API key es válida, el modelo configurado existe, devuelve JSON que cumple el
// esquema y lo hace dentro del timeout que usa la app (15 s por intento).
// Consume 1 llamada mínima de la cuota. Se saltea si no hay GEMINI_API_KEY.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callLlmJson, getGeminiTransport, type LlmCallStat } from '@/lib/ai/gemini';
import { env, tieneGemini } from './env';

describe.skipIf(!tieneGemini)('Gemini real — contrato de la integración', () => {
  it('responde JSON estructurado que cumple el esquema, con modelo y latencia aceptables', async () => {
    // Arrange
    process.env.GEMINI_API_KEY = env.geminiApiKey;
    const transport = getGeminiTransport();
    const stats: LlmCallStat[] = [];
    // Act
    const resultado = await callLlmJson(
      transport,
      {
        kind: 'e2e-contrato',
        systemInstruction: 'Respondé únicamente con el JSON pedido.',
        contents: [{ role: 'user', text: 'Devolvé ok=true y la fruta "manzana".' }],
        jsonSchema: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, fruta: { type: 'string' } },
          required: ['ok', 'fruta'],
        },
        maxOutputTokens: 200,
      },
      z.object({ ok: z.boolean(), fruta: z.string() }),
      { onStat: (s) => stats.push(s), log: () => {} },
    );
    // Assert
    expect(resultado.ok).toBe(true);
    expect(resultado.fruta.toLowerCase()).toContain('manzana');
    expect(stats[0].outcome).toBe('ok');
    expect(stats[0].attempts).toBeLessThanOrEqual(2);
    expect(stats[0].latencyMs).toBeLessThan(15_000);
    expect(stats[0].promptTokens).toBeGreaterThan(0);
  });
});
