/**
 * POST /api/delete-account — el usuario borra su propia cuenta (Bearer token + confirmación por email).
 * Particiones: sin token (401) / token inválido (401) / JSON inválido (400) / sin email (400) /
 * email de otra cuenta (403) / éxito (200) / falla al borrar el usuario de Auth (500).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock, deleteUserMock, borrarFotosMock, holder } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  deleteUserMock: vi.fn(),
  borrarFotosMock: vi.fn(),
  holder: { from: (_t: string): unknown => undefined },
}));
const db = createSupabaseFromMock();
holder.from = db.from;

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { getUser: getUserMock, admin: { deleteUser: deleteUserMock } },
    from: (t: string) => holder.from(t),
  }),
}));
vi.mock('@/lib/fotosDeteccion', () => ({ borrarFotosDeUsuario: borrarFotosMock }));

import { POST } from '@/app/api/delete-account/route';

const req = (body: unknown, token: string | null = 'tok') =>
  new NextRequest('http://localhost/api/delete-account', {
    method: 'POST',
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(() => {
  db.reset();
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u-1', email: 'Ana@Example.com' } }, error: null });
  deleteUserMock.mockReset().mockResolvedValue({ error: null });
  borrarFotosMock.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/delete-account — autenticación y validación', () => {
  it('sin token → 401 y no se borra nada', async () => {
    const res = await POST(req({ email: 'ana@example.com' }, null));
    expect(res.status).toBe(401);
    expect(getUserMock).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('token inválido → 401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } });
    expect((await POST(req({ email: 'ana@example.com' }))).status).toBe(401);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('cuerpo que no es JSON → 400', async () => {
    expect((await POST(req('no json'))).status).toBe(400);
  });

  it.each([[{}], [{ email: '' }], [null], ['solo texto']])('sin email (%j) → 400', async (body) => {
    expect((await POST(req(JSON.stringify(body)))).status).toBe(400);
  });

  it('un email que no es el de la cuenta del token → 403 (no se puede borrar a otro)', async () => {
    const res = await POST(req({ email: 'otra@example.com' }));
    expect(res.status).toBe(403);
    expect(deleteUserMock).not.toHaveBeenCalled();
    expect(db.tablasLlamadas()).toEqual([]);
  });
});

describe('POST /api/delete-account — borrado', () => {
  it('el email se compara sin distinguir mayúsculas ni espacios y borra todo en orden', async () => {
    const res = await POST(req({ email: '  ANA@example.com ' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(db.tablasLlamadas()).toEqual(['ingestas', 'hidratacion', 'physical_data', 'academic_data', 'psychological_surveys', 'profiles']);
    expect(borrarFotosMock).toHaveBeenCalledWith(expect.anything(), 'u-1');
    expect(deleteUserMock).toHaveBeenCalledWith('u-1');
    expect(body.ok).toBe(true);
  });

  it('cada tabla se filtra por el id del usuario del token (nunca por datos del body)', async () => {
    await POST(req({ email: 'ana@example.com' }));
    const filtros = db.eqLlamados().map((f) => f.args);
    expect(filtros).toContainEqual(['id_usuario', 'u-1']);
    expect(filtros).toContainEqual(['user_id', 'u-1']);
    expect(filtros.every(([, valor]) => valor === 'u-1')).toBe(true);
  });

  it('si falla el borrado de una tabla se informa pero se continúa', async () => {
    db.mockTable('hidratacion', { data: null, error: { message: 'permiso denegado' } });
    const body = await (await POST(req({ email: 'ana@example.com' }))).json();
    expect(body.tableResults.hidratacion).toBe('permiso denegado');
    expect(body.tableResults.profiles).toBe('ok');
  });

  it('si Auth no puede borrar al usuario → 500 con el detalle y el estado por tabla', async () => {
    deleteUserMock.mockResolvedValue({ error: { message: 'auth caído' } });
    const res = await POST(req({ email: 'ana@example.com' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.detail).toBe('auth caído');
    expect(body.tableResults.ingestas).toBe('ok');
  });
});
