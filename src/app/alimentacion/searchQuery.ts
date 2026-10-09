export type CamposBusqueda = {
  nombre: boolean;
  marca: boolean;
  denominacion: boolean;
};

export const CAMPOS_DEFAULT: CamposBusqueda = { nombre: true, marca: true, denominacion: true };

/**
 * Clausula OR (sintaxis PostgREST) para marca/denominacion, solo con los
 * campos tildados. Vacía si ninguno de los dos está tildado.
 */
export function buildMarcaDenominacionOr(campos: CamposBusqueda, q: string): string {
  const parts: string[] = [];
  if (campos.marca) parts.push(`marca.ilike.*${q}*`);
  if (campos.denominacion) parts.push(`denominacion.ilike.*${q}*`);
  return parts.join(',');
}

export interface FiltroEncadenable<T> {
  or(expr: string): T;
  not(column: string, operator: string, value: string): T;
}

/**
 * Filtra por categoría=suplemento (tab Suplementos) o la excluye (el resto de
 * los tabs). Mira categoria, nombre Y denominacion en ambas ramas.
 *
 * `categoria ilike '%suplemento%'` solo (lo que había antes) deja afuera
 * casos reales del catálogo ANMAT: bebidas/geles deportivos como "Reaktor" o
 * "Recover" están categorizados como "Bebidas analcohólicas" o "Alimentos de
 * régimen" (no "Suplementos dietarios"), pero su `denominacion` dice
 * literalmente "Suplemento hidroelectrolítico..." — verificado contra las
 * 38k filas reales de `ANMAT/anmat_unificado_100g.csv` (32 productos en ese
 * caso exacto). Agregar denominacion a la OR/exclusión cierra ese hueco sin
 * mantener una lista de palabras clave a mano.
 */
export function aplicarFiltroSuplemento<T extends FiltroEncadenable<T>>(builder: T, isSuplemento: boolean): T {
  if (isSuplemento) {
    return builder.or('categoria.ilike.%suplemento%,nombre.ilike.%suplemento%,denominacion.ilike.%suplemento%');
  }
  // Exclusión NULL-safe: `col NOT ILIKE x` es NULL (y descarta la fila) cuando col es NULL.
  // Los 930 alimentos SARA2 tienen `denominacion` NULL, así que con `.not()` simple
  // desaparecían de TODA búsqueda que no fuera de suplementos. Cada `.or()` es un filtro
  // aparte (PostgREST los combina con AND).
  return builder
    .or('categoria.is.null,categoria.not.ilike.%suplemento%')
    .or('nombre.is.null,nombre.not.ilike.%suplemento%')
    .or('denominacion.is.null,denominacion.not.ilike.%suplemento%');
}

/**
 * En qué campo matchea `q` dentro de un alimento (prioridad nombre > marca >
 * denominacion) — se usa para la etiqueta "en denominación" en el dropdown
 * cuando la única coincidencia vino de ese campo.
 */
export function campoDeCoincidencia(
  a: { nombre: string; marca: string | null; denominacion: string | null },
  q: string,
): 'nombre' | 'marca' | 'denominacion' | null {
  const ql = q.toLowerCase();
  if (a.nombre.toLowerCase().includes(ql)) return 'nombre';
  if (a.marca?.toLowerCase().includes(ql)) return 'marca';
  if (a.denominacion?.toLowerCase().includes(ql)) return 'denominacion';
  return null;
}

/** Minúscula y sin tilde, carácter por carácter — preserva la longitud para que los índices sigan valiendo sobre el texto original. */
const plegar = (s: string) =>
  s.split('').map((c) => c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()[0] ?? c).join('');

/**
 * Rango [inicio, fin) de la primera aparición de `q` en `texto`, ignorando
 * mayúsculas y tildes ("mani" coincide con "Maní") — para el `<mark>` del
 * resaltado en el dropdown. null si no hay coincidencia o `q` está vacía.
 */
export function rangoCoincidencia(texto: string, q: string): [number, number] | null {
  if (!q) return null;
  const i = plegar(texto).indexOf(plegar(q));
  return i < 0 ? null : [i, i + q.length];
}

/** Dedupea una lista de ids (ya ordenada por fecha desc) y la corta en `limite`. */
export function idsRecientesUnicos(idsEnOrdenDeFecha: number[], limite: number): number[] {
  const vistos = new Set<number>();
  const resultado: number[] = [];
  for (const id of idsEnOrdenDeFecha) {
    if (vistos.has(id)) continue;
    vistos.add(id);
    resultado.push(id);
    if (resultado.length >= limite) break;
  }
  return resultado;
}
