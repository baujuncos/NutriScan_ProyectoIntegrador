import type { NivelActividad, Sexo, SeriesPorVariable } from '@/lib/antropometria';

/**
 * Filas de las tablas de antropometrías (supabase/022_antropometria_nut247.sql,
 * supabase/023_antropometria_instrumentos_nut246.sql y
 * supabase/024_antropometria_fotos_nut251.sql).
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
  /** Quién CARGÓ la medición (no cambia nunca). */
  investigador_id: string;
  /** Quién midió; null = el mismo que `investigador_id` (023). */
  medido_por: string | null;
  /** Instrumentos usados, texto libre (foto de lo escrito al medir); null = sin informar (023). */
  instrumento_balanza: string | null;
  instrumento_calibres: string | null;
  instrumento_plicometro: string | null;
  instrumento_cinta: string | null;
  nivel_actividad: NivelActividad | null;
  deporte: string | null;
  series: SeriesPorVariable;
  estado: EstadoMedicion;
  creado_en: string;
  actualizado_en: string;
  actualizado_por: string | null;
}

/** "Mis instrumentos" de un investigador: su catálogo personal, que precarga las mediciones nuevas (023). */
export interface InstrumentosInvestigadorRow {
  investigador_id: string;
  instrumento_balanza: string | null;
  instrumento_calibres: string | null;
  instrumento_plicometro: string | null;
  instrumento_cinta: string | null;
  actualizado_en: string;
}

/** Posiciones fijas de las fotos posturales: una foto por posición, hasta 3 por medición (024). */
export const POSICIONES_FOTO = ['frente', 'lateral', 'espalda'] as const;
export type PosicionFoto = (typeof POSICIONES_FOTO)[number];

/** Foto postural de una medición. `path` es el objeto en el bucket privado `antropometria-fotos`. */
export interface FotoRow {
  id: string;
  medicion_id: string;
  posicion: PosicionFoto;
  path: string;
  creado_por: string;
  creado_en: string;
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
