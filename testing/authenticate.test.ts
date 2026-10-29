/**
 * authenticate() — sesión por cookie (app web) o por "Authorization: Bearer" (scripts, Postman, E2E).
 * Clases de equivalencia del header: sin header / "Bearer <token válido>" / "Bearer <token inválido>" /
 * "Bearer " vacío / esquema distinto (Basic).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { createSupabaseClientMock, getUserBearerMock, serverCreateClientMock, getUserCookieMock } = vi.hoisted(() => ({
  createSupabaseClientMock: vi.fn(),
  getUserBearerMock: vi.fn(),
  serverCreateClientMock: vi.fn(),
  getUserCookieMock: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: createSupabaseClientMock }));
vi.mock('@/lib/supabase/server', () => ({ createClient: serverCreateClientMock }));

import { authenticate } from '@/lib/chat/authenticate';

const req = (authorization?: string) =>
  new NextRequest('http://localhost/api/x', { headers: authorization === undefined ? {} : { authorization } });

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://proyecto.supabase.co');
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key-de-prueba');
  createSupabaseClientMock.mockReset().mockReturnValue({ auth: { getUser: getUserBearerMock }, tag: 'bearer' });
  getUserBearerMock.mockReset();
  getUserCookieMock.mockReset();
  serverCreateClientMock.mockReset().mockResolvedValue({ auth: { getUser: getUserCookieMock }, tag: 'cookie' });
});

describe('authenticate — Bearer token', () => {
  it('token válido → devuelve el userId y un cliente con el token del usuario (respeta RLS)', async () => {
    // Arrange
    getUserBearerMock.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
    // Act
    const auth = await authenticate(req('Bearer tok-123'));
    // Assert
    expect(auth?.userId).toBe('u-1');
    expect(getUserBearerMock).toHaveBeenCalledWith('tok-123');
    const [url, key, opts] = createSupabaseClientMock.mock.calls[0];
    expect(url).toBe('https://proyecto.supabase.co');
    expect(key).toBe('anon-key-de-prueba'); // nunca la service role
    expect(opts.global.headers.Authorization).toBe('Bearer tok-123');
    expect(serverCreateClientMock).not.toHaveBeenCalled();
  });

  it('token inválido o vencido → null', async () => {
    getUserBearerMock.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } });
    expect(await authenticate(req('Bearer vencido'))).toBeNull();
  });

  it('Supabase responde sin error pero sin usuario → null', async () => {
    getUserBearerMock.mockResolvedValue({ data: { user: null }, error: null });
    expect(await authenticate(req('Bearer raro'))).toBeNull();
  });

  it('ignora espacios alrededor del token', async () => {
    getUserBearerMock.mockResolvedValue({ data: { user: { id: 'u-2' } }, error: null });
    await authenticate(req('Bearer   tok-con-espacios  '));
    expect(getUserBearerMock).toHaveBeenCalledWith('tok-con-espacios');
  });
});

describe('authenticate — cookie de sesión', () => {
  it('sin header usa la sesión por cookie', async () => {
    getUserCookieMock.mockResolvedValue({ data: { user: { id: 'u-3' } } });
    const auth = await authenticate(req());
    expect(auth?.userId).toBe('u-3');
    expect(createSupabaseClientMock).not.toHaveBeenCalled();
  });

  it('sin header y sin sesión → null', async () => {
    getUserCookieMock.mockResolvedValue({ data: { user: null } });
    expect(await authenticate(req())).toBeNull();
  });

  it.each([['Bearer '], ['Bearer    '], ['Basic dXNlcjpwYXNz']])('header %j se trata como sin token y cae a la cookie', async (header) => {
    getUserCookieMock.mockResolvedValue({ data: { user: null } });
    expect(await authenticate(req(header))).toBeNull();
    expect(getUserCookieMock).toHaveBeenCalled();
    expect(createSupabaseClientMock).not.toHaveBeenCalled();
  });
});
