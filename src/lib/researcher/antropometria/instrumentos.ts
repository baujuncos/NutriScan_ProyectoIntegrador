/**
 * Instrumentos de medición de una antropometría (NUT-246): 4 campos de texto libre y opcionales
 * ("modelo o marca"). Lógica pura, compartida por el asistente, las acciones, la configuración y el informe.
 *
 * En los formularios un instrumento sin informar es '' (un input controlado no admite null);
 * en la base es NULL. `normalizarInstrumento` y `columnasInstrumentos` hacen la traducción.
 */
import { z } from 'zod';

export const MAX_INSTRUMENTO = 120;

export const INSTRUMENTOS = [
  { clave: 'balanza', etiqueta: 'Balanza', columna: 'instrumento_balanza' },
  { clave: 'calibres', etiqueta: 'Calibres y segmómetro', columna: 'instrumento_calibres' },
  { clave: 'plicometro', etiqueta: 'Plicómetro', columna: 'instrumento_plicometro' },
  { clave: 'cinta', etiqueta: 'Cinta antropométrica', columna: 'instrumento_cinta' },
] as const;

export type ClaveInstrumento = (typeof INSTRUMENTOS)[number]['clave'];
export type ColumnaInstrumento = (typeof INSTRUMENTOS)[number]['columna'];

/** Los 4 instrumentos como texto de formulario ('' = sin informar). */
export type Instrumentos = Record<ClaveInstrumento, string>;

export const INSTRUMENTOS_VACIOS: Instrumentos = { balanza: '', calibres: '', plicometro: '', cinta: '' };

/** Lo que tiene una fila de la base (medición o "mis instrumentos"). */
export type FilaInstrumentos = Partial<Record<ColumnaInstrumento, string | null>>;

/** Recorta espacios; un texto vacío (o null/undefined) es "sin informar". */
export function normalizarInstrumento(valor: string | null | undefined): string | null {
  const texto = (valor ?? '').trim();
  return texto === '' ? null : texto;
}

const instrumento = z
  .string()
  .trim()
  .max(MAX_INSTRUMENTO, `Cada instrumento admite hasta ${MAX_INSTRUMENTO} caracteres.`)
  .nullish()
  .transform((v) => normalizarInstrumento(v));

/** Validación de lo que llega del cliente: texto de hasta 120 caracteres; vacío → null. Nunca es obligatorio. */
export const instrumentosSchema = z.object({
  balanza: instrumento,
  calibres: instrumento,
  plicometro: instrumento,
  cinta: instrumento,
});

/** Instrumentos (ya normalizados) → columnas de la base. */
export function columnasInstrumentos(instrumentos: Record<ClaveInstrumento, string | null>): Record<ColumnaInstrumento, string | null> {
  return Object.fromEntries(INSTRUMENTOS.map((i) => [i.columna, normalizarInstrumento(instrumentos[i.clave])])) as Record<
    ColumnaInstrumento,
    string | null
  >;
}

/** Fila de la base → texto de formulario. */
export function instrumentosDeFila(fila: FilaInstrumentos | null | undefined): Instrumentos {
  return Object.fromEntries(INSTRUMENTOS.map((i) => [i.clave, fila?.[i.columna] ?? ''])) as Instrumentos;
}

/** Solo los instrumentos informados, en orden, para mostrar al pie del informe. [] = no se muestra el bloque. */
export function lineasInstrumentos(instrumentos: Instrumentos): { etiqueta: string; valor: string }[] {
  return INSTRUMENTOS.flatMap((i) => {
    const valor = normalizarInstrumento(instrumentos[i.clave]);
    return valor ? [{ etiqueta: i.etiqueta, valor }] : [];
  });
}
