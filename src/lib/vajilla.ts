/**
 * NUT-157 — Tipo de vajilla como referencia de escala para el reconocimiento
 * visual por IA (épica NUT-12).
 *
 * Lógica pura y sin dependencias: el usuario elige un tipo de vajilla y, para
 * los platos, confirma el diámetro en cm. Ese metadato viaja junto con la foto
 * hacia el módulo de reconocimiento para calibrar la escala y estimar el peso.
 * "Otro" no tiene guía calibrada, así que saltea la calibración por foto.
 */

export const VAJILLA_TIPOS = ['plato_playo', 'plato_postre', 'plato_hondo', 'otro'] as const;

export type VajillaTipo = (typeof VAJILLA_TIPOS)[number];

export interface VajillaInfo {
  tipo: VajillaTipo;
  label: string;
  descripcion: string;
  /** Diámetro precargado por defecto (cm). `null` sólo para "Otro". */
  diametroDefaultCm: number | null;
  /** Mínimo aceptado para vajilla real de ese tipo (cm). `null` para "Otro". */
  diametroMinCm: number | null;
  /** Máximo aceptado para vajilla real de ese tipo (cm). `null` para "Otro". */
  diametroMaxCm: number | null;
  /** Escala relativa del diámetro para la silueta guía (plato playo = 1). */
  siluetaDiametroRelativo: number;
  /** Profundidad relativa para el perfil lateral de la silueta (plato playo = 1). */
  siluetaProfundidadRelativa: number;
}

export const VAJILLA_INFO: Record<VajillaTipo, VajillaInfo> = {
  plato_playo: {
    tipo: 'plato_playo',
    label: 'Plato playo',
    descripcion: 'El plato grande de todos los días (principales).',
    diametroDefaultCm: 26,
    diametroMinCm: 22,
    diametroMaxCm: 32,
    siluetaDiametroRelativo: 1,
    siluetaProfundidadRelativa: 1,
  },
  plato_postre: {
    tipo: 'plato_postre',
    label: 'Plato de postre',
    descripcion: 'El plato chico, para postres o porciones pequeñas.',
    diametroDefaultCm: 20,
    diametroMinCm: 16,
    diametroMaxCm: 24,
    siluetaDiametroRelativo: 0.76,
    siluetaProfundidadRelativa: 0.9,
  },
  plato_hondo: {
    tipo: 'plato_hondo',
    label: 'Plato hondo',
    descripcion: 'El bowl para sopas, guisos, cereales o ensaladas.',
    diametroDefaultCm: 22,
    diametroMinCm: 18,
    diametroMaxCm: 28,
    siluetaDiametroRelativo: 0.85,
    siluetaProfundidadRelativa: 2.1,
  },
  otro: {
    tipo: 'otro',
    label: 'Otro',
    descripcion: 'Otro recipiente o sin plato: sin guía de escala calibrada.',
    diametroDefaultCm: null,
    diametroMinCm: null,
    diametroMaxCm: null,
    siluetaDiametroRelativo: 0.9,
    siluetaProfundidadRelativa: 1,
  },
};

export function getVajillaInfo(tipo: VajillaTipo): VajillaInfo {
  return VAJILLA_INFO[tipo];
}

export function getDiametroDefault(tipo: VajillaTipo): number | null {
  return VAJILLA_INFO[tipo].diametroDefaultCm;
}

/** El paso de diámetro (NUT-159) aplica a todos los tipos menos "Otro". */
export function requiereDiametro(tipo: VajillaTipo): boolean {
  return tipo !== 'otro';
}

/** "Otro" no continúa con el flujo de foto calibrada (NUT-160). */
export function usaCalibracionPorFoto(tipo: VajillaTipo): boolean {
  return tipo !== 'otro';
}

export interface ValidacionDiametro {
  valido: boolean;
  error?: string;
}

const MSG_NO_NUMERICO = 'Ingresá un número válido';
const MSG_NO_POSITIVO = 'El diámetro debe ser mayor a 0';

/**
 * Valida el diámetro ingresado por el usuario contra el rango real del tipo de
 * vajilla. Rechaza valores no numéricos, negativos, cero y fuera de rango.
 */
export function validarDiametro(tipo: VajillaTipo, valorCm: number | string): ValidacionDiametro {
  if (tipo === 'otro') return { valido: true };

  const raw = typeof valorCm === 'string' ? valorCm.trim() : valorCm;
  if (raw === '' || raw === null || raw === undefined) {
    return { valido: false, error: MSG_NO_NUMERICO };
  }

  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return { valido: false, error: MSG_NO_NUMERICO };
  if (n <= 0) return { valido: false, error: MSG_NO_POSITIVO };

  const { diametroMinCm, diametroMaxCm } = VAJILLA_INFO[tipo];
  if (diametroMinCm !== null && diametroMaxCm !== null && (n < diametroMinCm || n > diametroMaxCm)) {
    return {
      valido: false,
      error: `El diámetro debe estar entre ${diametroMinCm} y ${diametroMaxCm} cm`,
    };
  }

  return { valido: true };
}

export interface VajillaMetadata {
  tipo: VajillaTipo;
  /** Diámetro confirmado en cm; `null` para "Otro". */
  diametroCm: number | null;
  /** Si el reconocimiento visual puede usar la vajilla como referencia de escala. */
  calibracionPorFoto: boolean;
}

/**
 * Arma el metadato de vajilla que acompaña a la foto hacia el módulo de
 * reconocimiento visual. Para "Otro" descarta el diámetro.
 */
export function construirMetadataVajilla(
  tipo: VajillaTipo,
  diametroCm: number | null,
): VajillaMetadata {
  return {
    tipo,
    diametroCm: tipo === 'otro' ? null : diametroCm,
    calibracionPorFoto: usaCalibracionPorFoto(tipo),
  };
}
