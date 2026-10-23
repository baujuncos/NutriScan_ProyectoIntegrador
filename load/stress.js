// PRUEBA DE STRESS: se sube la carga por escalones hasta llevar el sistema más allá del uso normal
// para ver CUÁNDO y CÓMO se degrada (latencia, errores) y si se recupera al bajar.
//
//   k6 run load/stress.js -e BASE_URL=https://mi-app.vercel.app
//   (o `npm run load:stress`, que además genera el informe)
//
// Variables: BASE_URL, STRESS_PEAK (VUs en el pico, 100 por defecto), STRESS_STEP (duración de cada escalón, 1m).
// Umbrales (docs/pruebas-de-carga.md explica de dónde salen):
//   · errores (5xx/timeouts) < 5 %      · p95 < 2000 ms      · p99 < 5000 ms      · checks > 95 %
import { Trend } from 'k6/metrics';
import { trafico, resumen } from './common.js';

const PICO = Number(__ENV.STRESS_PEAK || 100);
const PASO = __ENV.STRESS_STEP || '1m';

export const latenciaPorEscalon = new Trend('latencia_escalon', true);

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      startVUs: 1,
      gracefulRampDown: '15s',
      stages: [
        { duration: PASO, target: Math.round(PICO * 0.1) }, // carga ligera
        { duration: PASO, target: Math.round(PICO * 0.3) },
        { duration: PASO, target: Math.round(PICO * 0.6) },
        { duration: PASO, target: PICO }, // pico
        { duration: PASO, target: PICO }, // se sostiene el pico
        { duration: '30s', target: 0 }, // recuperación
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    'http_req_duration{endpoint:login}': ['p(95)<2000'],
    'http_req_duration{endpoint:manifest}': ['p(95)<2000'],
    'http_req_duration{endpoint:home_sin_sesion}': ['p(95)<2000'],
    'http_req_duration{endpoint:chat_sin_token}': ['p(95)<2000'],
    checks: ['rate>0.95'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  trafico((ms) => latenciaPorEscalon.add(ms));
}

export function handleSummary(data) {
  return resumen('stress', data);
}
