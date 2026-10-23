/**
 * POST /api/chat/meal — prueba de API del endpoint (Gemini y Supabase reemplazados por dobles).
 *
 * Tabla de decisión del manejo de errores del endpoint:
 *   condición                                   | HTTP | code
 *   sin sesión / token inválido                 | 401  | UNAUTHORIZED
 *   más de 10 requests por minuto del usuario   | 429  | RATE_LIMITED
 *   cuerpo que no es JSON                       | 400  | BAD_REQUEST
 *   cuerpo que no cumple el esquema (Zod)       | 400  | BAD_REQUEST  (sin llamar a Gemini)
 *   Gemini: RATE_LIMITED                        | 429  | RATE_LIMITED
 *   Gemini: AI_UNAVAILABLE                      | 503  | AI_UNAVAILABLE
 *   Gemini: AI_INVALID_RESPONSE                 | 502  | AI_INVALID_RESPONSE
 *   Gemini: AI_BLOCKED (seguridad)              | 502  | AI_INVALID_RESPONSE
 *   error inesperado (p. ej. Supabase)          | 503  | AI_UNAVAILABLE (sin detalle crudo)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authenticateMock, analyzeMealMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  analyzeMealMock: vi.fn(),
}));

vi.mock('@/lib/chat/authenticate', () => ({ authenticate: authenticateMock }));
vi.mock('@/lib/chat/mealService', () => ({ analyzeMeal: analyzeMealMock }));
vi.mock('@/lib/chat/sara2Catalog', () => ({ createSupabaseSara2Catalog: () => ({ getAll: async () => [] }) }));
vi.mock('@/lib/ai/gemini', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ai/gemini')>();
  return { ...real, getGeminiTransport: () => ({ model: 'modelo-falso', generate: vi.fn() }) };
});

import { POST } from '@/app/api/chat/meal/route';
import { AiError } from '@/lib/ai/gemini';

let userSeq = 0;
const RESULTADO = {
  status: 'complete',
  assistantMessage: 'Te anoté una manzana.',
  detectedIngredients: [{ ingredient: 'manzana' }],
  totalEstimatedWeightGrams: 150,
  totalMacros: { kcal: 78, proteinas_g: 0.4, carbs_g: 20.7, grasas_g: 0.3 },
};

function req(body: unknown) {
  return new NextRequest('http://localhost/api/chat/meal', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const valido = { messages: [{ role: 'user', content: 'comí una manzana' }] };

beforeEach(() => {
  // Un usuario distinto por test: el rate limit vive en memoria del proceso.
  authenticateMock.mockReset().mockResolvedValue({ userId: `user-${++userSeq}`, supabase: {} });
  analyzeMealMock.mockReset().mockResolvedValue(RESULTADO);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/chat/meal — camino feliz', () => {
  it('devuelve 200 con el resultado del servicio', async () => {
    // Act
    const res = await POST(req(valido));
    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(RESULTADO);
    expect(analyzeMealMock).toHaveBeenCalledWith(valido.messages, expect.objectContaining({ llm: expect.anything(), catalog: expect.anything() }));
  });
});

describe('POST /api/chat/meal — autenticación y límite', () => {
  it('sin sesión → 401 y no se llama a Gemini', async () => {
    authenticateMock.mockResolvedValue(null);
    const res = await POST(req(valido));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
    expect(analyzeMealMock).not.toHaveBeenCalled();
  });

  it('valor límite: la request 10 pasa y la 11 del mismo usuario es 429', async () => {
    const estados: number[] = [];
    for (let i = 0; i < 11; i++) estados.push((await POST(req(valido))).status);
    expect(estados.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(estados[10]).toBe(429);
    expect(analyzeMealMock).toHaveBeenCalledTimes(10);
  });

  it('el límite es por usuario: otro usuario no queda bloqueado', async () => {
    for (let i = 0; i < 11; i++) await POST(req(valido));
    authenticateMock.mockResolvedValue({ userId: 'otro-usuario', supabase: {} });
    expect((await POST(req(valido))).status).toBe(200);
  });
});

describe('POST /api/chat/meal — validación (no gasta tokens)', () => {
  it('cuerpo que no es JSON → 400', async () => {
    const res = await POST(req('esto no es json'));
    expect(res.status).toBe(400);
    expect(analyzeMealMock).not.toHaveBeenCalled();
  });

  it.each([
    ['sin messages', {}],
    ['messages vacío', { messages: [] }],
    ['mensaje de usuario vacío', { messages: [{ role: 'user', content: '   ' }] }],
    ['último mensaje del asistente', { messages: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'ok' }] }],
    ['más de 500 caracteres', { messages: [{ role: 'user', content: 'a'.repeat(501) }] }],
    ['rol inválido', { messages: [{ role: 'system', content: 'hola' }] }],
  ])('%s → 400 sin llamar a Gemini', async (_caso, body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('BAD_REQUEST');
    expect(analyzeMealMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/chat/meal — fallas de Gemini', () => {
  it.each([
    ['RATE_LIMITED', 429, 'RATE_LIMITED'],
    ['AI_UNAVAILABLE', 503, 'AI_UNAVAILABLE'],
    ['AI_INVALID_RESPONSE', 502, 'AI_INVALID_RESPONSE'],
    ['AI_BLOCKED', 502, 'AI_INVALID_RESPONSE'],
  ] as const)('AiError %s → HTTP %i, code %s', async (aiCode, status, code) => {
    analyzeMealMock.mockRejectedValue(new AiError(aiCode, 'detalle interno'));
    const res = await POST(req(valido));
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.error.code).toBe(code);
    expect(JSON.stringify(body)).not.toContain('detalle interno');
  });

  it('un error inesperado → 503 sin exponer el mensaje crudo', async () => {
    analyzeMealMock.mockRejectedValue(new Error('password authentication failed for user postgres'));
    const res = await POST(req(valido));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain('postgres');
  });

  it('un valor que no es Error también se maneja', async () => {
    analyzeMealMock.mockRejectedValue('texto suelto');
    expect((await POST(req(valido))).status).toBe(503);
  });
});
