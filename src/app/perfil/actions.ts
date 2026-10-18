'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { borrarFotosDeUsuario } from '@/lib/fotosDeteccion';

const DOMAIN_TABLES = [
  { table: 'ingestas',              col: 'id_usuario' },
  { table: 'hidratacion',           col: 'id_usuario' },
  { table: 'physical_data',         col: 'user_id'    },
  { table: 'academic_data',         col: 'user_id'    },
  { table: 'psychological_surveys', col: 'user_id'    },
  { table: 'profiles',              col: 'user_id'    },
] as const;

export async function deleteAccountAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const emailInput = (formData.get('email') as string | null)?.trim().toLowerCase() ?? '';
  if (emailInput !== user.email?.toLowerCase()) {
    return { error: 'El email no coincide con tu cuenta.' };
  }

  const admin = createAdminClient();

  for (const { table, col } of DOMAIN_TABLES) {
    await admin.from(table).delete().eq(col, user.id);
  }

  // NUT-119: las fotos del plato viven en Storage y el cascade de la DB no las borra.
  await borrarFotosDeUsuario(admin, user.id);

  await admin.auth.admin.deleteUser(user.id);

  redirect('/login');
}
