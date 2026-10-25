/**
 * deleteAccountAction (Server Action de /perfil): el usuario confirma su email y se borra toda su cuenta.
 * Particiones: sin sesión / email distinto / email igual (con otra capitalización y espacios) / sin campo email.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock, redirectMock, deleteUserMock, borrarFotosMock, holder } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  deleteUserMock: vi.fn(),
  borrarFotosMock: vi.fn(),
  holder: { from: (_t: string): unknown => undefined },
}));
const db = createSupabaseFromMock();
holder.from = db.from;

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/lib/fotosDeteccion', () => ({ borrarFotosDeUsuario: borrarFotosMock }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: getUserMock } }) }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (t: string) => holder.from(t), auth: { admin: { deleteUser: deleteUserMock } } }),
}));

import { deleteAccountAction } from '@/app/perfil/actions';

const form = (email?: string) => {
  const fd = new FormData();
  if (email !== undefined) fd.set('email', email);
  return fd;
};

beforeEach(() => {
  db.reset();
  redirectMock.mockClear();
  deleteUserMock.mockReset().mockResolvedValue({ error: null });
  borrarFotosMock.mockReset().mockResolvedValue(undefined);
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u-1', email: 'Ana@Example.com' } } });
});

describe('deleteAccountAction', () => {
  it('sin sesión → redirige a /login y no borra nada', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    await expect(deleteAccountAction(form('ana@example.com'))).rejects.toThrow('REDIRECT:/login');
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it.each([['otra@example.com'], [''], ['ana@example.co']])('email %j que no coincide → error y no se borra nada', async (email) => {
    const r = await deleteAccountAction(form(email));
    expect(r).toEqual({ error: 'El email no coincide con tu cuenta.' });
    expect(db.tablasLlamadas()).toEqual([]);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('sin el campo email en el formulario → error', async () => {
    expect(await deleteAccountAction(form())).toEqual({ error: 'El email no coincide con tu cuenta.' });
  });

  it('email correcto (otra capitalización y espacios) → borra las 6 tablas, las fotos, el usuario y vuelve a /login', async () => {
    await expect(deleteAccountAction(form('  ANA@example.com '))).rejects.toThrow('REDIRECT:/login');
    expect(db.tablasLlamadas()).toEqual(['ingestas', 'hidratacion', 'physical_data', 'academic_data', 'psychological_surveys', 'profiles']);
    expect(db.eqLlamados().every((e) => e.args[1] === 'u-1')).toBe(true);
    expect(borrarFotosMock).toHaveBeenCalledWith(expect.anything(), 'u-1');
    expect(deleteUserMock).toHaveBeenCalledWith('u-1');
  });
});
