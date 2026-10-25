import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compara dos secretos en tiempo constante. `===` corta en el primer carácter
 * distinto y deja medir (por tiempos de respuesta) cuántos caracteres acertó
 * un atacante. Se hashea primero para que `timingSafeEqual` reciba siempre
 * buffers del mismo largo. Un secreto vacío nunca coincide.
 */
export function secretEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
