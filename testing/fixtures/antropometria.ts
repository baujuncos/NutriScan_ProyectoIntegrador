import type { SeriesPorVariable } from '@/lib/antropometria/variables';

// Paciente FICTICIA: los valores numéricos son los de la planilla de ejemplo de F. Holway
// ('Proc datos brutos'!B6:C33) pero el nombre y las fechas son inventados (privacidad).
// Mujer, 24,55 años a la fecha de medición, voleibol.

export const SERIES_JULIETA: SeriesPorVariable = {
  peso: [53.1, 53.0],
  talla: [163.5, 163.5],
  talla_sentado: [85.5, 85.5],
  diametro_biacromial: [35.6, 35.9],
  diametro_torax_transverso: [25.3, 25.5],
  diametro_torax_anteroposterior: [14.5, 14.5],
  diametro_biiliocrestideo: [26.9, 26.5],
  diametro_humeral: [6.4, 6.3],
  diametro_femoral: [8.5, 8.4],
  perimetro_cabeza: [53.5, 53.7],
  perimetro_brazo_relajado: [25.5, 25.5],
  perimetro_brazo_flexionado: [26.2, 26.5],
  perimetro_antebrazo: [22.5, 22.6],
  perimetro_torax_mesoesternal: [78, 77],
  perimetro_cintura: [64, 64],
  perimetro_caderas: [97, 97.1],
  perimetro_muslo_superior: [56, 56],
  perimetro_muslo_medial: [48, 48],
  perimetro_pantorrilla: [34.5, 34.6],
  pliegue_triceps: [12, 13],
  pliegue_subescapular: [7, 7],
  pliegue_supraespinal: [7, 7],
  pliegue_abdominal: [12, 12],
  pliegue_muslo_medial: [23, 24],
  pliegue_pantorrilla: [16, 17],
};

/** Masa ósea de referencia cargada a mano en la planilla (Proc datos brutos!I39). */
export const MASA_OSEA_REFERENCIA_JULIETA = 6.196;

/** Edad decimal que muestra la planilla de ejemplo ('Proc datos brutos'!I3), usada para validar fórmulas puntuales. */
export const EDAD_PLANILLA_JULIETA = 24.54757016;
