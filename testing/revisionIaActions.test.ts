/**
 * NUT-149 — Acciones del equipo de nutrición sobre la cola de revisión:
 * rol, signed URL (una sola, al abrir el ítem) y que Confirmar / Corregir /
 * Candidato llamen a su RPC sin enviar ni pisar datos de Gemini ni del usuario.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';
import { TTL_URL_FIRMADA_S } from '@/lib/fotosDeteccion';

const { getUserMock, revalidatePathMock } = vi.hoisted(() => ({ getUserMock: vi.fn(), revalidatePathMock: vi.fn() }));
const sb = createSupabaseFromMock();

vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: sb.from, rpc: sb.rpc, storage: sb.storage }),
}));

import {
  confirmarRevisionAction,
  corregirRevisionAction,
  getRevisionDetalleAction,
  marcarCandidatoAction,
} from '@/app/(researcher)/revision-ia/actions';

const FILA = {
  id_deteccion_item: 9,
  alimento_ia: 'Milanesa',
  gramos_ia: 150,
  confidence: 0.4,
  motivos_revision: ['confianza_baja'],
  estado_revision: 'pendiente',
  imagen_path: 'user-1/foto.jpg',
};

function comoRol(role: string | null) {
  getUserMock.mockResolvedValue({ data: { user: { id: 'inv-1' } } });
  sb.mockTable('profiles', { data: role ? { role } : null, error: null });
}

beforeEach(() => {
  sb.reset();
  getUserMock.mockReset();
  revalidatePathMock.mockReset();
});

describe('re-verificación de rol', () => {
  const acciones = [
    () => getRevisionDetalleAction(9),
    () => confirmarRevisionAction(9),
    () => corregirRevisionAction({ id: 9, alimento: 'Pollo', gramos: 100 }),
    () => marcarCandidatoAction(9, true),
  ];

  it('sin sesión → error y sin RPC ni storage', async () => {
    for (const accion of acciones) {
      getUserMock.mockResolvedValue({ data: { user: null } });
      expect(await accion()).toEqual({ error: 'No autenticado' });
    }
    expect(sb.rpcLlamadas()).toHaveLength(0);
    expect(sb.storageLlamadas()).toHaveLength(0);
  });

  it.each(['deportista_ucc', 'particular', null])('rol %s → Acceso denegado', async (rol) => {
    for (const accion of acciones) {
      comoRol(rol);
      expect(await accion()).toEqual({ error: 'Acceso denegado' });
    }
    expect(sb.rpcLlamadas()).toHaveLength(0);
    expect(sb.storageLlamadas()).toHaveLength(0);
  });
});

describe('getRevisionDetalleAction — foto', () => {
  it('genera UNA signed URL con TTL corto, sólo para ese ítem', async () => {
    comoRol('investigador');
    sb.mockTable('v_revision_ia', { data: FILA, error: null });
    sb.mockStorage('createSignedUrls', { data: [{ path: 'user-1/foto.jpg', signedUrl: 'https://x/firmada' }], error: null });

    const r = await getRevisionDetalleAction(9);

    expect(r).toMatchObject({ ok: true, fotoUrl: 'https://x/firmada' });
    const firmas = sb.storageLlamadas().filter((l) => l.metodo === 'createSignedUrls');
    expect(firmas).toHaveLength(1);
    expect(firmas[0]).toMatchObject({ bucket: 'detecciones-fotos', args: [['user-1/foto.jpg'], TTL_URL_FIRMADA_S] });
    expect(TTL_URL_FIRMADA_S).toBeLessThanOrEqual(600);
  });

  it('sin imagen_path no pide ninguna URL', async () => {
    comoRol('investigador');
    sb.mockTable('v_revision_ia', { data: { ...FILA, imagen_path: null }, error: null });
    const r = await getRevisionDetalleAction(9);
    expect(r).toMatchObject({ ok: true, fotoUrl: null });
    expect(sb.storageLlamadas()).toHaveLength(0);
  });

  it('ítem inexistente → error', async () => {
    comoRol('investigador');
    sb.mockTable('v_revision_ia', { data: null, error: { message: 'no rows' } });
    expect(await getRevisionDetalleAction(9)).toEqual({ error: 'El ítem ya no está en la cola de revisión' });
  });

  it('id inválido → error sin tocar nada', async () => {
    expect(await getRevisionDetalleAction(-1)).toEqual({ error: 'Datos inválidos' });
    expect(sb.tablasLlamadas()).toHaveLength(0);
  });
});

describe('acciones — independientes y sin pisar datos originales', () => {
  it('confirmar llama sólo a revision_ia_confirmar con el id', async () => {
    comoRol('investigador');
    expect(await confirmarRevisionAction(9)).toEqual({ ok: true });
    expect(sb.rpcLlamadas()).toEqual([{ nombre: 'revision_ia_confirmar', args: { p_id: 9 } }]);
    expect(revalidatePathMock).toHaveBeenCalledWith('/revision-ia');
  });

  it('corregir manda sólo los valores del nutricionista', async () => {
    comoRol('administrador');
    expect(await corregirRevisionAction({ id: 9, alimento: ' Pollo al horno ', gramos: 180 })).toEqual({ ok: true });
    expect(sb.rpcLlamadas()).toEqual([
      { nombre: 'revision_ia_corregir', args: { p_id: 9, p_alimento: 'Pollo al horno', p_gramos: 180 } },
    ]);
  });

  it('corregir acepta sólo alimento o sólo peso, pero no ninguno ni peso ≤ 0', async () => {
    comoRol('investigador');
    expect(await corregirRevisionAction({ id: 9, alimento: 'Pollo' })).toEqual({ ok: true });
    comoRol('investigador');
    expect(await corregirRevisionAction({ id: 9, gramos: 120 })).toEqual({ ok: true });
    expect(await corregirRevisionAction({ id: 9, alimento: '  ', gramos: null })).toMatchObject({ error: expect.any(String) });
    expect(await corregirRevisionAction({ id: 9, gramos: 0 })).toMatchObject({ error: expect.any(String) });
    expect(sb.rpcLlamadas()).toHaveLength(2);
  });

  it('marcar candidato llama a su RPC y no toca el estado de la revisión', async () => {
    comoRol('investigador');
    expect(await marcarCandidatoAction(9, true)).toEqual({ ok: true });
    expect(sb.rpcLlamadas()).toEqual([{ nombre: 'revision_ia_marcar_candidato', args: { p_id: 9, p_valor: true } }]);
  });

  it('ninguna acción escribe directamente en tablas (todo por RPC)', async () => {
    comoRol('investigador');
    await confirmarRevisionAction(9);
    expect(sb.insertsLlamados()).toHaveLength(0);
  });

  it('traduce los errores de las RPCs', async () => {
    comoRol('investigador');
    sb.mockRpc('revision_ia_confirmar', { data: null, error: { message: 'ESTADO_INVALIDO' } });
    expect(await confirmarRevisionAction(9)).toEqual({ error: 'Este ítem ya fue revisado por otra persona' });
    comoRol('investigador');
    sb.mockRpc('revision_ia_confirmar', { data: null, error: { message: 'NOT_FOUND' } });
    expect(await confirmarRevisionAction(9)).toEqual({ error: 'El ítem ya no está en la cola de revisión' });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
