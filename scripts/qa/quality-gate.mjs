#!/usr/bin/env node
// Quality gate del pipeline. Lee los reportes que generaron los pasos anteriores
// (eslint, jscpd, cobertura, npm audit) y el diff contra la rama base, y corta
// con exit 1 si algún chequeo bloqueante falla.
//
// Uso:  node scripts/qa/quality-gate.mjs [--base origin/main]
//
// Entradas (todas se generan con `npm run qa:reports`):
//   reports/eslint.json            eslint -f json
//   reports/jscpd/jscpd-report.json
//   coverage/coverage-summary.json + coverage/lcov.info
//   reports/npm-audit.json         (opcional)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { evaluateGate, parseDiffAddedLines, parseLcov, coverageOfNewCode, renderGateMarkdown, summarizeEslint } from './lib.mjs';

const args = process.argv.slice(2);
const baseArg = args.includes('--base') ? args[args.indexOf('--base') + 1] : process.env.QA_BASE_REF || 'origin/main';

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

const inputs = {};

const eslintRaw = readJson('reports/eslint.json');
if (eslintRaw) inputs.eslint = summarizeEslint(eslintRaw);

const jscpd = readJson('reports/jscpd/jscpd-report.json');
if (jscpd) inputs.duplicationPct = Math.round(jscpd.statistics.total.percentage * 100) / 100;

const cov = readJson('coverage/coverage-summary.json');
if (cov) inputs.coveragePct = cov.total.statements.pct;

const audit = readJson('reports/npm-audit.json');
if (audit?.metadata?.vulnerabilities) inputs.audit = audit.metadata.vulnerabilities;

let commit = 'desconocido';
let base = null;
try {
  commit = git('rev-parse', '--short', 'HEAD');
  base = git('merge-base', 'HEAD', baseArg);
  if (existsSync('coverage/lcov.info')) {
    // Compara contra el árbol de trabajo: en CI es igual a HEAD; en local incluye lo no commiteado.
    const diff = git('diff', '-U0', '--no-color', base, '--', 'src');
    const lcov = parseLcov(readFileSync('coverage/lcov.info', 'utf8'));
    inputs.newCode = coverageOfNewCode(parseDiffAddedLines(diff), lcov);
  }
} catch (e) {
  console.warn(`[quality-gate] no se pudo calcular la cobertura de código nuevo contra "${baseArg}": ${e.message}`);
}

const result = evaluateGate(inputs);
const md = renderGateMarkdown(result, { commit, base: base ? `${baseArg} @ ${base.slice(0, 7)}` : undefined });

mkdirSync('reports', { recursive: true });
writeFileSync('reports/quality-gate.md', md);
writeFileSync('reports/quality-gate.json', JSON.stringify({ ...result, inputs: { ...inputs, eslint: inputs.eslint && { ...inputs.eslint } } }, null, 2));
console.log(md);
if (inputs.newCode?.perFile?.length) {
  console.log('\nCódigo nuevo por archivo:');
  for (const f of inputs.newCode.perFile) {
    console.log(` - ${f.file}: ${f.covered}/${f.total}${f.uncovered.length ? ` (sin cubrir: ${f.uncovered.join(', ')})` : ''}`);
  }
}
process.exit(result.passed ? 0 : 1);
