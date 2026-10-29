/**
 * NUT-228 / NUT-231 — getPendienteDetalleAction con ítems del chat (chat_ia_registros_items.id_pendiente):
 * forma de las solicitudes, total real, las cargas manuales ya no incluyen los ítems del chat, solo
 * investigadores/administradores acceden (estudio a ciegas) y los errores de la base.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));
const sb = createSupabaseFromMock();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: sb.from, rpc: sb.rpc, storage: sb.storage }),
}));

import { getPendienteDetalleAction } from '@/app/(researcher)/validacion/actions';

const pendiente = (over: Record<string, unknown> = {}) => ({
  id_pendiente: 9, nombre_original: 'Empanada de carne', nombre_normalizado: 'empanada de carne', estado: 'pendiente',
  ocurrencias: 0, ocurrencias_manuales: 0, ocurrencias_chat: 25, usuarios_distintos: 3, origen: 'chat', ...over,
});

const chat = (n: number, uid: string, conv: unknown = [{ role: 'user', content: 'una empanada' }]) => ({
  id_item: n, ingrediente: 'Empanada de carne', gramos_final: '240.00', created_at: '2026-10-07T12:00:00Z',
  chat_ia_registros: { fecha: '2026-10-06', id_usuario: uid, conversacion: conv },
});

beforeEach(() => {
  sb.reset();
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'inv-1' } } });
  sb.mockTable('profiles', { data: { role: 'investigador' }, error: null });
});

describe('getPendienteDetalleAction — ítems del chat', () => {
  it('devuelve las solicitudes del chat (quién, cuándo, lo interpretado, gramos y conversación) y el total real', async () => {
    sb.mockTable('v_alimentos_pendientes', { data: pendiente(), error: null });
    sb.mockTable('detecciones_guardados_items', { data: [], error: null });
    sb.mockTable('detecciones_guardados_items', { data: [], error: null });
    sb.mockTable('items', { data: [], error: null });
    sb.mockTable('chat_ia_registros_items', { data: [chat(1, 'u1'), chat(2, 'u2', null)], error: null });
    sb.mockTable('profiles', { data: [{ user_id: 'u1', nombre: 'Ana', apellido: 'Pérez' }, { user_id: 'u2', nombre: 'Juan', apellido: 'Gómez' }], error: null });

    const r = await getPendienteDetalleAction(9);

    if (!('ok' in r)) throw new Error(r.error);
    expect(r.totalSolicitudesChat).toBe(25);
    expect(r.solicitudesChat).toEqual([
      { idItem: 1, fecha: '2026-10-06', deportista: 'Ana Pérez', interpretado: 'Empanada de carne', gramos: 240, conversacion: [{ role: 'user', content: 'una empanada' }] },
      { idItem: 2, fecha: '2026-10-06', deportista: 'Juan Gómez', interpretado: 'Empanada de carne', gramos: 240, conversacion: null },
    ]);
    expect(r.solicitudesManuales).toEqual([]);
    expect(sb.filtrosLlamados()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tabla: 'chat_ia_registros_items', metodo: 'limit', args: [20] }),
        // Los ítems del chat se excluyen de las cargas manuales (anti-join con la auditoría del chat).
        expect.objectContaining({ tabla: 'items', metodo: 'is', args: ['chat_ia_registros_items', null] }),
        expect.objectContaining({ tabla: 'profiles', metodo: 'in', args: ['user_id', ['u1', 'u2']] }),
      ]),
    );
  });

  it('la entrada se pide por id_pendiente y los nombres de chat y foto salen de UNA sola consulta de perfiles', async () => {
    sb.mockTable('v_alimentos_pendientes', { data: pendiente({ ocurrencias_chat: 1 }), error: null });
    sb.mockTable('detecciones_guardados_items', { data: [], error: null });
    sb.mockTable('detecciones_guardados_items', { data: [], error: null });
    sb.mockTable('items', { data: [], error: null });
    sb.mockTable('chat_ia_registros_items', { data: [chat(1, 'u1')], error: null });
    sb.mockTable('profiles', { data: [], error: null });
    await getPendienteDetalleAction(9);
    expect(sb.eqLlamados()).toEqual(
      expect.arrayContaining([expect.objectContaining({ tabla: 'chat_ia_registros_items', args: ['id_pendiente', 9] })]),
    );
    expect(sb.tablasLlamadas().filter((t) => t === 'profiles')).toHaveLength(2); // 1 de la verificación de rol + 1 de nombres
  });

  it('sin ítems del chat: lista vacía y total 0 (la entrada de foto o manual no cambia)', async () => {
    sb.mockTable('v_alimentos_pendientes', { data: pendiente({ ocurrencias_chat: undefined, ocurrencias_manuales: 1, origen: 'manual' }), error: null });
    sb.mockTable('detecciones_guardados_items', { data: [], error: null });
    sb.mockTable('detecciones_guardados_items', { data: [], error: null });
    sb.mockTable('items', { data: [], error: null });
    const r = await getPendienteDetalleAction(9);
    if (!('ok' in r)) throw new Error(r.error);
    expect(r.solicitudesChat).toEqual([]);
    expect(r.totalSolicitudesChat).toBe(0);
  });

  it.each(['deportista_ucc', 'particular'])('un %s no accede: "Acceso denegado" y no se lee la cola ni el chat', async (role) => {
    sb.reset();
    getUserMock.mockResolvedValue({ data: { user: { id: 'u-x' } } });
    sb.mockTable('profiles', { data: { role }, error: null });
    const r = await getPendienteDetalleAction(9);
    expect(r).toEqual({ error: 'Acceso denegado' });
    expect(sb.tablasLlamadas()).not.toContain('v_alimentos_pendientes');
    expect(sb.tablasLlamadas()).not.toContain('chat_ia_registros_items');
  });

  it('sin sesión: "No autenticado"', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect(await getPendienteDetalleAction(9)).toEqual({ error: 'No autenticado' });
  });

  it('id inválido: Datos inválidos, sin consultar', async () => {
    expect(await getPendienteDetalleAction(-1)).toEqual({ error: 'Datos inválidos' });
    expect(sb.tablasLlamadas()).not.toContain('chat_ia_registros_items');
  });
});
