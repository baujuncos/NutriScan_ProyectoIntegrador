// PRUEBA DE ESFUERZO SOSTENIDO (soak): carga moderada y CONSTANTE durante un rato largo para detectar
// lo que un pico corto no muestra: pérdidas de memoria, crecimiento de latencia, errores que aparecen con el tiempo.
//
//   k6 run load/soak.js -e BASE_URL=https://mi-app.vercel.app -e SOAK_DURATION=30m
//   (o `npm run load:soak`, que además genera el informe)
//
// Variables: BASE_URL, SOAK_VUS (20 por defecto), SOAK_DURATION (10m por defecto).
// Umbrales (más estrictos que en stress porque la carga es la esperada en uso real):
//   · errores < 1 %   · p95 < 1000 ms   · p99 < 2500 ms   · checks > 99 %
// Degradación: se compara la latencia del primer cuarto contra la del último (métricas soak_inicio / soak_final);
// el informe marca una alerta si el último cuarto es más de 1,5× el primero.
import { Trend } from 'k6/metrics';
import { trafico, resumen } from './common.js';

const VUS = Number(__ENV.SOAK_VUS || 20);
const DURACION = __ENV.SOAK_DURATION || '10m';

function aSegundos(txt) {
  const m = /^(\d+)(s|m|h)$/.exec(txt);
  if (!m) throw new Error(`SOAK_DURATION inválida: ${txt} (ej. 30s, 10m, 1h)`);
  return Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2]];
}
const TOTAL_S = aSegundos(DURACION);

const inicio = new Trend('soak_inicio', true);
const final = new Trend('soak_final', true);
let arranque = 0;

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURACION,
      gracefulStop: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000', 'p(99)<2500'],
    'http_req_duration{endpoint:login}': ['p(95)<1000'],
    'http_req_duration{endpoint:manifest}': ['p(95)<1000'],
    'http_req_duration{endpoint:home_sin_sesion}': ['p(95)<1000'],
    'http_req_duration{endpoint:chat_sin_token}': ['p(95)<1000'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  if (!arranque) arranque = Date.now();
  const transcurrido = (Date.now() - arranque) / 1000;
  trafico((ms) => {
    if (transcurrido < TOTAL_S * 0.25) inicio.add(ms);
    else if (transcurrido > TOTAL_S * 0.75) final.add(ms);
  });
}

export function handleSummary(data) {
  return resumen('soak', data);
}
