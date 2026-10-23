// Variables de entorno de las pruebas E2E (ver docs/SETUP_SECRETS.md). Nunca se imprimen valores.
const pick = (...names: string[]) => names.map((n) => process.env[n]?.trim()).find(Boolean) ?? '';

export const env = {
  /** App desplegada que se prueba. Por defecto, una app local (`npm run build && npm start`). */
  baseUrl: (pick('E2E_BASE_URL', 'BASE_URL') || 'http://localhost:3000').replace(/\/$/, ''),
  supabaseUrl: pick('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, ''),
  supabaseAnonKey: pick('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  /** Usuario de PRUEBA (particular) creado solo para el E2E. */
  userEmail: pick('E2E_USER_EMAIL'),
  userPassword: pick('E2E_USER_PASSWORD'),
  geminiApiKey: pick('GEMINI_API_KEY'),
  /** Secreto para saltar la protección de los previews de Vercel (opcional). */
  vercelBypass: pick('VERCEL_BYPASS_SECRET'),
};

export const tieneSupabase = Boolean(env.supabaseUrl && env.supabaseAnonKey);
export const tieneUsuarioDePrueba = tieneSupabase && Boolean(env.userEmail && env.userPassword);
export const tieneGemini = Boolean(env.geminiApiKey);

/** Headers comunes para pegarle a la app desplegada. */
export const appHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...(env.vercelBypass ? { 'x-vercel-protection-bypass': env.vercelBypass } : {}),
  ...extra,
});

/** Inicia sesión en Supabase Auth con el usuario de prueba y devuelve el access_token. */
export async function loginUsuarioDePrueba(): Promise<{ accessToken: string; userId: string }> {
  const res = await fetch(`${env.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.supabaseAnonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: env.userEmail, password: env.userPassword }),
  });
  if (!res.ok) throw new Error(`Login del usuario de prueba falló: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token: string; user: { id: string } };
  return { accessToken: body.access_token, userId: body.user.id };
}

/** Pide algo a PostgREST (Supabase REST) con la anon key y, opcionalmente, el token del usuario. */
export async function rest(path: string, opts: { token?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      apikey: env.supabaseAnonKey,
      authorization: `Bearer ${opts.token ?? env.supabaseAnonKey}`,
      'content-type': 'application/json',
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}
