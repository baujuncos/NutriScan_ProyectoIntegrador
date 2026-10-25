/**
 * proxy.ts (middleware de Next.js): decide a dónde va cada request según sesión, rol y onboarding.
 *
 * Tabla de decisión (ruta → resultado):
 *  sesión | ruta         | perfil                                  | resultado
 *  no     | pública      | —                                       | pasa
 *  no     | /api/*       | —                                       | pasa (cada API valida por su cuenta)
 *  no     | protegida    | —                                       | redirect /login
 *  sí     | /login       | sin perfil (recién creado por OAuth)    | pasa
 *  sí     | /login       | investigador                            | redirect /dashboard
 *  sí     | /login       | particular completo                     | redirect /home
 *  sí     | /login       | particular sin perfil físico            | redirect /perfil-fisico
 *  sí     | /login       | deportista sin académico / sin encuesta | redirect /perfil-academico, /encuesta-psicologica
 *  sí     | /auth/callback | cualquiera                            | pasa
 *  sí     | /home        | onboarding incompleto                   | redirect al paso pendiente
 *  sí     | /perfil-fisico | onboarding completo                   | redirect /home (o /dashboard)
 *  sí     | /home        | onboarding completo                     | pasa
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { createServerClientMock, getUserMock, singleMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  getUserMock: vi.fn(),
  singleMock: vi.fn(),
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: createServerClientMock }));

import { proxy, config } from '@/proxy';

const completo = { role: 'particular', physical_completed: true, academic_completed: false, psychological_completed: false };

function req(pathname: string) {
  return new NextRequest(`http://localhost${pathname}`);
}
const conSesion = (perfil: Record<string, unknown> | null) => {
  getUserMock.mockResolvedValue({ data: { user: { id: 'u-1' } } });
  singleMock.mockResolvedValue({ data: perfil });
};
const destino = (res: Response) => (res.headers.get('location') ? new URL(res.headers.get('location')!).pathname : null);

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://proyecto.supabase.co');
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon');
  getUserMock.mockReset().mockResolvedValue({ data: { user: null } });
  singleMock.mockReset().mockResolvedValue({ data: null });
  createServerClientMock.mockReset().mockImplementation(() => ({
    auth: { getUser: getUserMock },
    from: () => ({ select: () => ({ eq: () => ({ single: singleMock }) }) }),
  }));
});

describe('proxy — sin sesión', () => {
  it.each([['/'], ['/login'], ['/register'], ['/register/investigador'], ['/auth/callback'], ['/auth/reset-password'], ['/api/chat/meal']])(
    'ruta pública %s pasa',
    async (ruta) => {
      const res = await proxy(req(ruta));
      expect(res.headers.get('location')).toBeNull();
    },
  );

  it.each([['/home'], ['/alimentacion'], ['/dashboard'], ['/perfil'], ['/validacion']])('ruta protegida %s → /login', async (ruta) => {
    expect(destino(await proxy(req(ruta)))).toBe('/login');
  });
});

describe('proxy — con sesión en rutas públicas', () => {
  it('/login sin perfil todavía (alta con Google) → pasa', async () => {
    conSesion(null);
    expect((await proxy(req('/login'))).headers.get('location')).toBeNull();
  });

  it('/login de un investigador → /dashboard', async () => {
    conSesion({ ...completo, role: 'investigador' });
    expect(destino(await proxy(req('/login')))).toBe('/dashboard');
  });

  it('/login de un particular con todo completo → /home', async () => {
    conSesion({ ...completo, academic_completed: true });
    expect(destino(await proxy(req('/login')))).toBe('/home');
  });

  it.each([
    ['particular sin perfil físico', { ...completo, physical_completed: false }, '/perfil-fisico'],
    ['deportista sin perfil físico', { ...completo, role: 'deportista_ucc', physical_completed: false }, '/perfil-fisico'],
    ['deportista sin perfil académico', { ...completo, role: 'deportista_ucc' }, '/perfil-academico'],
    ['deportista sin encuesta', { ...completo, role: 'deportista_ucc', academic_completed: true }, '/encuesta-psicologica'],
  ])('/login de %s → paso pendiente %s', async (_caso, perfil, esperado) => {
    conSesion(perfil);
    expect(destino(await proxy(req('/login')))).toBe(esperado);
  });

  it('/auth/callback con sesión siempre pasa (lo resuelve la ruta)', async () => {
    conSesion({ ...completo, role: 'investigador' });
    expect((await proxy(req('/auth/callback'))).headers.get('location')).toBeNull();
  });

  it('/api/* con sesión no redirige', async () => {
    conSesion({ ...completo, role: 'investigador' });
    expect((await proxy(req('/api/chat/meal'))).headers.get('location')).toBeNull();
  });
});

describe('proxy — con sesión en rutas protegidas', () => {
  it.each([['/home'], ['/dashboard'], ['/alimentacion'], ['/alimentacion/algo']])('%s con onboarding incompleto → /perfil-fisico', async (ruta) => {
    conSesion({ ...completo, physical_completed: false });
    expect(destino(await proxy(req(ruta)))).toBe('/perfil-fisico');
  });

  it('/home con todo completo → pasa', async () => {
    conSesion({ ...completo, academic_completed: true });
    expect((await proxy(req('/home'))).headers.get('location')).toBeNull();
  });

  it('una ruta protegida que no es "principal" (/perfil) pasa aunque falte onboarding', async () => {
    conSesion({ ...completo, physical_completed: false });
    expect((await proxy(req('/perfil'))).headers.get('location')).toBeNull();
  });

  it('/perfil-fisico con onboarding completo → /home', async () => {
    conSesion({ ...completo, academic_completed: true });
    expect(destino(await proxy(req('/perfil-fisico')))).toBe('/home');
  });

  it('/perfil-fisico de un investigador → /dashboard', async () => {
    conSesion({ ...completo, role: 'investigador' });
    expect(destino(await proxy(req('/perfil-fisico')))).toBe('/dashboard');
  });

  it('/perfil-fisico con el paso físico pendiente → pasa (es donde tiene que estar)', async () => {
    conSesion({ ...completo, physical_completed: false });
    expect((await proxy(req('/perfil-fisico'))).headers.get('location')).toBeNull();
  });

  it('protegida sin perfil → pasa', async () => {
    conSesion(null);
    expect((await proxy(req('/home'))).headers.get('location')).toBeNull();
  });
});

describe('proxy — cookies de sesión', () => {
  it('crea el cliente de Supabase con las cookies de la request y propaga las que renueva', async () => {
    let cookiesApi: { getAll(): unknown; setAll(c: { name: string; value: string; options?: object }[]): void } | undefined;
    createServerClientMock.mockImplementation((_url, _key, opts) => {
      cookiesApi = opts.cookies;
      return { auth: { getUser: getUserMock }, from: () => ({ select: () => ({ eq: () => ({ single: singleMock }) }) }) };
    });
    const request = new NextRequest('http://localhost/login', { headers: { cookie: 'sb-token=abc' } });
    const res = await proxy(request);
    expect(cookiesApi?.getAll()).toEqual([{ name: 'sb-token', value: 'abc' }]);
    cookiesApi?.setAll([{ name: 'sb-token', value: 'nuevo' }]);
    expect(request.cookies.get('sb-token')?.value).toBe('nuevo');
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('proxy — matcher', () => {
  const regex = new RegExp(`^${config.matcher[0]}$`);
  it.each([['/home', true], ['/login', true], ['/_next/static/x.js', false], ['/icons/icon-192.png', false], ['/sw.js', false], ['/manifest.webmanifest', false]])(
    '%s se evalúa: %s',
    (ruta, evalua) => {
      expect(regex.test(ruta)).toBe(evalua);
    },
  );
});
