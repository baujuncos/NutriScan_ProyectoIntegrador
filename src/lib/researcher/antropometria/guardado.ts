/**
 * Lógica pura del guardado de una medición: limpieza de las series que llegan
 * del cliente y decisión de la masa ósea de referencia. Sin I/O: las acciones
 * del servidor la usan y los tests la cubren directo.
 */
import {
  calcularAntropometria,
  CLAVES_VARIABLES,
  EDAD_FIJA_MASA_OSEA,
  type EntradaAntropometria,
  type ResultadoAntropometria,
  type SeriesPorVariable,
} from '@/lib/antropometria';

const MAX_SERIES_POR_VARIABLE = 3;
const CLAVES = new Set<string>(CLAVES_VARIABLES);

/**
 * Deja solo las 25 variables conocidas, con hasta 3 valores finitos y positivos
 * (lo demás pasa a `null`, "serie sin medir"). No inventa variables ni valores.
 */
export function sanearSeries(entrada: unknown): SeriesPorVariable {
  if (typeof entrada !== 'object' || entrada === null || Array.isArray(entrada)) return {};
  const salida: Record<string, (number | null)[]> = {};
  for (const [clave, serie] of Object.entries(entrada)) {
    if (!CLAVES.has(clave) || !Array.isArray(serie)) continue;
    salida[clave] = serie
      .slice(0, MAX_SERIES_POR_VARIABLE)
      .map((v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null));
  }
  return salida as SeriesPorVariable;
}

/**
 * ¿Esta medición es la más antigua del paciente? (sin contar ella misma). Es la que
 * fija la masa ósea de referencia; un empate de fecha cuenta como "la más antigua".
 */
export function esLaMedicionMasAntigua(
  fechaMedicion: string,
  otrasVigentes: readonly { fecha_medicion: string }[],
): boolean {
  return otrasVigentes.every((m) => m.fecha_medicion >= fechaMedicion);
}

export interface DecisionMasaOsea {
  resultado: ResultadoAntropometria;
  /** Valor a persistir como nueva masa ósea de referencia del paciente, o null si no cambia. */
  guardarReferencia: number | null;
}

/**
 * Masa ósea de referencia (fija desde los 21 años):
 *  - menor de 21: se calcula siempre y no se guarda nada;
 *  - sin referencia previa: se guarda la calculada de esta medición;
 *  - la medición más antigua: se recalcula la referencia desde ella (al editar la primera medición
 *    la referencia no puede quedar desactualizada);
 *  - cualquier otra: se reutiliza la guardada.
 * Lanza `ErrorAntropometria` si el motor rechaza los datos.
 */
export function decidirMasaOsea(
  entrada: Omit<EntradaAntropometria, 'masaOseaReferencia'>,
  referenciaGuardada: number | null,
  esMasAntigua: boolean,
): DecisionMasaOsea {
  const sinReferencia = calcularAntropometria({ ...entrada, masaOseaReferencia: null });
  if (sinReferencia.edad.anios < EDAD_FIJA_MASA_OSEA) return { resultado: sinReferencia, guardarReferencia: null };

  if (referenciaGuardada === null || esMasAntigua) {
    const calculada = sinReferencia.masas.masaOsea.calculadaKg;
    return { resultado: sinReferencia, guardarReferencia: calculada === referenciaGuardada ? null : calculada };
  }

  return {
    resultado: calcularAntropometria({ ...entrada, masaOseaReferencia: referenciaGuardada }),
    guardarReferencia: null,
  };
}
