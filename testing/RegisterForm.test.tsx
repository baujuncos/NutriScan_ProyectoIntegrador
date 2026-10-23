/**
 * RegisterForm — registro con email (también el de investigador, con `?type=investigador`).
 * Tabla de decisión de la respuesta de /api/register:
 *   HTTP | cuerpo                         | efecto en pantalla
 *   201  | ok                             | "¡Revisá tu email!"
 *   409  | —                              | error en el campo email
 *   403  | error: INV_CODE_REQUIRED       | mensaje y redirección a /register/investigador
 *   400  | field: password | email        | error en ese campo
 *   otro | message                        | error general (o "No pudimos crear la cuenta.")
 *   red caída (fetch lanza)               | "Error de conexión"
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { pushMock, oauthMock, searchParamsMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  oauthMock: vi.fn(),
  searchParamsMock: { tipo: null as string | null },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => ({ get: (k: string) => (k === 'type' ? searchParamsMock.tipo : null) }),
}));
vi.mock('next/image', () => ({ default: (p: { alt: string }) => <span role="img" aria-label={p.alt} /> }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signInWithOAuth: oauthMock } }) }));

import RegisterForm from '@/app/register/RegisterForm';

const fetchMock = vi.fn();

function llenar(over: Partial<Record<'nombre' | 'apellido' | 'email' | 'password' | 'confirm', string>> = {}) {
  const v = { nombre: 'Ana', apellido: 'Paz', email: 'ana@example.com', password: 'Abcdef12', confirm: 'Abcdef12', ...over };
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: v.nombre } });
  fireEvent.change(screen.getByLabelText('Apellido'), { target: { value: v.apellido } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: v.email } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: v.password } });
  fireEvent.change(screen.getByLabelText('Confirmar Contraseña'), { target: { value: v.confirm } });
  fireEvent.click(screen.getByRole('button', { name: /Crear Cuenta|Acceder como Investigador/ }));
}
const respuesta = (status: number, json: unknown) => fetchMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => json });

beforeEach(() => {
  searchParamsMock.tipo = null;
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  oauthMock.mockReset().mockResolvedValue({ error: null });
  pushMock.mockReset();
});

describe('RegisterForm — validación (no llama a la API)', () => {
  it.each([
    ['nombre vacío', { nombre: ' ' }, 'El nombre es requerido'],
    ['apellido vacío', { apellido: '' }, 'El apellido es requerido'],
    ['email sin formato', { email: 'sin-arroba' }, 'Email inválido'],
    ['contraseña de 7 caracteres', { password: 'Abcde12', confirm: 'Abcde12' }, 'Mínimo 8 caracteres'],
    ['las contraseñas no coinciden', { confirm: 'Otra1234' }, 'Las contraseñas no coinciden'],
  ])('%s', async (_caso, cambio, mensaje) => {
    render(<RegisterForm />);
    llenar(cambio);
    expect(await screen.findByText(mensaje)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('RegisterForm — respuesta de /api/register', () => {
  it('201 → pantalla "¡Revisá tu email!" y el cuerpo enviado no incluye rol', async () => {
    respuesta(201, { ok: true });
    render(<RegisterForm />);
    llenar();
    expect(await screen.findByText('¡Revisá tu email!')).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'ana@example.com', password: 'Abcdef12', nombre: 'Ana', apellido: 'Paz' });
  });

  it('409 → error en el campo email', async () => {
    respuesta(409, { error: 'EMAIL_EXISTS' });
    render(<RegisterForm />);
    llenar();
    expect(await screen.findByText('Ya existe una cuenta con este email.')).toBeInTheDocument();
  });

  it('403 INV_CODE_REQUIRED → muestra el mensaje y vuelve a pedir el código', async () => {
    respuesta(403, { error: 'INV_CODE_REQUIRED', message: 'Código vencido.' });
    render(<RegisterForm />);
    llenar();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/register/investigador'));
    expect(await screen.findByText('Código vencido.')).toBeInTheDocument();
  });

  it('403 INV_CODE_REQUIRED sin mensaje usa el texto por defecto', async () => {
    respuesta(403, { error: 'INV_CODE_REQUIRED' });
    render(<RegisterForm />);
    llenar();
    expect(await screen.findByText('Volvé a ingresar el código de investigador.')).toBeInTheDocument();
  });

  it.each([['password'], ['email']])('400 con field=%s → el mensaje aparece en ese campo', async (field) => {
    respuesta(400, { field, message: `Rechazado: ${field}` });
    render(<RegisterForm />);
    llenar();
    expect(await screen.findByText(`Rechazado: ${field}`)).toBeInTheDocument();
  });

  it('500 con mensaje → error general', async () => {
    respuesta(500, { message: 'No pudimos crear la cuenta. Intentá de nuevo.' });
    render(<RegisterForm />);
    llenar();
    expect(await screen.findByText('No pudimos crear la cuenta. Intentá de nuevo.')).toBeInTheDocument();
  });

  it('500 sin mensaje usa "No pudimos crear la cuenta."', async () => {
    respuesta(500, {});
    render(<RegisterForm />);
    llenar();
    expect(await screen.findByText('No pudimos crear la cuenta.')).toBeInTheDocument();
  });

  it('una respuesta que no es JSON también se maneja', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('html'); } });
    render(<RegisterForm />);
    llenar();
    expect(await screen.findByText('No pudimos crear la cuenta.')).toBeInTheDocument();
  });

  it('red caída → "Error de conexión"', async () => {
    fetchMock.mockRejectedValue(new Error('sin red'));
    render(<RegisterForm />);
    llenar();
    expect(await screen.findByText('Error de conexión. Intentá de nuevo.')).toBeInTheDocument();
  });
});

describe('RegisterForm — modo investigador (?type=investigador)', () => {
  beforeEach(() => {
    searchParamsMock.tipo = 'investigador';
  });

  it('cambia los textos y manda role=investigador', async () => {
    respuesta(201, { ok: true });
    render(<RegisterForm />);
    expect(screen.getByText('Registro Investigador')).toBeInTheDocument();
    llenar();
    await screen.findByText('¡Revisá tu email!');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).role).toBe('investigador');
  });

  it('Google redirige al callback con role=investigador', async () => {
    render(<RegisterForm />);
    fireEvent.click(screen.getByRole('button', { name: /Registrarse con Google como Investigador/ }));
    await waitFor(() => expect(oauthMock).toHaveBeenCalled());
    expect(oauthMock.mock.calls[0][0].options.redirectTo).toBe(`${window.location.origin}/auth/callback?role=investigador`);
  });
});

describe('RegisterForm — Google', () => {
  it('registro con Google usa el callback sin rol', async () => {
    render(<RegisterForm />);
    fireEvent.click(screen.getByRole('button', { name: /Registrarse con Google/ }));
    await waitFor(() => expect(oauthMock).toHaveBeenCalled());
    expect(oauthMock.mock.calls[0][0]).toEqual({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } });
  });

  it('si Google falla muestra el error', async () => {
    oauthMock.mockResolvedValue({ error: { message: 'x' } });
    render(<RegisterForm />);
    fireEvent.click(screen.getByRole('button', { name: /Registrarse con Google/ }));
    expect(await screen.findByText('Error al continuar con Google.')).toBeInTheDocument();
  });
});
