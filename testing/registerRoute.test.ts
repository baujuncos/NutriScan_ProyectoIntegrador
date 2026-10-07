/**
 * Fix escalada de rol — /api/register: el rol de investigador se guarda en
 * `app_metadata` (solo escribible con service role), no en `user_metadata`
 * (que el usuario puede escribir por su cuenta).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { cookieGet, createUserMock, generateLinkMock, listUsersMock } = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  createUserMock: vi.fn(),
  generateLinkMock: vi.fn(),
  listUsersMock: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: cookieGet }) }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { listUsers: listUsersMock, createUser: createUserMock, generateLink: generateLinkMock } },
  }),
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
  createUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
  generateLinkMock.mockReset().mockResolvedValue({});
});

describe('POST /api/register — rol de investigador', () => {
  it('con el código en la cookie guarda el rol en app_metadata y NO en user_metadata', async () => {
    cookieGet.mockReturnValue({ value: 'secreto' });
    const res = await POST(request(body({ role: 'investigador' })));
    expect(res.status).toBe(201);
    const args = createUserMock.mock.calls[0][0];
    expect(args.app_metadata).toEqual({ role: 'investigador' });
    expect(args.user_metadata).toEqual({ nombre: 'Ana', apellido: 'Pérez' });
    expect(cookieGet).toHaveBeenCalledWith(INV_CODE_COOKIE);
  });

  it('sin cookie o con código incorrecto → 403 y no se crea el usuario', async () => {
    cookieGet.mockReturnValue({ value: 'otro' });
    const res = await POST(request(body({ role: 'investigador' })));
    expect(res.status).toBe(403);
    expect(createUserMock).not.toHaveBeenCalled();

    cookieGet.mockReturnValue(undefined);
    expect((await POST(request(body({ role: 'investigador' })))).status).toBe(403);
  });

  it('alta común (sin role): no manda ningún rol en ninguna metadata', async () => {
    const res = await POST(request(body()));
    expect(res.status).toBe(201);
    const args = createUserMock.mock.calls[0][0];
    expect(args.app_metadata).toBeUndefined();
    expect(args.user_metadata).toEqual({ nombre: 'Ana', apellido: 'Pérez' });
  });

  it('un role distinto de "investigador" en el body se rechaza (400)', async () => {
    const res = await POST(request(body({ role: 'administrador' })));
    expect(res.status).toBe(400);
    expect(createUserMock).not.toHaveBeenCalled();
  });
});
