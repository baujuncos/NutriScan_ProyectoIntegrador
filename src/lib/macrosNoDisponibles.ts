/**
 * NUT-192 — Un ítem de carga manual nuevo se guarda con origen_macros =
 * 'pendiente' (esperando a un investigador) y, si el investigador lo descarta,
 * 'descartado'. En ambos casos sus kcal/macros almacenados valen 0 por las
 * columnas NOT NULL DEFAULT 0, pero ese 0 NO significa "dio cero": significa
 * "no disponible". El discriminador es origen_macros (nunca el valor numérico).
 */

type ConOrigen = { origen_macros?: string | null };

const ORIGENES_SIN_MACROS: ReadonlySet<string> = new Set(['pendiente', 'descartado']);

export function macrosNoDisponibles(item: ConOrigen): boolean {
  return item.origen_macros != null && ORIGENES_SIN_MACROS.has(item.origen_macros);
}

export function contarSinMacros(items: ConOrigen[] | null | undefined): number {
  return (items ?? []).filter(macrosNoDisponibles).length;
}
