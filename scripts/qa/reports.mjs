#!/usr/bin/env node
// Genera los reportes de análisis estático que consume el quality gate:
//   reports/eslint.json            ESLint (errores = bugs críticos)
//   reports/jscpd/                 duplicación de código (jscpd, config en .jscpd.json)
//   reports/npm-audit.json         vulnerabilidades de dependencias (npm audit)
// Los pasos NO cortan el proceso aunque encuentren problemas: el que decide si el
// pipeline falla es el quality gate (scripts/qa/quality-gate.mjs), así el reporte
// siempre queda completo.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('reports', { recursive: true });
const shell = process.platform === 'win32';

function run(label, cmd, args) {
  const started = Date.now();
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell, maxBuffer: 256 * 1024 * 1024 });
  console.log(`[reports] ${label}: exit ${r.status} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  return r;
}

run('eslint', 'npx', ['eslint', '.', '-f', 'json', '-o', 'reports/eslint.json']);
run('jscpd', 'npx', ['jscpd']);
const audit = run('npm audit (solo producción)', 'npm', ['audit', '--omit=dev', '--json']);
writeFileSync('reports/npm-audit.json', audit.stdout || '{}');
