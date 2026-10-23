import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { User } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { findUserByEmail } from '@/lib/supabase/findUserByEmail';

const bodySchema = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
});

type ProviderHint = 'google_only' | 'unknown';

function getProviderHint(user: User | null): ProviderHint {
  if (!user) {
    return 'unknown';
  }
  // Collect providers from multiple possible fields Supabase may populate
  const appProviders = Array.isArray(user?.app_metadata?.providers)
    ? user!.app_metadata.providers.map((p: unknown) => String(p ?? '').toLowerCase()).filter(Boolean)
    : [];

  const appProviderSingle = typeof user?.app_metadata?.provider === 'string'
    ? [user.app_metadata.provider.toLowerCase()]
    : [];

  const userMetaProvider = typeof user?.user_metadata?.provider_id === 'string'
    ? [user.user_metadata.provider_id.toLowerCase()]
    : [];

  const identitiesArr = Array.isArray(user?.identities)
    ? user.identities.map((i: any) => String(i.provider ?? '').toLowerCase()).filter(Boolean)
    : [];

  const providersArr = Array.from(new Set([...appProviders, ...appProviderSingle, ...userMetaProvider, ...identitiesArr]));
  const providers = new Set(providersArr);

  // Debug: log detected providers to server logs to help debugging in development
  console.debug('provider-hint: detected providers for', user.email, providersArr);

  const hasEmail = providers.has('email');
  if (providers.size > 0 && !hasEmail) {
    if (providers.has('google') || providersArr.some((p) => p.includes('google'))) {
      return 'google_only';
    }
    // treat any oauth-only provider as google-only for UX guidance (we suggest OAuth login)
    return 'google_only';
  }

  return 'unknown';
}

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ hint: 'unknown' as ProviderHint }, { status: 200 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ hint: 'unknown' as ProviderHint }, { status: 200 });
  }

  try {
    const user = await findUserByEmail(createAdminClient(), parsed.data.email);
    const hint = getProviderHint(user);

    // In development, include debug info to help diagnose provider detection
    if (process.env.NODE_ENV !== 'production') {
          // Prefer app_metadata.providers (Supabase may populate this for OAuth users)
          const appProviders = Array.isArray(user?.app_metadata?.providers)
            ? user!.app_metadata.providers.map((p: unknown) => String(p ?? '').toLowerCase()).filter(Boolean)
            : [];

          // Fallback to app_metadata.provider or user_metadata.provider_id or identities
          const appProviderSingle = typeof user?.app_metadata?.provider === 'string'
            ? [user.app_metadata.provider.toLowerCase()]
            : [];

          const userMetaProvider = typeof user?.user_metadata?.provider_id === 'string'
            ? [user.user_metadata.provider_id.toLowerCase()]
            : [];

          const identitiesArr = Array.isArray(user?.identities)
            ? user.identities.map((i: any) => String(i.provider ?? '').toLowerCase()).filter(Boolean)
            : [];

          const providersArr = Array.from(new Set([...appProviders, ...appProviderSingle, ...userMetaProvider, ...identitiesArr]));

          // Return user object for debugging (do not include in production responses)
          return NextResponse.json({ hint, debug: { found: !!user, providers: providersArr, user } }, { status: 200 });
    }

    return NextResponse.json({ hint }, { status: 200 });
  } catch (e) {
    console.error('provider-hint error:', e);
    if (process.env.NODE_ENV !== 'production') {
      return NextResponse.json({ hint: 'unknown' as ProviderHint, debug: { found: false, error: String(e) } }, { status: 200 });
    }
    return NextResponse.json({ hint: 'unknown' as ProviderHint }, { status: 200 });
  }
}