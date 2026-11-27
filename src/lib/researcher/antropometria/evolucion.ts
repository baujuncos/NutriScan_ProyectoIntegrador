/**
 * Modelo de vista de la pantalla de Evolución (NUT-244): series sobre un eje de meses, tarjetas de
 * resumen, trayectoria en la somatocarta y comparador A/B. Puro: recibe las mediciones vigentes ya
 * calculadas por el motor y no toca la base ni formatea para pantalla más de lo necesario.
 *
 * Solo cuentan mediciones `vigente`: `medicionesParaEvolucion` descarta borradores y anuladas.
 */
import {
  compararMediciones,
  VARIABLES,
  type ClaveVariable,
  type GrupoVariable,
  type NombreMasa,
  type ResultadoAntropometria,
} from '@/lib/antropometria';
import type { MedicionRow, PacienteAntropometria } from '@/types/antropometria';
import { TITULO_GRUPO } from './asistente';
import { calcularMedicion } from './calculo';
import { fmtConSigno, fmtFijo } from './formato';
import { ETIQUETA_MASA } from './informe';
import { fechaLegible } from './reglas';

/** Mínimo de meses del eje: 12, para que la evolución anual se lea siempre igual. */
export const MESES_MINIMOS_EJE = 12;

/** Aviso fijo al pie de la pantalla: nada derivado se guarda, así que editar una medición mueve sus puntos. */
export const AVISO_RECALCULO =
  'Si se edita una medición anterior, sus valores se recalculan: en los gráficos sus puntos pueden quedar más arriba o más abajo, o más a la izquierda o a la derecha, y las diferencias con las demás cambian.';

/** Decimales de los valores y las diferencias del comparador. */
export const DECIMALES_COMPARADOR = 2;

const ABREVIATURA_MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;

// ───────────────────────────── Mediciones ─────────────────────────────

export interface MedicionEvolucion {
  id: string;
  /** ISO `YYYY-MM-DD`. */
  fecha: string;
  resultado: ResultadoAntropometria;
}

export interface MedicionNumerada extends MedicionEvolucion {
  /** Nº de medición: 1 = la más antigua entre las vigentes calculables. */
  nro: number;
}

export interface MedicionesParaEvolucion {
  mediciones: MedicionEvolucion[];
  /** Vigentes que el motor no pudo calcular (por ejemplo, datos del paciente incompletos): quedan fuera. */
  sinCalcular: number;
}

/** Solo las `vigente` (ni borradores ni anuladas) y solo las que el motor puede calcular. */
export function medicionesParaEvolucion(
  paciente: Pick<PacienteAntropometria, 'fechaNacimiento' | 'sexo' | 'masaOseaReferencia'>,
  filas: readonly Pick<MedicionRow, 'id' | 'fecha_medicion' | 'series' | 'nivel_actividad' | 'deporte' | 'estado'>[],
): MedicionesParaEvolucion {
  const vigentes = filas.filter((f) => f.estado === 'vigente');
  const mediciones: MedicionEvolucion[] = [];
  for (const f of vigentes) {
    const c = calcularMedicion(paciente, f);
    if (c.ok) mediciones.push({ id: f.id, fecha: f.fecha_medicion, resultado: c.resultado });
  }
  return { mediciones, sinCalcular: vigentes.length - mediciones.length };
}

/** Ordena por fecha (a igual fecha se respeta el orden de entrada) y numera desde 1. */
export function numerarMediciones(mediciones: readonly MedicionEvolucion[]): MedicionNumerada[] {
  return mediciones
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (a.m.fecha < b.m.fecha ? -1 : a.m.fecha > b.m.fecha ? 1 : a.i - b.i))
    .map(({ m }, i) => ({ ...m, nro: i + 1 }));
}

/** "Nº 2 · 20/09/2026": cómo se nombra una medición en los selectores y las tablas. */
export function etiquetaMedicion(m: Pick<MedicionNumerada, 'nro' | 'fecha'>): string {
  return `Nº ${m.nro} · ${fechaLegible(m.fecha)}`;
}

// ───────────────────────────── Eje de meses ─────────────────────────────

export interface MesEje {
  anio: number;
  /** 1–12. */
  mes: number;
  /** "may", "jun"… */
  etiqueta: string;
  /** Se muestra el año debajo: en el primer mes y cada vez que cambia. */
  mostrarAnio: boolean;
}

export interface EjeMeses {
  meses: MesEje[];
  /** Año y mes (1–12) del primer tick; null si no hay fechas. */
  inicio: { anio: number; mes: number } | null;
}

function partesFecha(iso: string): { anio: number; mes: number; dia: number } {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return { anio, mes, dia };
}

const indiceMes = (anio: number, mes: number) => anio * 12 + (mes - 1);

/**
 * 12 meses corridos desde el mes de la primera medición. Si la última cae después del mes 12,
 * el eje se alarga hasta incluirla (nunca queda una medición fuera del gráfico).
 */
export function ejeMeses(fechas: readonly string[]): EjeMeses {
  if (fechas.length === 0) return { meses: [], inicio: null };
  const ordenadas = [...fechas].sort();
  const primera = partesFecha(ordenadas[0]);
  const ultima = partesFecha(ordenadas[ordenadas.length - 1]);
  const inicioIdx = indiceMes(primera.anio, primera.mes);
  const cantidad = Math.max(MESES_MINIMOS_EJE, indiceMes(ultima.anio, ultima.mes) - inicioIdx + 1);

  const meses: MesEje[] = [];
  for (let i = 0; i < cantidad; i++) {
    const idx = inicioIdx + i;
    const anio = Math.floor(idx / 12);
    const mes = (idx % 12) + 1;
    meses.push({ anio, mes, etiqueta: ABREVIATURA_MES[mes - 1], mostrarAnio: i === 0 || mes === 1 });
  }
  return { meses, inicio: { anio: primera.anio, mes: primera.mes } };
}

/**
 * Posición de una fecha en el eje, medida en meses desde el borde izquierdo (0 a `meses.length`).
 * Cada mes ocupa una banda del mismo ancho y su etiqueta va centrada; el punto cae DENTRO de la
 * banda según el día (centro del día / días del mes). Así dos mediciones del mismo mes no se pisan
 * y ninguna queda pegada al borde del gráfico.
 */
export function posicionEnEje(eje: EjeMeses, fecha: string): number {
  if (!eje.inicio) return 0;
  const { anio, mes, dia } = partesFecha(fecha);
  const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return indiceMes(anio, mes) - indiceMes(eje.inicio.anio, eje.inicio.mes) + (dia - 0.5) / diasDelMes;
}

// ───────────────────────────── Escala vertical ─────────────────────────────

export interface EscalaY {
  minimo: number;
  maximo: number;
  ticks: number[];
  /** Decimales para rotular los ticks. */
  decimales: number;
}

function pasoAgradable(crudo: number): number {
  const exp = Math.floor(Math.log10(crudo));
  const base = 10 ** exp;
  const f = crudo / base;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return m * base;
}

const limpiar = (n: number) => Number(n.toFixed(10));

/** Escala con ticks "redondos" que contiene todos los valores (no fuerza el cero). */
export function escalaEjeY(valores: readonly number[], objetivoTicks = 4): EscalaY {
  const finitos = valores.filter(Number.isFinite);
  let min = finitos.length ? Math.min(...finitos) : 0;
  let max = finitos.length ? Math.max(...finitos) : 1;
  if (max - min < 1e-9) {
    const holgura = Math.max(Math.abs(max) * 0.1, 1);
    min -= holgura;
    max += holgura;
  } else {
    const holgura = (max - min) * 0.08;
    min -= holgura;
    max += holgura;
  }
  const paso = pasoAgradable((max - min) / objetivoTicks);
  const minimo = limpiar(Math.floor(min / paso) * paso);
  const maximo = limpiar(Math.ceil(max / paso) * paso);
  const ticks: number[] = [];
  for (let t = minimo; t <= maximo + paso / 1000; t = limpiar(t + paso)) ticks.push(t);
  const decimales = paso >= 1 ? 0 : paso >= 0.1 ? 1 : 2;
  return { minimo, maximo, ticks, decimales };
}

// ───────────────────────────── Series ─────────────────────────────

export type ClaveSerie = 'peso' | 'suma6' | NombreMasa;

export interface PuntoSerie {
  nro: number;
  fecha: string;
  /** Posición en meses desde el borde izquierdo del eje. */
  x: number;
  valor: number;
}

export interface SerieEvolucion {
  clave: ClaveSerie;
  etiqueta: string;
  unidad: 'kg' | 'mm';
  decimales: number;
  puntos: PuntoSerie[];
}

interface DefinicionSerie {
  etiqueta: string;
  unidad: 'kg' | 'mm';
  decimales: number;
  valor: (r: ResultadoAntropometria) => number;
}

export const NOMBRES_MASAS_GRAFICO: readonly NombreMasa[] = ['adiposa', 'muscular', 'osea', 'residual', 'piel'];

const DEFINICIONES: Record<ClaveSerie, DefinicionSerie> = {
  peso: { etiqueta: 'Peso', unidad: 'kg', decimales: 1, valor: (r) => r.estadistica.peso.mediana },
  suma6: { etiqueta: 'Suma de 6 pliegues', unidad: 'mm', decimales: 1, valor: (r) => r.indices.sumaSeisPliegues },
  adiposa: { etiqueta: ETIQUETA_MASA.adiposa, unidad: 'kg', decimales: 2, valor: (r) => r.masas.masas.adiposa.kg },
  muscular: { etiqueta: ETIQUETA_MASA.muscular, unidad: 'kg', decimales: 2, valor: (r) => r.masas.masas.muscular.kg },
  osea: { etiqueta: ETIQUETA_MASA.osea, unidad: 'kg', decimales: 2, valor: (r) => r.masas.masas.osea.kg },
  residual: { etiqueta: ETIQUETA_MASA.residual, unidad: 'kg', decimales: 2, valor: (r) => r.masas.masas.residual.kg },
  piel: { etiqueta: ETIQUETA_MASA.piel, unidad: 'kg', decimales: 2, valor: (r) => r.masas.masas.piel.kg },
};

export function construirSerie(clave: ClaveSerie, mediciones: readonly MedicionNumerada[], eje: EjeMeses): SerieEvolucion {
  const def = DEFINICIONES[clave];
  return {
    clave,
    etiqueta: def.etiqueta,
    unidad: def.unidad,
    decimales: def.decimales,
    puntos: mediciones.map((m) => ({ nro: m.nro, fecha: m.fecha, x: posicionEnEje(eje, m.fecha), valor: def.valor(m.resultado) })),
  };
}

// ───────────────────────────── Tarjetas de resumen ─────────────────────────────

export interface KpiEvolucion {
  clave: 'peso' | 'suma6' | 'adiposa' | 'muscular';
  etiqueta: string;
  unidad: 'kg' | 'mm';
  /** Último valor, ya formateado ("53,1"). */
  valorTexto: string;
  /** Última − medición Nº 1; null con una sola medición. */
  diferencia: number | null;
  /** "−1,55 kg desde la medición Nº 1" / "Primera medición". */
  diferenciaTexto: string;
}

const CLAVES_KPI: readonly KpiEvolucion['clave'][] = ['peso', 'suma6', 'adiposa', 'muscular'];

export function construirKpis(mediciones: readonly MedicionNumerada[]): KpiEvolucion[] {
  if (mediciones.length === 0) return [];
  const primera = mediciones[0];
  const ultima = mediciones[mediciones.length - 1];
  return CLAVES_KPI.map((clave) => {
    const def = DEFINICIONES[clave];
    const diferencia = mediciones.length > 1 ? def.valor(ultima.resultado) - def.valor(primera.resultado) : null;
    return {
      clave,
      etiqueta: def.etiqueta,
      unidad: def.unidad,
      valorTexto: fmtFijo(def.valor(ultima.resultado), def.decimales),
      diferencia,
      diferenciaTexto:
        diferencia === null ? 'Primera medición' : `${fmtConSigno(diferencia, 2)} ${def.unidad} desde la medición Nº ${primera.nro}`,
    };
  });
}

// ───────────────────────────── Somatocarta ─────────────────────────────

export interface PuntoTrayectoria {
  nro: number;
  fecha: string;
  etiqueta: string;
  endomorfia: number;
  mesomorfia: number;
  ectomorfia: number;
  x: number;
  y: number;
}

export interface ReferenciaDeporte {
  nombre: string;
  x: number;
  y: number;
}

export interface TrayectoriaSomatotipo {
  puntos: PuntoTrayectoria[];
  /** El deporte de la última medición (el mismo que usa el informe); null si no tiene. */
  referencia: ReferenciaDeporte | null;
}

export function construirTrayectoria(mediciones: readonly MedicionNumerada[]): TrayectoriaSomatotipo {
  const puntos = mediciones.map((m) => {
    const s = m.resultado.somatotipo;
    return {
      nro: m.nro,
      fecha: m.fecha,
      etiqueta: etiquetaMedicion(m),
      endomorfia: s.endomorfia,
      mesomorfia: s.mesomorfia,
      ectomorfia: s.ectomorfia,
      x: s.x,
      y: s.y,
    };
  });
  const deporte = mediciones.at(-1)?.resultado.comparacionDeporte ?? null;
  return { puntos, referencia: deporte ? { nombre: deporte.nombre, x: deporte.x, y: deporte.y } : null };
}

// ───────────────────────────── Evolución completa ─────────────────────────────

export interface Evolucion {
  mediciones: MedicionNumerada[];
  eje: EjeMeses;
  peso: SerieEvolucion;
  suma6: SerieEvolucion;
  masas: SerieEvolucion[];
  kpis: KpiEvolucion[];
  trayectoria: TrayectoriaSomatotipo;
}

export function construirEvolucion(entrada: readonly MedicionEvolucion[]): Evolucion {
  const mediciones = numerarMediciones(entrada);
  const eje = ejeMeses(mediciones.map((m) => m.fecha));
  return {
    mediciones,
    eje,
    peso: construirSerie('peso', mediciones, eje),
    suma6: construirSerie('suma6', mediciones, eje),
    masas: NOMBRES_MASAS_GRAFICO.map((n) => construirSerie(n, mediciones, eje)),
    kpis: construirKpis(mediciones),
    trayectoria: construirTrayectoria(mediciones),
  };
}

// ───────────────────────────── Comparador A/B ─────────────────────────────

export interface FilaComparacion {
  clave: string;
  etiqueta: string;
  unidad: 'kg' | 'cm' | 'mm' | '';
  valorA: number;
  valorB: number;
  /** B − A (positivo = B es mayor). */
  diferencia: number;
}

export interface GrupoComparacion {
  id: string;
  titulo: string;
  filas: FilaComparacion[];
}

export interface Comparacion {
  a: MedicionNumerada;
  b: MedicionNumerada;
  /** A y B son la misma medición: no hay nada que comparar. */
  mismaMedicion: boolean;
  grupos: GrupoComparacion[];
}

/** Por defecto A = la primera medición y B = la última; un id desconocido en la URL también cae ahí. */
export function resolverSeleccion(
  mediciones: readonly MedicionNumerada[],
  a?: string | null,
  b?: string | null,
): { idA: string; idB: string } | null {
  if (mediciones.length === 0) return null;
  const existe = (id?: string | null) => (id && mediciones.some((m) => m.id === id) ? id : null);
  return { idA: existe(a) ?? mediciones[0].id, idB: existe(b) ?? mediciones[mediciones.length - 1].id };
}

const GRUPOS_VARIABLES_ORDEN: readonly GrupoVariable[] = ['basicas', 'diametros', 'perimetros', 'pliegues'];

/**
 * Tabla A/B con diferencias absolutas B − A. Reusa `compararMediciones` del motor para las
 * variables, masas y somatotipo; el IMC y la suma de 6 pliegues (que el motor no compara) se restan acá.
 * Orden: datos básicos, índices, masas de Kerr, somatotipo y después diámetros, perímetros y pliegues.
 */
export function compararAB(mediciones: readonly MedicionNumerada[], idA: string, idB: string): Comparacion | null {
  const a = mediciones.find((m) => m.id === idA);
  const b = mediciones.find((m) => m.id === idB);
  if (!a || !b) return null;

  const ra = a.resultado;
  const rb = b.resultado;
  const dif = compararMediciones(rb, ra);

  const fila = (clave: string, etiqueta: string, unidad: FilaComparacion['unidad'], valorA: number, valorB: number, diferencia: number): FilaComparacion => ({
    clave,
    etiqueta,
    unidad,
    valorA,
    valorB,
    diferencia,
  });

  const filasVariables = (grupo: GrupoVariable) =>
    VARIABLES.filter((v) => v.grupo === grupo).map((v) =>
      fila(v.clave, v.etiqueta, v.unidad, ra.estadistica[v.clave as ClaveVariable].mediana, rb.estadistica[v.clave as ClaveVariable].mediana, dif.variables[v.clave as ClaveVariable]),
    );

  const grupoVariables = (grupo: GrupoVariable): GrupoComparacion => ({ id: grupo, titulo: TITULO_GRUPO[grupo], filas: filasVariables(grupo) });

  const indices: GrupoComparacion = {
    id: 'indices',
    titulo: 'Índices',
    filas: [
      fila('imc', 'IMC', '', ra.indices.imc, rb.indices.imc, rb.indices.imc - ra.indices.imc),
      fila('suma6', 'Suma de 6 pliegues', 'mm', ra.indices.sumaSeisPliegues, rb.indices.sumaSeisPliegues, rb.indices.sumaSeisPliegues - ra.indices.sumaSeisPliegues),
    ],
  };

  const masas: GrupoComparacion = {
    id: 'masas',
    titulo: 'Masas corporales (Kerr)',
    filas: NOMBRES_MASAS_GRAFICO.map((n) => fila(`masa_${n}`, ETIQUETA_MASA[n], 'kg', ra.masas.masas[n].kg, rb.masas.masas[n].kg, dif.masas[n])),
  };

  const somatotipo: GrupoComparacion = {
    id: 'somatotipo',
    titulo: 'Somatotipo',
    filas: [
      fila('endomorfia', 'Endomorfia', '', ra.somatotipo.endomorfia, rb.somatotipo.endomorfia, dif.somatotipo.endomorfia),
      fila('mesomorfia', 'Mesomorfia', '', ra.somatotipo.mesomorfia, rb.somatotipo.mesomorfia, dif.somatotipo.mesomorfia),
      fila('ectomorfia', 'Ectomorfia', '', ra.somatotipo.ectomorfia, rb.somatotipo.ectomorfia, dif.somatotipo.ectomorfia),
    ],
  };

  const [basicas, ...resto] = GRUPOS_VARIABLES_ORDEN;
  return {
    a,
    b,
    mismaMedicion: a.id === b.id,
    grupos: [grupoVariables(basicas), indices, masas, somatotipo, ...resto.map(grupoVariables)],
  };
}
