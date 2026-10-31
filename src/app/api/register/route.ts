import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { strongPasswordSchema } from '@/lib/password';
import { INV_CODE_COOKIE } from '@/lib/inv-code-cookie';
import { secretEquals } from '@/lib/secretEquals';
import { findUserByEmail } from '@/lib/supabase/findUserByEmail';

const bodySchema = z.object({
  email: z.string().email('Email inválido').transform((s) => s.trim().toLowerCase()),
  password: strongPasswordSchema,
  nombre: z.string().trim().min(1, 'El nombre es requerido'),
  apellido: z.string().trim().min(1, 'El apellido es requerido'),
  role: z.enum(['investigador']).optional(),
});

function badRequest(message: string, field?: string) {
  return NextResponse.json({ error: 'INVALID', message, field }, { status: 400 });
}

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest('Cuerpo de la solicitud inválido.');
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return badRequest(issue?.message ?? 'Datos inválidos.', issue?.path?.[0] as string | undefined);
  }
  const { email, password, nombre, apellido, role } = parsed.data;

  if (role === 'investigador') {
    const cookieStore = await cookies();
    const token = cookieStore.get(INV_CODE_COOKIE)?.value;
    const valid = process.env.INVITATION_CODE_INVESTIGADOR?.trim();
    if (!secretEquals(token, valid)) {
      return NextResponse.json(
        { error: 'INV_CODE_REQUIRED', message: 'Código de investigador inválido o expirado. Volvé a ingresarlo.' },
        { status: 403 },
      );
    }
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: 'SERVER_CONFIG', message: 'Servidor mal configurado.' },
      { status: 500 },
    );
  }

  try {
    if (await findUserByEmail(admin, email)) {
      return NextResponse.json(
        { error: 'EMAIL_EXISTS', message: 'Ya existe una cuenta con este email.' },
        { status: 409 },
      );
    }
  } catch (e) {
    console.error('emailExists check failed:', e);
    return NextResponse.json(
      { error: 'SERVER_ERROR', message: 'No pudimos validar el email. Intentá de nuevo.' },
      { status: 500 },
    );
  }

  // signUp (y no admin.createUser + generateLink): generateLink solo devuelve el enlace, no envía
  // ningún mail. signUp crea el usuario sin confirmar y hace que Supabase mande el mail de
  // confirmación (flujo PKCE, que es el que espera /auth/callback con ?code=).
  const redirectTo = new URL(
    `/auth/callback${role === 'investigador' ? '?role=investigador' : ''}`,
    req.nextUrl.origin,
  ).toString();

  const supabase = await createClient();
  const { data: created, error: createError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { nombre, apellido }, emailRedirectTo: redirectTo },
  });

  if (!createError && role && created.user) {
    // El rol va en app_metadata: solo se escribe con service role (el usuario no lo puede forjar).
    const { error: roleError } = await admin.auth.admin.updateUserById(created.user.id, {
      app_metadata: { role },
    });
    if (roleError) {
      console.error('No se pudo asignar el rol de investigador:', roleError);
      await admin.auth.admin.deleteUser(created.user.id);
      return NextResponse.json(
        { error: 'SERVER_ERROR', message: 'No pudimos crear la cuenta. Intentá de nuevo.' },
        { status: 500 },
      );
    }
  }

  if (createError) {
    const msg = createError.message ?? '';
    if (/already.*registered|already.*exists|duplicate/i.test(msg)) {
      return NextResponse.json(
        { error: 'EMAIL_EXISTS', message: 'Ya existe una cuenta con este email.' },
        { status: 409 },
      );
    }
    console.error('createUser failed:', createError);
    return NextResponse.json(
      { error: 'SERVER_ERROR', message: 'No pudimos crear la cuenta. Intentá de nuevo.' },
      { status: 500 },
    );
  }

  // Clear the inv-code cookie now that it has been consumed (if any).
  const res = NextResponse.json({ ok: true, userId: created.user?.id }, { status: 201 });
  if (role === 'investigador') {
    res.cookies.set(INV_CODE_COOKIE, '', { path: '/', maxAge: 0 });
  }
  return res;
}
