import { todayAR } from './date';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDateLocal(value: string): Date | null {
  if (typeof value !== 'string') return null;
  const m = ISO_DATE.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}

export function ageOn(birth: Date, ref: Date = new Date()): number {
  let age = ref.getFullYear() - birth.getFullYear();
  const m = ref.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < birth.getDate())) age--;
  return age;
}

export const MIN_AGE = 10;
export const MAX_AGE = 100;

export interface BirthDateRange {
  todayISO: string;
  minISO: string;
}

export function birthDateRange(): BirthDateRange {
  const todayISO = todayAR();
  const [y, m, d] = todayISO.split('-').map(Number);
  // La fecha más antigua con edad <= MAX_AGE es la del día siguiente a "hoy hace MAX_AGE + 1 años":
  // quien cumple 101 hoy ya no es válido, quien los cumple mañana sí (DEF-019: antes era hoy - 100 años).
  const min = new Date(y - MAX_AGE - 1, m - 1, d + 1);
  const mm = String(min.getMonth() + 1).padStart(2, '0');
  const dd = String(min.getDate()).padStart(2, '0');
  return { todayISO, minISO: `${min.getFullYear()}-${mm}-${dd}` };
}

export function validateFechaNacimiento(value: string): string | null {
  const d = parseDateLocal(value);
  if (!d) return 'Fecha inválida. Usá el formato AAAA-MM-DD.';
  const today = parseDateLocal(todayAR());
  if (!today) return 'Error interno de fecha.';
  if (d.getTime() > today.getTime()) return 'La fecha no puede ser futura.';
  const age = ageOn(d, today);
  if (age < MIN_AGE) return `Debés tener al menos ${MIN_AGE} años.`;
  if (age > MAX_AGE) return `La edad máxima es ${MAX_AGE} años.`;
  return null;
}
