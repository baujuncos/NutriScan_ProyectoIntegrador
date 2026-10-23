/**
 * Fábricas de clientes de Supabase: server (cookies), admin (service role) y browser.
 * Lo importante: el admin nunca se crea sin la service role y no persiste sesión; el de servidor
 * usa la anon key y propaga las cookies que renueva Supabase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createServerClientMock, createBrowserClientMock, createClientMock, cookiesMock, cookieStore } = vi.hoisted(() => {
  const cookieStore = { getAll: vi.fn(() => [{ name: 'a', value: '1' }]), set: vi.fn() };
  return {
    createServerClientMock: vi.fn(() => ({ tag: 'server' })),
    createBrowserClientMock: vi.fn(() => ({ tag: 'browser' })),
    createClientMock: vi.fn(() => ({ tag: 'admin' })),
    cookiesMock: vi.fn(async () => cookieStore),
    cookieStore,
  };
});

vi.mock('@supabase/ssr', () => ({ createServerClient: createServerClientMock, createBrowserClient: createBrowserClientMock }));
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));
vi.mock('next/headers', () => ({ cookies: cookiesMock }));

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createBrowser } from '@/lib/supabase/client';
import { createClient as createServer } from '@/lib/supabase/server';

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('SUPABASE_URL', 'https://proyecto.supabase.co');
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');
});

describe('createAdminClient', () => {
  it('crea el cliente con la service role y sin persistir sesión', () => {
    createAdminClient();
    expect(createClientMock).toHaveBeenCalledWith('https://proyecto.supabase.co', 'service', {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  it('usa NEXT_PUBLIC_SUPABASE_URL si falta SUPABASE_URL (desarrollo local)', () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://local.supabase.co');
    createAdminClient();
    expect(createClientMock.mock.calls[0]).toEqual(['https://local.supabase.co', 'service', expect.anything()]);
  });

  it.each([
    ['sin URL', { SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_URL: '' }],
    ['sin service role', { SUPABASE_SERVICE_ROLE_KEY: '' }],
  ])('%s → lanza error de configuración', (_caso, env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    expect(() => createAdminClient()).toThrow('Supabase admin no configurado');
    expect(createClientMock).not.toHaveBeenCalled();
  });
});

describe('createClient (servidor)', () => {
  it('usa la anon key y entrega las cookies de la request', async () => {
    await createServer();
    const [url, key, opts] = createServerClientMock.mock.calls[0] as unknown as [string, string, { cookies: { getAll(): unknown; setAll(c: unknown[]): void } }];
    expect([url, key]).toEqual(['https://proyecto.supabase.co', 'anon']);
    expect(opts.cookies.getAll()).toEqual([{ name: 'a', value: '1' }]);
  });

  it('escribe las cookies renovadas y no rompe si se llama desde un Server Component (set lanza)', async () => {
    await createServer();
    const { cookies } = (createServerClientMock.mock.calls[0] as unknown as [string, string, { cookies: { setAll(c: unknown[]): void } }])[2];
    cookies.setAll([{ name: 'sb', value: 'x', options: { path: '/' } }]);
    expect(cookieStore.set).toHaveBeenCalledWith('sb', 'x', { path: '/' });
    cookieStore.set.mockImplementationOnce(() => {
      throw new Error('solo lectura');
    });
    expect(() => cookies.setAll([{ name: 'sb', value: 'y' }])).not.toThrow();
  });

  it('sin variables de entorno usa strings vacíos (no revienta al importar)', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.unstubAllEnvs();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    await createServer();
    expect(createServerClientMock.mock.calls[0].slice(0, 2)).toEqual(['', '']);
  });
});

describe('createClient (navegador)', () => {
  it('crea el cliente del navegador con la URL y la anon key', () => {
    createBrowser();
    expect(createBrowserClientMock).toHaveBeenCalledWith('https://proyecto.supabase.co', 'anon');
  });

  it('sin variables de entorno usa strings vacíos', () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    createBrowser();
    expect(createBrowserClientMock).toHaveBeenCalledWith('', '');
  });
});
