/**
 * Puente entre lo que se guarda (datos crudos) y el motor: arma la entrada y
 * calcula al vuelo. Nada derivado se persiste, así editar siempre recalcula.
 */
import {
  calcularAntropometria,
  ErrorAntropometria,
  type EntradaAntropometria,
  type ResultadoAntropometria,
} from '@/lib/antropometria';
import type { MedicionRow, PacienteAntropometria } from '@/types/antropometria';

export type CalculoMedicion = { ok: true; resultado: ResultadoAntropometria } | { ok: false; motivo: string };

/** null si faltan datos del paciente o de la medición que el motor necesita. */
export function entradaDesdeMedicion(
  paciente: Pick<PacienteAntropometria, 'fechaNacimiento' | 'sexo' | 'masaOseaReferencia'>,
  medicion: Pick<MedicionRow, 'fecha_medicion' | 'series' | 'nivel_actividad' | 'deporte'>,
): EntradaAntropometria | null {
  if (!paciente.fechaNacimiento || !paciente.sexo || !medicion.nivel_actividad) return null;
  return {
    sexo: paciente.sexo,
    fechaNacimiento: paciente.fechaNacimiento,
    fechaMedicion: medicion.fecha_medicion,
    series: medicion.series,
    nivelActividad: medicion.nivel_actividad,
    deporte: medicion.deporte,
    masaOseaReferencia: paciente.masaOseaReferencia,
  };
}

/** Calcula una medición; un error del motor (menor, faltantes…) vuelve como `motivo`, no como excepción. */
export function calcularMedicion(
  paciente: Pick<PacienteAntropometria, 'fechaNacimiento' | 'sexo' | 'masaOseaReferencia'>,
  medicion: Pick<MedicionRow, 'fecha_medicion' | 'series' | 'nivel_actividad' | 'deporte'>,
): CalculoMedicion {
  const entrada = entradaDesdeMedicion(paciente, medicion);
  if (!entrada) return { ok: false, motivo: 'Faltan datos del paciente o de la medición para calcular el informe.' };
  try {
    return { ok: true, resultado: calcularAntropometria(entrada) };
  } catch (e) {
    if (e instanceof ErrorAntropometria) return { ok: false, motivo: e.message };
    throw e;
  }
}

export interface ResumenMedicion {
  pesoKg: number;
  masaAdiposaKg: number;
  masaMuscularKg: number;
}

/** Lo que muestra la fila de la ficha; null si la medición no se puede calcular. */
export function resumirMedicion(
  paciente: Pick<PacienteAntropometria, 'fechaNacimiento' | 'sexo' | 'masaOseaReferencia'>,
  medicion: Pick<MedicionRow, 'fecha_medicion' | 'series' | 'nivel_actividad' | 'deporte'>,
): ResumenMedicion | null {
  const c = calcularMedicion(paciente, medicion);
  if (!c.ok) return null;
  const { estadistica, masas } = c.resultado;
  return {
    pesoKg: estadistica.peso.mediana,
    masaAdiposaKg: masas.masas.adiposa.kg,
    masaMuscularKg: masas.masas.muscular.kg,
  };
}
