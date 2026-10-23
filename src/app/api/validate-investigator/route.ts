import { NextRequest, NextResponse } from 'next/server';
import { INV_CODE_COOKIE } from '@/lib/inv-code-cookie';
import { checkRateLimit } from '@/lib/chat/rateLimit';
import { secretEquals } from '@/lib/secretEquals';

const COOKIE_MAX_AGE_SECONDS = 60 * 15; // 15 minutes

/** IP del cliente según el proxy (Vercel completa x-forwarded-for); sirve para limitar intentos. */
function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'desconocida';
}

export async function POST(request: NextRequest) {
  // DEF-005: el código de invitación da acceso de investigador, así que se limitan los intentos
  // por IP (mismo límite en memoria que el chat: 10 por minuto) para frenar la fuerza bruta.
  if (!checkRateLimit(`inv-code:${clientIp(request)}`)) {
    return NextResponse.json(
      { valid: false, error: 'Demasiados intentos. Esperá un minuto y probá de nuevo.' },
      { status: 429 },
    );
  }

  let body: { code?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ valid: false, error: 'Cuerpo inválido.' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code) {
    return NextResponse.json(
      { valid: false, error: 'Ingresá el código de acceso.' },
      { status: 400 },
    );
  }

  const validCode = process.env.INVITATION_CODE_INVESTIGADOR?.trim();
  if (!validCode) {
    console.error('INVITATION_CODE_INVESTIGADOR env var not set');
    return NextResponse.json(
      { valid: false, error: 'Error de configuración del servidor.' },
      { status: 500 },
    );
  }

  if (!secretEquals(code, validCode)) {
    return NextResponse.json(
      { valid: false, error: 'Código incorrecto.' },
      { status: 401 },
    );
  }

  const res = NextResponse.json({ valid: true });
  res.cookies.set(INV_CODE_COOKIE, validCode, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}
