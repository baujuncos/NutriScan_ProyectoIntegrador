/**
 * Modelo de la pantalla de Evolución (NUT-244) con la paciente ficticia "Julieta": eje de meses,
 * series, tarjetas de resumen, trayectoria del somatotipo y comparador A/B.
 */
import { describe, expect, it } from 'vitest';
import { calcularAntropometria, compararMediciones } from '@/lib/antropometria';
import {
  AVISO_RECALCULO,
  compararAB,
  construirEvolucion,
  ejeMeses,
  escalaEjeY,
  etiquetaMedicion,
  medicionesParaEvolucion,
  numerarMediciones,
  posicionEnEje,
  resolverSeleccion,
  type MedicionEvolucion,
} from '@/lib/researcher/antropometria/evolucion';
import { ENTRADA_JULIETA, SERIES_JULIETA } from '../fixtures/antropometria';

function medicion(id: string, fecha: string, series: Record<string, number[]> = {}, deporte: string | null = 'voleibol'): MedicionEvolucion {
  return {
    id,
    fecha,
    resultado: calcularAntropometria({ ...ENTRADA_JULIETA, fechaMedicion: fecha, deporte, series: { ...SERIES_JULIETA, ...series } }),
  };
}

const M1 = medicion('m1', '2026-10-24');
const M2 = medicion('m2', '2027-01-10', { peso: [51.5, 51.5], pliegue_triceps: [10, 10] });
const M3 = medicion('m3', '2027-03-02', { peso: [52.2, 52.2], pliegue_triceps: [11, 11], perimetro_brazo_flexionado: [28, 28] });

describe('ejeMeses', () => {
  it('con una sola medición: 12 meses desde su mes, con el año en el primero', () => {
    const eje = ejeMeses(['2026-05-15']);
    expect(eje.meses).toHaveLength(12);
    expect(eje.meses.slice(0, 3).map((m) => m.etiqueta)).toEqual(['may', 'jun', 'jul']);
    expect(eje.meses[11]).toMatchObject({ etiqueta: 'abr', anio: 2027 });
    expect(eje.meses[0]).toMatchObject({ anio: 2026, mostrarAnio: true });
  });

  it('el año se muestra de nuevo cada vez que cambia (en enero)', () => {
    const eje = ejeMeses(['2026-05-15']);
    expect(eje.meses.filter((m) => m.mostrarAnio).map((m) => `${m.etiqueta} ${m.anio}`)).toEqual(['may 2026', 'ene 2027']);
  });

  it('con 6 meses de diferencia sigue siendo de 12 meses', () => {
    expect(ejeMeses(['2026-05-15', '2026-11-02']).meses).toHaveLength(12);
  });

  it('con exactamente 12 meses de span (la última en el mes 12) no se alarga', () => {
    const eje = ejeMeses(['2026-10-24', '2027-09-30']);
    expect(eje.meses).toHaveLength(12);
    expect(eje.meses[11]).toMatchObject({ etiqueta: 'sep', anio: 2027 });
  });

  it('si la última cae después del mes 12, el eje se alarga hasta incluirla', () => {
    const eje = ejeMeses(['2026-10-24', '2027-10-01']);
    expect(eje.meses).toHaveLength(13);
    expect(eje.meses[12]).toMatchObject({ etiqueta: 'oct', anio: 2027 });
    expect(ejeMeses(['2026-01-05', '2028-06-30']).meses).toHaveLength(30);
  });

  it('no depende del orden de las fechas y sin fechas queda vacío', () => {
    expect(ejeMeses(['2027-03-01', '2026-10-24']).inicio).toEqual({ anio: 2026, mes: 10 });
    expect(ejeMeses([])).toEqual({ meses: [], inicio: null });
  });
});

describe('posicionEnEje', () => {
  const eje = ejeMeses(['2026-10-24']);

  it('cae dentro de la banda de su mes según el día, sin tocar los bordes', () => {
    const inicio = posicionEnEje(eje, '2026-10-01');
    const fin = posicionEnEje(eje, '2026-10-31');
    expect(inicio).toBeGreaterThan(0);
    expect(fin).toBeLessThan(1);
    expect(inicio).toBeLessThan(posicionEnEje(eje, '2026-10-24'));
    expect(posicionEnEje(eje, '2026-10-24')).toBeLessThan(fin);
  });

  it('un mes después suma una banda entera; el cambio de año no rompe la cuenta', () => {
    expect(posicionEnEje(eje, '2026-10-24')).toBeCloseTo(23.5 / 31, 10);
    expect(posicionEnEje(eje, '2026-11-24')).toBeCloseTo(1 + 23.5 / 30, 10);
    expect(Math.floor(posicionEnEje(eje, '2027-01-10'))).toBe(3);
    expect(Math.floor(posicionEnEje(eje, '2027-09-30'))).toBe(11);
  });

  it('febrero de un año bisiesto tiene 29 días', () => {
    const e = ejeMeses(['2028-02-01']);
    expect(posicionEnEje(e, '2028-02-29')).toBeCloseTo((29 - 0.5) / 29, 6);
  });
});

describe('escalaEjeY', () => {
  it('ticks redondos que contienen todos los valores', () => {
    const e = escalaEjeY([51.5, 53.1, 52.2]);
    expect(e.minimo).toBeLessThanOrEqual(51.5);
    expect(e.maximo).toBeGreaterThanOrEqual(53.1);
    expect(e.ticks[0]).toBe(e.minimo);
    expect(e.ticks.at(-1)).toBe(e.maximo);
    expect(e.ticks.length).toBeGreaterThanOrEqual(3);
  });

  it('con un solo valor (o todos iguales) arma un rango alrededor y no divide por cero', () => {
    const e = escalaEjeY([53.1]);
    expect(e.maximo).toBeGreaterThan(e.minimo);
    expect(e.minimo).toBeLessThan(53.1);
    expect(e.maximo).toBeGreaterThan(53.1);
  });

  it('rotula con decimales cuando el paso es menor que 1', () => {
    expect(escalaEjeY([10.1, 10.6]).decimales).toBeGreaterThan(0);
    expect(escalaEjeY([0, 100]).decimales).toBe(0);
  });
});

describe('numerarMediciones', () => {
  it('ordena por fecha y numera desde 1; a igual fecha respeta el orden de entrada', () => {
    const otra = medicion('m1b', '2026-10-24');
    const n = numerarMediciones([M3, M2, M1, otra]);
    expect(n.map((m) => [m.nro, m.id])).toEqual([
      [1, 'm1'],
      [2, 'm1b'],
      [3, 'm2'],
      [4, 'm3'],
    ]);
    // M1 y "otra" tienen la misma fecha: el orden relativo es el de entrada (M1 antes que otra).
  });

  it('etiqueta "Nº k · dd/mm/aaaa"', () => {
    expect(etiquetaMedicion({ nro: 2, fecha: '2027-01-10' })).toBe('Nº 2 · 10/01/2027');
  });
});

describe('medicionesParaEvolucion', () => {
  const paciente = { fechaNacimiento: '2002-04-05', sexo: 'F' as const, masaOseaReferencia: 6.196 };
  const fila = (id: string, estado: 'vigente' | 'borrador' | 'anulada', fecha = '2026-10-24') => ({
    id,
    fecha_medicion: fecha,
    series: SERIES_JULIETA,
    nivel_actividad: 'moderada' as const,
    deporte: 'voleibol',
    estado,
  });

  it('solo cuentan las vigentes: borradores y anuladas quedan afuera', () => {
    const r = medicionesParaEvolucion(paciente, [fila('v1', 'vigente'), fila('b1', 'borrador', '2026-11-01'), fila('a1', 'anulada', '2026-12-01'), fila('v2', 'vigente', '2027-01-10')]);
    expect(r.mediciones.map((m) => m.id)).toEqual(['v1', 'v2']);
    expect(r.sinCalcular).toBe(0);
  });

  it('una vigente que el motor no puede calcular se cuenta aparte en vez de romper', () => {
    const r = medicionesParaEvolucion({ ...paciente, sexo: null }, [fila('v1', 'vigente')]);
    expect(r.mediciones).toEqual([]);
    expect(r.sinCalcular).toBe(1);
  });
});

describe('construirEvolucion', () => {
  const ev = construirEvolucion([M3, M1, M2]);

  it('ordena por fecha, comparte un único eje y posiciona cada punto por su fecha', () => {
    expect(ev.mediciones.map((m) => m.nro)).toEqual([1, 2, 3]);
    expect(ev.eje.meses).toHaveLength(12);
    const xs = ev.peso.puntos.map((p) => p.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(Math.floor(xs[1])).toBe(3); // enero de 2027 es el 4.º mes del eje que arranca en octubre
  });

  it('series: peso, Σ6 pliegues y las cinco masas de Kerr', () => {
    expect(ev.peso.puntos.map((p) => p.valor)).toEqual([M1, M2, M3].map((m) => m.resultado.estadistica.peso.mediana));
    expect(ev.peso.puntos[0].valor).toBeCloseTo(53.05, 6);
    expect(ev.suma6.puntos[1].valor).toBe(M2.resultado.indices.sumaSeisPliegues);
    expect(ev.masas.map((s) => s.clave)).toEqual(['adiposa', 'muscular', 'osea', 'residual', 'piel']);
    expect(ev.masas[0].puntos[0].valor).toBeCloseTo(17.64, 2);
    expect(ev.masas[1].puntos[0].valor).toBeCloseTo(21.26, 2);
    expect(ev.masas.every((s) => s.puntos.length === 3 && s.unidad === 'kg')).toBe(true);
  });

  it('tarjetas: último valor y diferencia contra la medición Nº 1, con signo explícito y es-AR', () => {
    expect(ev.kpis.map((k) => k.clave)).toEqual(['peso', 'suma6', 'adiposa', 'muscular']);
    const peso = ev.kpis[0];
    expect(peso.valorTexto).toBe('52,2');
    expect(peso.diferencia).toBeCloseTo(52.2 - 53.05, 6);
    expect(peso.diferenciaTexto).toBe('−0,85 kg desde la medición Nº 1');
    const suma6 = ev.kpis[1];
    expect(suma6.diferencia).toBeLessThan(0);
    expect(suma6.diferenciaTexto).toMatch(/^−\d+,\d{2} mm desde la medición Nº 1$/);
    const muscular = ev.kpis[3];
    expect(muscular.diferencia).toBeLessThan(0);
    expect(muscular.diferenciaTexto).toMatch(/^−0,18 kg desde la medición Nº 1$/);
  });

  it('una suba lleva "+" explícito', () => {
    const sube = construirEvolucion([M1, medicion('m6', '2027-02-01', { peso: [56, 56] })]);
    expect(sube.kpis[0].diferencia).toBeCloseTo(56 - 53.05, 6);
    expect(sube.kpis[0].diferenciaTexto).toBe('+2,95 kg desde la medición Nº 1');
  });

  it('una diferencia nula no lleva signo', () => {
    const igual = construirEvolucion([M1, medicion('m1b', '2026-11-24')]);
    expect(igual.kpis[0].diferenciaTexto).toBe('0,00 kg desde la medición Nº 1');
  });

  it('con una sola medición no hay diferencia: "Primera medición"', () => {
    const uno = construirEvolucion([M1]);
    expect(uno.kpis.every((k) => k.diferencia === null && k.diferenciaTexto === 'Primera medición')).toBe(true);
    expect(uno.peso.puntos).toHaveLength(1);
    expect(uno.eje.meses).toHaveLength(12);
  });

  it('sin mediciones no arma nada', () => {
    const vacio = construirEvolucion([]);
    expect(vacio.kpis).toEqual([]);
    expect(vacio.eje.meses).toEqual([]);
    expect(vacio.trayectoria).toEqual({ puntos: [], referencia: null });
  });

  it('trayectoria del somatotipo: puntos en orden con Nº y fecha, y el deporte de la última medición', () => {
    const t = ev.trayectoria;
    expect(t.puntos.map((p) => p.nro)).toEqual([1, 2, 3]);
    expect(t.puntos[0].etiqueta).toBe('Nº 1 · 24/10/2026');
    expect(t.puntos[0].x).toBeCloseTo(M1.resultado.somatotipo.x, 10);
    expect(t.puntos[2].y).toBeCloseTo(M3.resultado.somatotipo.y, 10);
    expect(t.referencia).toEqual({
      nombre: M3.resultado.comparacionDeporte!.nombre,
      x: M3.resultado.comparacionDeporte!.x,
      y: M3.resultado.comparacionDeporte!.y,
    });
  });

  it('sin deporte en la última medición no hay referencia', () => {
    const sinDeporte = construirEvolucion([M1, medicion('m5', '2027-02-01', {}, null)]);
    expect(sinDeporte.trayectoria.referencia).toBeNull();
  });
});

describe('resolverSeleccion', () => {
  const mediciones = numerarMediciones([M1, M2, M3]);

  it('por defecto A = la primera y B = la última', () => {
    expect(resolverSeleccion(mediciones)).toEqual({ idA: 'm1', idB: 'm3' });
  });

  it('respeta ids válidos y descarta los desconocidos', () => {
    expect(resolverSeleccion(mediciones, 'm2', 'm3')).toEqual({ idA: 'm2', idB: 'm3' });
    expect(resolverSeleccion(mediciones, 'nada', 'm2')).toEqual({ idA: 'm1', idB: 'm2' });
  });

  it('sin mediciones no hay selección', () => {
    expect(resolverSeleccion([])).toBeNull();
  });
});

describe('compararAB', () => {
  const mediciones = numerarMediciones([M1, M2, M3]);
  const filas = (c: NonNullable<ReturnType<typeof compararAB>>) => c.grupos.flatMap((g) => g.filas);

  it('agrupa como el asistente y cubre peso, talla, IMC, Σ6, las 5 masas, somatotipo y las 25 variables', () => {
    const c = compararAB(mediciones, 'm1', 'm3')!;
    expect(c.grupos.map((g) => g.id)).toEqual(['basicas', 'indices', 'masas', 'somatotipo', 'diametros', 'perimetros', 'pliegues']);
    expect(c.grupos.map((g) => g.titulo).slice(0, 2)).toEqual(['Datos básicos', 'Índices']);
    const claves = filas(c).map((f) => f.clave);
    expect(claves).toEqual(expect.arrayContaining(['peso', 'talla', 'imc', 'suma6', 'masa_adiposa', 'masa_muscular', 'masa_osea', 'masa_residual', 'masa_piel', 'endomorfia', 'mesomorfia', 'ectomorfia']));
    expect(new Set(claves).size).toBe(claves.length);
    // 25 variables + IMC + Σ6 + 5 masas + 3 componentes del somatotipo.
    expect(claves).toHaveLength(25 + 2 + 5 + 3);
  });

  it('diferencia = B − A y coincide con compararMediciones del motor', () => {
    const c = compararAB(mediciones, 'm1', 'm3')!;
    const motor = compararMediciones(M3.resultado, M1.resultado);
    const por = (clave: string) => filas(c).find((f) => f.clave === clave)!;

    expect(por('peso').valorA).toBeCloseTo(53.05, 6);
    expect(por('peso').valorB).toBeCloseTo(52.2, 6);
    expect(por('peso').diferencia).toBeCloseTo(52.2 - 53.05, 6);
    expect(por('peso').diferencia).toBe(motor.peso);
    expect(por('masa_adiposa').diferencia).toBe(motor.masas.adiposa);
    expect(por('endomorfia').diferencia).toBe(motor.somatotipo.endomorfia);
    expect(por('perimetro_brazo_flexionado').diferencia).toBe(motor.variables.perimetro_brazo_flexionado);
    expect(por('imc').diferencia).toBeCloseTo(M3.resultado.indices.imc - M1.resultado.indices.imc, 10);
    expect(por('suma6').diferencia).toBeCloseTo(M3.resultado.indices.sumaSeisPliegues - M1.resultado.indices.sumaSeisPliegues, 10);
    for (const f of filas(c)) expect(f.diferencia).toBeCloseTo(f.valorB - f.valorA, 9);
  });

  it('invertir A y B invierte el signo de todas las diferencias', () => {
    const ab = filas(compararAB(mediciones, 'm1', 'm2')!);
    const ba = filas(compararAB(mediciones, 'm2', 'm1')!);
    ab.forEach((f, i) => expect(ba[i].diferencia).toBeCloseTo(-f.diferencia, 9));
  });

  it('la variable que no cambió tiene diferencia cero', () => {
    const f = filas(compararAB(mediciones, 'm1', 'm3')!).find((x) => x.clave === 'talla')!;
    expect(f.diferencia).toBe(0);
  });

  it('A === B: marca misma medición y todas las diferencias son cero', () => {
    const c = compararAB(mediciones, 'm2', 'm2')!;
    expect(c.mismaMedicion).toBe(true);
    expect(filas(c).every((f) => f.diferencia === 0)).toBe(true);
    expect(compararAB(mediciones, 'm1', 'm3')!.mismaMedicion).toBe(false);
  });

  it('un id que no existe no compara', () => {
    expect(compararAB(mediciones, 'm1', 'nada')).toBeNull();
  });

  it('A y B conservan su Nº y fecha', () => {
    const c = compararAB(mediciones, 'm2', 'm3')!;
    expect([c.a.nro, c.b.nro]).toEqual([2, 3]);
  });
});

describe('aviso de recálculo', () => {
  it('es el texto acordado', () => {
    expect(AVISO_RECALCULO).toBe(
      'Si se edita una medición anterior, sus valores se recalculan: en los gráficos sus puntos pueden quedar más arriba o más abajo, o más a la izquierda o a la derecha, y las diferencias con las demás cambian.',
    );
  });
});
