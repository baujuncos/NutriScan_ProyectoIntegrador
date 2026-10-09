/**
 * NUT-119 — Catálogo que usa el matching automático de lo que detecta la IA:
 * sólo SARA2 (genéricos, ~930). ANMAT queda afuera a propósito: son productos
 * envasados y el riesgo de un match equivocado (ej. "Huevo" → un huevo de
 * chocolate) es alto; esos se cargan por código de barras o eligiéndolos a mano
 * en el buscador. Los alimentos que validan los investigadores tampoco entran
 * (no se agregan a `alimentos`): se reutilizan por la cola de validación.
 *
 * Se le pasan a Gemini los candidatos de esta lista para que ELIJA de ellos. Es de lectura
 * pública y casi no cambia, así que se cachea en memoria unos minutos.
 */

export const FUENTES_AUTOMATICAS = ['SARA2'] as const;

export interface EntradaCatalogo {
  id: number;
  nombre: string;
}

/** Lo mínimo del cliente de Supabase que usamos (facilita mockear). */
export interface CatalogoClient {
  from: (tabla: string) => any;
}

const TTL_MS = 5 * 60 * 1000;
// PostgREST devuelve como máximo 1000 filas por consulta: se pagina.
const PAGINA = 1000;
// ponytail: tope de seguridad (20 mil entradas); si el catálogo automático llega ahí, pasar a preselección por similitud.
const MAX_PAGINAS = 20;

// Palabras vacías que no sirven para decidir si dos nombres "se parecen".
const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'al', 'en', 'y', 'a', 'para', 'por', 'un', 'una', 'tipo']);

/** Palabras en minúscula y sin tildes ("Pan francés" → ["pan", "frances"]). */
function palabras(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** ¿Es la misma palabra, un prefijo (plural/singular: "tomates" ~ "tomate")? */
const coincide = (w: string, t: string) => w === t || w.startsWith(t) || (w.length >= 4 && t.startsWith(w));

/**
 * Preselecciona qué entradas del catálogo se le muestran a la IA: sólo las que
 * comparten una palabra con algún alimento detectado (≈85 % menos tokens que la
 * lista entera: ~1 400 vs ~8 900 en un plato de 12 alimentos). Si algún
 * alimento no comparte ninguna palabra (sinónimos: "aguacate" ~ "palta") se
 * devuelve la lista ENTERA, para no perder recall; es el caso raro.
 */
export function preseleccionarCandidatos(nombres: string[], catalogo: EntradaCatalogo[]): EntradaCatalogo[] {
  if (catalogo.length === 0) return [];
  const indexado = catalogo.map((e) => ({ e, palabras: palabras(e.nombre) }));
  const elegidos = new Set<number>();
  for (const nombre of nombres) {
    const anclas = palabras(nombre).filter((t) => t.length >= 3 && !PALABRAS_VACIAS.has(t));
    const hits = indexado.filter(({ palabras: ps }) => anclas.some((t) => ps.some((w) => coincide(w, t))));
    if (hits.length === 0) return catalogo;
    for (const h of hits) elegidos.add(h.e.id);
  }
  return catalogo.filter((e) => elegidos.has(e.id));
}

let cache: { entradas: EntradaCatalogo[]; expira: number } | null = null;

/** Sólo para tests. */
export function limpiarCacheCatalogo(): void {
  cache = null;
}

export async function cargarCatalogoAutomatico(
  client: CatalogoClient,
  ahora: number = Date.now(),
): Promise<EntradaCatalogo[]> {
  if (cache && cache.expira > ahora) return cache.entradas;

  const entradas: EntradaCatalogo[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const desde = pagina * PAGINA;
    const { data, error } = await client
      .from('alimentos')
      .select('id_alimento, nombre')
      .in('fuente', [...FUENTES_AUTOMATICAS])
      .order('id_alimento')
      .range(desde, desde + PAGINA - 1);
    if (error) throw new Error(`No se pudo leer el catálogo automático: ${error.message}`);
    const filas = (data ?? []) as Array<{ id_alimento: number; nombre: string }>;
    for (const f of filas) entradas.push({ id: Number(f.id_alimento), nombre: f.nombre });
    if (filas.length < PAGINA) break;
  }

  cache = { entradas, expira: ahora + TTL_MS };
  return entradas;
}
