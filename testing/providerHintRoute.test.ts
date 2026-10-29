/**
 * /api/auth/provider-hint — dice si un email se registró solo con un proveedor OAuth.
 * Tabla de decisión sobre los proveedores detectados del usuario:
 *   usuario existe | proveedores             | hint
 *   no             | —                       | unknown
 *   sí             | [] (ninguno)            | unknown
 *   sí             | ['email']               | unknown
 *   sí             | ['email','google']      | unknown
 *   sí             | ['google']              | google_only
 *   sí             | ['github'] (otro OAuth) | google_only (se sugiere OAuth igual)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { listUsersMock } = vi.hoisted(() => ({ listUsersMock: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ auth: { admin: { listUsers: listUsersMock } } }),
}));

import { POST } from '@/app/api/auth/provider-hint/route';

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/auth/provider-hint', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const conUsuario = (user: Record<string, unknown> | null) =>
  listUsersMock.mockResolvedValue({ data: { users: user ? [{ email: 'ana@example.com', ...user }] : [] }, error: null });

beforeEach(() => {
  listUsersMock.mockReset();
  vi.stubEnv('NODE_ENV', 'production');
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('/api/auth/provider-hint — entrada inválida (siempre 200 con "unknown")', () => {
  it.each([
    ['JSON inválido', 'no es json'],
    ['sin email', {}],
    ['email mal formado', { email: 'esto-no-es-un-mail' }],
  ])('%s', async (_caso, body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hint: 'unknown' });
    expect(listUsersMock).not.toHaveBeenCalled();
  });
});

describe('/api/auth/provider-hint — decisión por proveedores', () => {
  it.each([
    ['usuario inexistente', null, 'unknown'],
    ['sin proveedores', {}, 'unknown'],
    ['solo email', { app_metadata: { providers: ['email'] } }, 'unknown'],
    ['email + google', { app_metadata: { providers: ['email', 'google'] } }, 'unknown'],
    ['solo google (app_metadata.providers)', { app_metadata: { providers: ['google'] } }, 'google_only'],
    ['solo google (app_metadata.provider)', { app_metadata: { provider: 'google' } }, 'google_only'],
    ['solo google (user_metadata.provider_id)', { user_metadata: { provider_id: 'google' } }, 'google_only'],
    ['solo google (identities)', { identities: [{ provider: 'google' }] }, 'google_only'],
    ['otro OAuth distinto de google', { app_metadata: { providers: ['github'] } }, 'google_only'],
    ['identities con email y google', { identities: [{ provider: 'google' }, { provider: 'email' }] }, 'unknown'],
  ])('%s → %s', async (_caso, user, hint) => {
    conUsuario(user);
    const res = await POST(req({ email: 'Ana@Example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hint });
  });

  it('en producción la respuesta NO incluye el objeto del usuario ni datos de depuración', async () => {
    conUsuario({ app_metadata: { providers: ['google'] } });
    const body = await (await POST(req({ email: 'ana@example.com' }))).json();
    expect(body).not.toHaveProperty('debug');
  });

  it('fuera de producción agrega información de depuración', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    conUsuario({ app_metadata: { providers: ['google'] } });
    const body = await (await POST(req({ email: 'ana@example.com' }))).json();
    expect(body.debug).toMatchObject({ found: true, providers: ['google'] });
  });
});

describe('/api/auth/provider-hint — fallas de Supabase', () => {
  it('si Supabase falla responde 200 "unknown" (no bloquea el login)', async () => {
    listUsersMock.mockResolvedValue({ data: null, error: new Error('down') });
    const res = await POST(req({ email: 'ana@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hint: 'unknown' });
  });

  it('fuera de producción el error se informa en debug', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    listUsersMock.mockResolvedValue({ data: null, error: new Error('down') });
    const body = await (await POST(req({ email: 'ana@example.com' }))).json();
    expect(body.debug).toMatchObject({ found: false });
  });
});
