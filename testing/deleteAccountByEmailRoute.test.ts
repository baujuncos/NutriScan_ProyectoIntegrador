/**
 * /api/admin/delete-account-by-email
 *
 * DEF-003 — el endpoint llamaba `listUsers()` sin paginar: Supabase devuelve solo
 * la primera página (50 usuarios por defecto), así que a cualquier usuario
 * "después" del puesto 50 lo respondía como inexistente (404) y no se borraba.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSupabaseFromMock } from './supabaseMock';

const { listUsersMock, deleteUserMock, borrarFotosMock, holder } = vi.hoisted(() => ({
  listUsersMock: vi.fn(),
  deleteUserMock: vi.fn(),
  borrarFotosMock: vi.fn(),
  holder: { from: (_t: string): unknown => undefined },
}));
const db = createSupabaseFromMock();
holder.from = db.from;

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { listUsers: listUsersMock, deleteUser: deleteUserMock } },
    from: (t: string) => holder.from(t),
  }),
}));
vi.mock('@/lib/fotosDeteccion', () => ({ borrarFotosDeUsuario: borrarFotosMock }));

import { POST } from '@/app/api/admin/delete-account-by-email/route';

const SERVICE_KEY = 'service-role-de-prueba';

function req(body: unknown, key: string | null = SERVICE_KEY) {
  return new NextRequest('http://localhost/api/admin/delete-account-by-email', {
    method: 'POST',
    headers: key === null ? {} : { 'x-admin-key': key },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Simula la paginación real de supabase-js: página 1 y 50 por página si no se pide otra cosa. */
function usuariosPaginados(total: number, emailEn?: { posicion: number; email: string }) {
  const todos = Array.from({ length: total }, (_, i) => ({
    id: `id-${i}`,
    email: emailEn && i === emailEn.posicion ? emailEn.email : `user${i}@example.com`,
  }));
  listUsersMock.mockImplementation(async (params?: { page?: number; perPage?: number }) => {
    const page = params?.page ?? 1;
    const perPage = params?.perPage ?? 50;
    return { data: { users: todos.slice((page - 1) * perPage, page * perPage) }, error: null };
  });
}

beforeEach(() => {
  db.reset();
  listUsersMock.mockReset();
  deleteUserMock.mockReset().mockResolvedValue({ error: null });
  borrarFotosMock.mockReset().mockResolvedValue(undefined);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('/api/admin/delete-account-by-email — autorización y validación', () => {
  it('sin x-admin-key → 401', async () => {
    expect((await POST(req({ email: 'a@b.com' }, null))).status).toBe(401);
    expect(listUsersMock).not.toHaveBeenCalled();
  });

  it('con una clave incorrecta → 401', async () => {
    expect((await POST(req({ email: 'a@b.com' }, 'otra'))).status).toBe(401);
  });

  it('sin SUPABASE_SERVICE_ROLE_KEY configurada nadie puede entrar (ni con clave vacía)', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect((await POST(req({ email: 'a@b.com' }, ''))).status).toBe(401);
  });

  it('cuerpo que no es JSON → 400', async () => {
    expect((await POST(req('esto no es json'))).status).toBe(400);
  });

  it.each([[{}], [{ email: '' }], [{ email: '   ' }]])('sin email válido (%j) → 400', async (body) => {
    expect((await POST(req(body))).status).toBe(400);
  });
});

describe('/api/admin/delete-account-by-email — búsqueda del usuario (DEF-003)', () => {
  it('encuentra a un usuario que está en la tercera página (posición 120 de 130)', async () => {
    // Arrange
    usuariosPaginados(130, { posicion: 120, email: 'objetivo@example.com' });
    // Act
    const res = await POST(req({ email: 'Objetivo@Example.com' }));
    // Assert
    expect(res.status).toBe(200);
    expect(deleteUserMock).toHaveBeenCalledWith('id-120');
  });

  it('valor límite: el último de la primera página (posición 49) y el primero de la segunda (50)', async () => {
    usuariosPaginados(60, { posicion: 49, email: 'p49@example.com' });
    expect((await POST(req({ email: 'p49@example.com' }))).status).toBe(200);
    usuariosPaginados(60, { posicion: 50, email: 'p50@example.com' });
    expect((await POST(req({ email: 'p50@example.com' }))).status).toBe(200);
  });

  it('un email inexistente → 404 y no se borra nada', async () => {
    usuariosPaginados(130);
    const res = await POST(req({ email: 'nadie@example.com' }));
    expect(res.status).toBe(404);
    expect(deleteUserMock).not.toHaveBeenCalled();
    expect(db.tablasLlamadas()).toEqual([]);
  });

  it('error de Supabase al listar → 500', async () => {
    listUsersMock.mockResolvedValue({ data: null, error: { message: 'down' } });
    expect((await POST(req({ email: 'a@b.com' }))).status).toBe(500);
  });
});

describe('/api/admin/delete-account-by-email — borrado', () => {
  it('borra las 6 tablas de dominio, las fotos y por último el usuario de Auth', async () => {
    usuariosPaginados(3, { posicion: 1, email: 'ana@example.com' });
    const res = await POST(req({ email: 'ana@example.com' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(db.tablasLlamadas()).toEqual(['ingestas', 'hidratacion', 'physical_data', 'academic_data', 'psychological_surveys', 'profiles']);
    expect(borrarFotosMock).toHaveBeenCalledWith(expect.anything(), 'id-1');
    expect(body.tableResults).toMatchObject({ ingestas: 'ok', profiles: 'ok' });
  });

  it('si una tabla falla se informa en tableResults pero se sigue con el resto', async () => {
    usuariosPaginados(2, { posicion: 0, email: 'ana@example.com' });
    db.mockTable('ingestas', { data: null, error: { message: 'fk violation' } });
    const body = await (await POST(req({ email: 'ana@example.com' }))).json();
    expect(body.tableResults.ingestas).toBe('fk violation');
    expect(body.tableResults.profiles).toBe('ok');
  });

  it('si Auth no puede borrar al usuario → 500 con el detalle', async () => {
    usuariosPaginados(2, { posicion: 0, email: 'ana@example.com' });
    deleteUserMock.mockResolvedValue({ error: { message: 'auth down' } });
    const res = await POST(req({ email: 'ana@example.com' }));
    expect(res.status).toBe(500);
    expect((await res.json()).detail).toBe('auth down');
  });
});
