export type CodigoErrorAntropometria =
  | 'MENOR_DE_EDAD'
  | 'FECHA_INVALIDA'
  | 'SEXO_INVALIDO'
  | 'NIVEL_ACTIVIDAD_INVALIDO'
  | 'DEPORTE_INVALIDO'
  | 'SERIE_INVALIDA'
  | 'VARIABLES_FALTANTES'
  | 'MASA_OSEA_INVALIDA';

/** Error de validación del motor antropométrico; `codigo` es estable para que la UI lo traduzca. */
export class ErrorAntropometria extends Error {
  constructor(
    readonly codigo: CodigoErrorAntropometria,
    mensaje: string,
    readonly detalle?: Record<string, unknown>,
  ) {
    super(mensaje);
    this.name = 'ErrorAntropometria';
  }
}
