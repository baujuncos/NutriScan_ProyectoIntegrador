/**
 * Investigadores, "mis instrumentos" y error técnico de medición (NUT-246). Se usa siempre con la
 * sesión del investigador (RLS aplica): `profiles` lo lee todo investigador/administrador y
 * "mis instrumentos" es privado de cada uno.
 */
import { calcularErrorTecnico, type ErrorTecnico, type SeriesPorVariable } from '@/lib/antropometria';
import type { SupabaseServidor } from '@/lib/researcher/clienteInvestigador';
import { cargarNombres } from './datos';
import { instrumentosDeFila, type FilaInstrumentos, type Instrumentos } from './instrumentos';

/** Roles que pueden medir (los mismos que entran al panel de investigadores). */
export const ROLES_INVESTIGADOR = ['investigador', 'administrador'] as const;

export interface Investigador {
  id: string;
  nombre: string;
}

/** Lo que el asistente y el informe muestran del error técnico de un investigador. */
export interface ResumenEtmInvestigador {
  pliegues: number | null;
  otras: number | null;
  /** Mediciones vigentes en las que se basa. */
  mediciones: number;
}

export function resumenEtm(etm: ErrorTecnico | undefined | null): ResumenEtmInvestigador | null {
  return etm ? { pliegues: etm.resumen.pliegues, otras: etm.resumen.otras, mediciones: etm.mediciones } : null;
}

/** Todos los investigadores y administradores, ordenados por apellido: el selector de "Investigador que midió". */
export async function cargarInvestigadores(supabase: SupabaseServidor): Promise<Investigador[]> {
  const { data } = await supabase
    .from('profiles')
    .select('user_id, nombre, apellido')
    .in('role', [...ROLES_INVESTIGADOR])
    .order('apellido', { ascending: true })
    .order('nombre', { ascending: true });
  return ((data ?? []) as { user_id: string; nombre: string; apellido: string }[]).map((p) => ({
    id: p.user_id,
    nombre: `${p.nombre} ${p.apellido}`.trim(),
  }));
}

/** ¿Este usuario es investigador o administrador? (para validar "quién midió" en el servidor). */
export async function esInvestigador(supabase: SupabaseServidor, id: string): Promise<boolean> {
  const { data } = await supabase.from('profiles').select('user_id').eq('user_id', id).in('role', [...ROLES_INVESTIGADOR]).maybeSingle();
  return !!data;
}

/** id del usuario con sesión, o null. */
export async function cargarUsuarioId(supabase: SupabaseServidor): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** "Mis instrumentos" del usuario; vacíos si todavía no cargó nada. */
export async function cargarMisInstrumentos(supabase: SupabaseServidor, usuarioId: string | null): Promise<Instrumentos> {
  if (!usuarioId) return instrumentosDeFila(null);
  const { data } = await supabase
    .from('antropometria_instrumentos_investigador')
    .select('instrumento_balanza, instrumento_calibres, instrumento_plicometro, instrumento_cinta')
    .eq('investigador_id', usuarioId)
    .maybeSingle();
  return instrumentosDeFila((data as FilaInstrumentos | null) ?? null);
}

export interface FilaSeriesInvestigador {
  medido_por: string | null;
  investigador_id: string;
  series: SeriesPorVariable;
}

/**
 * Agrupa las mediciones por quien midió (`medido_por`, y si es null quien la cargó) y calcula el ETM de cada uno.
 * Pura: la usan el loader y los tests.
 */
export function agruparErrorTecnico(filas: readonly FilaSeriesInvestigador[]): Record<string, ErrorTecnico> {
  const porInvestigador = new Map<string, SeriesPorVariable[]>();
  for (const fila of filas) {
    const id = fila.medido_por ?? fila.investigador_id;
    const series = porInvestigador.get(id);
    if (series) series.push(fila.series);
    else porInvestigador.set(id, [fila.series]);
  }
  return Object.fromEntries([...porInvestigador].map(([id, series]) => [id, calcularErrorTecnico(series)]));
}

const TAMANO_PAGINA = 1000;
const MAX_PAGINAS = 20;

/**
 * ETM de cada investigador sobre sus mediciones VIGENTES (no cuentan borradores ni anuladas).
 * Una sola consulta de solo tres columnas, paginada porque PostgREST corta en 1000 filas.
 */
export async function cargarErrorTecnicoPorInvestigador(supabase: SupabaseServidor): Promise<Record<string, ErrorTecnico>> {
  const filas: FilaSeriesInvestigador[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const { data } = await supabase
      .from('antropometria_mediciones')
      .select('medido_por, investigador_id, series')
      .eq('estado', 'vigente')
      .order('id', { ascending: true })
      .range(pagina * TAMANO_PAGINA, (pagina + 1) * TAMANO_PAGINA - 1);
    const lote = (data ?? []) as FilaSeriesInvestigador[];
    filas.push(...lote);
    if (lote.length < TAMANO_PAGINA) break;
  }
  return agruparErrorTecnico(filas);
}

export interface AyudasAsistente {
  investigadores: Investigador[];
  miId: string;
  misInstrumentos: Instrumentos;
  etmPorInvestigador: Record<string, ResumenEtmInvestigador>;
}

/**
 * Todo lo que el asistente necesita de los investigadores. `medidoPorActual` (al editar) se agrega al selector
 * aunque ya no figure como investigador, para que la medición no cambie de responsable sin querer.
 * `conMisInstrumentos` solo hace falta en una medición nueva (las existentes traen los suyos).
 */
export async function cargarAyudasAsistente(
  supabase: SupabaseServidor,
  { medidoPorActual = null, conMisInstrumentos = false }: { medidoPorActual?: string | null; conMisInstrumentos?: boolean } = {},
): Promise<AyudasAsistente> {
  const [lista, miId, etm] = await Promise.all([
    cargarInvestigadores(supabase),
    cargarUsuarioId(supabase),
    cargarErrorTecnicoPorInvestigador(supabase),
  ]);
  const investigadores = [...lista];
  if (medidoPorActual && !investigadores.some((i) => i.id === medidoPorActual)) {
    const nombres = await cargarNombres(supabase, [medidoPorActual]);
    investigadores.push({ id: medidoPorActual, nombre: nombres.get(medidoPorActual) ?? 'Investigador' });
  }
  return {
    investigadores,
    miId: miId ?? '',
    misInstrumentos: conMisInstrumentos ? await cargarMisInstrumentos(supabase, miId) : instrumentosDeFila(null),
    etmPorInvestigador: Object.fromEntries(Object.entries(etm).map(([id, e]) => [id, resumenEtm(e)!])),
  };
}
