// Lo que comparten los escenarios de carga de k6. Se explica en docs/pruebas-de-carga.md.
//
// Mezcla de tráfico (aproxima el uso real SIN gastar cuota de Gemini ni escribir datos):
//   50 %  GET  /login                        página de entrada (render del servidor)
//   10 %  GET  /manifest.webmanifest         manifiesto PWA
//   20 %  GET  /home sin sesión              el proxy responde con un redirect a /login
//   20 %  POST /api/chat/meal sin token      la API rechaza con 401 (pasa por la ruta, la autenticación y el cliente de Supabase)
// Los 401 y los redirects son respuestas ESPERADAS: solo los 5xx y los timeouts cuentan como error.
import http from 'k6/http';
import { check, sleep } from 'k6';

export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const bypass = __ENV.VERCEL_BYPASS_SECRET ? { 'x-vercel-protection-bypass': __ENV.VERCEL_BYPASS_SECRET } : {};
const jsonHeaders = { 'Content-Type': 'application/json', ...bypass };

const CHAT_BODY = JSON.stringify({ messages: [{ role: 'user', content: 'una manzana' }] });

const esperado = {
  login: http.expectedStatuses(200),
  manifest: http.expectedStatuses(200),
  home: http.expectedStatuses({ min: 300, max: 399 }),
  chat401: http.expectedStatuses(401),
};

/** Una "iteración de usuario": elige un endpoint según los pesos de arriba y valida la respuesta. */
export function trafico(onLatency) {
  const r = Math.random();
  let res;
  let nombre;
  if (r < 0.5) {
    nombre = 'login';
    res = http.get(`${BASE_URL}/login`, { headers: bypass, tags: { endpoint: nombre }, responseCallback: esperado.login });
    check(res, { 'login: 200': (x) => x.status === 200 }, { endpoint: nombre });
  } else if (r < 0.6) {
    nombre = 'manifest';
    res = http.get(`${BASE_URL}/manifest.webmanifest`, { headers: bypass, tags: { endpoint: nombre }, responseCallback: esperado.manifest });
    check(res, { 'manifest: 200': (x) => x.status === 200 }, { endpoint: nombre });
  } else if (r < 0.8) {
    nombre = 'home_sin_sesion';
    res = http.get(`${BASE_URL}/home`, { headers: bypass, redirects: 0, tags: { endpoint: nombre }, responseCallback: esperado.home });
    check(res, { 'home sin sesión: redirige a /login': (x) => x.status >= 300 && x.status < 400 && String(x.headers['Location']).includes('/login') }, { endpoint: nombre });
  } else {
    nombre = 'chat_sin_token';
    res = http.post(`${BASE_URL}/api/chat/meal`, CHAT_BODY, { headers: jsonHeaders, tags: { endpoint: nombre }, responseCallback: esperado.chat401 });
    check(res, { 'chat sin token: 401': (x) => x.status === 401 }, { endpoint: nombre });
  }
  if (onLatency) onLatency(res.timings.duration);
  // Tiempo de "lectura" del usuario entre pedidos (0,3–1,0 s).
  sleep(0.3 + Math.random() * 0.7);
}

/** Resumen que k6 escribe al terminar: el JSON completo alimenta el informe (scripts/load/report.mjs). */
export function resumen(nombre, data) {
  return {
    [`reports/load/${nombre}-summary.json`]: JSON.stringify(data, null, 2),
    stdout: textoCorto(nombre, data),
  };
}

function textoCorto(nombre, data) {
  const m = data.metrics;
  const f = (x) => (x === undefined ? 'n/d' : Number(x).toFixed(1));
  const d = m.http_req_duration?.values ?? {};
  const lineas = [
    `\n=== ${nombre} ===`,
    `solicitudes: ${m.http_reqs?.values.count}  (${f(m.http_reqs?.values.rate)}/s)   VUs máx: ${m.vus_max?.values.max}`,
    `latencia ms → avg ${f(d.avg)} · p90 ${f(d['p(90)'])} · p95 ${f(d['p(95)'])} · p99 ${f(d['p(99)'])} · max ${f(d.max)}`,
    `errores (5xx/timeouts): ${(100 * (m.http_req_failed?.values.rate ?? 0)).toFixed(2)} %`,
    `checks OK: ${(100 * (m.checks?.values.rate ?? 1)).toFixed(2)} %`,
  ];
  for (const [k, t] of Object.entries(data.metrics)) {
    if (!t.thresholds) continue;
    for (const [expr, ok] of Object.entries(t.thresholds)) lineas.push(`  umbral ${k} ${expr}: ${ok ? 'FALLÓ ❌' : 'OK ✅'}`);
  }
  return lineas.join('\n') + '\n';
}
