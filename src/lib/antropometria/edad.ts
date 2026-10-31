import { ageOn, parseDateLocal } from '../dates';
import { ErrorAntropometria } from './errores';

/** Solo se miden mayores de edad (respuesta 11 del cuestionario a nutrición). */
export const EDAD_MINIMA = 18;

export interface Edad {
  /** Años cumplidos a la fecha de medición. */
  anios: number;
  /** Años decimales como la planilla: (medición − nacimiento) / 365,25 (Proc datos brutos!I3). */
  decimal: number;
}

function fechaIso(valor: string, campo: string): Date {
  const fecha = parseDateLocal(valor);
  if (!fecha) {
    throw new ErrorAntropometria('FECHA_INVALIDA', `"${campo}" debe ser una fecha AAAA-MM-DD válida.`, { campo, valor });
  }
  return fecha;
}

const diasUtc = (f: Date) => Date.UTC(f.getFullYear(), f.getMonth(), f.getDate()) / 86_400_000;

/** Calcula la edad y rechaza menores de 18 con `MENOR_DE_EDAD`. */
export function calcularEdad(fechaNacimiento: string, fechaMedicion: string): Edad {
  const nacimiento = fechaIso(fechaNacimiento, 'fechaNacimiento');
  const medicion = fechaIso(fechaMedicion, 'fechaMedicion');
  if (nacimiento.getTime() > medicion.getTime()) {
    throw new ErrorAntropometria('FECHA_INVALIDA', 'La fecha de nacimiento es posterior a la fecha de medición.', {
      fechaNacimiento,
      fechaMedicion,
    });
  }

  const anios = ageOn(nacimiento, medicion);
  if (anios < EDAD_MINIMA) {
    throw new ErrorAntropometria(
      'MENOR_DE_EDAD',
      `Solo se pueden calcular antropometrías de mayores de ${EDAD_MINIMA} años (edad: ${anios}).`,
      { anios },
    );
  }
  return { anios, decimal: (diasUtc(medicion) - diasUtc(nacimiento)) / 365.25 };
}
