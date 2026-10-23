/**
 * findUserByEmail recorre las páginas de auth.admin.listUsers (DEF-003).
 * Clases de equivalencia: usuario en la 1.ª página / en una página intermedia / en la última /
 * inexistente / error de Supabase. Valores límite: 199-200-201 usuarios (tamaño de página = 200).
 */
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findUserByEmail } from '@/lib/supabase/findUserByEmail';

function adminCon(total: number, posicion?: number, email = 'buscado@example.com') {
  const todos = Array.from({ length: total }, (_, i) => ({ id: `id-${i}`, email: i === posicion ? email : `u${i}@example.com` }));
  const listUsers = vi.fn(async ({ page, perPage }: { page: number; perPage: number }) => ({
    data: { users: todos.slice((page - 1) * perPage, page * perPage) },
    error: null,
  }));
  return { admin: { auth: { admin: { listUsers } } } as unknown as SupabaseClient, listUsers };
}

describe('findUserByEmail', () => {
  it('lo encuentra en la primera página con una sola consulta', async () => {
    const { admin, listUsers } = adminCon(10, 3);
    const user = await findUserByEmail(admin, 'buscado@example.com');
    expect(user?.id).toBe('id-3');
    expect(listUsers).toHaveBeenCalledTimes(1);
  });

  it('ignora mayúsculas y espacios del email buscado', async () => {
    const { admin } = adminCon(5, 2);
    expect((await findUserByEmail(admin, '  BUSCADO@Example.COM '))?.id).toBe('id-2');
  });

  it('devuelve null si no existe', async () => {
    const { admin } = adminCon(10);
    expect(await findUserByEmail(admin, 'nadie@example.com')).toBeNull();
  });

  it.each([
    [199, 'una página incompleta alcanza para saber que no hay más', 1],
    [200, 'página justa: hay que pedir la siguiente para confirmar que está vacía', 2],
    [201, 'dos páginas', 2],
  ])('valor límite con %i usuarios: %s (consultas: %i)', async (total, _porque, consultas) => {
    const { admin, listUsers } = adminCon(total);
    await findUserByEmail(admin, 'nadie@example.com');
    expect(listUsers).toHaveBeenCalledTimes(consultas);
  });

  it('lo encuentra en la última posición de la segunda página (401 usuarios)', async () => {
    const { admin } = adminCon(401, 400);
    expect((await findUserByEmail(admin, 'buscado@example.com'))?.id).toBe('id-400');
  });

  it('propaga el error de Supabase', async () => {
    const admin = { auth: { admin: { listUsers: vi.fn().mockResolvedValue({ data: null, error: new Error('down') }) } } } as unknown as SupabaseClient;
    await expect(findUserByEmail(admin, 'a@b.com')).rejects.toThrow('down');
  });

  it('usuarios sin email no rompen la búsqueda', async () => {
    const listUsers = vi.fn().mockResolvedValue({ data: { users: [{ id: 'x', email: undefined }, { id: 'y', email: 'a@b.com' }] }, error: null });
    const admin = { auth: { admin: { listUsers } } } as unknown as SupabaseClient;
    expect((await findUserByEmail(admin, 'a@b.com'))?.id).toBe('y');
  });
});
