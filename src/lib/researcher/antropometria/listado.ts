/**
 * Listado unificado de pacientes de Antropometrías: deportistas registrados
 * (rol deportista_ucc) + pacientes cargados a mano. `armarListado` es puro; la
 * lectura de Supabase está en `cargarListado`.
 */
import type { Sexo } from '@/lib/antropometria';
import type { SupabaseServidor } from '@/lib/researcher/clienteInvestigador';
import { ATHLETE_ROLE } from '@/lib/researcher/athletes';
import type { DeportistaDatosRow, OrigenPaciente, PacienteManualRow } from '@/types/antropometria';
import { edadEn } from './reglas';

export interface PacienteListado {
  origen: OrigenPaciente;
  id: string;
  nombre: string;
  apellido: string;
  fechaNacimiento: string | null;
  sexo: Sexo | null;
  /** Años cumplidos hoy; null si falta la fecha de nacimiento. */
  edad: number | null;
  cantidadMediciones: number;
  /** AAAA-MM-DD de la última medición vigente; null si no tiene. */
  ultimaMedicion: string | null;
}

interface PerfilFila {
  user_id: string;
  nombre: string;
  apellido: string;
}
interface FisicoFila {
  user_id: string;
  fecha_nacimiento: string | null;
  sexo: Sexo | null;
}
interface MedicionVigenteFila {
  user_id: string | null;
  paciente_manual_id: string | null;
  fecha_medicion: string;
}

export interface FuentesListado {
  perfiles: PerfilFila[];
  fisicos: FisicoFila[];
  auxiliares: Pick<DeportistaDatosRow, 'user_id' | 'sexo' | 'fecha_nacimiento'>[];
  manuales: Pick<PacienteManualRow, 'id' | 'nombre' | 'apellido' | 'fecha_nacimiento' | 'sexo'>[];
  medicionesVigentes: MedicionVigenteFila[];
}

export function armarListado(f: FuentesListado, hoy: Date = new Date()): PacienteListado[] {
  const fisico = new Map(f.fisicos.map((p) => [p.user_id, p]));
  const auxiliar = new Map(f.auxiliares.map((a) => [a.user_id, a]));

  const resumen = new Map<string, { cantidad: number; ultima: string }>();
  for (const m of f.medicionesVigentes) {
    const clave = m.user_id ?? m.paciente_manual_id;
    if (!clave) continue;
    const previo = resumen.get(clave);
    resumen.set(clave, {
      cantidad: (previo?.cantidad ?? 0) + 1,
      ultima: previo && previo.ultima > m.fecha_medicion ? previo.ultima : m.fecha_medicion,
    });
  }

  const deportistas: PacienteListado[] = f.perfiles.map((p) => {
    // `physical_data` manda; el dato auxiliar solo rellena lo que falta.
    const fechaNacimiento = fisico.get(p.user_id)?.fecha_nacimiento ?? auxiliar.get(p.user_id)?.fecha_nacimiento ?? null;
    const sexo = fisico.get(p.user_id)?.sexo ?? auxiliar.get(p.user_id)?.sexo ?? null;
    const r = resumen.get(p.user_id);
    return {
      origen: 'deportista',
      id: p.user_id,
      nombre: p.nombre,
      apellido: p.apellido,
      fechaNacimiento,
      sexo,
      edad: fechaNacimiento ? edadEn(fechaNacimiento, hoy) : null,
      cantidadMediciones: r?.cantidad ?? 0,
      ultimaMedicion: r?.ultima ?? null,
    };
  });

  const manuales: PacienteListado[] = f.manuales.map((p) => {
    const r = resumen.get(p.id);
    return {
      origen: 'manual',
      id: p.id,
      nombre: p.nombre,
      apellido: p.apellido,
      fechaNacimiento: p.fecha_nacimiento,
      sexo: p.sexo,
      edad: edadEn(p.fecha_nacimiento, hoy),
      cantidadMediciones: r?.cantidad ?? 0,
      ultimaMedicion: r?.ultima ?? null,
    };
  });

  return [...deportistas, ...manuales].sort(
    (a, b) => a.apellido.localeCompare(b.apellido, 'es') || a.nombre.localeCompare(b.nombre, 'es'),
  );
}

/** Lee las fuentes con la sesión del investigador (RLS aplica) y arma el listado. */
export async function cargarListado(supabase: SupabaseServidor, hoy: Date = new Date()): Promise<PacienteListado[]> {
  const [perfiles, auxiliares, manuales, mediciones] = await Promise.all([
    supabase.from('profiles').select('user_id, nombre, apellido').eq('role', ATHLETE_ROLE),
    supabase.from('antropometria_deportistas_datos').select('user_id, sexo, fecha_nacimiento'),
    supabase.from('antropometria_pacientes_manuales').select('id, nombre, apellido, fecha_nacimiento, sexo'),
    supabase.from('antropometria_mediciones').select('user_id, paciente_manual_id, fecha_medicion').eq('estado', 'vigente'),
  ]);

  const perfilesFila = (perfiles.data ?? []) as PerfilFila[];
  const ids = perfilesFila.map((p) => p.user_id);
  const fisicos = ids.length
    ? (((await supabase.from('physical_data').select('user_id, fecha_nacimiento, sexo').in('user_id', ids)).data ?? []) as FisicoFila[])
    : [];

  return armarListado(
    {
      perfiles: perfilesFila,
      fisicos,
      auxiliares: (auxiliares.data ?? []) as FuentesListado['auxiliares'],
      manuales: (manuales.data ?? []) as FuentesListado['manuales'],
      medicionesVigentes: (mediciones.data ?? []) as MedicionVigenteFila[],
    },
    hoy,
  );
}
