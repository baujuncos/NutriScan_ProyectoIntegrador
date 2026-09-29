/**
 * NUT-169 (sesión 2/2) — Persistencia de la última vajilla/diámetro elegidos,
 * para preseleccionarlos la próxima vez que se abre "Reconocimiento por IA".
 *
 * Elegido `localStorage` (mismo patrón que `PWAInstallPrompt.tsx`) en vez de
 * una columna en `profiles`: es una conveniencia de UI por dispositivo, no un
 * dato de investigación ni algo que otro cliente del usuario necesite leer.
 */
import { VAJILLA_TIPOS, type VajillaTipo } from './vajilla';

const KEY = 'nutriscan:ultimaVajilla';

export interface VajillaPreferencia {
  tipo: VajillaTipo;
  diametroCm: number | null;
}

function esVajillaTipo(v: unknown): v is VajillaTipo {
  return typeof v === 'string' && (VAJILLA_TIPOS as readonly string[]).includes(v);
}

/** `null` si no hay preferencia guardada o el storage no está disponible (SSR, privado, etc). */
export function leerUltimaVajilla(): VajillaPreferencia | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { tipo, diametroCm } = parsed as Record<string, unknown>;
    if (!esVajillaTipo(tipo)) return null;
    return {
      tipo,
      diametroCm: typeof diametroCm === 'number' && Number.isFinite(diametroCm) ? diametroCm : null,
    };
  } catch {
    return null;
  }
}

export function guardarUltimaVajilla(pref: VajillaPreferencia): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(pref));
  } catch {
    // localStorage no disponible (privado, cuota) — no bloquea el flujo.
  }
}
