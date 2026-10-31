import type { OrigenPaciente } from '@/types/antropometria';

/** Rutas de Antropometrías: un solo lugar para que listado, ficha, asistente e informe no se desincronicen. */
export const RUTA_LISTADO = '/antropometrias';

export const rutaFicha = (origen: OrigenPaciente, id: string) => `${RUTA_LISTADO}/${origen}/${id}`;
export const rutaNuevaMedicion = (origen: OrigenPaciente, id: string) => `${rutaFicha(origen, id)}/medicion/nueva`;
export const rutaInforme = (medicionId: string) => `${RUTA_LISTADO}/medicion/${medicionId}`;
export const rutaEditarMedicion = (medicionId: string) => `${rutaInforme(medicionId)}/editar`;

export function esOrigen(valor: string): valor is OrigenPaciente {
  return valor === 'deportista' || valor === 'manual';
}
