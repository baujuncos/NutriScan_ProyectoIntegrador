import { describe, it, expect } from 'vitest';
import {
  calcularAntropometria,
  calcularEdad,
  compararMediciones,
  DIFERENCIAS_CON_EXCEL,
  ErrorAntropometria,
  CLAVES_VARIABLES,
  variablesFaltantes,
  type ClavePhantom,
  type EntradaAntropometria,
  type NombreMasa,
} from '@/lib/antropometria';
import { ENTRADA_JULIETA, SERIES_JULIETA } from '../fixtures/antropometria';
import {
  EXCEL_HOMBRE,
  FECHAS_HOMBRE,
  MASA_OSEA_REFERENCIA_HOMBRE,
  SERIES_HOMBRE,
} from '../fixtures/antropometriaExcelHombre';

const NOMBRES: NombreMasa[] = ['adiposa', 'muscular', 'residual', 'osea', 'piel'];

function codigoDelError(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ErrorAntropometria ? e.codigo : `otro:${String(e)}`;
  }
  return undefined;
}

describe('calcularAntropometria — integración con la paciente de ejemplo (mujer, voleibol)', () => {
  const r = calcularAntropometria(ENTRADA_JULIETA);

  it('edad 24,55 años (24 cumplidos)', () => {
    expect(r.edad.decimal).toBeCloseTo(24.55, 2);
    expect(r.edad.anios).toBe(24);
  });

  it('estadística: peso 53,05; talla 163,5; talla sentado 85,5', () => {
    expect(r.estadistica.peso.mediana).toBeCloseTo(53.05, 2);
    expect(r.estadistica.talla.mediana).toBe(163.5);
    expect(r.estadistica.talla_sentado.mediana).toBe(85.5);
  });

  it('Phantom: Z esperados (con el muslo medial corregido)', () => {
    const esperados: Partial<Record<ClavePhantom, number>> = {
      talla_sentado: -0.21,
      diametro_biacromial: -0.43,
      perimetro_cabeza: -0.15,
      perimetro_antebrazo: -1.18,
      pliegue_triceps: -0.53,
      pliegue_subescapular: -1.96,
      pliegue_supraespinal: -1.82,
      pliegue_abdominal: -1.66,
      perimetro_muslo_medial: -0.71,
    };
    for (const [clave, z] of Object.entries(esperados)) {
      expect(r.phantom[clave as ClavePhantom].z, clave).toBeCloseTo(z, 2);
    }
  });

  it('Kerr: masas, Z y control de calidad', () => {
    const kg = { adiposa: 17.64, muscular: 21.26, residual: 4.66, osea: 6.196, piel: 3.29 };
    const z = { adiposa: -1.0, muscular: -0.13, residual: -0.57, osea: -0.58 };
    for (const n of NOMBRES) expect(r.masas.masas[n].kg, n).toBeCloseTo(kg[n], 2);
    for (const n of ['adiposa', 'muscular', 'residual', 'osea'] as const) {
      expect(r.masas.masas[n].z, n).toBeCloseTo(z[n], 2);
    }
    expect(r.masas.total.kg).toBeCloseTo(53.05, 2);
    expect(r.calidad.diferenciaPesoPorcentaje).toBeCloseTo(-0.63, 2);
    expect(r.masas.masaOsea.origen).toBe('referencia');
  });

  it('somatotipo 2,8 – 3,6 – 3,3 con somatocarta X 0,476 / Y 1,18', () => {
    expect(r.somatotipo.endomorfia).toBeCloseTo(2.796, 3);
    expect(r.somatotipo.mesomorfia).toBeCloseTo(3.624, 3);
    expect(r.somatotipo.ectomorfia).toBeCloseTo(3.272, 3);
    expect(r.somatotipo.x).toBeCloseTo(0.476, 3);
    expect(r.somatotipo.y).toBeCloseTo(1.18, 2);
  });

  it('comparación con deporte: Voleibol mujer 3,0 – 3,5 – 3,5 (ver hallazgo del VLOOKUP en somatotipo.test)', () => {
    expect(r.comparacionDeporte).toMatchObject({ nombre: 'Voleibol', endomorfia: 3, mesomorfia: 3.5, ectomorfia: 3.5 });
    expect(r.comparacionDeporte?.x).toBeCloseTo(0.5, 10);
    expect(r.comparacionDeporte?.y).toBeCloseTo(0.5, 10);
  });

  it('energía: peso ideal, ajuste del 25 % y metabolismo basal', () => {
    expect(r.energia.pesoIdeal).toBeCloseTo(57.474, 3);
    expect(r.energia.rangoPesoIdeal.minimo).toBeCloseTo(51.727, 3);
    expect(r.energia.rangoPesoIdeal.maximo).toBeCloseTo(63.222, 3);
    expect(r.energia.diferenciaConIdeal).toBeCloseTo(-4.424, 3);
    expect(r.energia.ajusteSobrepeso).toBeCloseTo(-1.106, 3);
    expect(r.energia.pesoParaCalculo).toBeCloseTo(56.368, 3);
    // La planilla da 1326,86 con su edad (24,5476); con las fechas ficticias de la fixture la edad es
    // 24,5530 y el MB 1326,83: de ahí la tolerancia de 0,05 en vez de 0,01.
    expect(r.energia.metabolismoBasal).toBeCloseTo(1326.86, 1);
    expect(Math.abs(r.energia.metabolismoBasal - 1326.86)).toBeLessThan(0.05);
    expect(r.energia.gastoEnergeticoTotal).toBeCloseTo(r.energia.metabolismoBasal * 1.6, 8);
  });

  it('índices', () => {
    expect(r.indices.imc).toBeCloseTo(19.845, 3);
    expect(r.indices.icc).toBeCloseTo(0.659, 3);
    expect(r.indices.indiceMusculoOseo).toBeCloseTo(3.43, 2);
    expect(r.indices.indiceAdiposoMuscular).toBeCloseTo(0.83, 2);
    expect(r.indices.tallaSentadoTalla).toBeCloseTo(0.523, 3);
    expect(r.indices.superficieCorporal).toBeCloseTo(1.565, 3);
    expect(r.indices.superficieCorporalPorPeso).toBeCloseTo(294.97, 2);
    expect(r.indices.sumaSeisPliegues).toBeCloseTo(78.5, 2);
  });
});

describe('calcularAntropometria — caso masculino cruzado con la planilla recalculada', () => {
  const entrada: EntradaAntropometria = {
    sexo: 'M',
    ...FECHAS_HOMBRE,
    series: SERIES_HOMBRE,
    nivelActividad: 'moderada',
    masaOseaReferencia: MASA_OSEA_REFERENCIA_HOMBRE,
  };
  const r = calcularAntropometria(entrada);

  it('edad decimal igual a Proc datos brutos!I3', () => {
    expect(r.edad.decimal).toBeCloseTo(EXCEL_HOMBRE.edadDecimal, 6);
    expect(r.edad.anios).toBe(26);
  });

  it('mediana, desvío y % de error de las 25 variables (la planilla redondea a 3 decimales)', () => {
    for (const clave of CLAVES_VARIABLES) {
      const x = EXCEL_HOMBRE.estadistica[clave];
      expect(r.estadistica[clave].mediana, `${clave} mediana`).toBeCloseTo(x.mediana, 2);
      expect(r.estadistica[clave].desvioEstandar, `${clave} DE`).toBeCloseTo(x.desvio, 3);
      expect(r.estadistica[clave].errorPorcentual, `${clave} error`).toBeCloseTo(x.errorPct, 2);
    }
  });

  it('valores ajustados y Z Phantom de las 24 variables con Z (Presentación!F y K)', () => {
    for (const clave of Object.keys(r.phantom) as ClavePhantom[]) {
      const x = EXCEL_HOMBRE.phantom[clave];
      expect(r.phantom[clave].ajustado, `${clave} ajustado`).toBeCloseTo(x.ajustado, 6);
      // El Z del perímetro de muslo medial difiere a propósito de la planilla (K29 usa el valor sin ajustar).
      if (clave !== 'perimetro_muslo_medial') expect(r.phantom[clave].z, `${clave} Z`).toBeCloseTo(x.z, 6);
    }
    expect(r.phantom.perimetro_muslo_medial.z).toBeCloseTo((52.686124509 - 53.2) / 4.56, 6);
  });

  it('masas de Kerr con la masa ósea de referencia (Proc datos brutos!I50:I55)', () => {
    const x = EXCEL_HOMBRE.kerrConReferencia7.masas;
    for (const n of NOMBRES) expect(r.masas.masas[n].kg, n).toBeCloseTo(x[n], 6);
    expect(r.calidad.diferenciaPesoPorcentaje).toBeCloseTo(EXCEL_HOMBRE.diferenciaPesoPct, 6);
  });

  it('somatotipo, energía e índices', () => {
    expect(r.somatotipo.endomorfia).toBeCloseTo(EXCEL_HOMBRE.somatotipo.endo, 6);
    expect(r.somatotipo.ectomorfia).toBeCloseTo(EXCEL_HOMBRE.somatotipo.ecto, 6);
    expect(r.somatotipo.y).toBeCloseTo(EXCEL_HOMBRE.somatotipo.y, 6);
    expect(r.energia.metabolismoBasal).toBeCloseTo(EXCEL_HOMBRE.energia.mb, 4);
    expect(r.energia.gastoEnergeticoTotal).toBeCloseTo(EXCEL_HOMBRE.energia.mb * 1.7, 4);
    expect(r.indices.superficieCorporal).toBeCloseTo(EXCEL_HOMBRE.indices.bsa, 6);
    expect(r.indices.riesgoIcc.nivel).toBe('moderado'); // ICC 0,836 hombre 20-29 → 0,83–0,88
  });

  it('sin deporte no hay comparación', () => {
    expect(r.comparacionDeporte).toBeNull();
  });
});

describe('2 vs 3 series', () => {
  it('con 3 series la mediana es la central y el desvío usa las 3', () => {
    const r = calcularAntropometria({
      ...ENTRADA_JULIETA,
      series: { ...SERIES_JULIETA, pliegue_triceps: [12, 13, 20] },
    });
    expect(r.estadistica.pliegue_triceps.mediana).toBe(13);
    expect(r.estadistica.pliegue_triceps.valores).toHaveLength(3);
    expect(r.estadistica.pliegue_triceps.desvioEstandar).toBeCloseTo(4.3589, 4);
  });

  it('una variable con series idénticas tiene desvío 0 y el resto del cálculo sigue igual', () => {
    const r = calcularAntropometria(ENTRADA_JULIETA);
    expect(r.estadistica.talla.desvioEstandar).toBe(0);
    expect(r.estadistica.talla.errorPorcentual).toBe(0);
  });
});

describe('validaciones', () => {
  it('una variable faltante rechaza el cálculo y el error dice cuál', () => {
    const { pliegue_abdominal: _x, ...series } = SERIES_JULIETA;
    expect(variablesFaltantes(series)).toEqual(['pliegue_abdominal']);
    try {
      calcularAntropometria({ ...ENTRADA_JULIETA, series });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorAntropometria);
      expect((e as ErrorAntropometria).codigo).toBe('VARIABLES_FALTANTES');
      expect((e as ErrorAntropometria).detalle?.faltantes).toEqual(['pliegue_abdominal']);
    }
  });

  it('menor de 18 años → MENOR_DE_EDAD con mensaje claro', () => {
    const entrada = { ...ENTRADA_JULIETA, fechaNacimiento: '2010-01-15' };
    expect(codigoDelError(() => calcularAntropometria(entrada))).toBe('MENOR_DE_EDAD');
    expect(() => calcularAntropometria(entrada)).toThrowError(/mayores de 18/);
  });

  it('el día que cumple 18 ya se acepta; el día anterior no', () => {
    expect(calcularEdad('2008-10-24', '2026-10-24').anios).toBe(18);
    expect(codigoDelError(() => calcularEdad('2008-10-25', '2026-10-24'))).toBe('MENOR_DE_EDAD');
  });

  it('fechas inválidas o nacimiento posterior a la medición → FECHA_INVALIDA', () => {
    expect(codigoDelError(() => calcularEdad('05/04/2002', '2026-10-24'))).toBe('FECHA_INVALIDA');
    expect(codigoDelError(() => calcularEdad('2002-04-05', '2026-13-40'))).toBe('FECHA_INVALIDA');
    expect(codigoDelError(() => calcularEdad('2030-01-01', '2026-10-24'))).toBe('FECHA_INVALIDA');
  });

  it('sexo, nivel de actividad y deporte inválidos', () => {
    expect(codigoDelError(() => calcularAntropometria({ ...ENTRADA_JULIETA, sexo: 'X' as 'M' }))).toBe('SEXO_INVALIDO');
    expect(
      codigoDelError(() => calcularAntropometria({ ...ENTRADA_JULIETA, nivelActividad: 'mucha' as 'liviana' })),
    ).toBe('NIVEL_ACTIVIDAD_INVALIDO');
    expect(codigoDelError(() => calcularAntropometria({ ...ENTRADA_JULIETA, deporte: 'curling' }))).toBe(
      'DEPORTE_INVALIDO',
    );
  });
});

describe('masa ósea de referencia: presente vs. ausente', () => {
  const sinReferencia = calcularAntropometria({ ...ENTRADA_JULIETA, masaOseaReferencia: null });

  it('ausente (≥ 21 años): se calcula y se devuelve para que quien llama la guarde', () => {
    expect(sinReferencia.masas.masaOsea).toMatchObject({ origen: 'calculada', guardarComoReferencia: true });
    expect(sinReferencia.masas.masaOsea.usadaKg).toBeCloseTo(6.1963, 3);
  });

  it('presente: se usa tal cual, aunque cambien las mediciones', () => {
    const conReferencia = calcularAntropometria({
      ...ENTRADA_JULIETA,
      series: { ...SERIES_JULIETA, diametro_femoral: [9.1, 9.3] },
      masaOseaReferencia: 6.196,
    });
    expect(conReferencia.masas.masas.osea.kg).toBe(6.196);
    expect(conReferencia.masas.masaOsea.calculadaKg).not.toBeCloseTo(6.196, 1);
  });

  it('con 20 años se calcula siempre, aunque venga una referencia', () => {
    const r = calcularAntropometria({ ...ENTRADA_JULIETA, fechaNacimiento: '2006-05-01', masaOseaReferencia: 9 });
    expect(r.edad.anios).toBe(20);
    expect(r.masas.masaOsea.origen).toBe('calculada');
  });
});

describe('pureza y sin redondeo interno', () => {
  it('no modifica la entrada y devuelve lo mismo en cada llamada', () => {
    const copia = structuredClone(ENTRADA_JULIETA);
    const a = calcularAntropometria(ENTRADA_JULIETA);
    expect(ENTRADA_JULIETA).toEqual(copia);
    expect(calcularAntropometria(ENTRADA_JULIETA)).toEqual(a);
  });

  it('no redondea: los resultados conservan decimales completos', () => {
    const r = calcularAntropometria(ENTRADA_JULIETA);
    const decimales = (n: number) => (String(n).split('.')[1] ?? '').length;
    expect(decimales(r.somatotipo.endomorfia)).toBeGreaterThan(6);
    expect(decimales(r.energia.pesoIdeal)).toBeGreaterThan(6);
    expect(decimales(r.estadistica.peso.desvioEstandar)).toBeGreaterThan(6);
  });

  it('el módulo documenta sus diferencias con la planilla', () => {
    expect(DIFERENCIAS_CON_EXCEL.map((d) => d.id)).toContain('z-perimetro-muslo-medial');
    for (const d of DIFERENCIAS_CON_EXCEL) expect(d.celdas).toMatch(/!/);
  });
});

describe('compararMediciones', () => {
  const anterior = calcularAntropometria({
    ...ENTRADA_JULIETA,
    fechaMedicion: '2026-09-24',
    series: { ...SERIES_JULIETA, peso: [54.1, 54.3], pliegue_triceps: [14, 15], perimetro_brazo_flexionado: [26.0, 26.2] },
  });
  const actual = calcularAntropometria(ENTRADA_JULIETA);
  const d = compararMediciones(actual, anterior);

  it('peso y masas: actual − anterior', () => {
    expect(d.peso).toBeCloseTo(53.05 - 54.2, 6);
    for (const n of NOMBRES) {
      expect(d.masas[n]).toBeCloseTo(actual.masas.masas[n].kg - anterior.masas.masas[n].kg, 10);
    }
    expect(d.masas.total).toBeCloseTo(53.05 - 54.2, 2);
  });

  it('somatotipo y coordenadas: actual − anterior', () => {
    expect(d.somatotipo.endomorfia).toBeCloseTo(actual.somatotipo.endomorfia - anterior.somatotipo.endomorfia, 10);
    expect(d.somatotipo.x).toBeCloseTo(actual.somatotipo.x - anterior.somatotipo.x, 10);
    expect(d.somatotipo.endomorfia).toBeLessThan(0); // menos pliegue tríceps → menos endomorfia
  });

  it('diferencias por variable (Presentación!J10:J37)', () => {
    expect(d.variables.pliegue_triceps).toBeCloseTo(12.5 - 14.5, 6);
    expect(d.variables.talla).toBe(0);
  });

  it('comparar una medición consigo misma da todo 0', () => {
    const cero = compararMediciones(actual, actual);
    expect(cero.peso).toBe(0);
    expect(Object.values(cero.masas).every((v) => v === 0)).toBe(true);
    expect(Object.values(cero.somatotipo).every((v) => v === 0)).toBe(true);
  });
});
