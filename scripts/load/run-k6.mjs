#!/usr/bin/env node
// Corre un escenario de k6 (stress | soak), guarda el resumen JSON y genera el informe en Markdown.
//
//   node scripts/load/run-k6.mjs stress
//   BASE_URL=https://mi-app.vercel.app node scripts/load/run-k6.mjs soak
//
// k6 se busca en: variable K6_BIN → "k6" en el PATH. Instalación: docs/pruebas-de-carga.md.
// El código de salida es el de k6: 99 = algún umbral se cruzó (el pipeline falla), 0 = todo OK.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { escribirInforme } from './report.mjs';

const escenario = process.argv[2];
if (!['stress', 'soak'].includes(escenario)) {
  console.error('Uso: node scripts/load/run-k6.mjs <stress|soak>');
  process.exit(2);
}

const k6 = process.env.K6_BIN || 'k6';
const baseUrl = process.env.BASE_URL || process.env.E2E_BASE_URL || 'http://localhost:3000';

const version = spawnSync(k6, ['version'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (version.error || version.status !== 0) {
  console.error('No se encontró k6. Instalalo (https://grafana.com/docs/k6/latest/set-up/install-k6/) o apuntá K6_BIN al ejecutable.');
  process.exit(2);
}

mkdirSync('reports/load', { recursive: true });
console.log(`[load] ${version.stdout.trim()} · escenario ${escenario} · destino ${baseUrl}`);

const r = spawnSync(k6, ['run', `load/${escenario}.js`], {
  stdio: 'inherit',
  env: { ...process.env, BASE_URL: baseUrl },
  shell: process.platform === 'win32',
});

escribirInforme({ baseUrl, k6Version: version.stdout.trim() });
process.exit(r.status ?? 1);
