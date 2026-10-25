/**
 * /api/validate-investigator — valida el código de invitación de investigadores.
 *
 * DEF-005 — el endpoint no limitaba intentos: se podía probar códigos sin tope hasta
 * adivinar el de invitación y obtener acceso de investigador (datos de todos los atletas).
 *
 * Particiones de equivalencia de `code`:
 *   ausente / no es string / solo espacios → 400
 *   string con el valor correcto (con o sin espacios alrededor) → 200 + cookie httpOnly
 *   string incorrecto → 401
 * Y de configuración: INVITATION_CODE_INVESTIGADOR ausente o vacía → 500 (error del servidor, no del cliente).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { INV_CODE_COOKIE } from '@/lib/inv-code-cookie';
import { POST } from '@/app/api/validate-investigator/route';
import { RATE_LIMIT_MAX_REQUESTS } from '@/lib/chat/rateLimit';

const CODIGO = 'codigo-secreto-de-prueba';
let ipSeq = 0;
/** Cada test usa su propia IP: el límite de intentos se lleva por IP y vive en memoria del proceso. */
let ip = '';

function req(body: unknown, opts: { ip?: string } = {}) {
  return new NextRequest('http://localhost/api/validate-investigator', {
    method: 'POST',
    headers: { 'x-forwarded-for': opts.ip ?? ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  ip = `10.0.0.${++ipSeq}`;
  vi.stubEnv('INVITATION_CODE_INVESTIGADOR', CODIGO);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('/api/validate-investigator — validación del código', () => {
  it('código correcto → 200 y cookie httpOnly con vencimiento de 15 minutos', async () => {
    // Act
    const res = await POST(req({ code: CODIGO }));
    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true });
    const cookie = res.cookies.get(INV_CODE_COOKIE);
    expect(cookie?.value).toBe(CODIGO);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.maxAge).toBe(15 * 60);
  });

  it('ignora espacios alrededor del código ingresado', async () => {
    expect((await POST(req({ code: `  ${CODIGO}  ` }))).status).toBe(200);
  });

  it('código incorrecto → 401 y sin cookie', async () => {
    const res = await POST(req({ code: 'otro' }));
    expect(res.status).toBe(401);
    expect(res.cookies.get(INV_CODE_COOKIE)).toBeUndefined();
  });

  it('valor límite: el código correcto con un carácter menos → 401', async () => {
    expect((await POST(req({ code: CODIGO.slice(0, -1) }))).status).toBe(401);
  });

  it.each([
    ['sin campo code', {}],
    ['code vacío', { code: '' }],
    ['code solo espacios', { code: '   ' }],
    ['code numérico', { code: 123 }],
    ['code null', { code: null }],
  ])('%s → 400', async (_caso, body) => {
    expect((await POST(req(body))).status).toBe(400);
  });

  it('cuerpo que no es JSON → 400', async () => {
    expect((await POST(req('no es json'))).status).toBe(400);
  });

  it.each([[''], ['   ']])('si el servidor no tiene el código configurado (%j) → 500', async (valor) => {
    vi.stubEnv('INVITATION_CODE_INVESTIGADOR', valor);
    expect((await POST(req({ code: 'cualquiera' }))).status).toBe(500);
  });

  it('la cookie es segura (secure) solo en producción', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await POST(req({ code: CODIGO }));
    expect(res.cookies.get(INV_CODE_COOKIE)?.secure).toBe(true);
  });
});

describe('/api/validate-investigator — límite de intentos (DEF-005)', () => {
  it(`tras ${RATE_LIMIT_MAX_REQUESTS} intentos fallidos desde la misma IP, el siguiente es 429 aunque el código sea correcto`, async () => {
    // Arrange: se agotan los intentos permitidos con códigos incorrectos
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
      expect((await POST(req({ code: `intento-${i}` }))).status).toBe(401);
    }
    // Act
    const res = await POST(req({ code: CODIGO }));
    // Assert
    expect(res.status).toBe(429);
    expect(res.cookies.get(INV_CODE_COOKIE)).toBeUndefined();
  });

  it('valor límite: el intento número 10 todavía se evalúa (401), el 11 se bloquea (429)', async () => {
    const estados: number[] = [];
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS + 1; i++) estados.push((await POST(req({ code: 'x' }))).status);
    expect(estados.slice(0, RATE_LIMIT_MAX_REQUESTS).every((s) => s === 401)).toBe(true);
    expect(estados[RATE_LIMIT_MAX_REQUESTS]).toBe(429);
  });

  it('el bloqueo es por IP: otra IP puede seguir intentando', async () => {
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) await POST(req({ code: 'x' }));
    expect((await POST(req({ code: CODIGO }, { ip: '203.0.113.99' }))).status).toBe(200);
  });
});
