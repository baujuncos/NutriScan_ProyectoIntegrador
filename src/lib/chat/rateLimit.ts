// NUT-190 — Rate limit simple por usuario, en memoria (ventana deslizante).
// Limitación: en serverless (Vercel) cada instancia tiene su propio Map y se
// pierde en cada cold start, así que el límite es aproximado. Si hace falta uno
// estricto, mover a una tabla en Supabase o a un store compartido (Upstash/Redis).

export const RATE_LIMIT_MAX_REQUESTS = 10;
export const RATE_LIMIT_WINDOW_MS = 60_000;

const hits = new Map<string, number[]>();

/** Devuelve true si la request está permitida (y la registra). */
export function checkRateLimit(userId: string, now = Date.now()): boolean {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  // Evita que el Map crezca indefinidamente en instancias de larga vida.
  if (hits.size > 5_000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) hits.delete(key);
    }
  }
  return true;
}
