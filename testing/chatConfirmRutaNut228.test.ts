// NUT-228 — POST /api/chat/meal/confirm con la conversación: llega a la RPC solo con ítems encolables,
// el cuerpo inválido se rechaza antes de la base y la respuesta es la de siempre (sin datos de la cola).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { ConfirmItem } from '@/lib/chat/confirmSchemas';

const authenticateMock = vi.fn();
vi.mock('@/lib/chat/authenticate', () => ({ authenticate: (...args: unknown[]) => authenticateMock(...args) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/date', () => ({ todayAR: () => '2026-10-08', daysAgoAR: () => '2026-10-01' }));

import { POST } from '@/app/api/chat/meal/confirm/route';

const REQUEST_ID = '3f2b8c1e-7d4a-4e0b-9a55-0c1d2e3f4a5b';
const empanada: ConfirmItem = {
  ingrediente: 'Empanada de carne', tipo: 'otro', unidad: 'g', origin: 'ai', macroSource: 'estimado_ia',
  idAlimento: null, confidence: 0.7, gramosIa: 240, gramosFinal: 240,
  macrosIa: { kcal: 600, proteinas_g: 25.2, carbs_g: 64.8, grasas_g: 26.4 },
};
const banana: ConfirmItem = {
  ingrediente: 'Banana', tipo: 'fruta', unidad: 'g', origin: 'ai', macroSource: 'sara2',
  idAlimento: 375, confidence: 0.9, gramosIa: 120, gramosFinal: 120,
  macrosIa: { kcal: 9999, proteinas_g: 99, carbs_g: 99, grasas_g: 99 },
};
const conversacion = [
  { role: 'user', content: 'Comí una empanada' },
  { role: 'assistant', content: '¿De qué es?' },
];
const body = (items: ConfirmItem[], extra: Record<string, unknown> = {}) => ({
  requestId: REQUEST_ID, fecha: '2026-10-08', tipoIngesta: 'almuerzo', items, ...extra,
});

describe('POST /api/chat/meal/confirm — conversación (NUT-228)', () => {
  const rpc = vi.fn();
  const inFilter = vi.fn();
  const supabase = { from: vi.fn(() => ({ select: vi.fn(() => ({ in: inFilter })) })), rpc };
  const call = (b: unknown) => POST(new NextRequest('http://localhost/api/chat/meal/confirm', { method: 'POST', body: JSON.stringify(b) }));

  beforeEach(() => {
    vi.clearAllMocks();
    authenticateMock.mockResolvedValue({ userId: 'u1', supabase });
    inFilter.mockResolvedValue({ data: [{ id_alimento: 375, kcal_100g: 92, proteinas_100g: 1.2, grasas_100g: 0.2, carbs_100g: 20.4 }], error: null });
    rpc.mockResolvedValue({ data: { idRegistro: 7, idIngesta: 3, itemsDiario: 1, mlAgua: 0, yaGuardado: false }, error: null });
  });

  it('con un ítem estimado por la IA, la conversación viaja a la RPC (solo {role, content})', async () => {
    const res = await call(body([empanada], { conversacion: [{ ...conversacion[0], id: 'x', timestamp: 'y' }, conversacion[1]] }));
    expect(res.status).toBe(200);
    expect(rpc.mock.calls[0][1].p_payload.conversacion).toEqual(conversacion);
  });

  it('sin ítems encolables (solo SARA2) la conversación NO llega a la RPC', async () => {
    await call(body([banana], { conversacion }));
    expect('conversacion' in rpc.mock.calls[0][1].p_payload).toBe(false);
  });

  it('sin conversación el payload es el de siempre', async () => {
    await call(body([empanada]));
    expect('conversacion' in rpc.mock.calls[0][1].p_payload).toBe(false);
  });

  it('400 si la conversación excede los topes o trae roles inválidos; nunca llega a la base', async () => {
    const larga = Array.from({ length: 21 }, () => ({ role: 'user', content: 'a' }));
    expect((await call(body([empanada], { conversacion: larga }))).status).toBe(400);
    expect((await call(body([empanada], { conversacion: [{ role: 'user', content: 'a'.repeat(2001) }] }))).status).toBe(400);
    expect((await call(body([empanada], { conversacion: [{ role: 'system', content: 'x' }] }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('la respuesta es la de siempre: no expone nada de la cola de validación', async () => {
    const res = await call(body([empanada], { conversacion }));
    expect(await res.json()).toEqual({ ok: true, idRegistro: 7, idIngesta: 3, itemsDiario: 1, mlAgua: 0, yaGuardado: false });
  });
});
