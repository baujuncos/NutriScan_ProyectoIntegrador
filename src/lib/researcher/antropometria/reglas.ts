/**
 * Reglas de negocio de Antropometrías validadas por los nutricionistas. Todo puro
 * (sin I/O) para poder testearlo y compartirlo entre el servidor y la UI.
 */
import { ageOn, parseDateLocal } from '@/lib/dates';
import { EDAD_MINIMA } from '@/lib/antropometria';
import { MAX_MEDICIONES_POR_PACIENTE } from '@/types/antropometria';

export const MENSAJE_MENOR_DE_EDAD = `Solo se pueden registrar y medir pacientes mayores de ${EDAD_MINIMA} años.`;

/** Edad en años cumplidos a `hoy`, o null si la fecha no es válida. */
export function edadEn(fechaNacimiento: string, hoy: Date = new Date()): number | null {
  const nacimiento = parseDateLocal(fechaNacimiento);
  return nacimiento ? ageOn(nacimiento, hoy) : null;
}

/** true solo con una fecha válida y ≥ 18 años cumplidos a `referencia`. */
export function esMayorDeEdad(fechaNacimiento: string, referencia: Date = new Date()): boolean {
  const edad = edadEn(fechaNacimiento, referencia);
  return edad !== null && edad >= EDAD_MINIMA;
}

/** Bloque Unicode de marcas combinadas (U+0300–U+036F): lo que deja `normalize('NFD')` de las tildes. */
const MARCAS_DIACRITICAS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');

/** Minúsculas, sin tildes y con espacios colapsados: "  María  PÉREZ " → "maria perez". */
export function normalizarNombre(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(MARCAS_DIACRITICAS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface DatosIdentidad {
  nombre: string;
  apellido: string;
  fechaNacimiento: string | null;
}

/** Primer paciente existente con el mismo nombre, apellido y fecha de nacimiento (aviso, nunca bloquea). */
export function buscarDuplicado<T extends DatosIdentidad>(candidato: DatosIdentidad, existentes: readonly T[]): T | null {
  const nombre = normalizarNombre(candidato.nombre);
  const apellido = normalizarNombre(candidato.apellido);
  return (
    existentes.find(
      (p) =>
        p.fechaNacimiento === candidato.fechaNacimiento &&
        normalizarNombre(p.nombre) === nombre &&
        normalizarNombre(p.apellido) === apellido,
    ) ?? null
  );
}

/** Hasta 12 mediciones vigentes por paciente (una por mes durante un año). */
export function puedeAgregarMedicion(cantidadVigentes: number): boolean {
  return cantidadVigentes < MAX_MEDICIONES_POR_PACIENTE;
}

export const MENSAJE_LIMITE_MEDICIONES = `Este paciente ya tiene ${MAX_MEDICIONES_POR_PACIENTE} mediciones. Anulá una para poder cargar otra.`;

/**
 * Por qué no se puede cargar una medición nueva, o null si se puede. Un deportista sin
 * fecha de nacimiento no se bloquea: el asistente se la pide en el primer paso.
 */
export function motivoBloqueoNuevaMedicion(
  paciente: { fechaNacimiento: string | null },
  cantidadVigentes: number,
  hoy: Date = new Date(),
): string | null {
  if (paciente.fechaNacimiento && !esMayorDeEdad(paciente.fechaNacimiento, hoy)) return MENSAJE_MENOR_DE_EDAD;
  if (!puedeAgregarMedicion(cantidadVigentes)) return MENSAJE_LIMITE_MEDICIONES;
  return null;
}

/** "2026-10-24" → "24/10/2026" (sin pasar por Date: evita corrimientos de zona horaria). */
export function fechaLegible(iso: string): string {
  const [anio, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${anio}`;
}

/** "2026-10-24" y "2026-10-02" → true (mismo año y mes). */
export function mismoMes(fechaA: string, fechaB: string): boolean {
  return fechaA.slice(0, 7) === fechaB.slice(0, 7);
}

/** Mediciones vigentes del mismo mes que `fecha`, sin contar la que se está editando. */
export function medicionesDelMismoMes<T extends { id: string; fecha_medicion: string }>(
  fecha: string,
  vigentes: readonly T[],
  excluirId?: string,
): T[] {
  return vigentes.filter((m) => m.id !== excluirId && mismoMes(m.fecha_medicion, fecha));
}

const DECIMAL = /^\d+([.,]\d+)?$/;

/** "12,5" / "12.5" / "12" → número; vacío o con basura → null. Sin negativos ni notación científica. */
export function parsearDecimal(texto: string): number | null {
  const limpio = texto.trim();
  if (!DECIMAL.test(limpio)) return null;
  const n = Number(limpio.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Para mostrar en un input: punto → coma ("12.5" → "12,5"). */
export function textoDecimal(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '' : String(n).replace('.', ',');
}
