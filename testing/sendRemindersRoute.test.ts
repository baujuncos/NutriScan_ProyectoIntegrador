/**
 * DEF-002 — /api/send-reminders no tenía autenticación: cualquiera podía
 * disparar el envío masivo de mails y recibir en la respuesta los emails de
 * todos los usuarios. Estos tests son la prueba de regresión del defecto.
 *
 * Tabla de decisión (autorización):
 *   CRON_SECRET configurada | header Authorization      | resultado
 *   ------------------------+---------------------------+-----------------
 *   sí                      | Bearer <secreto correcto> | 200 (procesa)
 *   sí                      | Bearer <otro valor>       | 401
 *   sí                      | ausente                   | 401
 *   no                      | cualquiera (incl. vacío)  | 401 (falla cerrado)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSupabaseFromMock } from './supabaseMock';

// La ruta crea el cliente de Supabase al importarse, antes de que exista `db`:
// el cliente falso delega en `holder.from`, que se completa justo después.
const { sendMailMock, holder } = vi.hoisted(() => ({
  sendMailMock: vi.fn(),
  holder: { from: (_tabla: string): unknown => undefined },
}));
const db = createSupabaseFromMock();
holder.from = db.from;

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (tabla: string) => holder.from(tabla) }),
}));

import { GET, POST } from '@/app/api/send-reminders/route';

const SECRET = 'cron-secreto-de-prueba';

function req(authorization?: string, method: 'GET' | 'POST' = 'POST') {
  return new NextRequest('http://localhost/api/send-reminders', {
    method,
    headers: authorization === undefined ? {} : { authorization },
  });
}

const usuarios = [
  { user_id: 'u1', nombre: 'Ana', email: 'ana@example.com', role: 'particular' },
  { user_id: 'u2', nombre: 'Beto', email: 'beto@example.com', role: 'deportista_ucc' },
  { user_id: 'u3', nombre: 'Sin mail', email: null, role: 'particular' },
];

beforeEach(() => {
  db.reset();
  sendMailMock.mockReset().mockResolvedValue({});
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('/api/send-reminders — autorización (DEF-002)', () => {
  // Hay datos reales para procesar: si la ruta no valida, los procesaría y mandaría mails.
  beforeEach(() => {
    db.mockTable('profiles', { data: usuarios, error: null });
    db.mockTable('ingestas', { data: [], error: null });
  });

  it('sin header Authorization responde 401 y no consulta la base ni envía mails', async () => {
    // Arrange: nada que preparar, la request viene sin credenciales
    // Act
    const res = await POST(req());
    // Assert
    expect(res.status).toBe(401);
    expect(db.tablasLlamadas()).toEqual([]);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('con un token incorrecto responde 401', async () => {
    const res = await POST(req('Bearer otro-valor'));
    expect(res.status).toBe(401);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('valor límite: el secreto correcto pero con un carácter de más también es 401', async () => {
    const res = await POST(req(`Bearer ${SECRET}x`));
    expect(res.status).toBe(401);
  });

  it('sin CRON_SECRET configurada falla cerrado: 401 aunque mande "Bearer " vacío', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = await POST(req('Bearer '));
    expect(res.status).toBe(401);
    expect(db.tablasLlamadas()).toEqual([]);
  });

  it('GET (el método que usa Vercel Cron) pasa por la misma validación', async () => {
    const res = await GET(req(undefined, 'GET'));
    expect(res.status).toBe(401);
  });
});

describe('/api/send-reminders — con credenciales válidas', () => {
  it('manda un mail a quien no cargó las 4 comidas principales y omite a quien no tiene email', async () => {
    // Arrange: Ana cargó desayuno y almuerzo; Beto, las cuatro; u3 no tiene email.
    db.mockTable('profiles', { data: usuarios, error: null });
    db.mockTable('ingestas', {
      data: [
        { id_usuario: 'u1', tipo: 'desayuno' },
        { id_usuario: 'u1', tipo: 'almuerzo' },
        ...['desayuno', 'almuerzo', 'merienda', 'cena'].map((tipo) => ({ id_usuario: 'u2', tipo })),
      ],
      error: null,
    });
    // Act
    const res = await POST(req(`Bearer ${SECRET}`));
    const body = await res.json();
    // Assert
    expect(res.status).toBe(200);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0]).toMatchObject({ to: 'ana@example.com' });
    expect(sendMailMock.mock.calls[0][0].html).toContain('Merienda, Cena');
    expect(body).toEqual({ sent: 1, failed: 0 });
  });

  it('la respuesta no filtra emails ni objetos de error de los usuarios', async () => {
    db.mockTable('profiles', { data: usuarios, error: null });
    db.mockTable('ingestas', { data: [], error: null });
    sendMailMock.mockRejectedValueOnce(new Error('SMTP caído con detalles internos'));
    const res = await POST(req(`Bearer ${SECRET}`));
    const texto = JSON.stringify(await res.json());
    expect(texto).not.toContain('@');
    expect(texto).not.toContain('SMTP');
  });

  it('un mail que falla se cuenta como fallido y no corta a los demás', async () => {
    db.mockTable('profiles', { data: usuarios.slice(0, 2), error: null });
    db.mockTable('ingestas', { data: [], error: null });
    sendMailMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({});
    const body = await (await POST(req(`Bearer ${SECRET}`))).json();
    expect(body).toEqual({ sent: 1, failed: 1 });
  });

  it('error al leer perfiles → 500 sin detalles internos de la base', async () => {
    db.mockTable('profiles', { data: null, error: { message: 'relation "profiles" does not exist' } });
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('relation');
  });

  it('error al leer ingestas → 500 y no se envía ningún mail', async () => {
    db.mockTable('profiles', { data: usuarios, error: null });
    db.mockTable('ingestas', { data: null, error: { message: 'timeout' } });
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('GET con credenciales válidas ejecuta la misma lógica que POST', async () => {
    db.mockTable('profiles', { data: [], error: null });
    db.mockTable('ingestas', { data: [], error: null });
    const res = await GET(req(`Bearer ${SECRET}`, 'GET'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 0, failed: 0 });
  });
});
