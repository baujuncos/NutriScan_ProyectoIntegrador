/**
 * NUT-246 — Instrumentos (texto libre, opcionales) y agrupación del error técnico por investigador.
 */
import { describe, expect, it } from 'vitest';
import { calcularErrorTecnico } from '@/lib/antropometria';
import {
  columnasInstrumentos,
  instrumentosDeFila,
  instrumentosSchema,
  INSTRUMENTOS,
  INSTRUMENTOS_VACIOS,
  lineasInstrumentos,
  MAX_INSTRUMENTO,
  normalizarInstrumento,
} from '@/lib/researcher/antropometria/instrumentos';
import { agruparErrorTecnico, resumenEtm } from '@/lib/researcher/antropometria/investigadores';

describe('instrumentos', () => {
  it('son 4, con las etiquetas del producto', () => {
    expect(INSTRUMENTOS.map((i) => i.etiqueta)).toEqual(['Balanza', 'Calibres y segmómetro', 'Plicómetro', 'Cinta antropométrica']);
    expect(MAX_INSTRUMENTO).toBe(120);
  });

  it('normalizarInstrumento recorta y trata el vacío como "sin informar"', () => {
    expect(normalizarInstrumento('  Tanita  ')).toBe('Tanita');
    expect(normalizarInstrumento('   ')).toBeNull();
    expect(normalizarInstrumento('')).toBeNull();
    expect(normalizarInstrumento(null)).toBeNull();
    expect(normalizarInstrumento(undefined)).toBeNull();
  });

  it('el esquema acepta todo vacío o ausente y devuelve null', () => {
    expect(instrumentosSchema.parse({})).toEqual({ balanza: null, calibres: null, plicometro: null, cinta: null });
    expect(instrumentosSchema.parse({ balanza: ' Seca ', cinta: null, calibres: '' })).toEqual({
      balanza: 'Seca',
      calibres: null,
      plicometro: null,
      cinta: null,
    });
  });

  it('el esquema rechaza más de 120 caracteres (después de recortar) y acepta exactamente 120', () => {
    expect(instrumentosSchema.safeParse({ balanza: 'x'.repeat(121) }).success).toBe(false);
    expect(instrumentosSchema.safeParse({ balanza: `  ${'x'.repeat(120)}  ` }).success).toBe(true);
  });

  it('columnasInstrumentos y instrumentosDeFila son inversas (null ↔ texto vacío)', () => {
    const columnas = columnasInstrumentos({ balanza: 'Tanita', calibres: null, plicometro: 'Harpenden', cinta: '' });
    expect(columnas).toEqual({
      instrumento_balanza: 'Tanita',
      instrumento_calibres: null,
      instrumento_plicometro: 'Harpenden',
      instrumento_cinta: null,
    });
    expect(instrumentosDeFila(columnas)).toEqual({ balanza: 'Tanita', calibres: '', plicometro: 'Harpenden', cinta: '' });
    expect(instrumentosDeFila(null)).toEqual(INSTRUMENTOS_VACIOS);
    expect(instrumentosDeFila({})).toEqual(INSTRUMENTOS_VACIOS);
  });

  it('lineasInstrumentos omite los vacíos y conserva el orden; si no hay ninguno devuelve []', () => {
    expect(lineasInstrumentos({ balanza: 'Tanita', calibres: '  ', plicometro: 'Harpenden', cinta: '' })).toEqual([
      { etiqueta: 'Balanza', valor: 'Tanita' },
      { etiqueta: 'Plicómetro', valor: 'Harpenden' },
    ]);
    expect(lineasInstrumentos(INSTRUMENTOS_VACIOS)).toEqual([]);
  });
});

describe('agruparErrorTecnico', () => {
  const fila = (medido_por: string | null, investigador_id: string, peso: number[]) => ({
    medido_por,
    investigador_id,
    series: { peso },
  });

  it('agrupa por quien midió y, si es null, por quien cargó la medición', () => {
    const r = agruparErrorTecnico([
      fila(null, 'lucia', [50, 52]), // la cargó y midió Lucía
      fila('lucia', 'martin', [60, 59]), // la cargó Martín pero midió Lucía
      fila('martin', 'lucia', [70, 70]), // la cargó Lucía pero midió Martín
    ]);

    expect(Object.keys(r).sort()).toEqual(['lucia', 'martin']);
    expect(r.lucia.mediciones).toBe(2);
    expect(r.lucia.variables.peso!.tem).toBeCloseTo(Math.sqrt(5 / 4), 10);
    expect(r.martin.mediciones).toBe(1);
    expect(r.martin.variables.peso!.tem).toBe(0);
  });

  it('sin filas → sin investigadores', () => {
    expect(agruparErrorTecnico([])).toEqual({});
  });

  it('el resultado es el mismo que calcular el ETM directo sobre las series de ese investigador', () => {
    const r = agruparErrorTecnico([fila('a', 'x', [10, 12]), fila('a', 'x', [20, 21, 22])]);
    expect(r.a).toEqual(calcularErrorTecnico([{ peso: [10, 12] }, { peso: [20, 21, 22] }]));
  });
});

describe('resumenEtm', () => {
  it('toma el resumen y la cantidad de mediciones; sin ETM devuelve null', () => {
    const etm = calcularErrorTecnico([{ pliegue_triceps: [10, 12], peso: [50, 52] }]);
    expect(resumenEtm(etm)).toEqual({ pliegues: etm.resumen.pliegues, otras: etm.resumen.otras, mediciones: 1 });
    expect(resumenEtm(undefined)).toBeNull();
  });
});
