import { UserRole } from '@/types';

export function getRoleLabel(role: string): string {
  if (role === 'deportista_ucc') return 'Deportista UCC';
  if (role === 'particular') return 'Usuario Particular';
  return role;
}

/**
 * Deportistas UCC participan en un estudio a ciegas: no deben recibir
 * retroalimentación numérica de calorías/macros para no sesgar su conducta alimentaria.
 */
export function shouldHideNutritionInfo(role: string): boolean {
  return role === 'deportista_ucc';
}

export function esEmailUCC(email: string | null | undefined): boolean {
  return (email ?? '').toLowerCase().endsWith('@ucc.edu.ar');
}

export function determineRoleFromEmail(email: string): UserRole {
  const domain = email.split('@')[1]?.toLowerCase();
  if (domain === 'ucc.edu.ar') {
    return 'deportista_ucc';
  }
  return 'particular';
}

/**
 * ¿Este alta es de investigador? No se confía en un query param (cualquiera lo
 * puede agregar a /auth/callback, y Supabase puede descartarlo del redirectTo):
 * vale el rol que /api/register dejó en user_metadata (alta por email) o la
 * cookie del código de invitación ya validado (alta con Google).
 */
export function esAltaInvestigador(opts: {
  metaRole: unknown;
  cookieToken?: string;
  validCode?: string;
}): boolean {
  if (opts.metaRole === 'investigador') return true;
  const valid = opts.validCode?.trim();
  return !!valid && opts.cookieToken === valid;
}

/**
 * Extracts nombre and apellido from Supabase user metadata.
 * Supports both email-based signup (metadata.nombre / metadata.apellido)
 * and Google OAuth (metadata.full_name).
 */
export function extractNombreApellido(userMetadata: Record<string, unknown>): {
  nombre: string;
  apellido: string;
} {
  const metaNombre = (userMetadata?.nombre as string) || (userMetadata?.full_name as string) || '';
  const metaApellido = (userMetadata?.apellido as string) || '';
  const nombre =
    metaNombre.includes(' ') && !metaApellido ? metaNombre.split(' ')[0] : metaNombre;
  const apellido =
    metaApellido || (metaNombre.includes(' ') ? metaNombre.split(' ').slice(1).join(' ') : '');
  return { nombre, apellido };
}
