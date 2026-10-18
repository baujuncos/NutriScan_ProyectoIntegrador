/**
 * Fix escalada de rol — /auth/callback: el alta de investigador solo vale con
 * `app_metadata.role` (service role) o con el código de invitación en la
 * cookie, y se inserta con el cliente ADMIN (el trigger de profiles no deja
 * que un usuario común se asigne ese rol). `user_metadata.role` lo escribe el
 * propio usuario y NO se confía.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSupabaseFromMock } from './supabaseMock';

const { exchangeMock, getUserMock } = vi.hoisted(() => ({ exchangeMock: vi.fn(), getUserMock: vi.fn() }));
const userDb = createSupabaseFromMock();
const adminDb = createSupabaseFromMock();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: exchangeMock, getUser: getUserMock },
    from: userDb.from,
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: adminDb.from }) }));

import { GET } from '@/app/auth/callback/route';
import { INV_CODE_COOKIE } from '@/lib/inv-code-cookie';

const request = (cookie?: string) =>
  new NextRequest('http://localhost/auth/callback?code=abc', {
    headers: cookie ? { cookie: `${INV_CODE_COOKIE}=${cookie}` } : {},
  });

const usuario = (over: Record<string, unknown> = {}) => ({
  id: 'user-1',
  email: 'alguien@gmail.com',
  user_metadata: { nombre: 'Ana', apellido: 'Pérez' },
  app_metadata: {},
  ...over,
});

const insertsPerfil = (db: ReturnType<typeof createSupabaseFromMock>) =>
  db.insertsLlamados().filter((i) => i.tabla === 'profiles').map((i) => i.payload as { role: string });

beforeEach(() => {
  vi.stubEnv('INVITATION_CODE_INVESTIGADOR', 'secreto');
  exchangeMock.mockReset().mockResolvedValue({ error: null });
  getUserMock.mockReset();
  userDb.reset();
  adminDb.reset();
  userDb.mockTable('profiles', { data: null, error: null }); // todavía no tiene perfil
});

describe('GET /auth/callback — alta de investigador', () => {
  it('user_metadata.role="investigador" FORJADO por el usuario → queda particular (no investigador)', async () => {
    getUserMock.mockResolvedValue({
      data: { user: usuario({ user_metadata: { nombre: 'Ana', apellido: 'Pérez', role: 'investigador' } }) },
    });
    await GET(request());
    expect(insertsPerfil(userDb)).toEqual([expect.objectContaining({ role: 'particular' })]);
    expect(insertsPerfil(adminDb)).toEqual([]);
  });

  it('app_metadata.role="investigador" (lo puso /api/register con service role) → investigador, insertado con el cliente admin', async () => {
    getUserMock.mockResolvedValue({ data: { user: usuario({ app_metadata: { role: 'investigador' } }) } });
    await GET(request());
    expect(insertsPerfil(adminDb)).toEqual([expect.objectContaining({ role: 'investigador', user_id: 'user-1' })]);
    expect(insertsPerfil(userDb)).toEqual([]);
  });

  it('cookie con el código correcto (Google) → investigador vía cliente admin y se borra la cookie', async () => {
    getUserMock.mockResolvedValue({ data: { user: usuario() } });
    const res = await GET(request('secreto'));
    expect(insertsPerfil(adminDb)).toEqual([expect.objectContaining({ role: 'investigador' })]);
    expect(insertsPerfil(userDb)).toEqual([]);
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`${INV_CODE_COOKIE}=;`));
  });

  it('cookie con un código incorrecto → particular', async () => {
    getUserMock.mockResolvedValue({ data: { user: usuario() } });
    await GET(request('adivinando'));
    expect(insertsPerfil(userDb)).toEqual([expect.objectContaining({ role: 'particular' })]);
    expect(insertsPerfil(adminDb)).toEqual([]);
  });
});

describe('GET /auth/callback — resto de los casos', () => {
  it('email @ucc.edu.ar sin código → va a /elegir-uso sin crear perfil', async () => {
    getUserMock.mockResolvedValue({ data: { user: usuario({ email: 'ana@ucc.edu.ar' }) } });
    const res = await GET(request());
    expect(res.headers.get('location')).toContain('/elegir-uso');
    expect(insertsPerfil(userDb)).toEqual([]);
    expect(insertsPerfil(adminDb)).toEqual([]);
  });

  it('si ya tiene perfil no crea otro', async () => {
    userDb.reset();
    userDb.mockTable('profiles', { data: { id: 'p', role: 'particular' }, error: null });
    getUserMock.mockResolvedValue({ data: { user: usuario({ app_metadata: { role: 'investigador' } }) } });
    await GET(request());
    expect(insertsPerfil(userDb)).toEqual([]);
    expect(insertsPerfil(adminDb)).toEqual([]);
  });
});
