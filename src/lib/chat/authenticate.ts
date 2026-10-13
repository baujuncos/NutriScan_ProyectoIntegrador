// Autenticación compartida por los endpoints del chat (/api/chat/meal y /api/chat/meal/confirm).
import type { NextRequest } from 'next/server';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * Sesión por cookie (app web) o `Authorization: Bearer <access_token>` (Postman/scripts),
 * mismo criterio que /api/delete-account pero sin service role: con Bearer se usa la
 * anon key + el token del usuario, así las queries respetan RLS.
 */
export async function authenticate(request: NextRequest): Promise<{ userId: string; supabase: SupabaseClient } | null> {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (token) {
    const supabase = createSupabaseClient(
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_ANON_KEY ?? '',
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      },
    );
    const { data: { user }, error } = await supabase.auth.getUser(token);
    return error || !user ? null : { userId: user.id, supabase };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { userId: user.id, supabase } : null;
}
