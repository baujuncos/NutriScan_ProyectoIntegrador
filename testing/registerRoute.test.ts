/**
 * Fix escalada de rol — /api/register: el rol de investigador se guarda en
 * `app_metadata` (solo escribible con service role), no en `user_metadata`
 * (que el usuario puede escribir por su cuenta).
 *
 * El alta usa `signUp` (que hace que Supabase envíe el mail de confirmación); el rol se escribe
 * después con el cliente admin.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { cookieGet, signUpMock, updateUserByIdMock, deleteUserMock, listUsersMock } = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  signUpMock: vi.fn(),
  updateUserByIdMock: vi.fn(),
  deleteUserMock: vi.fn(),
  listUsersMock: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: cookieGet }) }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: {
      admin: { listUsers: listUsersMock, updateUserById: updateUserByIdMock, deleteUser: deleteUserMock },
    },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signUp: signUpMock } }),
}));

import { POST } from '@/app/api/register/route';
import { INV_CODE_COOKIE } from '@/lib/inv-code-cookie';

const body = (over: Record<string, unknown> = {}) => ({
  email: 'Ana@Example.com',
  password: 'Abcdef1!ghij',
  nombre: 'Ana',
  apellido: 'Pérez',
  ...over,
});

const request = (json: unknown) =>
  ({ json: async () => json, nextUrl: { origin: 'http://localhost' } }) as unknown as NextRequest;

beforeEach(() => {
  vi.stubEnv('INVITATION_CODE_INVESTIGADOR', 'secreto');
  cookieGet.mockReset();
  listUsersMock.mockReset().mockResolvedValue({ data: { users: [] }, error: null });
  signUpMock.mockReset().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
  updateUserByIdMock.mockReset().mockResolvedValue({ error: null });
  deleteUserMock.mockReset().mockResolvedValue({ error: null });
});

describe('POST /api/register — rol de investigador', () => {
  it('con el código en la cookie guarda el rol en app_metadata y NO en user_metadata', async () => {
    cookieGet.mockReturnValue({ value: 'secreto' });
    const res = await POST(request(body({ role: 'investigador' })));
    expect(res.status).toBe(201);
    const args = signUpMock.mock.calls[0][0];
    expect(args.options.data).toEqual({ nombre: 'Ana', apellido: 'Pérez' });
    expect(updateUserByIdMock).toHaveBeenCalledWith('u-1', { app_metadata: { role: 'investigador' } });
    expect(cookieGet).toHaveBeenCalledWith(INV_CODE_COOKIE);
  });

  it('si no se puede escribir el rol, se borra el usuario y responde 500', async () => {
    cookieGet.mockReturnValue({ value: 'secreto' });
    updateUserByIdMock.mockResolvedValue({ error: { message: 'boom' } });
    const res = await POST(request(body({ role: 'investigador' })));
    expect(res.status).toBe(500);
    expect(deleteUserMock).toHaveBeenCalledWith('u-1');
  });

  it('sin cookie o con código incorrecto → 403 y no se crea el usuario', async () => {
    cookieGet.mockReturnValue({ value: 'otro' });
    const res = await POST(request(body({ role: 'investigador' })));
    expect(res.status).toBe(403);
    expect(signUpMock).not.toHaveBeenCalled();

    cookieGet.mockReturnValue(undefined);
    expect((await POST(request(body({ role: 'investigador' })))).status).toBe(403);
  });

  it('alta común (sin role): no manda ningún rol en ninguna metadata', async () => {
    const res = await POST(request(body()));
    expect(res.status).toBe(201);
    const args = signUpMock.mock.calls[0][0];
    expect(args.options.data).toEqual({ nombre: 'Ana', apellido: 'Pérez' });
    expect(args.options.emailRedirectTo).toBe('http://localhost/auth/callback');
    expect(updateUserByIdMock).not.toHaveBeenCalled();
  });

  it('un role distinto de "investigador" en el body se rechaza (400)', async () => {
    const res = await POST(request(body({ role: 'administrador' })));
    expect(res.status).toBe(400);
    expect(signUpMock).not.toHaveBeenCalled();
  });
});
