/**
 * Pantalla de login / registro (src/app/login/page.tsx): formularios con validación (zod), llamada a
 * Supabase Auth para ingresar, /api/register para crear cuenta y /api/auth/provider-hint para avisar
 * cuando la cuenta se creó solo con Google.
 *
 * Particiones del campo contraseña del LOGIN (DEF-007): vacía → "Ingresá tu contraseña" /
 * cualquier otro texto (incluso corto) → se delega a Supabase, que decide si las credenciales sirven.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { pushMock, refreshMock, signInMock, oauthMock, resetMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  signInMock: vi.fn(),
  oauthMock: vi.fn(),
  resetMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock('next/image', () => ({ default: (p: { alt: string }) => <span role="img" aria-label={p.alt} /> }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signInWithPassword: signInMock, signInWithOAuth: oauthMock, resetPasswordForEmail: resetMock },
  }),
}));

import LoginPage from '@/app/login/page';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({ hint: 'unknown' }) });
  signInMock.mockReset().mockResolvedValue({ error: null });
  oauthMock.mockReset().mockResolvedValue({ error: null });
  resetMock.mockReset().mockResolvedValue({ error: null });
  pushMock.mockReset();
  refreshMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

async function completarLogin(user: ReturnType<typeof userEvent.setup>, email = 'ana@example.com', password = 'Abcdef12') {
  if (email) await user.type(screen.getByLabelText('Mail'), email);
  if (password) await user.type(screen.getByLabelText('Contraseña'), password);
  await user.click(botonEnviarLogin());
}
// Hay dos botones "Iniciar sesión": la pestaña y el submit del formulario (el último del DOM).
const botonEnviarLogin = () => screen.getAllByRole('button', { name: 'Iniciar sesión' }).at(-1)!;

describe('Login — validación del formulario', () => {
  it('con los campos vacíos muestra los errores y no llama a Supabase', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(botonEnviarLogin());
    expect(await screen.findByText('Email inválido')).toBeInTheDocument();
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('DEF-007: con la contraseña vacía el mensaje no promete una regla que no se valida ("Mínimo 8 caracteres")', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('Mail'), 'ana@example.com');
    await user.click(botonEnviarLogin());
    expect(await screen.findByText('Ingresá tu contraseña')).toBeInTheDocument();
    expect(screen.queryByText(/Mínimo 8 caracteres/)).not.toBeInTheDocument();
  });

  it('valor límite: una contraseña de 1 carácter se envía a Supabase (la política la aplica el servidor)', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('Mail'), 'ana@example.com');
    await user.type(screen.getByLabelText('Contraseña'), 'a');
    await user.click(botonEnviarLogin());
    await waitFor(() => expect(signInMock).toHaveBeenCalledWith({ email: 'ana@example.com', password: 'a' }));
  });

  it('un email sin dominio completo no se envía', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    // 'ana@example' pasa la validación nativa del navegador pero zod lo rechaza (sin dominio de primer nivel).
    await user.type(screen.getByLabelText('Mail'), 'ana@example');
    await user.type(screen.getByLabelText('Contraseña'), 'Abcdef12');
    await user.click(botonEnviarLogin());
    expect(await screen.findByText('Email inválido')).toBeInTheDocument();
    expect(signInMock).not.toHaveBeenCalled();
  });
});

describe('Login — resultado de Supabase', () => {
  it('credenciales correctas → navega a "/" y refresca', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await completarLogin(user);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'));
    expect(refreshMock).toHaveBeenCalled();
  });

  it('credenciales incorrectas → mensaje genérico, sin navegar', async () => {
    signInMock.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const user = userEvent.setup();
    render(<LoginPage />);
    await completarLogin(user);
    expect(await screen.findByText(/Credenciales inválidas/)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('credenciales incorrectas en una cuenta creada solo con Google → sugiere usar Google', async () => {
    signInMock.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ hint: 'google_only' }) });
    const user = userEvent.setup();
    render(<LoginPage />);
    await completarLogin(user);
    // El texto está dos veces en el DOM: el aviso del campo (oculto con CSS) y el error del formulario.
    const textos = await screen.findAllByText(/Esta cuenta fue creada con Google/);
    expect(textos.some((t) => t.closest('[aria-live="polite"]'))).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/provider-hint', expect.objectContaining({ method: 'POST' }));
  });

  it('si el servicio de pistas falla, igual muestra el mensaje genérico', async () => {
    signInMock.mockResolvedValue({ error: { message: 'x' } });
    fetchMock.mockRejectedValue(new Error('sin red'));
    const user = userEvent.setup();
    render(<LoginPage />);
    await completarLogin(user);
    expect(await screen.findByText(/Credenciales inválidas/)).toBeInTheDocument();
  });

  it('si el servicio de pistas devuelve algo que no es JSON, muestra el mensaje genérico', async () => {
    signInMock.mockResolvedValue({ error: { message: 'x' } });
    fetchMock.mockResolvedValue({ ok: false, json: async () => { throw new Error('no json'); } });
    const user = userEvent.setup();
    render(<LoginPage />);
    await completarLogin(user);
    expect(await screen.findByText(/Credenciales inválidas/)).toBeInTheDocument();
  });
});

describe('Login — aviso anticipado de cuenta de Google', () => {
  it('al salir del campo email consulta la pista y avisa si la cuenta es solo de Google', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ hint: 'google_only' }) });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('Mail'), 'ana@example.com');
    await user.tab();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const aviso = screen.getByText(/Esta cuenta fue creada con Google/);
    expect(aviso.closest('div')?.className).toContain('opacity-100');
  });

  it('no consulta si el texto no parece un email', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('Mail'), 'sin-arroba');
    await user.tab();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('si la consulta falla no muestra ningún aviso', async () => {
    fetchMock.mockRejectedValue(new Error('sin red'));
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('Mail'), 'ana@example.com');
    await user.tab();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText(/Esta cuenta fue creada con Google/).closest('div')?.className).toContain('opacity-0');
  });

  it('el aviso desaparece solo a los 5 segundos', async () => {
    vi.useFakeTimers();
    try {
      signInMock.mockResolvedValue({ error: { message: 'x' } });
      render(<LoginPage />);
      fireEvent.change(screen.getByLabelText('Mail'), { target: { value: 'ana@example.com' } });
      fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'abcdefgh' } });
      await act(async () => {
        fireEvent.click(botonEnviarLogin());
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(screen.getByText(/Credenciales inválidas/)).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(screen.queryByText(/Credenciales inválidas/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Login con Google y recuperación de contraseña', () => {
  it('"Continuar con Google" inicia OAuth con la URL de callback de la app', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByRole('button', { name: /Continuar con Google/ }));
    expect(oauthMock).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  });

  it('si OAuth falla muestra el error y habilita el botón de nuevo', async () => {
    oauthMock.mockResolvedValue({ error: { message: 'x' } });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByRole('button', { name: /Continuar con Google/ }));
    expect(await screen.findByText('Error al iniciar sesión con Google.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continuar con Google/ })).toBeEnabled();
  });

  it('recuperar contraseña: pide el email, manda el enlace y confirma', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }));
    await user.type(screen.getByPlaceholderText('juanperez@hotmail.com'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Enviar enlace' }));
    expect(await screen.findByText('Revisá tu email')).toBeInTheDocument();
    expect(resetMock).toHaveBeenCalledWith('ana@example.com', { redirectTo: `${window.location.origin}/auth/reset-password` });
    await user.click(screen.getByRole('button', { name: /Volver al inicio de sesión/ }));
    expect(screen.getByText('Bienvenido de vuelta')).toBeInTheDocument();
  });

  it('recuperar contraseña: si Supabase falla informa el error', async () => {
    resetMock.mockResolvedValue({ error: { message: 'x' } });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }));
    await user.type(screen.getByPlaceholderText('juanperez@hotmail.com'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Enviar enlace' }));
    expect(await screen.findByText(/No se pudo enviar el email/)).toBeInTheDocument();
  });

  it('"Volver" desde recuperar contraseña regresa al login', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }));
    await user.click(screen.getByRole('button', { name: /^Volver/ }));
    expect(screen.getByText('Bienvenido de vuelta')).toBeInTheDocument();
  });
});

describe('Registro (pestaña "Crear cuenta")', () => {
  async function irARegistro(user: ReturnType<typeof userEvent.setup>) {
    render(<LoginPage />);
    await user.click(screen.getAllByRole('button', { name: /Crear cuenta/ })[0]);
  }
  async function completarRegistro(user: ReturnType<typeof userEvent.setup>, over: Partial<Record<'nombre' | 'apellido' | 'email' | 'password' | 'confirm', string>> = {}) {
    const v = { nombre: 'Ana', apellido: 'Paz', email: 'ana@example.com', password: 'Abcdef12', confirm: 'Abcdef12', ...over };
    await user.type(screen.getByPlaceholderText('Juan'), v.nombre);
    await user.type(screen.getByPlaceholderText('Pérez'), v.apellido);
    await user.type(screen.getByPlaceholderText('tu@email.com'), v.email);
    const [pass, confirm] = screen.getAllByPlaceholderText('••••••••');
    await user.type(pass, v.password);
    await user.type(confirm, v.confirm);
    await user.click(screen.getAllByRole('button', { name: /Crear cuenta/ }).at(-1)!);
  }

  it('registro exitoso → pantalla "Revisá tu mail" y vuelve al login con el enlace', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ ok: true }) });
    const user = userEvent.setup();
    await irARegistro(user);
    await completarRegistro(user);
    expect(await screen.findByText('¡Revisá tu mail!')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/register', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'ana@example.com', password: 'Abcdef12', nombre: 'Ana', apellido: 'Paz' });
    await user.click(screen.getByRole('button', { name: /Volver al inicio de sesión/ }));
    expect(screen.getByText('Bienvenido de vuelta')).toBeInTheDocument();
  });

  it.each([
    ['contraseña débil (7 caracteres)', { password: 'Abcde12', confirm: 'Abcde12' }, 'Mínimo 8 caracteres'],
    ['contraseña sin mayúscula', { password: 'abcdefg1', confirm: 'abcdefg1' }, 'Debe incluir al menos una mayúscula'],
    ['las contraseñas no coinciden', { confirm: 'Otra1234' }, 'Las contraseñas no coinciden'],
    ['nombre vacío', { nombre: ' ' }, 'El nombre es requerido'],
  ])('%s → muestra el error y no llama a /api/register', async (_caso, cambio, mensaje) => {
    const user = userEvent.setup();
    await irARegistro(user);
    const v = { nombre: 'Ana', apellido: 'Paz', email: 'ana@example.com', password: 'Abcdef12', confirm: 'Abcdef12', ...cambio };
    if (v.nombre.trim()) await user.type(screen.getByPlaceholderText('Juan'), v.nombre);
    await user.type(screen.getByPlaceholderText('Pérez'), v.apellido);
    await user.type(screen.getByPlaceholderText('tu@email.com'), v.email);
    const [pass, confirm] = screen.getAllByPlaceholderText('••••••••');
    await user.type(pass, v.password);
    await user.type(confirm, v.confirm);
    await user.click(screen.getAllByRole('button', { name: /Crear cuenta/ }).at(-1)!);
    expect(await screen.findByText(mensaje)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('409 (email repetido) → error en el campo email', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'EMAIL_EXISTS' }) });
    const user = userEvent.setup();
    await irARegistro(user);
    await completarRegistro(user);
    expect(await screen.findByText('Ya existe una cuenta con este email.')).toBeInTheDocument();
  });

  it.each([
    ['password', 'Contraseña rechazada por el servidor'],
    ['email', 'Email rechazado por el servidor'],
  ])('400 con field=%s → el mensaje aparece en ese campo', async (field, message) => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ field, message }) });
    const user = userEvent.setup();
    await irARegistro(user);
    await completarRegistro(user);
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('otro error del servidor → mensaje general', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ message: 'No pudimos crear la cuenta.' }) });
    const user = userEvent.setup();
    await irARegistro(user);
    await completarRegistro(user);
    expect(await screen.findByText('No pudimos crear la cuenta.')).toBeInTheDocument();
  });

  it('error de red → "Error de conexión"', async () => {
    fetchMock.mockRejectedValue(new Error('sin red'));
    const user = userEvent.setup();
    await irARegistro(user);
    await completarRegistro(user);
    expect(await screen.findByText('Error de conexión. Intentá de nuevo.')).toBeInTheDocument();
  });

  it('"Registrarse con Google" inicia OAuth; si falla informa el error', async () => {
    oauthMock.mockResolvedValue({ error: { message: 'x' } });
    const user = userEvent.setup();
    await irARegistro(user);
    await user.click(screen.getByRole('button', { name: /Registrarse con Google/ }));
    expect(oauthMock).toHaveBeenCalled();
    expect(await screen.findByText('Error al continuar con Google.')).toBeInTheDocument();
  });

  it('muestra el acceso para investigadores solo en la pestaña de registro', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    expect(screen.queryByText(/Registrarse con código de acceso/)).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /Crear cuenta/ })[0]);
    expect(screen.getByRole('link', { name: /Registrarse con código de acceso/ })).toHaveAttribute('href', '/register/investigador');
  });
});
