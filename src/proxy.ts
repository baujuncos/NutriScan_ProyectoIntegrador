import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Public routes - accessible without auth
  const publicRoutes = ['/', '/login', '/auth/callback'];
  const isPublicRoute =
    publicRoutes.some((r) => pathname === r) ||
    pathname.startsWith('/auth/') ||
    pathname === '/register' ||
    pathname.startsWith('/register/') ||
    pathname.startsWith('/api/'); // Allow all /api/* routes

  if (!user && !isPublicRoute) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (user && isPublicRoute && pathname !== '/auth/callback') {
    // Fetch profile to decide where to redirect
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, physical_completed, academic_completed, psychological_completed')
      .eq('user_id', user.id)
      .single();

    if (!profile) {
      // Profile not yet created - could happen right after Google OAuth
      return supabaseResponse;
    }

    const redirectUrl = getOnboardingRedirect(profile);
    if (redirectUrl) {
      return NextResponse.redirect(new URL(redirectUrl, request.url));
    }
    // If no redirect needed (e.g., investigador), send to appropriate destination
    const dest = profile.role === 'investigador' ? '/dashboard' : '/home';
    return NextResponse.redirect(new URL(dest, request.url));
  }

  // If user is authenticated, check for incomplete onboarding
  if (user && !isPublicRoute) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, physical_completed, academic_completed, psychological_completed')
      .eq('user_id', user.id)
      .single();

    if (profile) {
      const onboardingRedirect = getOnboardingRedirect(profile);
  const onboardingPaths = ['/perfil-fisico', '/perfil-academico', '/encuesta-psicologica', '/elegir-uso'];
      const isOnboardingRoute = onboardingPaths.some((p) => pathname.startsWith(p));
      const isMainRoute =
        pathname.startsWith('/home') ||
        pathname.startsWith('/dashboard') ||
        pathname.startsWith('/alimentacion');

      if (onboardingRedirect && isMainRoute) {
        return NextResponse.redirect(new URL(onboardingRedirect, request.url));
      }

      if (!onboardingRedirect && isOnboardingRoute) {
        const dest = profile.role === 'investigador' ? '/dashboard' : '/home';
        return NextResponse.redirect(new URL(dest, request.url));
      }
    }
  }

  return supabaseResponse;
}

function getOnboardingRedirect(profile: {
  role: string;
  physical_completed: boolean;
  academic_completed: boolean;
  psychological_completed: boolean;
}): string | null {
  if (profile.role === 'investigador') {
    return null; // Investigators skip onboarding
  }

  if (!profile.physical_completed) {
    return '/perfil-fisico';
  }

  if (profile.role === 'deportista_ucc') {
    if (!profile.academic_completed) return '/perfil-academico';
    if (!profile.psychological_completed) return '/encuesta-psicologica';
  }

  return null; // All completed
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|sw\\.js|workbox-.*\\.js|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
