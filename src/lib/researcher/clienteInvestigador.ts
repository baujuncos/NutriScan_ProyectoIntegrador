import { createClient } from '@/lib/supabase/server';

export type SupabaseServidor = Awaited<ReturnType<typeof createClient>>;

/** Sesión + `profiles.role` ∈ investigador/administrador: el chequeo de rol de las acciones del panel de investigador. */
export async function clienteInvestigador(): Promise<{ supabase: SupabaseServidor } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado' };

  const { data: myProfile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  if (!myProfile || (myProfile.role !== 'investigador' && myProfile.role !== 'administrador')) {
    return { error: 'Acceso denegado' };
  }
  return { supabase };
}
