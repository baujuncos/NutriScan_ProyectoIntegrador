import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { esAltaInvestigador, extractNombreApellido } from '@/lib/roles';
import { INV_CODE_COOKIE } from '@/lib/inv-code-cookie';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  let invConsumido = false;
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        try {
          const { data: existingProfile, error: selectError } = await supabase
            .from('profiles')
            .select('id, role')
            .eq('user_id', user.id)
            .maybeSingle();

          if (selectError) {
            console.error('Error al buscar perfil:', selectError.message);
          }

          if (!existingProfile) {
            const email = user.email ?? '';
            const isUCC = email.toLowerCase().endsWith('@ucc.edu.ar');
            const { nombre, apellido } = extractNombreApellido(
              user.user_metadata as Record<string, unknown>,
            );

            if (
              esAltaInvestigador({
                metaRole: (user.user_metadata as Record<string, unknown>)?.role,
                cookieToken: request.cookies.get(INV_CODE_COOKIE)?.value,
                validCode: process.env.INVITATION_CODE_INVESTIGADOR,
              })
            ) {
              // Investigador: alta por email (metadata) o Google tras validar el código
              invConsumido = true;
              await supabase.from('profiles').insert({
                user_id: user.id,
                nombre,
                apellido,
                email,
                role: 'investigador',
                physical_completed: false,
                academic_completed: false,
                psychological_completed: false,
              });
            } else if (isUCC) {
              // UCC users need to choose their usage before the profile is created.
              // Redirect them to the usage-selection screen.
              const forwardedHost = request.headers.get('x-forwarded-host');
              const isLocalEnv = process.env.NODE_ENV === 'development';
              const base = isLocalEnv
                ? origin
                : forwardedHost
                  ? `https://${forwardedHost}`
                  : origin;
              return NextResponse.redirect(`${base}/elegir-uso`);
            } else {
              // Non-UCC users are always 'particular'
              await supabase.from('profiles').insert({
                user_id: user.id,
                nombre,
                apellido,
                email,
                role: 'particular',
                physical_completed: false,
                academic_completed: false,
                psychological_completed: false,
              });
            }
          }
        } catch (e) {
          console.error('Error crítico en el callback:', e);
        }
      }

      const forwardedHost = request.headers.get('x-forwarded-host');
      const isLocalEnv = process.env.NODE_ENV === 'development';

      const base = !isLocalEnv && forwardedHost ? `https://${forwardedHost}` : origin;
      const res = NextResponse.redirect(`${base}${next}`);
      if (invConsumido) res.cookies.set(INV_CODE_COOKIE, '', { path: '/', maxAge: 0 });
      return res;
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}
