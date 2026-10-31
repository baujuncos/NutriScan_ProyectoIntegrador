// Somatotipo de referencia (Heath-Carter) por deporte y sexo, para la comparación con el deporte.
// Origen: hoja 'Proc datos brutos', bloque "Deportes para la somatocarta" (V10:AC64):
//   mujeres  → columnas V (deporte), W (endo), X (meso), Y (ecto), filas 13–51
//   hombres  → columnas Z (deporte), AA (endo), AB (meso), AC (ecto), filas 13–64
// Los nombres se copiaron tal cual figuran en la planilla (solo se limpiaron espacios sobrantes y la coma
// final); el `id` es un slug estable derivado del nombre. La fila "Ninguno" (0 – 0 – 0) no se incluye:
// "ninguno" significa "sin comparación" (ver DEPORTE_NINGUNO).
//
// OJO: la planilla busca estos valores con VLOOKUP aproximado sobre rangos con nombre truncados
// (depf = V14:Y35, depm = Z13:AC46), así que para varios deportes (p. ej. Voleibol) muestra los valores de
// OTRO deporte. Este módulo busca por id exacto sobre la tabla completa.

export interface DeporteReferencia {
  id: string;
  nombre: string;
  endomorfia: number;
  mesomorfia: number;
  ectomorfia: number;
  celdas: string;
}

/** Valor de `deporte` que significa "sin comparación" (planilla: "Ninguno"). */
export const DEPORTE_NINGUNO = 'ninguno';

export const DEPORTES_FEMENINO: readonly DeporteReferencia[] = [
  { id: 'atletismo_fondo', nombre: 'ATLETISMO Fondo', endomorfia: 2.1, mesomorfia: 3.2, ectomorfia: 3.5, celdas: 'Proc datos brutos!V13:Y13' },
  { id: 'atletismo_maraton', nombre: 'ATLETISMO Maratón', endomorfia: 2, mesomorfia: 3.3, ectomorfia: 3.9, celdas: 'Proc datos brutos!V14:Y14' },
  { id: 'atletismo_medio_fondo', nombre: 'ATLETISMO Medio Fondo', endomorfia: 2.6, mesomorfia: 3.1, ectomorfia: 3.5, celdas: 'Proc datos brutos!V15:Y15' },
  { id: 'atletismo_pruebas_combinadas', nombre: 'ATLETISMO Pruebas Combinadas', endomorfia: 2.5, mesomorfia: 3.5, ectomorfia: 3.5, celdas: 'Proc datos brutos!V16:Y16' },
  { id: 'atletismo_salto_altura', nombre: 'ATLETISMO Salto Altura', endomorfia: 2.3, mesomorfia: 2.2, ectomorfia: 4.6, celdas: 'Proc datos brutos!V17:Y17' },
  { id: 'atletismo_salto_longitud_y_triple_salto', nombre: 'ATLETISMO Salto Longitud y Triple Salto', endomorfia: 2.3, mesomorfia: 3.8, ectomorfia: 3.1, celdas: 'Proc datos brutos!V18:Y18' },
  { id: 'atletismo_velocidad', nombre: 'ATLETISMO Velocidad', endomorfia: 2.4, mesomorfia: 3.3, ectomorfia: 3.3, celdas: 'Proc datos brutos!V19:Y19' },
  { id: 'baloncesto', nombre: 'Baloncesto', endomorfia: 3.7, mesomorfia: 4, ectomorfia: 2.9, celdas: 'Proc datos brutos!V20:Y20' },
  { id: 'baminton', nombre: 'Baminton', endomorfia: 4.1, mesomorfia: 4.4, ectomorfia: 2.5, celdas: 'Proc datos brutos!V21:Y21' },
  { id: 'cricket', nombre: 'Cricket', endomorfia: 4.9, mesomorfia: 4.4, ectomorfia: 2, celdas: 'Proc datos brutos!V22:Y22' },
  { id: 'esgrima', nombre: 'ESGRIMA', endomorfia: 3, mesomorfia: 3.4, ectomorfia: 3.5, celdas: 'Proc datos brutos!V23:Y23' },
  { id: 'futbol', nombre: 'Fútbol', endomorfia: 4.2, mesomorfia: 4.6, ectomorfia: 2.2, celdas: 'Proc datos brutos!V24:Y24' },
  { id: 'gimnasia_artistica', nombre: 'GIMNASIA ARTÍSTICA', endomorfia: 1.9, mesomorfia: 4.6, ectomorfia: 2.9, celdas: 'Proc datos brutos!V25:Y25' },
  { id: 'gimnasia_ritmica', nombre: 'GIMNASIA RÍTMICA', endomorfia: 1.9, mesomorfia: 2.4, ectomorfia: 5, celdas: 'Proc datos brutos!V26:Y26' },
  { id: 'hockey', nombre: 'Hockey', endomorfia: 3.7, mesomorfia: 4.5, ectomorfia: 2.2, celdas: 'Proc datos brutos!V27:Y27' },
  { id: 'judo_66_72_kg', nombre: 'JUDO < 66-72 Kg.', endomorfia: 3.3, mesomorfia: 4.4, ectomorfia: 2.3, celdas: 'Proc datos brutos!V28:Y28' },
  { id: 'judo_48_52_kg', nombre: 'JUDO < 48-52 Kg.', endomorfia: 3.5, mesomorfia: 5, ectomorfia: 1.9, celdas: 'Proc datos brutos!V29:Y29' },
  { id: 'judo_56_61_kg', nombre: 'JUDO < 56-61 Kg.', endomorfia: 3.8, mesomorfia: 5.2, ectomorfia: 1.6, celdas: 'Proc datos brutos!V30:Y30' },
  { id: 'lacrosse', nombre: 'Lacrosse', endomorfia: 4.1, mesomorfia: 4.5, ectomorfia: 2.4, celdas: 'Proc datos brutos!V31:Y31' },
  { id: 'natacion', nombre: 'NATACIÓN', endomorfia: 3.5, mesomorfia: 3.8, ectomorfia: 3, celdas: 'Proc datos brutos!V32:Y32' },
  { id: 'natacion_espalda_200_m', nombre: 'NATACIÓN Espalda 200 m', endomorfia: 2.5, mesomorfia: 3.7, ectomorfia: 3.1, celdas: 'Proc datos brutos!V33:Y33' },
  { id: 'natacion_espalda_50_100_m', nombre: 'NATACIÓN Espalda 50+100 m', endomorfia: 2.6, mesomorfia: 3.5, ectomorfia: 3.6, celdas: 'Proc datos brutos!V34:Y34' },
  { id: 'natacion_freestyle_200_400_m', nombre: 'NATACIÓN Freestyle 200+400 m', endomorfia: 2.9, mesomorfia: 3.7, ectomorfia: 3.2, celdas: 'Proc datos brutos!V35:Y35' },
  { id: 'natacion_freestyle_50_100_m', nombre: 'NATACIÓN Freestyle 50+100 m', endomorfia: 2.8, mesomorfia: 3.7, ectomorfia: 3.2, celdas: 'Proc datos brutos!V36:Y36' },
  { id: 'natacion_freestyle_800_m', nombre: 'NATACIÓN Freestyle 800 m', endomorfia: 2.4, mesomorfia: 3.8, ectomorfia: 3, celdas: 'Proc datos brutos!V37:Y37' },
  { id: 'natacion_mariposa_200_m', nombre: 'NATACIÓN Mariposa 200 m', endomorfia: 3, mesomorfia: 4.2, ectomorfia: 2.8, celdas: 'Proc datos brutos!V38:Y38' },
  { id: 'natacion_mariposa_50_100_m', nombre: 'NATACIÓN Mariposa 50+100 m', endomorfia: 2.8, mesomorfia: 3.9, ectomorfia: 3.1, celdas: 'Proc datos brutos!V39:Y39' },
  { id: 'natacion_medley_200_400_m', nombre: 'NATACIÓN Medley 200+400 m', endomorfia: 2.9, mesomorfia: 3.7, ectomorfia: 3, celdas: 'Proc datos brutos!V40:Y40' },
  { id: 'natacion_pecho_200_m', nombre: 'NATACIÓN Pecho 200 m', endomorfia: 2.9, mesomorfia: 4.3, ectomorfia: 2.8, celdas: 'Proc datos brutos!V41:Y41' },
  { id: 'natacion_pecho_50_100_m', nombre: 'NATACIÓN Pecho 50+100 m', endomorfia: 2.6, mesomorfia: 3.9, ectomorfia: 3.3, celdas: 'Proc datos brutos!V42:Y42' },
  { id: 'natacionlarga_distancia', nombre: 'NATACIÓNLarga distancia', endomorfia: 4.4, mesomorfia: 4.7, ectomorfia: 1.7, celdas: 'Proc datos brutos!V43:Y43' },
  { id: 'netball', nombre: 'Netball', endomorfia: 3, mesomorfia: 3.8, ectomorfia: 3.3, celdas: 'Proc datos brutos!V44:Y44' },
  { id: 'piraguismo', nombre: 'PIRAGÜISMO', endomorfia: 2.7, mesomorfia: 5.2, ectomorfia: 2, celdas: 'Proc datos brutos!V46:Y46' },
  { id: 'softbol', nombre: 'Softbol', endomorfia: 3.8, mesomorfia: 4.3, ectomorfia: 2.7, celdas: 'Proc datos brutos!V47:Y47' },
  { id: 'squash', nombre: 'Squash', endomorfia: 3.4, mesomorfia: 4, ectomorfia: 2.8, celdas: 'Proc datos brutos!V48:Y48' },
  { id: 'tiro_olimpico', nombre: 'TIRO OLÍMPICO', endomorfia: 4.9, mesomorfia: 4.3, ectomorfia: 2.4, celdas: 'Proc datos brutos!V49:Y49' },
  { id: 'triatlon', nombre: 'TRIATLÓN', endomorfia: 2.6, mesomorfia: 3.8, ectomorfia: 3, celdas: 'Proc datos brutos!V50:Y50' },
  { id: 'voleibol', nombre: 'Voleibol', endomorfia: 3, mesomorfia: 3.5, ectomorfia: 3.5, celdas: 'Proc datos brutos!V51:Y51' },
];

export const DEPORTES_MASCULINO: readonly DeporteReferencia[] = [
  { id: 'atletismo_fondo_10_000_m', nombre: 'ATLETISMO Fondo 10.000 m', endomorfia: 1.8, mesomorfia: 4.3, ectomorfia: 3.4, celdas: 'Proc datos brutos!Z13:AC13' },
  { id: 'atletismo_fondo_3_000_m_obstaculos', nombre: 'ATLETISMO Fondo 3.000 m. Obstáculos', endomorfia: 1.6, mesomorfia: 4.5, ectomorfia: 3.4, celdas: 'Proc datos brutos!Z14:AC14' },
  { id: 'atletismo_fondo_5_000_m', nombre: 'ATLETISMO Fondo 5.000 m.', endomorfia: 1.5, mesomorfia: 4.1, ectomorfia: 3.7, celdas: 'Proc datos brutos!Z15:AC15' },
  { id: 'atletismo_lanzamiento_martillo', nombre: 'ATLETISMO Lanzamiento Martillo', endomorfia: 4.4, mesomorfia: 7.2, ectomorfia: 0.5, celdas: 'Proc datos brutos!Z16:AC16' },
  { id: 'atletismo_maraton', nombre: 'ATLETISMO Maratón', endomorfia: 1.7, mesomorfia: 4.2, ectomorfia: 3.6, celdas: 'Proc datos brutos!Z17:AC17' },
  { id: 'atletismo_medio_fondo_1_500_m', nombre: 'ATLETISMO Medio Fondo 1.500 m.', endomorfia: 1.6, mesomorfia: 3.7, ectomorfia: 3.7, celdas: 'Proc datos brutos!Z18:AC18' },
  { id: 'atletismo_medio_fondo_800_m', nombre: 'ATLETISMO Medio Fondo 800 m.', endomorfia: 1.8, mesomorfia: 4.1, ectomorfia: 3.6, celdas: 'Proc datos brutos!Z19:AC19' },
  { id: 'atletismo_pruebas_combinadas', nombre: 'ATLETISMO Pruebas Combinadas', endomorfia: 2.1, mesomorfia: 5.3, ectomorfia: 2.4, celdas: 'Proc datos brutos!Z20:AC20' },
  { id: 'atletismo_salto_altura', nombre: 'ATLETISMO Salto Altura', endomorfia: 1.6, mesomorfia: 3.7, ectomorfia: 4.2, celdas: 'Proc datos brutos!Z21:AC21' },
  { id: 'atletismo_salto_de_pertiga', nombre: 'ATLETISMO Salto de Pértiga', endomorfia: 1.7, mesomorfia: 4.8, ectomorfia: 3, celdas: 'Proc datos brutos!Z22:AC22' },
  { id: 'atletismo_salto_longitud_y_triple_salto', nombre: 'ATLETISMO Salto Longitud y Triple Salto', endomorfia: 1.7, mesomorfia: 4.3, ectomorfia: 3.5, celdas: 'Proc datos brutos!Z23:AC23' },
  { id: 'atletismo_velocidad_400_m', nombre: 'ATLETISMO Velocidad: 400 m.', endomorfia: 1.7, mesomorfia: 4.5, ectomorfia: 3.2, celdas: 'Proc datos brutos!Z24:AC24' },
  { id: 'atletismo_velocidad_60_200_m', nombre: 'ATLETISMO Velocidad: 60 - 200 m.', endomorfia: 1.8, mesomorfia: 5.2, ectomorfia: 2.7, celdas: 'Proc datos brutos!Z25:AC25' },
  { id: 'baloncesto_ala_pivot_pivot', nombre: 'BALONCESTO Ala-pivot / Pivot', endomorfia: 2.8, mesomorfia: 3.9, ectomorfia: 3.7, celdas: 'Proc datos brutos!Z26:AC26' },
  { id: 'baloncesto_alero', nombre: 'BALONCESTO Alero', endomorfia: 2.2, mesomorfia: 4.7, ectomorfia: 3.3, celdas: 'Proc datos brutos!Z27:AC27' },
  { id: 'baloncesto_base', nombre: 'BALONCESTO Base', endomorfia: 2.4, mesomorfia: 5, ectomorfia: 3, celdas: 'Proc datos brutos!Z28:AC28' },
  { id: 'baloncesto_escolta', nombre: 'BALONCESTO Escolta', endomorfia: 2.1, mesomorfia: 4.4, ectomorfia: 3.5, celdas: 'Proc datos brutos!Z29:AC29' },
  { id: 'ciclismo', nombre: 'CICLISMO', endomorfia: 1.9, mesomorfia: 4.7, ectomorfia: 2.9, celdas: 'Proc datos brutos!Z30:AC30' },
  { id: 'futbol_australiano', nombre: 'Futbol australiano', endomorfia: 2.1, mesomorfia: 5.7, ectomorfia: 2.5, celdas: 'Proc datos brutos!Z31:AC31' },
  { id: 'futbol_defensa', nombre: 'FÚTBOL Defensa', endomorfia: 2.2, mesomorfia: 5.2, ectomorfia: 2.5, celdas: 'Proc datos brutos!Z32:AC32' },
  { id: 'futbol_delantero', nombre: 'FÚTBOL Delantero', endomorfia: 2.1, mesomorfia: 4.9, ectomorfia: 2.7, celdas: 'Proc datos brutos!Z33:AC33' },
  { id: 'futbol_medio', nombre: 'FÚTBOL Medio', endomorfia: 2.5, mesomorfia: 5, ectomorfia: 2.5, celdas: 'Proc datos brutos!Z34:AC34' },
  { id: 'futbol_portero', nombre: 'FÚTBOL Portero', endomorfia: 2.5, mesomorfia: 5.2, ectomorfia: 2.4, celdas: 'Proc datos brutos!Z35:AC35' },
  { id: 'gimnasia_deportiva', nombre: 'Gimnasia deportiva', endomorfia: 1.9, mesomorfia: 6.1, ectomorfia: 2.5, celdas: 'Proc datos brutos!Z36:AC36' },
  { id: 'hockey_sobre_cesped', nombre: 'Hockey sobre césped', endomorfia: 2.4, mesomorfia: 5.4, ectomorfia: 2.6, celdas: 'Proc datos brutos!Z37:AC37' },
  { id: 'judo_60_65_kg', nombre: 'JUDO 60-65 Kg.', endomorfia: 2.1, mesomorfia: 5.9, ectomorfia: 1.9, celdas: 'Proc datos brutos!Z38:AC38' },
  { id: 'judo_71_78_kg', nombre: 'JUDO 71-78 Kg.', endomorfia: 2.3, mesomorfia: 6.7, ectomorfia: 1.6, celdas: 'Proc datos brutos!Z39:AC39' },
  { id: 'judo_86_95_kg', nombre: 'JUDO 86-95 Kg.', endomorfia: 2.5, mesomorfia: 6.3, ectomorfia: 1.9, celdas: 'Proc datos brutos!Z40:AC40' },
  { id: 'levantamiento_de_potencia', nombre: 'Levantamiento de potencia', endomorfia: 2.7, mesomorfia: 7.9, ectomorfia: 0.6, celdas: 'Proc datos brutos!Z41:AC41' },
  { id: 'lucha_greco_romana', nombre: 'Lucha greco romana', endomorfia: 2, mesomorfia: 6.5, ectomorfia: 1.5, celdas: 'Proc datos brutos!Z42:AC42' },
  { id: 'lucha_libre', nombre: 'Lucha libre', endomorfia: 1.8, mesomorfia: 6.8, ectomorfia: 1.4, celdas: 'Proc datos brutos!Z43:AC43' },
  { id: 'natacion', nombre: 'NATACIÓN', endomorfia: 2.3, mesomorfia: 4.9, ectomorfia: 3, celdas: 'Proc datos brutos!Z44:AC44' },
  { id: 'natacion_espalda_200_m', nombre: 'NATACIÓN Espalda 200 m', endomorfia: 1.9, mesomorfia: 4.3, ectomorfia: 3.5, celdas: 'Proc datos brutos!Z45:AC45' },
  { id: 'natacion_espalda_50_100_m', nombre: 'NATACIÓN Espalda 50+100 m', endomorfia: 1.8, mesomorfia: 5.2, ectomorfia: 3.1, celdas: 'Proc datos brutos!Z46:AC46' },
  { id: 'natacion_larga_distancia', nombre: 'NATACIÓN larga distancia', endomorfia: 2.5, mesomorfia: 5.3, ectomorfia: 2.3, celdas: 'Proc datos brutos!Z47:AC47' },
  { id: 'natacion_libre_1500_m', nombre: 'NATACIÓN Libre 1500 m', endomorfia: 1.5, mesomorfia: 4.8, ectomorfia: 3.4, celdas: 'Proc datos brutos!Z48:AC48' },
  { id: 'natacion_libre_200_400_m', nombre: 'NATACIÓN Libre 200+400 m', endomorfia: 1.9, mesomorfia: 4.7, ectomorfia: 3.1, celdas: 'Proc datos brutos!Z49:AC49' },
  { id: 'natacion_libre_50_100_m', nombre: 'NATACIÓN Libre 50+100 m', endomorfia: 1.7, mesomorfia: 4.9, ectomorfia: 3.2, celdas: 'Proc datos brutos!Z50:AC50' },
  { id: 'natacion_mariposa_200_m', nombre: 'NATACIÓN Mariposa 200 m', endomorfia: 2, mesomorfia: 5.2, ectomorfia: 2.5, celdas: 'Proc datos brutos!Z51:AC51' },
  { id: 'natacion_mariposa_50_100_m', nombre: 'NATACIÓN Mariposa 50+100 m', endomorfia: 2.1, mesomorfia: 5.5, ectomorfia: 2.5, celdas: 'Proc datos brutos!Z52:AC52' },
  { id: 'natacion_pecho_200_m', nombre: 'NATACIÓN Pecho 200 m', endomorfia: 2.1, mesomorfia: 5.7, ectomorfia: 2.6, celdas: 'Proc datos brutos!Z53:AC53' },
  { id: 'natacionpecho_50_100_m', nombre: 'NATACIÓNPecho 50+100 m', endomorfia: 1.8, mesomorfia: 5.1, ectomorfia: 2.9, celdas: 'Proc datos brutos!Z54:AC54' },
  { id: 'piraguismo', nombre: 'PIRAGÜISMO', endomorfia: 2.2, mesomorfia: 6.1, ectomorfia: 2, celdas: 'Proc datos brutos!Z56:AC56' },
  { id: 'remo', nombre: 'REMO', endomorfia: 1.9, mesomorfia: 5.4, ectomorfia: 2.5, celdas: 'Proc datos brutos!Z57:AC57' },
  { id: 'remo_categoria_abierto', nombre: 'Remo categoría abierto', endomorfia: 2, mesomorfia: 5.2, ectomorfia: 3, celdas: 'Proc datos brutos!Z58:AC58' },
  { id: 'rugby_super_12_backs', nombre: 'Rugby Super 12 backs', endomorfia: 2.7, mesomorfia: 7.1, ectomorfia: 1.2, celdas: 'Proc datos brutos!Z59:AC59' },
  { id: 'rugby_super_12_front_forwards', nombre: 'Rugby Super 12 front forwards', endomorfia: 4.2, mesomorfia: 9.4, ectomorfia: 0.3, celdas: 'Proc datos brutos!Z60:AC60' },
  { id: 'rugby_super_12_remaining_forwards', nombre: 'Rugby Super 12 remaining forwards', endomorfia: 3.9, mesomorfia: 8.5, ectomorfia: 1, celdas: 'Proc datos brutos!Z61:AC61' },
  { id: 'squash', nombre: 'Squash', endomorfia: 2.5, mesomorfia: 5.2, ectomorfia: 2.8, celdas: 'Proc datos brutos!Z62:AC62' },
  { id: 'tiro_olimpico', nombre: 'TIRO OLÍMPICO', endomorfia: 4.9, mesomorfia: 5.8, ectomorfia: 1.6, celdas: 'Proc datos brutos!Z63:AC63' },
  { id: 'voleibol', nombre: 'VOLEIBOL', endomorfia: 2, mesomorfia: 3.8, ectomorfia: 3.7, celdas: 'Proc datos brutos!Z64:AC64' },
];
