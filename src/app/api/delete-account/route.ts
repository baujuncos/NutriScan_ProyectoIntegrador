// NO USAMOS ESTE ENDPOINT, USAMOS EL SERVER ACTION EN SU LUGAR PORQUE ES MÁS SENCILLO DE PROTEGER Y MANEJAR ERRORES.
import { NextRequest, NextResponse } from 'next/server';
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

export async function POST(request: NextRequest) {
  // --- Autenticar via Bearer token (igual que Postman) ---
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: { user }, error: authError } = await admin.auth.getUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: 'Token inválido o expirado.' }, { status: 401 });
  }

  // --- Parse y validar body ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido.' }, { status: 400 });
  }

  const email =
    typeof body === 'object' && body !== null
      ? String((body as Record<string, unknown>).email ?? '').trim().toLowerCase()
      : '';

  if (!email) {
    return NextResponse.json({ error: 'Falta el campo email.' }, { status: 400 });
  }

  // --- Verificar que el email coincide con el token ---
  if (user.email?.toLowerCase() !== email) {
    return NextResponse.json(
      { error: 'El email no coincide con tu cuenta.' },
      { status: 403 },
    );
  }

  // --- Eliminar tablas en orden, luego el usuario ---
  const tableResults: Record<string, 'ok' | string> = {};

  for (const { table, col } of DOMAIN_TABLES) {
    const { error } = await admin.from(table).delete().eq(col, user.id);
    tableResults[table] = error ? error.message : 'ok';
    if (error) console.error(`delete-account: error en ${table}:`, error);
  }

  // NUT-119: las fotos del plato viven en Storage y el cascade de la DB no las borra.
  await borrarFotosDeUsuario(admin, user.id);

  const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteUserError) {
    console.error('delete-account: deleteUser falló:', deleteUserError);
    return NextResponse.json(
      {
        error: 'No se pudo eliminar la cuenta.',
        detail: deleteUserError.message,
        tableResults,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: true, message: 'Cuenta y todos los datos eliminados.', tableResults },
    { status: 200 },
  );
}
