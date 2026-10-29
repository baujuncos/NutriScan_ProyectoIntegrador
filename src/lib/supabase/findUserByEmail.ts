import type { SupabaseClient, User } from '@supabase/supabase-js';

const PER_PAGE = 200;
// Tope de seguridad contra bucles: 50 páginas × 200 = 10.000 usuarios, de sobra para este proyecto.
const MAX_PAGES = 50;

/**
 * Busca un usuario de Supabase Auth por email (sin distinguir mayúsculas).
 * `auth.admin.listUsers()` NO filtra por email y devuelve una sola página
 * (50 usuarios por defecto): hay que recorrer las páginas hasta encontrarlo
 * (DEF-003). Lanza el error de Supabase si falla la consulta.
 */
export async function findUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const wanted = email.trim().toLowerCase();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === wanted);
    if (hit) return hit;
    if (data.users.length < PER_PAGE) return null;
  }
  return null;
}
