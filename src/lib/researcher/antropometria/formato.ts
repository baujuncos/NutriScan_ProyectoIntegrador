/**
 * Formato es-AR con DECIMALES FIJOS para el informe: "3,0" y "17,60", no "3" ni "17,6", así las
 * columnas se leen parejas. (`fmt` de `@/lib/numeros` solo fija el máximo de decimales.)
 */
const formatos = new Map<number, Intl.NumberFormat>();

export function fmtFijo(n: number | null | undefined, decimales = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  let f = formatos.get(decimales);
  if (!f) {
    f = new Intl.NumberFormat('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
    formatos.set(decimales, f);
  }
  return f.format(n);
}

/** Con signo explícito y menos tipográfico: "+0,52" / "−0,31"; el cero no lleva signo. */
export function fmtConSigno(n: number | null | undefined, decimales = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const texto = fmtFijo(Math.abs(n), decimales);
  if (Number(texto.replace(',', '.')) === 0) return texto;
  return n > 0 ? `+${texto}` : `−${texto}`;
}
