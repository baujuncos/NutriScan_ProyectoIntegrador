const TZ = 'America/Argentina/Buenos_Aires';

export function todayAR(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

export function daysAgoAR(days: number): string {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
  const [y, m, d] = formatter.format(new Date()).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - days);
  return formatter.format(date);
}

/** Ventana en la que se puede cargar o editar una comida: hasta 7 días atrás, nunca en el futuro. */
export function estaEnRangoEditable(fecha: string): boolean {
  return fecha >= daysAgoAR(7) && fecha <= todayAR();
}
