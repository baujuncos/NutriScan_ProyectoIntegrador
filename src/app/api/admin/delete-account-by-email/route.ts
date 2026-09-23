import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Only available in development or when called with the service role key.
// Protected by requiring x-admin-key === SUPABASE_SERVICE_ROLE_KEY.

const DOMAIN_TABLES = [
  { table: 'ingestas',              col: 'id_usuario' },
  { table: 'hidratacion',           col: 'id_usuario' },
  { table: 'physical_data',         col: 'user_id'    },
  { table: 'academic_data',         col: 'user_id'    },
  { table: 'psychological_surveys', col: 'user_id'    },
  { table: 'profiles',              col: 'user_id'    },
] as const;

export async function POST(request: NextRequest) {
  // --- Protect with service role key ---
  const adminKey = request.headers.get('x-admin-key') ?? '';
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    '';

  if (!adminKey || adminKey !== serviceKey) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  // --- Parse body ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido.' }, { status: 400 });
  }

  const email =
    typeof body === 'object' && body !== null
      ? ((body as Record<string, unknown>).email as string | undefined)?.trim().toLowerCase()
      : undefined;

  if (!email) {
    return NextResponse.json({ error: 'Falta el campo email.' }, { status: 400 });
  }

  const admin = createAdminClient();

  // --- Find user by email ---
  const { data: listData, error: listError } = await admin.auth.admin.listUsers();
  if (listError) {
    return NextResponse.json({ error: 'No se pudo consultar usuarios.', detail: listError.message }, { status: 500 });
  }

  const user = listData.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) {
    return NextResponse.json({ error: `No existe ningún usuario con email "${email}".` }, { status: 404 });
  }

  const userId = user.id;

  // --- Delete domain tables in order ---
  const tableResults: Record<string, 'ok' | string> = {};

  for (const { table, col } of DOMAIN_TABLES) {
    const { error } = await admin.from(table).delete().eq(col, userId);
    tableResults[table] = error ? error.message : 'ok';
    if (error) console.error(`delete-by-email: error en ${table}:`, error);
  }

  // --- Delete auth user ---
  const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
  if (deleteUserError) {
    console.error('delete-by-email: deleteUser falló:', deleteUserError);
    return NextResponse.json(
      {
        error: 'No se pudo eliminar el usuario de autenticación.',
        detail: deleteUserError.message,
        userId,
        tableResults,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      message: `Usuario "${email}" y todos sus datos eliminados.`,
      userId,
      tableResults,
    },
    { status: 200 },
  );
}
