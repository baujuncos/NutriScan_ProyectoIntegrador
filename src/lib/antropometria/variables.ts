// Las 25 variables obligatorias de la medición (protocolo ISAK, planilla de F. Holway).
// `clave` es estable (se persiste); `filaProc` es la fila de 'Proc datos brutos' donde se cargan las
// series y `filaPresentacion` la fila de 'Presentación' que muestra su resultado.

export const GRUPOS_VARIABLE = ['basicas', 'diametros', 'perimetros', 'pliegues'] as const;
export type GrupoVariable = (typeof GRUPOS_VARIABLE)[number];

export interface DefinicionVariable {
  clave: string;
  grupo: GrupoVariable;
  etiqueta: string;
  unidad: 'kg' | 'cm' | 'mm';
  filaProc: number;
  filaPresentacion: number;
}

export const VARIABLES = [
  // Básicas (3)
  { clave: 'peso', grupo: 'basicas', etiqueta: 'Peso bruto', unidad: 'kg', filaProc: 6, filaPresentacion: 10 },
  { clave: 'talla', grupo: 'basicas', etiqueta: 'Talla corporal', unidad: 'cm', filaProc: 7, filaPresentacion: 11 },
  { clave: 'talla_sentado', grupo: 'basicas', etiqueta: 'Talla sentado', unidad: 'cm', filaProc: 8, filaPresentacion: 12 },
  // Diámetros (6)
  { clave: 'diametro_biacromial', grupo: 'diametros', etiqueta: 'Biacromial', unidad: 'cm', filaProc: 10, filaPresentacion: 14 },
  { clave: 'diametro_torax_transverso', grupo: 'diametros', etiqueta: 'Tórax transverso', unidad: 'cm', filaProc: 11, filaPresentacion: 15 },
  { clave: 'diametro_torax_anteroposterior', grupo: 'diametros', etiqueta: 'Tórax anteroposterior', unidad: 'cm', filaProc: 12, filaPresentacion: 16 },
  { clave: 'diametro_biiliocrestideo', grupo: 'diametros', etiqueta: 'Bi-iliocrestídeo', unidad: 'cm', filaProc: 13, filaPresentacion: 17 },
  { clave: 'diametro_humeral', grupo: 'diametros', etiqueta: 'Humeral (biepicondilar)', unidad: 'cm', filaProc: 14, filaPresentacion: 18 },
  { clave: 'diametro_femoral', grupo: 'diametros', etiqueta: 'Femoral (biepicondilar)', unidad: 'cm', filaProc: 15, filaPresentacion: 19 },
  // Perímetros (10)
  { clave: 'perimetro_cabeza', grupo: 'perimetros', etiqueta: 'Cabeza', unidad: 'cm', filaProc: 17, filaPresentacion: 21 },
  { clave: 'perimetro_brazo_relajado', grupo: 'perimetros', etiqueta: 'Brazo relajado', unidad: 'cm', filaProc: 18, filaPresentacion: 22 },
  { clave: 'perimetro_brazo_flexionado', grupo: 'perimetros', etiqueta: 'Brazo flexionado en tensión', unidad: 'cm', filaProc: 19, filaPresentacion: 23 },
  { clave: 'perimetro_antebrazo', grupo: 'perimetros', etiqueta: 'Antebrazo (máximo)', unidad: 'cm', filaProc: 20, filaPresentacion: 24 },
  { clave: 'perimetro_torax_mesoesternal', grupo: 'perimetros', etiqueta: 'Tórax mesoesternal', unidad: 'cm', filaProc: 21, filaPresentacion: 25 },
  { clave: 'perimetro_cintura', grupo: 'perimetros', etiqueta: 'Cintura (mínima)', unidad: 'cm', filaProc: 22, filaPresentacion: 26 },
  { clave: 'perimetro_caderas', grupo: 'perimetros', etiqueta: 'Caderas (máxima)', unidad: 'cm', filaProc: 23, filaPresentacion: 27 },
  { clave: 'perimetro_muslo_superior', grupo: 'perimetros', etiqueta: 'Muslo (superior)', unidad: 'cm', filaProc: 24, filaPresentacion: 28 },
  { clave: 'perimetro_muslo_medial', grupo: 'perimetros', etiqueta: 'Muslo (medial)', unidad: 'cm', filaProc: 25, filaPresentacion: 29 },
  { clave: 'perimetro_pantorrilla', grupo: 'perimetros', etiqueta: 'Pantorrilla (máxima)', unidad: 'cm', filaProc: 26, filaPresentacion: 30 },
  // Pliegues cutáneos (6)
  { clave: 'pliegue_triceps', grupo: 'pliegues', etiqueta: 'Tríceps', unidad: 'mm', filaProc: 28, filaPresentacion: 32 },
  { clave: 'pliegue_subescapular', grupo: 'pliegues', etiqueta: 'Subescapular', unidad: 'mm', filaProc: 29, filaPresentacion: 33 },
  { clave: 'pliegue_supraespinal', grupo: 'pliegues', etiqueta: 'Supraespinal', unidad: 'mm', filaProc: 30, filaPresentacion: 34 },
  { clave: 'pliegue_abdominal', grupo: 'pliegues', etiqueta: 'Abdominal', unidad: 'mm', filaProc: 31, filaPresentacion: 35 },
  { clave: 'pliegue_muslo_medial', grupo: 'pliegues', etiqueta: 'Muslo medial', unidad: 'mm', filaProc: 32, filaPresentacion: 36 },
  { clave: 'pliegue_pantorrilla', grupo: 'pliegues', etiqueta: 'Pantorrilla', unidad: 'mm', filaProc: 33, filaPresentacion: 37 },
] as const satisfies readonly DefinicionVariable[];

export type ClaveVariable = (typeof VARIABLES)[number]['clave'];

export const CLAVES_VARIABLES: readonly ClaveVariable[] = VARIABLES.map((v) => v.clave);

/** Un valor por variable (típicamente la mediana de sus series). */
export type ValoresPorVariable = Record<ClaveVariable, number>;

/** Mediciones crudas por variable; `null`/`undefined` equivale a celda vacía en la planilla. */
export type SeriesPorVariable = Partial<Record<ClaveVariable, readonly (number | null | undefined)[]>>;

export function variablesDelGrupo(grupo: GrupoVariable): ClaveVariable[] {
  return VARIABLES.filter((v) => v.grupo === grupo).map((v) => v.clave);
}
