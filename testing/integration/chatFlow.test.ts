/**
 * Prueba de INTEGRACIÓN del flujo del chat: las dos rutas (`/api/chat/meal` y `/api/chat/meal/confirm`)
 * con TODO el código propio real en el medio (esquemas Zod, servicio, matcher contra SARA2, reintentos
 * del cliente de Gemini, cálculo de macros y armado del payload). Solo se reemplazan los dos límites
 * con el exterior: el transporte de Gemini y el cliente de Supabase.
 *
 * Diferencia con los tests de cada módulo: acá se verifica que las piezas ENCAJAN entre sí
 * (lo que devuelve la primera ruta es lo que acepta la segunda) y propiedades de punta a punta:
 *   P1  los macros de un alimento del catálogo salen de SARA2, nunca de lo que estimó la IA ni de lo que manda el cliente;
 *   P2  una request del chat hace UNA sola llamada a Gemini (dos si hubo que reintentar);
 *   P3  los errores de Gemini se traducen a los códigos HTTP del contrato;
 *   P4  confirmar es transaccional (una sola RPC) y valida la fecha.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { todayAR, daysAgoAR } from '@/lib/date';

const { authMock, transportMock, rpcMock, revalidateMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  transportMock: { model: 'gemini-falso', generate: vi.fn() },
  rpcMock: vi.fn(),
  revalidateMock: vi.fn(),
}));

vi.mock('@/lib/chat/authenticate', () => ({ authenticate: authMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/lib/ai/gemini', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ai/gemini')>();
  return { ...real, getGeminiTransport: () => transportMock };
});

import { POST as chatMeal } from '@/app/api/chat/meal/route';
import { POST as confirmar } from '@/app/api/chat/meal/confirm/route';

const MANZANA = { id_alimento: 375, nombre: 'Manzana', kcal_100g: 52, proteinas_100g: 0.3, grasas_100g: 0.2, carbs_100g: 13.8 };

/** Supabase falso: devuelve el catálogo para las dos consultas que hacen las rutas y registra la RPC. */
function supabaseFalso(catalogo = [MANZANA]) {
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === 'range') return () => Promise.resolve({ data: catalogo, error: null }); // catálogo SARA2 del chat
        if (prop === 'in') return () => Promise.resolve({ data: catalogo, error: null }); // lectura al confirmar
        return () => chain;
      },
    },
  );
  return { from: () => chain, rpc: rpcMock };
}

const salidaModelo = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    detectedIngredients: [
      {
        ingredient: 'manzana', type: 'fruta', confidence: 0.9, estimatedWeightGrams: 150, unit: 'g',
        // La IA "alucina" 9999 kcal: si el sistema las usara, la propiedad P1 se rompería.
        estimatedMacros: { kcal: 9999, proteinas_g: 1, carbs_g: 1, grasas_g: 1 },
        questionForUser: null,
      },
    ],
    status: 'complete', invalidReason: null, assistantMessage: 'Anoté una manzana.', ...over,
  });
const respuestaGemini = (text: string) => ({ text, usage: { promptTokens: 100, outputTokens: 50, thoughtsTokens: 0 } });

let usuario = 0;
const llamarChat = (content = 'Comí una manzana de 150 g') =>
  chatMeal(new NextRequest('http://localhost/api/chat/meal', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content }] }) }));
const llamarConfirm = (body: unknown) =>
  confirmar(new NextRequest('http://localhost/api/chat/meal/confirm', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  usuario += 1;
  authMock.mockReset().mockResolvedValue({ userId: `u-${usuario}`, supabase: supabaseFalso() });
  transportMock.generate.mockReset().mockResolvedValue(respuestaGemini(salidaModelo()));
  rpcMock.mockReset().mockResolvedValue({ data: { ok: true, yaGuardado: false }, error: null });
  revalidateMock.mockReset();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Chat → catálogo (P1, P2)', () => {
  it('un alimento del catálogo se valúa con SARA2 y no con la estimación de la IA', async () => {
    // Act
    const res = await llamarChat();
    const body = await res.json();
    // Assert
    expect(res.status).toBe(200);
    expect(body.detectedIngredients[0]).toMatchObject({ macroSource: 'sara2', kcal: 78, sara2Match: { id_alimento: 375 } });
    expect(body.totalMacros.kcal).toBe(78); // 52 kcal/100 g × 150 g, no 9999
  });

  it('hace UNA sola llamada a Gemini por request', async () => {
    await llamarChat();
    expect(transportMock.generate).toHaveBeenCalledTimes(1);
  });

  it('un alimento fuera del catálogo usa la estimación de la IA, acotada a lo físicamente posible', async () => {
    // 'quinoa' no está en el catálogo (el catálogo se cachea 10 minutos en el módulo, por eso no se vacía).
    transportMock.generate.mockResolvedValue(
      respuestaGemini(salidaModelo({ detectedIngredients: [{ ...JSON.parse(salidaModelo()).detectedIngredients[0], ingredient: 'quinoa', type: 'cereal' }] })),
    );
    const body = await (await llamarChat('Comí 150 g de quinoa')).json();
    const item = body.detectedIngredients[0];
    expect(item.macroSource).toBe('estimado_ia');
    expect(item.kcal).toBeLessThanOrEqual(150 * 9); // 9999 se recorta a 9 kcal/g × 150 g
    expect(item.proteinas_g).toBeLessThanOrEqual(150);
  });

  it('una conversación que no habla de comida no consulta el catálogo ni devuelve ítems', async () => {
    transportMock.generate.mockResolvedValue(respuestaGemini(salidaModelo({ detectedIngredients: [], status: 'off_topic', assistantMessage: 'x' })));
    const body = await (await llamarChat('¿cómo está el clima?')).json();
    expect(body.status).toBe('off_topic');
    expect(body.detectedIngredients).toEqual([]);
  });

  it('un mensaje de solo emojis no llega a Gemini', async () => {
    const body = await (await llamarChat('🍎🍎🍎')).json();
    expect(body.status).toBe('invalid_input');
    expect(transportMock.generate).not.toHaveBeenCalled();
  });
});

describe('Chat → errores de Gemini (P3)', () => {
  it('JSON inválido dos veces → 502 tras un reintento', async () => {
    transportMock.generate.mockResolvedValue(respuestaGemini('esto no es json'));
    const res = await llamarChat();
    expect(res.status).toBe(502);
    expect(transportMock.generate).toHaveBeenCalledTimes(2);
  });

  it('un 503 y después una respuesta válida → 200 (el reintento rescata la request)', async () => {
    transportMock.generate.mockRejectedValueOnce(Object.assign(new Error('saturado'), { status: 503 }));
    const res = await llamarChat();
    expect(res.status).toBe(200);
    expect(transportMock.generate).toHaveBeenCalledTimes(2);
  });

  it('un 400 de Gemini (configuración) no se reintenta → 503', async () => {
    transportMock.generate.mockRejectedValue(Object.assign(new Error('api key not valid'), { status: 400 }));
    const res = await llamarChat();
    expect(res.status).toBe(503);
    expect(transportMock.generate).toHaveBeenCalledTimes(1);
  });

  it('respuesta bloqueada por seguridad → 200 con "invalid_input" y mensaje fijo (no se reintenta)', async () => {
    transportMock.generate.mockResolvedValue({ text: '', blockReason: 'SAFETY', usage: { promptTokens: 1, outputTokens: 0, thoughtsTokens: 0 } });
    const body = await (await llamarChat()).json();
    expect(body.status).toBe('invalid_input');
    expect(transportMock.generate).toHaveBeenCalledTimes(1);
  });
});

describe('Chat → confirmar (P1, P4)', () => {
  const itemDeLaIa = (over: Record<string, unknown> = {}) => ({
    ingrediente: 'manzana', tipo: 'fruta', unidad: 'g', origin: 'ai', macroSource: 'sara2', idAlimento: 375,
    confidence: 0.9, gramosIa: 150, gramosFinal: 150,
    // El cliente miente: manda 15000 kcal (el máximo que acepta el esquema). El servidor recalcula desde el catálogo.
    macrosIa: { kcal: 15000, proteinas_g: 0, carbs_g: 0, grasas_g: 0 },
    ...over,
  });
  const pedido = (items = [itemDeLaIa()], over: Record<string, unknown> = {}) => ({
    requestId: randomUUID(), fecha: todayAR(), tipoIngesta: 'colacion', items, ...over,
  });

  it('lo que devuelve /meal se puede confirmar en /meal/confirm y los macros se recalculan con el catálogo', async () => {
    // Arrange: primero la ruta del chat
    const chat = await (await llamarChat()).json();
    const ia = chat.detectedIngredients[0];
    // Act: se confirma lo que devolvió el chat
    const res = await llamarConfirm(
      pedido([
        itemDeLaIa({ confidence: ia.confidence, gramosIa: ia.estimatedWeightGrams, gramosFinal: ia.estimatedWeightGrams, idAlimento: ia.sara2Match.id_alimento }),
      ]),
    );
    // Assert
    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledTimes(1); // una sola RPC = una sola transacción
    const [nombre, args] = rpcMock.mock.calls[0];
    expect(nombre).toBe('confirmar_chat_ia_registro');
    expect(args.p_payload.totales.kcal).toBe(78); // 52 × 150 / 100, no 15000
    expect(args.p_payload.items[0].final.kcal).toBe(78);
    expect(revalidateMock).toHaveBeenCalledWith('/home');
  });

  it('si el usuario edita los gramos, los macros finales siguen saliendo del catálogo', async () => {
    await llamarConfirm(pedido([itemDeLaIa({ origin: 'edited', gramosFinal: 300 })]));
    expect(rpcMock.mock.calls[0][1].p_payload.items[0].final.kcal).toBe(156);
  });

  it('el reintento con el mismo requestId es idempotente: la RPC informa yaGuardado', async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, yaGuardado: true }, error: null });
    const body = await (await llamarConfirm(pedido())).json();
    expect(body).toMatchObject({ ok: true, yaGuardado: true });
  });

  it.each([
    ['hace 8 días (fuera de la ventana)', daysAgoAR(8)],
    ['mañana', '2999-01-01'],
  ])('fecha %s → 400 y no se guarda nada', async (_caso, fecha) => {
    const res = await llamarConfirm(pedido([itemDeLaIa()], { fecha }));
    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('un alimento del catálogo que ya no existe → 400', async () => {
    authMock.mockResolvedValue({ userId: `u-${usuario}`, supabase: supabaseFalso([]) });
    const res = await llamarConfirm(pedido());
    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('si la base falla al guardar → 500 PERSISTENCE_ERROR sin detalle crudo', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function confirmar_chat_ia_registro' } });
    const res = await llamarConfirm(pedido());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error.code).toBe('PERSISTENCE_ERROR');
    expect(JSON.stringify(body)).not.toContain('PGRST202');
  });

  it('sin sesión → 401', async () => {
    authMock.mockResolvedValue(null);
    expect((await llamarConfirm(pedido())).status).toBe(401);
  });
});
