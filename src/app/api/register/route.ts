import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { strongPasswordSchema } from '@/lib/password';
import { INV_CODE_COOKIE } from '@/lib/inv-code-cookie';

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

async function emailExists(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<boolean> {
  // listUsers does not support filter in all client versions, so we scan pages
  // until we find a match. For a research-app MVP, scanning is acceptable.
  let page = 1;
  const perPage = 200;
  // Cap to avoid runaway loops; this is generous for current user counts.
  for (let i = 0; i < 50; i++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === email);
    if (hit) return true;
    if (data.users.length < perPage) return false;
    page += 1;
  }
  return false;
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
    if (!valid || !token || token !== valid) {
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
    if (await emailExists(admin, email)) {
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

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: { nombre, apellido },
    // El rol va en app_metadata: solo se escribe con service role (el usuario no lo puede forjar).
    ...(role ? { app_metadata: { role } } : {}),
  });

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

  // Send the confirmation email via Supabase generateLink (signup type).
  // This mirrors what supabase.auth.signUp does for the email-link flow.
  const redirectTo = new URL(
    `/auth/callback${role === 'investigador' ? '?role=investigador' : ''}`,
    req.nextUrl.origin,
  ).toString();

  try {
    await admin.auth.admin.generateLink({
      type: 'signup',
      email,
      password,
      options: { redirectTo },
    });
  } catch (e) {
    // The user is created; if the link generation fails, they can use
    // "resend confirmation" from the login page. Log and continue.
    console.error('generateLink failed:', e);
  }

  // Clear the inv-code cookie now that it has been consumed (if any).
  const res = NextResponse.json({ ok: true, userId: created.user?.id }, { status: 201 });
  if (role === 'investigador') {
    res.cookies.set(INV_CODE_COOKIE, '', { path: '/', maxAge: 0 });
  }
  return res;
}
