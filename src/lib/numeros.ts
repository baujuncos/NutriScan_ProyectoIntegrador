/**
 * NUT-119 — Formato de números para mostrar (es-AR: coma decimal), como en el "Revisar alimento".
 * Sólo para mostrar: los campos numéricos y los cálculos siguen usando punto.
 */
const formatos = new Map<number, Intl.NumberFormat>();

export function fmt(n: number, decimales = 1): string {
  if (!Number.isFinite(n)) return '—';
  let f = formatos.get(decimales);
  if (!f) {
    f = new Intl.NumberFormat('es-AR', { maximumFractionDigits: decimales });
    formatos.set(decimales, f);
  }
  return f.format(n);
}
