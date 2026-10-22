/**
 * NUT-149 — Acciones del equipo de nutrición sobre la cola de revisión:
 * rol, signed URL (una sola, al abrir el ítem) y que Confirmar / Corregir /
 * Candidato llamen a su RPC sin enviar ni pisar datos de Gemini ni del usuario.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';
import { TTL_URL_LISTA_S } from '@/lib/fotosDeteccion';

const { getUserMock, revalidatePathMock } = vi.hoisted(() => ({ getUserMock: vi.fn(), revalidatePathMock: vi.fn() }));
const sb = createSupabaseFromMock();

vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: sb.from, rpc: sb.rpc, storage: sb.storage }),
}));

import {
  confirmarRevisionAction,
  corregirRevisionAction,
  marcarCandidatoAction,
  renovarFotoAction,
} from '@/app/(researcher)/revision-ia/actions';

const FOTO = '3f2b8c1e-5a7d-4e9f-8a6b-1c2d3e4f5a6b/9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a.jpg';

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
    () => renovarFotoAction(FOTO),
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

describe('renovarFotoAction — URL vencida', () => {
  it('firma UNA URL nueva de 10 minutos, sólo para esa foto', async () => {
    comoRol('investigador');
    sb.mockStorage('createSignedUrls', { data: [{ path: FOTO, signedUrl: 'https://x/nueva' }], error: null });

    expect(await renovarFotoAction(FOTO)).toEqual({ ok: true, url: 'https://x/nueva' });

    const firmas = sb.storageLlamadas().filter((l) => l.metodo === 'createSignedUrls');
    expect(firmas).toHaveLength(1);
    expect(firmas[0]).toMatchObject({ bucket: 'detecciones-fotos', args: [[FOTO], TTL_URL_LISTA_S] });
    expect(TTL_URL_LISTA_S).toBe(600);
  });

  it('si no se puede firmar devuelve un error (sin exponer nada)', async () => {
    comoRol('investigador');
    sb.mockStorage('createSignedUrls', { data: [{ path: FOTO, signedUrl: null }], error: null });
    expect(await renovarFotoAction(FOTO)).toEqual({ error: 'No se pudo cargar la foto' });
  });

  it('rechaza rutas que no son una foto de detección ({id_usuario}/{uuid}.jpg) sin tocar Storage', async () => {
    for (const mala of ['user-1/foto.jpg', '../otro/x.jpg', `${FOTO}.png`, '']) {
      expect(await renovarFotoAction(mala)).toEqual({ error: 'Datos inválidos' });
    }
    expect(sb.storageLlamadas()).toHaveLength(0);
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
