/**
 * NUT-119 — Matching de nombres de alimentos contra `public.alimentos` vía la
 * RPC `match_alimentos` (pg_trgm + unaccent, ver supabase/013). Una sola
 * llamada por comida, nunca una por ítem. El matching vive en Postgres: acá
 * solo se arma la llamada y se normaliza la forma del resultado.
 */
import type { Macros100 } from './macros';

export type MetodoMatchCatalogo = 'exacto';

export interface MatchResultado {
  /** Clave normalizada calculada por SQL (null si el nombre no tiene caracteres útiles). */
  nombreNormalizado: string | null;
  idAlimento: number | null;
  nombre: string | null;
  fuente: string | null;
  score: number | null;
  metodo: MetodoMatchCatalogo | null;
  macros: Macros100 | null;
}

interface MatchRow {
  idx: number;
  nombre_normalizado: string | null;
  id_alimento: number | null;
  nombre: string | null;
  fuente: string | null;
  score: number | null;
  metodo: MetodoMatchCatalogo | null;
  kcal_100g: number | string | null;
  proteinas_100g: number | string | null;
  grasas_100g: number | string | null;
  carbs_100g: number | string | null;
}

/** Lo mínimo del cliente de Supabase que necesitamos (facilita mockear). */
export interface RpcClient {
  rpc: (fn: string, args?: object) => PromiseLike<{ data: any; error: any }>;
}

const SIN_MATCH: MatchResultado = {
  nombreNormalizado: null,
  idAlimento: null,
  nombre: null,
  fuente: null,
  score: null,
  metodo: null,
  macros: null,
};

// numeric de Postgres llega como string por PostgREST.
const num = (v: number | string | null): number => Number(v ?? 0);

/** Devuelve un resultado por nombre, en el mismo orden que la entrada. */
export async function matchearAlimentos(client: RpcClient, nombres: string[]): Promise<MatchResultado[]> {
  if (nombres.length === 0) return [];

  const { data, error } = await client.rpc('match_alimentos', { p_nombres: nombres });
  if (error) throw new Error(`match_alimentos falló: ${error.message}`);

  // La RPC numera desde 1 (with ordinality) y no garantiza orden en el cliente.
  const porIdx = new Map<number, MatchRow>((data as MatchRow[] | null ?? []).map((r) => [Number(r.idx), r]));

  return nombres.map((_, i) => {
    const r = porIdx.get(i + 1);
    if (!r) return { ...SIN_MATCH };
    const hayMatch = r.id_alimento != null;
    return {
      nombreNormalizado: r.nombre_normalizado,
      idAlimento: hayMatch ? Number(r.id_alimento) : null,
      nombre: r.nombre,
      fuente: r.fuente,
      score: r.score,
      metodo: hayMatch ? r.metodo : null,
      macros: hayMatch
        ? {
            kcal_100g: num(r.kcal_100g),
            proteinas_100g: num(r.proteinas_100g),
            grasas_100g: num(r.grasas_100g),
            carbs_100g: num(r.carbs_100g),
          }
        : null,
    };
  });
}
