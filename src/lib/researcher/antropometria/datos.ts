/**
 * Lectura de un paciente y sus mediciones. Se usa siempre con la sesión del
 * investigador (RLS aplica). Los deportistas se resuelven SOLO con rol
 * `deportista_ucc`: los `particular` nunca se ven en el panel.
 */
import type { Sexo } from '@/lib/antropometria';
import { ATHLETE_ROLE } from '@/lib/researcher/athletes';
import type { SupabaseServidor } from '@/lib/researcher/clienteInvestigador';
import type {
  DeportistaDatosRow,
  MedicionRow,
  OrigenPaciente,
  PacienteAntropometria,
  PacienteManualRow,
} from '@/types/antropometria';

interface PerfilFila {
  user_id: string;
  nombre: string;
  apellido: string;
}
interface FisicoFila {
  fecha_nacimiento: string | null;
  sexo: Sexo | null;
}

/** `physical_data` manda; el dato auxiliar solo rellena lo que falta. */
export function armarPacienteDeportista(
  perfil: PerfilFila,
  fisico: FisicoFila | null,
  auxiliar: Pick<DeportistaDatosRow, 'sexo' | 'fecha_nacimiento' | 'masa_osea_referencia'> | null,
): PacienteAntropometria {
  return {
    origen: 'deportista',
    id: perfil.user_id,
    nombre: perfil.nombre,
    apellido: perfil.apellido,
    fechaNacimiento: fisico?.fecha_nacimiento ?? auxiliar?.fecha_nacimiento ?? null,
    sexo: fisico?.sexo ?? auxiliar?.sexo ?? null,
    masaOseaReferencia: auxiliar?.masa_osea_referencia ?? null,
  };
}

export function armarPacienteManual(fila: PacienteManualRow): PacienteAntropometria {
  return {
    origen: 'manual',
    id: fila.id,
    nombre: fila.nombre,
    apellido: fila.apellido,
    fechaNacimiento: fila.fecha_nacimiento,
    sexo: fila.sexo,
    masaOseaReferencia: fila.masa_osea_referencia,
  };
}

export async function cargarPaciente(
  supabase: SupabaseServidor,
  origen: OrigenPaciente,
  id: string,
): Promise<PacienteAntropometria | null> {
  if (origen === 'manual') {
    const { data } = await supabase.from('antropometria_pacientes_manuales').select('*').eq('id', id).maybeSingle();
    return data ? armarPacienteManual(data as PacienteManualRow) : null;
  }

  const { data: perfil } = await supabase
    .from('profiles')
    .select('user_id, nombre, apellido')
    .eq('user_id', id)
    .eq('role', ATHLETE_ROLE)
    .maybeSingle();
  if (!perfil) return null;

  const [fisico, auxiliar] = await Promise.all([
    supabase.from('physical_data').select('fecha_nacimiento, sexo').eq('user_id', id).maybeSingle(),
    supabase
      .from('antropometria_deportistas_datos')
      .select('sexo, fecha_nacimiento, masa_osea_referencia')
      .eq('user_id', id)
      .maybeSingle(),
  ]);
  return armarPacienteDeportista(
    perfil as PerfilFila,
    (fisico.data as FisicoFila | null) ?? null,
    (auxiliar.data as Pick<DeportistaDatosRow, 'sexo' | 'fecha_nacimiento' | 'masa_osea_referencia'> | null) ?? null,
  );
}

/** Borradores y vigentes del paciente, de la más antigua a la más nueva. Las anuladas no se leen. */
export async function cargarMediciones(supabase: SupabaseServidor, paciente: Pick<PacienteAntropometria, 'origen' | 'id'>): Promise<MedicionRow[]> {
  const { data } = await supabase
    .from('antropometria_mediciones')
    .select('*')
    .eq(paciente.origen === 'deportista' ? 'user_id' : 'paciente_manual_id', paciente.id)
    .in('estado', ['borrador', 'vigente'])
    .order('fecha_medicion', { ascending: true })
    .order('creado_en', { ascending: true });
  return (data ?? []) as MedicionRow[];
}

/** id de usuario → "Nombre Apellido" (quién midió / quién editó). */
export async function cargarNombres(supabase: SupabaseServidor, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((i): i is string => !!i))];
  if (unicos.length === 0) return new Map();
  const { data } = await supabase.from('profiles').select('user_id, nombre, apellido').in('user_id', unicos);
  return new Map(((data ?? []) as PerfilFila[]).map((p) => [p.user_id, `${p.nombre} ${p.apellido}`.trim()]));
}

/** Una medición por id (cualquier estado); la página decide qué hacer con las anuladas. */
export async function cargarMedicion(supabase: SupabaseServidor, id: string): Promise<MedicionRow | null> {
  const { data } = await supabase.from('antropometria_mediciones').select('*').eq('id', id).maybeSingle();
  return (data as MedicionRow | null) ?? null;
}

/** El paciente dueño de una medición, sin importar el origen. */
export async function cargarPacienteDeMedicion(supabase: SupabaseServidor, medicion: MedicionRow): Promise<PacienteAntropometria | null> {
  return medicion.user_id
    ? cargarPaciente(supabase, 'deportista', medicion.user_id)
    : medicion.paciente_manual_id
      ? cargarPaciente(supabase, 'manual', medicion.paciente_manual_id)
      : null;
}
