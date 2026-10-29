// E2E contra Supabase REAL (Auth + base con RLS). Solo lecturas y un intento de escritura que DEBE ser rechazado.
// Parte pública: solo necesita SUPABASE_URL y SUPABASE_ANON_KEY. Parte autenticada: necesita el usuario de prueba.
import { beforeAll, describe, expect, it } from 'vitest';
import { env, loginUsuarioDePrueba, rest, tieneSupabase, tieneUsuarioDePrueba } from './env';

const filasVisibles = (data: unknown) => (Array.isArray(data) ? data.length : 0);

describe.skipIf(!tieneSupabase)('Supabase real — disponibilidad y seguridad (anon key)', () => {
  it('Auth responde: /auth/v1/health', async () => {
    const res = await fetch(`${env.supabaseUrl}/auth/v1/health`, { headers: { apikey: env.supabaseAnonKey } });
    expect(res.status).toBe(200);
  });

  it('el catálogo de alimentos está cargado y se puede leer (SARA2 ≈ 930 + ANMAT)', async () => {
    const r = await rest('alimentos?select=id_alimento&limit=1', { headers: { prefer: 'count=exact' } });
    expect([200, 206]).toContain(r.status); // 206 = respuesta parcial por el limit, también válida
    const total = Number(String(r.headers.get('content-range')).split('/')[1]);
    expect(total).toBeGreaterThanOrEqual(900);
  });

  it('RLS: sin sesión NO se pueden leer perfiles de usuarios', async () => {
    const r = await rest('profiles?select=user_id,email&limit=5');
    // Según la configuración, PostgREST responde 200 con lista vacía o 401/403: lo que no puede pasar es devolver filas.
    expect([200, 401, 403]).toContain(r.status);
    // Se cuenta, no se compara el contenido: si hubiera filas, no deben imprimirse en los logs del pipeline (son datos personales).
    if (r.status === 200) expect(filasVisibles(r.data), 'perfiles legibles SIN sesión (RLS roto, DEF-009)').toBe(0);
  });

  it('RLS: sin sesión NO se pueden leer las ingestas', async () => {
    const r = await rest('ingestas?select=id_ingesta&limit=5');
    expect([200, 401, 403]).toContain(r.status);
    if (r.status === 200) expect(filasVisibles(r.data), 'ingestas legibles SIN sesión').toBe(0);
  });

  it('RLS: sin sesión NO se puede escribir en ingestas', async () => {
    const r = await rest('ingestas', {
      method: 'POST',
      body: { id_usuario: '00000000-0000-0000-0000-000000000000', fecha: '2026-01-01', tipo: 'desayuno' },
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

describe.skipIf(!tieneUsuarioDePrueba)('Supabase real — usuario de prueba', () => {
  let token = '';
  let userId = '';
  beforeAll(async () => {
    ({ accessToken: token, userId } = await loginUsuarioDePrueba());
  });

  it('el login con email y contraseña devuelve un token', () => {
    expect(token.split('.')).toHaveLength(3); // JWT
  });

  it('RLS: con sesión solo se ve el PROPIO perfil', async () => {
    const r = await rest('profiles?select=user_id,role', { token });
    expect(r.status).toBe(200);
    const filas = r.data as Array<{ user_id: string; role: string }>;
    expect(filas.length).toBeLessThanOrEqual(1);
    for (const f of filas) expect(f.user_id).toBe(userId);
  });

  it('el usuario de prueba es un usuario común (no investigador ni administrador)', async () => {
    const r = await rest('profiles?select=role', { token });
    const [perfil] = r.data as Array<{ role: string }>;
    if (perfil) expect(['particular', 'deportista_ucc']).toContain(perfil.role);
  });
});
