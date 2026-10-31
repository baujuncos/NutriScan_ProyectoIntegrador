import { describe, it, expect } from 'vitest';
import { calcularKerr, NOMBRES_MASA } from '@/lib/antropometria/kerr';
import { calcularEstadisticas, medianasDe } from '@/lib/antropometria/series';
import { ErrorAntropometria } from '@/lib/antropometria/errores';
import { MASA_OSEA_REFERENCIA_JULIETA, SERIES_JULIETA } from '../fixtures/antropometria';
import { EXCEL_HOMBRE, MASA_OSEA_REFERENCIA_HOMBRE, SERIES_HOMBRE } from '../fixtures/antropometriaExcelHombre';

const medianasMujer = medianasDe(calcularEstadisticas(SERIES_JULIETA));
const medianasHombre = medianasDe(calcularEstadisticas(SERIES_HOMBRE));

describe('Kerr — paciente de ejemplo (mujer, 24 años, masa ósea de referencia 6,196)', () => {
  const r = calcularKerr(medianasMujer, 'F', 24, MASA_OSEA_REFERENCIA_JULIETA);

  it.each([
    ['adiposa', 17.64, -1.0],
    ['muscular', 21.26, -0.13],
    ['residual', 4.66, -0.57],
    ['osea', 6.196, -0.58],
  ] as const)('masa %s: %f kg y Z %f', (masa, kg, z) => {
    expect(r.masas[masa].kg).toBeCloseTo(kg, 2);
    expect(r.masas[masa].z).toBeCloseTo(z, 2);
  });

  it('la masa ósea es exactamente la de referencia', () => {
    expect(r.masas.osea.kg).toBe(6.196);
  });

  it('piel 3,29 kg y sin Z (la planilla no lo calcula)', () => {
    expect(r.masas.piel.kg).toBeCloseTo(3.29, 2);
    expect(r.masas.piel.z).toBeNull();
  });

  it('las 5 masas suman el peso medido (53,05 kg) y los porcentajes 100 %', () => {
    const suma = NOMBRES_MASA.reduce((acc, n) => acc + r.masas[n].kg, 0);
    expect(suma).toBeCloseTo(53.05, 2);
    expect(r.total.kg).toBeCloseTo(53.05, 2);
    expect(NOMBRES_MASA.reduce((acc, n) => acc + r.masas[n].porcentaje, 0)).toBeCloseTo(100, 2);
    expect(r.total.z).toBeCloseTo(-0.5533, 3); // Presentación!G64
  });

  it('control de calidad: diferencia de −0,63 % entre peso estructurado y peso medido', () => {
    expect(r.diferenciaPesoPorcentaje).toBeCloseTo(-0.63, 2);
    expect(r.pesoEstructurado).toBeCloseTo(52.7159, 3); // Proc datos brutos!B80
  });

  it('masas sin ajustar y calculada de la ósea coinciden con las celdas B de la planilla', () => {
    expect(r.sinAjustar.adiposa).toBeCloseTo(17.5274, 3); // B52
    expect(r.sinAjustar.muscular).toBeCloseTo(21.1225, 3); // B62
    expect(r.sinAjustar.residual).toBeCloseTo(4.6353, 3); // B68
    expect(r.sinAjustar.osea).toBeCloseTo(6.1573, 3); // B78
    expect(r.sinAjustar.piel).toBeCloseTo(3.2734, 3); // B47
    expect(r.masaOsea.calculadaKg).toBeCloseTo(6.1963, 3); // E78
  });

  it('índice por masa = kg / talla² (Proc datos brutos!H58)', () => {
    expect(r.masas.adiposa.indice).toBeCloseTo(6.5982, 3);
  });

  it('con una referencia ≈ calculada, % y kg son los de Presentación!D59:E63', () => {
    expect(r.masas.adiposa.porcentaje).toBeCloseTo(33.2488, 2);
    expect(r.masas.muscular.porcentaje).toBeCloseTo(40.0686, 2);
  });
});

describe('masa ósea: se calcula hasta los 21 años y desde ahí se reutiliza la de referencia', () => {
  it('≥ 21 años con referencia: se usa la referencia y se re-ajustan las otras 4 masas', () => {
    const r = calcularKerr(medianasMujer, 'F', 21, 6.5);
    expect(r.masaOsea).toMatchObject({ usadaKg: 6.5, origen: 'referencia', guardarComoReferencia: false });
    expect(r.masas.osea.kg).toBe(6.5);
    // Más ósea → menos masa en las otras 4 (el peso total se conserva).
    const base = calcularKerr(medianasMujer, 'F', 21, 6.196);
    expect(r.masas.adiposa.kg).toBeLessThan(base.masas.adiposa.kg);
    expect(r.total.kg).toBeCloseTo(53.05, 1);
  });

  it('primera medición ≥ 21 años (sin referencia): se calcula y se devuelve para guardarla', () => {
    const r = calcularKerr(medianasMujer, 'F', 30);
    expect(r.masaOsea.origen).toBe('calculada');
    expect(r.masaOsea.guardarComoReferencia).toBe(true);
    expect(r.masaOsea.usadaKg).toBeCloseTo(6.1963, 3);
    expect(r.masas.osea.kg).toBe(r.masaOsea.usadaKg);
  });

  it('< 21 años: siempre se calcula, aunque llegue una referencia, y no se guarda', () => {
    const r = calcularKerr(medianasMujer, 'F', 19, 9);
    expect(r.masaOsea).toMatchObject({ origen: 'calculada', guardarComoReferencia: false });
    expect(r.masas.osea.kg).toBeCloseTo(6.1963, 3);
  });

  it('rechaza una referencia no positiva, no finita o mayor al peso', () => {
    for (const ref of [0, -1, NaN, 60]) {
      expect(() => calcularKerr(medianasMujer, 'F', 25, ref)).toThrowError(ErrorAntropometria);
    }
  });
});

describe('Kerr — caso masculino cruzado con la planilla recalculada', () => {
  const x = EXCEL_HOMBRE.kerrConReferencia7;
  const conRef = calcularKerr(medianasHombre, 'M', 26, MASA_OSEA_REFERENCIA_HOMBRE);
  const sinRef = calcularKerr(medianasHombre, 'M', 26);

  it('masas sin ajustar (Proc datos brutos!B47, B52, B62, B68, B78)', () => {
    for (const n of NOMBRES_MASA) expect(conRef.sinAjustar[n]).toBeCloseTo(x.sinAjustar[n], 6);
  });

  it('Z de adiposa, muscular, residual y ósea (B51, B61, B67, B75)', () => {
    for (const n of ['adiposa', 'muscular', 'residual', 'osea'] as const) {
      expect(conRef.masas[n].z).toBeCloseTo(EXCEL_HOMBRE.zKerr[n], 6);
    }
  });

  it('con masa ósea de referencia 7 kg: masas re-ajustadas idénticas a Proc datos brutos!I50:I55', () => {
    for (const n of NOMBRES_MASA) expect(conRef.masas[n].kg).toBeCloseTo(x.masas[n], 6);
    expect(conRef.total.kg).toBeCloseTo(x.masas.suma, 6);
    expect(conRef.diferenciaPesoPorcentaje).toBeCloseTo(EXCEL_HOMBRE.diferenciaPesoPct, 6);
  });

  it('sin referencia: usa la ósea calculada y coincide con la planilla (I39 = E78)', () => {
    expect(sinRef.masaOsea.usadaKg).toBeCloseTo(EXCEL_HOMBRE.kerrSinReferencia.oseaCalculada, 6);
    for (const n of NOMBRES_MASA) expect(sinRef.masas[n].kg).toBeCloseTo(EXCEL_HOMBRE.kerrSinReferencia.masas[n], 6);
    expect(sinRef.total.kg).toBeCloseTo(84.3, 6);
  });

  it('el sexo cambia grosor de piel y constante de superficie', () => {
    const comoMujer = calcularKerr(medianasHombre, 'F', 26);
    expect(comoMujer.masas.piel.kg).not.toBeCloseTo(sinRef.masas.piel.kg, 2);
  });
});
