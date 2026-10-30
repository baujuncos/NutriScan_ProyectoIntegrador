import type { SeriesPorVariable } from '@/lib/antropometria/variables';

// Caso MASCULINO inventado, recalculado con las fórmulas reales de la planilla de F. Holway (hojas
// 'Proc datos brutos' y 'Presentación') evaluadas con HyperFormula, porque LibreOffice no está disponible.
// El mismo motor reprodujo antes, celda por celda, los valores guardados de la planilla de ejemplo
// (mujer), así que sirve como segunda corrida independiente. Entradas cargadas en la planilla:
//   Proc datos brutos!I2 = 1 (masculino), B3 = 2026-10-24, E3 = 2000-02-15, F1 = 'C' (moderada),
//   series en B:D de las filas 6–33 y masa ósea de referencia I39 = 7 (caso "con referencia") o
//   I39 = E78 (caso "sin referencia": se usa la calculada).
// Los valores están redondeados a 10 cifras significativas.

export const SERIES_HOMBRE: SeriesPorVariable = {
  peso: [84.4, 84.2, 84.3],
  talla: [178.2, 178.4],
  talla_sentado: [92.6, 92.8],
  diametro_biacromial: [40.2, 40],
  diametro_torax_transverso: [30.4, 30.6],
  diametro_torax_anteroposterior: [20.4, 20.2, 20.5],
  diametro_biiliocrestideo: [29, 29.2],
  diametro_humeral: [7, 7.1],
  diametro_femoral: [9.7, 9.9],
  perimetro_cabeza: [57, 57.2],
  perimetro_brazo_relajado: [33, 33.4],
  perimetro_brazo_flexionado: [35.6, 35.2, 35.4],
  perimetro_antebrazo: [28.2, 28.4],
  perimetro_torax_mesoesternal: [100.5, 101],
  perimetro_cintura: [84, 84.6],
  perimetro_caderas: [101, 100.6],
  perimetro_muslo_superior: [60.4, 60.8],
  perimetro_muslo_medial: [55, 55.4],
  perimetro_pantorrilla: [38.6, 38.4],
  pliegue_triceps: [10, 11, 10],
  pliegue_subescapular: [14, 15],
  pliegue_supraespinal: [11, 12],
  pliegue_abdominal: [20, 22, 21],
  pliegue_muslo_medial: [14, 15],
  pliegue_pantorrilla: [8, 9]
};

export const FECHAS_HOMBRE = { fechaNacimiento: '2000-02-15', fechaMedicion: '2026-10-24' } as const;

export const MASA_OSEA_REFERENCIA_HOMBRE = 7;

export const EXCEL_HOMBRE = {
  edadDecimal: 26.68856947,
  estadistica: {
    peso: { mediana: 84.3, desvio: 0.1, errorPct: 0.119 },
    talla: { mediana: 178.3, desvio: 0.141, errorPct: 0.079 },
    talla_sentado: { mediana: 92.7, desvio: 0.141, errorPct: 0.152 },
    diametro_biacromial: { mediana: 40.1, desvio: 0.141, errorPct: 0.352 },
    diametro_torax_transverso: { mediana: 30.5, desvio: 0.141, errorPct: 0.462 },
    diametro_torax_anteroposterior: { mediana: 20.4, desvio: 0.153, errorPct: 0.75 },
    diametro_biiliocrestideo: { mediana: 29.1, desvio: 0.141, errorPct: 0.485 },
    diametro_humeral: { mediana: 7.05, desvio: 0.071, errorPct: 1.007 },
    diametro_femoral: { mediana: 9.8, desvio: 0.141, errorPct: 1.439 },
    perimetro_cabeza: { mediana: 57.1, desvio: 0.141, errorPct: 0.247 },
    perimetro_brazo_relajado: { mediana: 33.2, desvio: 0.283, errorPct: 0.852 },
    perimetro_brazo_flexionado: { mediana: 35.4, desvio: 0.2, errorPct: 0.565 },
    perimetro_antebrazo: { mediana: 28.3, desvio: 0.141, errorPct: 0.498 },
    perimetro_torax_mesoesternal: { mediana: 100.75, desvio: 0.354, errorPct: 0.351 },
    perimetro_cintura: { mediana: 84.3, desvio: 0.424, errorPct: 0.503 },
    perimetro_caderas: { mediana: 100.8, desvio: 0.283, errorPct: 0.281 },
    perimetro_muslo_superior: { mediana: 60.6, desvio: 0.283, errorPct: 0.467 },
    perimetro_muslo_medial: { mediana: 55.2, desvio: 0.283, errorPct: 0.513 },
    perimetro_pantorrilla: { mediana: 38.5, desvio: 0.141, errorPct: 0.366 },
    pliegue_triceps: { mediana: 10, desvio: 0.577, errorPct: 5.77 },
    pliegue_subescapular: { mediana: 14.5, desvio: 0.707, errorPct: 4.876 },
    pliegue_supraespinal: { mediana: 11.5, desvio: 0.707, errorPct: 6.148 },
    pliegue_abdominal: { mediana: 21, desvio: 1, errorPct: 4.762 },
    pliegue_muslo_medial: { mediana: 14.5, desvio: 0.707, errorPct: 4.876 },
    pliegue_pantorrilla: { mediana: 8.5, desvio: 0.707, errorPct: 8.318 }
  },
  phantom: {
    peso: { ajustado: 73.29917778, z: 1.013857882 },
    talla_sentado: { ajustado: 88.47832866, z: -0.320371409 },
    diametro_biacromial: { ajustado: 38.27379697, z: 0.1217692559 },
    diametro_torax_transverso: { ajustado: 29.11099271, z: 0.6844785683 },
    diametro_torax_anteroposterior: { ajustado: 19.47095906, z: 1.428231201 },
    diametro_biiliocrestideo: { ajustado: 27.77475042, z: -0.6087140453 },
    diametro_humeral: { ajustado: 6.72893438, z: 0.7112410864 },
    diametro_femoral: { ajustado: 9.353696018, z: -0.3464666293 },
    perimetro_cabeza: { ajustado: 54.49959619, z: -1.041947093 },
    perimetro_brazo_relajado: { ajustado: 31.68803141, z: 2.059240948 },
    perimetro_brazo_flexionado: { ajustado: 33.78784072, z: 1.847190176 },
    perimetro_antebrazo: { ajustado: 27.0111834, z: 1.334172623 },
    perimetro_torax_mesoesternal: { ajustado: 96.16172182, z: 1.602648999 },
    perimetro_cintura: { ajustado: 80.46087493, z: 1.921544928 },
    perimetro_caderas: { ajustado: 96.20944476, z: 0.275886157 },
    perimetro_muslo_superior: { ajustado: 57.84020191, z: 0.4775891033 },
    perimetro_muslo_medial: { ajustado: 52.68612451, z: 0.4385964912 },
    perimetro_pantorrilla: { ajustado: 36.74666293, z: 0.650723012 },
    pliegue_triceps: { ajustado: 9.544587773, z: -1.309935621 },
    pliegue_subescapular: { ajustado: 13.83965227, z: -0.662790479 },
    pliegue_supraespinal: { ajustado: 10.97627594, z: -0.9896474408 },
    pliegue_abdominal: { ajustado: 20.04363432, z: -0.6884788786 },
    pliegue_muslo_medial: { ajustado: 13.83965227, z: -1.579873677 },
    pliegue_pantorrilla: { ajustado: 8.112899607, z: -1.688886594 }
  },
  kerrConReferencia7: {
    masas: {
      adiposa: 21.95317721,
      muscular: 41.31532326,
      residual: 9.752185126,
      osea: 7,
      piel: 4.239410929,
      suma: 84.26009652
    },
    sinAjustar: {
      adiposa: 21.69624245,
      muscular: 40.83177856,
      residual: 9.638047873,
      osea: 8.850421698,
      piel: 4.189793873
    }
  },
  kerrSinReferencia: {
    masas: {
      adiposa: 21.46547347,
      muscular: 40.39747719,
      residual: 9.535534156,
      osea: 8.756285455,
      piel: 4.14522973,
      suma: 84.3
    },
    oseaCalculada: 8.756285455
  },
  zKerr: {
    adiposa: -1.151287664,
    muscular: 2.037664856,
    residual: 2.17474157,
    osea: -0.1249890828
  },
  diferenciaPesoPct: 1.075070518,
  somatotipo: {
    endo: 3.521466832,
    meso: 5.61025,
    ecto: 1.197654874,
    hwr: 40.66448137,
    x: -2.323811958,
    y: 6.501378294
  },
  energia: {
    pesoIdeal: 73.119047,
    diferencia: 11.180953,
    ajuste: 2.79523825,
    pesoCalculo: 75.91428525,
    pesoUsadoMB: 75.91428525,
    mb: 1816.043435,
    rangoMin: 65.8071423,
    rangoMax: 80.4309517
  },
  indices: {
    icc: 0.8363095238,
    suma6Pliegues: 80,
    musculoOseo: 4.613540456,
    adiposoMuscular: 0.5313567818,
    imc: 26.51703051,
    tallaSentadoTalla: 0.5199102636,
    bsa: 2.028756511,
    bsaPorPeso: 240.6591353
  }
} as const;
