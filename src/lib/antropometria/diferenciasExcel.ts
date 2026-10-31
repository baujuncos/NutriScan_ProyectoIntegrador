// Diferencias INTENCIONALES entre este módulo y la planilla de F. Holway. Todo lo demás replica la
// planilla celda por celda. Se exporta para que el informe y la documentación puedan citarlas.

export interface DiferenciaConExcel {
  id: string;
  celdas: string;
  planilla: string;
  modulo: string;
}

export const DIFERENCIAS_CON_EXCEL: readonly DiferenciaConExcel[] = [
  {
    id: 'z-perimetro-muslo-medial',
    celdas: 'Presentación!K29',
    planilla: '(E29-53.2)/4.56: usa el valor sin ajustar (error de la planilla, validado con nutrición).',
    modulo: '(F29-53.2)/4.56: usa el valor ajustado por talla, como las demás variables.',
  },
  {
    id: 'somatotipo-de-referencia-por-deporte',
    celdas: 'Presentación!G232:I232',
    planilla:
      'VLOOKUP aproximado sobre rangos truncados (depf = V14:Y35, depm = Z13:AC46): para varios deportes devuelve la fila de otro (Voleibol mujer → Natación Freestyle 200+400 m).',
    modulo: 'Búsqueda por id exacto sobre la tabla completa de cada sexo.',
  },
  {
    id: 'sin-redondeo-interno',
    celdas: 'Proc datos brutos!G6:I33',
    planilla: 'Mediana, desvío y % de error con ROUND(…, 3).',
    modulo: 'Sin redondeo; el redondeo es de presentación.',
  },
  {
    id: 'porcentaje-de-masas',
    celdas: 'Presentación!D59:D63',
    planilla:
      'Fracciones de las masas antes de re-ajustar la masa ósea de referencia (no siempre coinciden con los kg mostrados).',
    modulo: 'kg finales / peso medido × 100, coherente con los kg informados.',
  },
];
