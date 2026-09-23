import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  const url = process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_ANON_KEY ?? '';
  return createBrowserClient(url, key);
}
