/**
 * NUT-151 — Resumen descargable (.md) de la calidad de las detecciones de Gemini, pensado para
 * pasárselo a una IA que proponga mejoras al prompt de reconocimiento y estimación de peso
 * (cierra el ciclo de mejora continua). Funciones puras: reciben las filas ya cargadas y devuelven
 * texto. No incluye NADA personal (ni usuarios, ni investigadores, ni fotos).
 */
import {
  UMBRAL_CONFIANZA_ALTA,
  UMBRAL_TASA_CORRECCION_ALTA,
  confianzaVsCorreccion,
  estadoCola,
  evolucionPorPrompt,
  noDetectados,
  rankingAlimentos,
  resumenEvolucion,
  type ItemMetrica,
  type NoDetectadoFila,
} from '@/lib/metricasIa';
import type { MetricasParams } from '@/lib/metricasIaQuery';
import { UMBRAL_CONFIANZA_BAJA, UMBRAL_DIFERENCIA_PESO } from '@/lib/revisionIa';

/** Con menos detecciones que esto, un porcentaje no es confiable: se marca como muestra chica. */
export const MIN_MUESTRA = 5;
const MAX_FILAS_TABLA = 20;
const MAX_CASOS = 12;
const MAX_EJEMPLOS = 40;

export interface PromptActual {
  version: string;
  texto: string;
}

export interface EntradaResumen {
  /** Ya filtradas por fecha, vajilla y versión de prompt (las del dashboard). */
  items: ItemMetrica[];
  /** Fecha y vajilla pero TODAS las versiones: para comparar versiones del prompt. */
  itemsTodasLasVersiones: ItemMetrica[];
  noDetectados: NoDetectadoFila[];
  params: MetricasParams;
  prompt: PromptActual;
  generadoEn: Date;
  /** Se alcanzó el tope de lectura: los números son parciales. */
  truncado?: boolean;
}

// ---------- utilidades de formato ----------

const redondear = (n: number, dec = 1) => Math.round(n * 10 ** dec) / 10 ** dec;
const num = (n: number) => String(redondear(n));
const pct = (x: number, dec = 0) => `${redondear(x * 100, dec)} %`;
const gramos = (n: number | null | undefined) => (n == null ? '—' : `${num(n)} g`);
const celda = (t: string) => t.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const promedio = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

function tabla(encabezados: string[], filas: string[][]): string {
  const cuerpo = filas.map((f) => `| ${f.map(celda).join(' | ')} |`);
  // Empieza con una línea en blanco: muchos renderizadores de Markdown no reconocen una tabla pegada a un párrafo.
  return '\n' + [`| ${encabezados.join(' | ')} |`, `| ${encabezados.map(() => '---').join(' | ')} |`, ...cuerpo].join('\n');
}

const VAJILLA: Record<string, string> = { plato_playo: 'plato playo', plato_postre: 'plato de postre', plato_hondo: 'plato hondo' };
const vajilla = (v?: string) => (v ? VAJILLA[v] ?? v : 'sin dato');

// ---------- estadísticas ----------

const quitado = (i: ItemMetrica) => i.motivos_revision.includes('item_quitado') || i.alimento_usuario === null;
const corregido = (i: ItemMetrica) =>
  i.motivos_revision.some((m) => m === 'cambio_alimento' || m === 'correccion_peso_grande' || m === 'item_quitado');

/** Valor final de un ítem: lo del investigador si corrigió; si no, lo que dejó el deportista. */
export function valorFinal(i: ItemMetrica): { nombre: string | null; gramos: number | null; fuente: 'investigador' | 'deportista' } {
  if (i.estado_revision === 'corregido' && (i.nutricionista_alimento || i.nutricionista_gramos != null)) {
    return {
      nombre: i.nutricionista_alimento ?? i.alimento_usuario ?? null,
      gramos: i.nutricionista_gramos ?? i.gramos_usuario,
      fuente: 'investigador',
    };
  }
  return { nombre: i.alimento_usuario ?? null, gramos: i.gramos_usuario, fuente: 'deportista' };
}

export interface ResumenGeneral {
  detecciones: number;
  tasaNombre: number;
  tasaPeso: number;
  tasaQuitado: number;
  tasaCorreccion: number;
  tasaConfianzaBaja: number;
  confianzaPromedio: number;
}

export function resumenGeneral(items: ItemMetrica[]): ResumenGeneral {
  const n = items.length;
  const tasa = (f: (i: ItemMetrica) => boolean) => (n === 0 ? 0 : items.filter(f).length / n);
  return {
    detecciones: n,
    tasaNombre: tasa((i) => i.motivos_revision.includes('cambio_alimento')),
    tasaPeso: tasa((i) => i.motivos_revision.includes('correccion_peso_grande')),
    tasaQuitado: tasa((i) => i.motivos_revision.includes('item_quitado')),
    tasaCorreccion: tasa(corregido),
    tasaConfianzaBaja: tasa((i) => i.motivos_revision.includes('confianza_baja')),
    confianzaPromedio: promedio(items.map((i) => i.confidence)),
  };
}

export interface FilaCalibracion {
  rango: string;
  detecciones: number;
  tasaCorreccion: number;
}

/** ¿La confianza que declara el modelo se corresponde con cuánto acierta? Corrección por tramo de confianza. */
export function calibracionConfianza(items: ItemMetrica[]): FilaCalibracion[] {
  const tramos: Array<{ rango: string; desde: number; hasta: number }> = [
    { rango: `menos de ${pct(UMBRAL_CONFIANZA_BAJA)}`, desde: 0, hasta: UMBRAL_CONFIANZA_BAJA },
    { rango: `${pct(UMBRAL_CONFIANZA_BAJA)} a 75 %`, desde: UMBRAL_CONFIANZA_BAJA, hasta: 0.75 },
    { rango: '75 % a 90 %', desde: 0.75, hasta: 0.9 },
    { rango: '90 % o más', desde: 0.9, hasta: 1.0001 },
  ];
  return tramos.map((t) => {
    const grupo = items.filter((i) => i.confidence >= t.desde && i.confidence < t.hasta);
    return { rango: t.rango, detecciones: grupo.length, tasaCorreccion: grupo.length === 0 ? 0 : grupo.filter(corregido).length / grupo.length };
  });
}

export interface SesgoPeso {
  clave: string;
  detecciones: number;
  /** Error relativo medio con signo: (final − IA) / IA. Positivo = la IA subestima. */
  sesgoMedio: number;
  errorAbsolutoMedio: number;
  /** Fracción de casos en que la IA subestimó (final > IA). */
  subestima: number;
}

function sesgoDe(grupo: ItemMetrica[], clave: string): SesgoPeso | null {
  const errores = grupo
    .filter((i) => !quitado(i) && i.gramos_ia > 0)
    .map((i) => ({ i, g: valorFinal(i).gramos }))
    .filter((x): x is { i: ItemMetrica; g: number } => x.g != null)
    .map(({ i, g }) => (g - i.gramos_ia) / i.gramos_ia);
  if (errores.length === 0) return null;
  return {
    clave,
    detecciones: errores.length,
    sesgoMedio: promedio(errores),
    errorAbsolutoMedio: promedio(errores.map(Math.abs)),
    subestima: errores.filter((e) => e > 0).length / errores.length,
  };
}

/** Sesgo de peso por alimento (los de menos de `minimo` detecciones con peso se descartan: no dicen nada). */
export function sesgoPesoPorAlimento(items: ItemMetrica[], minimo = 3): SesgoPeso[] {
  const grupos = new Map<string, ItemMetrica[]>();
  for (const i of items) grupos.set(i.alimento_norm, [...(grupos.get(i.alimento_norm) ?? []), i]);
  return [...grupos.values()]
    .map((g) => sesgoDe(g, g[0].alimento))
    .filter((s): s is SesgoPeso => s != null && s.detecciones >= minimo)
    .sort((a, b) => Math.abs(b.sesgoMedio) - Math.abs(a.sesgoMedio));
}

/** Sesgo de peso por tipo de vajilla (la escala del plato puede sesgar todos los alimentos juntos). */
export function sesgoPesoPorVajilla(items: ItemMetrica[]): SesgoPeso[] {
  const grupos = new Map<string, ItemMetrica[]>();
  for (const i of items) grupos.set(vajilla(i.vajilla_tipo), [...(grupos.get(vajilla(i.vajilla_tipo)) ?? []), i]);
  return [...grupos.entries()].map(([k, g]) => sesgoDe(g, k)).filter((s): s is SesgoPeso => s != null);
}

export interface Confusion {
  ia: string;
  final: string;
  veces: number;
  confianzaPromedio: number;
}

/** Qué alimento detectó la IA y cuál era en realidad (valor final), cuando se cambió el nombre. */
export function confusionesNombre(items: ItemMetrica[]): Confusion[] {
  const mapa = new Map<string, { ia: string; final: string; confs: number[] }>();
  for (const i of items) {
    if (!i.motivos_revision.includes('cambio_alimento')) continue;
    const final = valorFinal(i).nombre;
    if (!final) continue;
    const clave = `${i.alimento_norm}→${final.toLowerCase()}`;
    const actual = mapa.get(clave) ?? { ia: i.alimento, final, confs: [] };
    actual.confs.push(i.confidence);
    mapa.set(clave, actual);
  }
  return [...mapa.values()]
    .map((c) => ({ ia: c.ia, final: c.final, veces: c.confs.length, confianzaPromedio: promedio(c.confs) }))
    .sort((a, b) => b.veces - a.veces || b.confianzaPromedio - a.confianzaPromedio);
}

function contexto(i: ItemMetrica): string {
  const partes = [vajilla(i.vajilla_tipo)];
  if (i.vajilla_diametro_cm != null) partes[0] += ` de ${num(i.vajilla_diametro_cm)} cm`;
  if (i.angulo_captura_grados != null) partes.push(`ángulo ${i.angulo_captura_grados}°`);
  return partes.join(', ');
}

/** Un caso concreto en una línea: lo que dijo la IA, lo que dejó el deportista y lo que corrigió el equipo. */
export function lineaCaso(i: ItemMetrica): string {
  const ia = `${i.alimento} · ${gramos(i.gramos_ia)} · confianza ${pct(i.confidence)}`;
  const dep = quitado(i) ? 'lo quitó (no estaba en el plato)' : `${i.alimento_usuario ?? '—'} · ${gramos(i.gramos_usuario)}`;
  let inv = 'sin revisar';
  if (i.estado_revision === 'corregido') inv = `${i.nutricionista_alimento ?? '(nombre sin cambios)'} · ${gramos(i.nutricionista_gramos)}`;
  else if (i.estado_revision === 'confirmado') inv = 'confirmó lo del deportista';
  const motivos = i.motivos_revision.length > 0 ? i.motivos_revision.join(', ') : 'ninguno';
  return `- **IA:** ${ia} → **Deportista:** ${dep} → **Equipo:** ${inv} _(${contexto(i)}; motivos: ${motivos})_`;
}

export interface Casos {
  ejemplos: ItemMetrica[];
  mayoresErroresDePeso: ItemMetrica[];
  confiadosYEquivocados: ItemMetrica[];
}

export function casosDestacados(items: ItemMetrica[]): Casos {
  const errorPeso = (i: ItemMetrica) => {
    const g = valorFinal(i).gramos;
    return g == null || i.gramos_ia <= 0 ? 0 : Math.abs(g - i.gramos_ia) / i.gramos_ia;
  };
  return {
    ejemplos: items.filter((i) => i.candidato_ejemplo).slice(0, MAX_EJEMPLOS),
    mayoresErroresDePeso: items
      .filter((i) => i.motivos_revision.includes('correccion_peso_grande') && !i.candidato_ejemplo)
      .sort((a, b) => errorPeso(b) - errorPeso(a))
      .slice(0, MAX_CASOS),
    confiadosYEquivocados: items
      .filter((i) => i.confidence >= UMBRAL_CONFIANZA_ALTA && corregido(i) && !i.candidato_ejemplo)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, MAX_CASOS),
  };
}

// ---------- documento ----------

const fechaCorta = (d: Date) => d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' });

function seccionFiltros(p: MetricasParams): string {
  const lineas = [
    `- **Período:** ${p.desde || 'sin límite inferior'} a ${p.hasta || 'sin límite superior'}`,
    `- **Vajilla:** ${p.vajilla === 'todas' ? 'todas' : vajilla(p.vajilla)}`,
    `- **Versión del prompt:** ${p.prompt === 'todas' ? 'todas' : p.prompt}`,
  ];
  return lineas.join('\n');
}

/** El documento completo, en Markdown. */
export function construirResumenMd(e: EntradaResumen): string {
  const { items } = e;
  const g = resumenGeneral(items);
  const cola = estadoCola(items);
  const ranking = rankingAlimentos(items);
  const puntos = confianzaVsCorreccion(items);
  const sesgoAlimento = sesgoPesoPorAlimento(items);
  const sesgoVaj = sesgoPesoPorVajilla(items);
  const confusiones = confusionesNombre(items);
  const casos = casosDestacados(items);
  const evolucion = evolucionPorPrompt(e.itemsTodasLasVersiones);
  const resumenEvol = resumenEvolucion(evolucion);
  const faltantes = noDetectados(e.noDetectados);
  const quitados = ranking.filter((r) => r.tasaQuitado > 0).sort((a, b) => b.tasaQuitado * b.detecciones - a.tasaQuitado * a.detecciones).slice(0, 10);
  const confiadosEquivocados = puntos.filter((p) => p.cuadrante === 'confiado_equivocado').sort((a, b) => b.tasaCorreccion - a.tasaCorreccion);
  const marcaChica = (n: number) => (n < MIN_MUESTRA ? ' ⚠️' : '');

  const s: string[] = [];

  s.push(`# NutriScan — Resumen de calidad del reconocimiento de alimentos por IA`);
  s.push(`_Generado el ${fechaCorta(e.generadoEn)}. Pensado para pasárselo a una IA que proponga mejoras al prompt de reconocimiento y estimación de peso._`);
  s.push(`${seccionFiltros(e.params)}\n- **Detecciones evaluadas:** ${g.detecciones} · **Confianza promedio declarada:** ${pct(g.confianzaPromedio)}`);
  if (e.truncado) s.push('> ⚠️ Se alcanzó el límite de lectura de datos: **los números son parciales**. Conviene acotar el período.');

  // ---- contexto ----
  s.push(`## 1. Contexto: qué es esto y cómo leerlo
NutriScan es una app de seguimiento nutricional para deportistas universitarios. El usuario saca una **foto de su plato** (con el tipo y diámetro real de la vajilla y el ángulo de captura como referencia de escala) y un modelo de IA (Gemini) **identifica cada alimento y estima su peso en gramos**, con un valor de confianza (0–1) y una caja sobre la foto. Después el deportista **confirma o corrige** el resultado, y el equipo de nutrición **revisa a mano** los casos dudosos o muy corregidos.

Este archivo resume cómo y dónde se equivoca el modelo. **Todo está en términos de lo que dijo la IA contra lo que dejó el deportista al confirmar** (y, cuando el equipo de nutrición revisó, contra lo que corrigió).

**Definiciones**
- **Cambio de nombre:** el deportista reemplazó el alimento que detectó la IA (la IA no lo reconoció bien).
- **Corrección de peso:** el peso final difiere del estimado por la IA en más de ${pct(UMBRAL_DIFERENCIA_PESO)} (con el mismo alimento).
- **Ítem quitado:** la IA detectó algo que no estaba en el plato y el deportista lo sacó (falso positivo).
- **Confianza baja:** la IA declaró una confianza menor a ${pct(UMBRAL_CONFIANZA_BAJA)} (no cuenta como corrección por sí sola).
- **Corrección (en general):** cambio de nombre, de peso o ítem quitado.
- **No detectado:** alimento que el deportista tuvo que agregar a mano porque la IA no lo vio (falso negativo). Se mide aparte.
- **Error relativo de peso:** (peso final − peso de la IA) / peso de la IA. **Positivo = la IA subestimó**; negativo = sobreestimó.

**Límites de los datos (importante)**
- **No hay peso real medido con balanza.** El "peso final" es lo que el deportista (o el equipo) dejó: también es una estimación, aunque sea mejor informada. Interpretá los errores de peso como una señal, no como verdad absoluta.
- Los porcentajes con pocas detecciones no son confiables: las filas con menos de ${MIN_MUESTRA} detecciones están marcadas con ⚠️.
- Los datos se leen desde que se empezó a guardar la clasificación de cada ítem; detecciones anteriores no aparecen.`);

  // ---- prompt actual ----
  s.push(`## 2. Prompt actual de reconocimiento y estimación (versión \`${e.prompt.version}\`)
Este es el prompt de sistema que se le manda al modelo. Los valores de vajilla, diámetro y ángulo cambian en cada foto (acá van de ejemplo). Es lo que se busca mejorar.

\`\`\`text
${e.prompt.texto.trim()}
\`\`\``);

  // ---- resumen ----
  s.push(`## 3. Resumen de errores
${tabla(
    ['Indicador', 'Valor'],
    [
      ['Detecciones evaluadas', String(g.detecciones)],
      ['Con alguna corrección (nombre, peso o quitado)', pct(g.tasaCorreccion)],
      ['Cambio de nombre', pct(g.tasaNombre)],
      ['Corrección de peso', pct(g.tasaPeso)],
      ['Ítem quitado (falso positivo)', pct(g.tasaQuitado)],
      ['Confianza baja', pct(g.tasaConfianzaBaja)],
      ['Alimentos agregados a mano (no detectados)', String(e.noDetectados.length)],
    ],
  )}

**Estado de la revisión del equipo de nutrición:** ${cola.pendiente} pendientes, ${cola.confirmado} confirmados, ${cola.corregido} corregidos.`);

  // ---- ranking ----
  s.push(
    ranking.length === 0
      ? `## 4. Alimentos más corregidos\nNo hay detecciones evaluadas en el período.`
      : `## 4. Alimentos más corregidos
Ordenados por tasa de corrección. Nombre y peso son problemas distintos: el primero es de **identificación visual**, el segundo de **escala/porción**.
${tabla(
          ['Alimento', 'Detecciones', '% cambio de nombre', '% corrección de peso', '% quitado', '% con alguna corrección'],
          ranking.slice(0, MAX_FILAS_TABLA).map((r) => [`${r.alimento}${marcaChica(r.detecciones)}`, String(r.detecciones), pct(r.tasaNombre), pct(r.tasaPeso), pct(r.tasaQuitado), pct(r.tasaCorreccion)]),
        )}${ranking.length > MAX_FILAS_TABLA ? `\n\n_Se muestran ${MAX_FILAS_TABLA} de ${ranking.length} alimentos._` : ''}`,
  );

  // ---- confiados y equivocados ----
  s.push(`## 5. "Confiado y equivocado": el modelo estaba seguro y se equivocó igual
Alimentos con confianza promedio de ${pct(UMBRAL_CONFIANZA_ALTA)} o más y corregidos en ${pct(UMBRAL_TASA_CORRECCION_ALTA)} o más de los casos. Son los errores más valiosos para mejorar el prompt (el modelo no "sabe que no sabe").
${
    confiadosEquivocados.length === 0
      ? '\nNingún alimento cae en este grupo en el período.'
      : '\n' + tabla(['Alimento', 'Detecciones', 'Confianza promedio', '% con corrección'], confiadosEquivocados.map((p) => [`${p.alimento}${marcaChica(p.detecciones)}`, String(p.detecciones), pct(p.confianzaPromedio), pct(p.tasaCorreccion)]))
  }

**Calibración de la confianza** (¿la confianza declarada se corresponde con cuánto acierta?):
${tabla(['Confianza declarada', 'Detecciones', '% con alguna corrección'], calibracionConfianza(items).map((c) => [c.rango, String(c.detecciones), c.detecciones === 0 ? '—' : pct(c.tasaCorreccion)]))}

_Si la tasa de corrección no baja al subir la confianza, la confianza que reporta el modelo no es un buen indicador._`);

  // ---- sesgo de peso ----
  s.push(`## 6. Sesgo en la estimación de peso
Error relativo medio con signo (positivo = la IA **subestima**). Sólo ítems que no se quitaron y tienen peso final; alimentos con al menos 3 detecciones.
${
    sesgoAlimento.length === 0
      ? '\nNo hay suficientes datos de peso por alimento.'
      : '\n' + tabla(['Alimento', 'Detecciones con peso', 'Error relativo medio', 'Error absoluto medio', '% de casos en que la IA subestima'], sesgoAlimento.slice(0, MAX_FILAS_TABLA).map((x) => [`${x.clave}${marcaChica(x.detecciones)}`, String(x.detecciones), `${x.sesgoMedio > 0 ? '+' : ''}${pct(x.sesgoMedio)}`, pct(x.errorAbsolutoMedio), pct(x.subestima)]))
  }

**Por tipo de vajilla** (un sesgo común a todos los alimentos de un plato apunta a un problema de escala, no de reconocimiento):
${sesgoVaj.length === 0 ? '\nSin datos.' : '\n' + tabla(['Vajilla', 'Detecciones con peso', 'Error relativo medio', 'Error absoluto medio'], sesgoVaj.map((x) => [x.clave, String(x.detecciones), `${x.sesgoMedio > 0 ? '+' : ''}${pct(x.sesgoMedio)}`, pct(x.errorAbsolutoMedio)]))}`);

  // ---- confusiones ----
  s.push(`## 7. Confusiones de nombre más frecuentes (la IA dijo → en realidad era)
${confusiones.length === 0 ? '\nNo hay cambios de nombre registrados en el período.' : '\n' + tabla(['La IA detectó', 'Era en realidad', 'Veces', 'Confianza promedio'], confusiones.slice(0, MAX_FILAS_TABLA).map((c) => [c.ia, c.final, String(c.veces), pct(c.confianzaPromedio)]))}

**Falsos positivos** (la IA detectó algo que no estaba y el deportista lo quitó):
${quitados.length === 0 ? '\nNo hay ítems quitados en el período.' : '\n' + tabla(['Alimento', 'Detecciones', '% quitado'], quitados.map((r) => [`${r.alimento}${marcaChica(r.detecciones)}`, String(r.detecciones), pct(r.tasaQuitado)]))}`);

  // ---- no detectados ----
  s.push(`## 8. Alimentos no detectados (falsos negativos)
Alimentos que los deportistas agregaron a mano porque la IA no los vio. Miden la capacidad de **detección**, no la de estimación.
${faltantes.length === 0 ? '\nNingún alimento agregado a mano en el período.' : '\n' + tabla(['Alimento', 'Veces'], faltantes.slice(0, MAX_FILAS_TABLA).map((f) => [f.alimento, String(f.veces)]))}`);

  // ---- evolución ----
  s.push(`## 9. Evolución por versión del prompt
${
    evolucion.length === 0
      ? 'Sin datos.'
      : tabla(['Versión', 'Detecciones', '% con alguna corrección', 'Error de peso promedio (absoluto)', 'Cambio vs. versión anterior'], evolucion.map((v) => [v.prompt_version, String(v.detecciones), pct(v.tasaCorreccion), v.errorPesoPromedio == null ? '—' : pct(v.errorPesoPromedio), v.deltaError == null ? '—' : `${v.deltaError > 0 ? '+' : ''}${redondear(v.deltaError * 100)} puntos`]))
  }
${resumenEvol ? `\n${resumenEvol.puntos < 0 ? 'Mejoró' : resumenEvol.puntos > 0 ? 'Empeoró' : 'Sin cambio'}: ${Math.abs(resumenEvol.puntos)} puntos de error de peso entre \`${resumenEvol.desde}\` y \`${resumenEvol.hasta}\`.` : '\n_Hay una sola versión con datos de peso: todavía no hay comparación posible._'}`);

  // ---- casos ----
  const bloqueCasos = (titulo: string, ayuda: string, lista: ItemMetrica[]) =>
    `### ${titulo}\n${ayuda}\n\n${lista.length === 0 ? '_Ninguno en el período._' : lista.map(lineaCaso).join('\n')}`;
  s.push(`## 10. Casos concretos
Los ejemplos reales sirven para armar *few-shot* o para entender el tipo de error. No contienen datos personales.

${bloqueCasos('10.1 Marcados como "Ejemplo para la IA" por el equipo', 'El equipo los señaló como errores **claros y típicos**, buenos candidatos para sumar como ejemplos en el prompt.', casos.ejemplos)}

${bloqueCasos('10.2 Mayores errores de peso', 'Correcciones de peso más grandes (con el mismo alimento).', casos.mayoresErroresDePeso)}

${bloqueCasos('10.3 Confiado y equivocado', 'Casos con confianza alta que igual se corrigieron.', casos.confiadosYEquivocados)}`);

  // ---- tarea ----
  s.push(`## 11. Tarea sugerida para la IA que lea este archivo
Con los datos de arriba, proponé mejoras al **prompt de reconocimiento y estimación de peso** (sección 2). Entregá:

1. **Diagnóstico**: los 3–5 patrones de error más importantes, separando **errores de identificación** (nombre, falsos positivos, no detectados) de **errores de estimación** (peso, sesgos por alimento o por vajilla). Citá los números que los respaldan.
2. **Cambios concretos al prompt**, como texto listo para pegar o como diff sobre el prompt actual, indicando qué error ataca cada cambio.
3. **Ejemplos para el prompt** (*few-shot*): elegí de la sección 10 los más representativos y explicá por qué; no inventes casos nuevos.
4. **Factores de calibración** posibles (por alimento o por vajilla) si hay un sesgo sistemático claro en la sección 6, con la advertencia de cuántas detecciones lo respaldan.
5. **Qué datos faltan** para decidir mejor (por ejemplo, más fotos de un alimento, pesos medidos con balanza).

**Restricciones**
- No te apoyes en filas marcadas con ⚠️ (menos de ${MIN_MUESTRA} detecciones) para sacar conclusiones fuertes; mencionalas como hipótesis.
- Mantené intacto el formato de salida del modelo (JSON con alimentos, categoría, confianza, peso estimado, preguntas aclaratorias y caja) y la regla de que la **única referencia de escala es la vajilla**.
- El modelo **no debe estimar valores nutricionales** (kcal, macros): eso sale de la base de alimentos. Sólo identifica y estima peso.
- Priorizá cambios que se puedan **medir** con las mismas métricas de este resumen en la próxima versión del prompt.`);

  return s.join('\n\n') + '\n';
}

/** Nombre del archivo: nutriscan-resumen-calidad-AAAA-MM-DD.md (hora de Argentina). */
export function nombreArchivoResumen(fecha: Date): string {
  const [d, m, a] = fechaCorta(fecha).split('/');
  return `nutriscan-resumen-calidad-${a}-${m}-${d}.md`;
}
