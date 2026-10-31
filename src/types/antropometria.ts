import type { NivelActividad, Sexo, SeriesPorVariable } from '@/lib/antropometria';

/**
 * Filas de las tablas de antropometrías (supabase/021_antropometria_nut247.sql).
 * El repo no genera tipos de la base: se mantienen a mano, como el resto de `src/types`.
 */

export type EstadoMedicion = 'borrador' | 'vigente' | 'anulada';

/** Cómo se llega al paciente: deportista registrado (`profiles`) o paciente cargado a mano. */
export type OrigenPaciente = 'deportista' | 'manual';

export const MAX_MEDICIONES_POR_PACIENTE = 12;

export interface PacienteManualRow {
  id: string;
  nombre: string;
  apellido: string;
  fecha_nacimiento: string;
  sexo: Sexo;
  masa_osea_referencia: number | null;
  creado_por: string;
  creado_en: string;
}

/** Respaldo por deportista registrado; `physical_data` manda cuando tiene el dato. */
export interface DeportistaDatosRow {
  user_id: string;
  sexo: Sexo | null;
  fecha_nacimiento: string | null;
  masa_osea_referencia: number | null;
  actualizado_por: string | null;
  actualizado_en: string;
}

export interface MedicionRow {
  id: string;
  user_id: string | null;
  paciente_manual_id: string | null;
  fecha_medicion: string;
  investigador_id: string;
  nivel_actividad: NivelActividad | null;
  deporte: string | null;
  series: SeriesPorVariable;
  estado: EstadoMedicion;
  creado_en: string;
  actualizado_en: string;
  actualizado_por: string | null;
}

/** Paciente ya resuelto, igual para ambos orígenes (lo que consumen listado, ficha e informe). */
export interface PacienteAntropometria {
  origen: OrigenPaciente;
  id: string;
  nombre: string;
  apellido: string;
  /** null solo en deportistas sin `physical_data` ni dato auxiliar. */
  fechaNacimiento: string | null;
  sexo: Sexo | null;
  masaOseaReferencia: number | null;
}
