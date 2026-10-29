// Arma reports/load/informe-carga.md a partir de los resúmenes de k6 (stress-summary.json, soak-summary.json).
// Todos los números salen del JSON que escribió k6: no se calcula ni se estima nada a mano.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const ms = (x) => (x === undefined ? 'n/d' : `${Number(x).toFixed(1)} ms`);
const pct = (x) => (x === undefined ? 'n/d' : `${(100 * x).toFixed(2)} %`);

/** Umbrales de un resumen: [{metrica, expresion, ok}] */
export function umbrales(data) {
  const out = [];
  for (const [metrica, m] of Object.entries(data.metrics)) {
    for (const [expresion, t] of Object.entries(m.thresholds ?? {})) out.push({ metrica, expresion, ok: t.ok === true });
  }
  return out;
}

/** Relación latencia final / inicial del esfuerzo sostenido; null si no hay datos. */
export function degradacion(data) {
  const a = data.metrics.soak_inicio?.values?.['p(95)'];
  const b = data.metrics.soak_final?.values?.['p(95)'];
  if (!a || !b) return null;
  return { inicio: a, final: b, ratio: b / a };
}

export function seccion(nombre, titulo, data, baseUrl) {
  const m = data.metrics;
  const d = m.http_req_duration?.values ?? {};
  const t = umbrales(data);
  const ok = t.every((x) => x.ok);
  const lineas = [
    `## ${titulo} — ${ok ? '✅ umbrales cumplidos' : '❌ umbrales NO cumplidos'}`,
    '',
    `Duración real: ${(data.state.testRunDurationMs / 1000).toFixed(0)} s · VUs máximos: ${m.vus_max?.values.max} · destino: \`${baseUrl}\``,
    '',
    '| Métrica | Valor |',
    '| --- | --- |',
    `| Solicitudes totales | ${m.http_reqs?.values.count} (${Number(m.http_reqs?.values.rate).toFixed(1)}/s) |`,
    `| Latencia promedio | ${ms(d.avg)} |`,
    `| Latencia p90 / p95 / p99 | ${ms(d['p(90)'])} / ${ms(d['p(95)'])} / ${ms(d['p(99)'])} |`,
    `| Latencia máxima | ${ms(d.max)} |`,
    `| Tasa de error (5xx, timeouts) | ${pct(m.http_req_failed?.values.rate)} |`,
    `| Checks correctos | ${pct(m.checks?.values.rate)} |`,
    '',
    '**Umbrales**',
    '',
    '| Métrica | Condición | Resultado |',
    '| --- | --- | --- |',
    ...t.map((x) => `| \`${x.metrica}\` | \`${x.expresion}\` | ${x.ok ? '✅' : '❌'} |`),
  ];

  const porEndpoint = Object.entries(m).filter(([k]) => k.startsWith('http_req_duration{endpoint:'));
  if (porEndpoint.length) {
    lineas.push('', '**Latencia por endpoint**', '', '| Endpoint | p95 | p99 | máx |', '| --- | --- | --- | --- |');
    for (const [k, v] of porEndpoint) {
      lineas.push(`| ${k.replace('http_req_duration{endpoint:', '').replace('}', '')} | ${ms(v.values['p(95)'])} | ${ms(v.values['p(99)'])} | ${ms(v.values.max)} |`);
    }
  }
  const deg = nombre === 'soak' ? degradacion(data) : null;
  if (nombre === 'soak') {
    lineas.push('');
    if (deg) {
      const alerta = deg.ratio > 1.5;
      lineas.push(
        `**Degradación en el tiempo:** p95 del primer cuarto ${ms(deg.inicio)} → p95 del último cuarto ${ms(deg.final)} (×${deg.ratio.toFixed(2)}) — ${alerta ? '⚠️ ALERTA: más de 1,5× (posible pérdida de recursos)' : '✅ sin degradación significativa (≤ 1,5×)'}`,
      );
    } else {
      lineas.push('**Degradación en el tiempo:** n/d (la corrida fue demasiado corta para comparar cuartos).');
    }
  }
  return lineas.join('\n');
}

export function escribirInforme({ baseUrl, k6Version }) {
  const partes = [`# Informe de pruebas de carga`, '', `Generado: ${new Date().toISOString()} · ${k6Version ?? ''}`, ''];
  let hay = false;
  for (const [nombre, titulo] of [['stress', 'Prueba de stress'], ['soak', 'Prueba de esfuerzo sostenido']]) {
    const f = `reports/load/${nombre}-summary.json`;
    if (!existsSync(f)) continue;
    hay = true;
    partes.push(seccion(nombre, titulo, JSON.parse(readFileSync(f, 'utf8')), baseUrl), '');
  }
  if (!hay) partes.push('No hay resúmenes de k6 todavía.');
  writeFileSync('reports/load/informe-carga.md', partes.join('\n'));
  console.log('[load] informe: reports/load/informe-carga.md');
}
