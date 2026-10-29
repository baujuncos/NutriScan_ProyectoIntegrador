// Lógica pura del quality gate. Sin I/O: la lee/escribe scripts/qa/quality-gate.mjs,
// y la prueba testing/qaScripts.test.ts. Se explica paso a paso en docs/GUIA_DEFENSA.md.

/** Umbrales del TP (nivel 3). Cambiarlos acá cambia el gate del pipeline. */
export const THRESHOLDS = {
  maxEslintErrors: 0, // "bugs críticos": cualquier error de ESLint bloquea
  maxDuplicationPct: 5, // duplicación mayor a 5 % bloquea
  minCoveragePct: 80, // cobertura (sentencias) sobre el código existente
  minNewCodeCoveragePct: 80, // cobertura sobre el código nuevo
};

const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * Líneas agregadas por un `git diff -U0`: Map<archivo, Set<número de línea nuevo>>.
 * Solo cuenta los `+` (las líneas borradas no necesitan cobertura).
 */
export function parseDiffAddedLines(diffText) {
  const added = new Map();
  let file = null;
  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      file = target === '/dev/null' ? null : norm(target.replace(/^b\//, ''));
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && file) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      if (!added.has(file)) added.set(file, new Set());
      for (let i = 0; i < count; i++) added.get(file).add(start + i);
    }
  }
  return added;
}

/**
 * Parsea un lcov.info: Map<archivo, { lines: Map<línea, hits>, branches: [{line, taken}] }>.
 * Las rutas se normalizan a relativas respecto de `root` y con "/".
 */
export function parseLcov(text, root = process.cwd()) {
  const files = new Map();
  const rootN = norm(root).replace(/\/$/, '');
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      let path = norm(line.slice(3));
      if (path.startsWith(rootN + '/')) path = path.slice(rootN.length + 1);
      current = { lines: new Map(), branches: [] };
      files.set(path, current);
    } else if (line.startsWith('DA:') && current) {
      const [n, hits] = line.slice(3).split(',');
      current.lines.set(Number(n), Number(hits));
    } else if (line.startsWith('BRDA:') && current) {
      const [n, , , taken] = line.slice(5).split(',');
      current.branches.push({ line: Number(n), taken: taken === '-' ? 0 : Number(taken) });
    } else if (line === 'end_of_record') {
      current = null;
    }
  }
  return files;
}

const pct = (covered, total) => (total === 0 ? 100 : Math.round((covered / total) * 10000) / 100);

/**
 * Cobertura SOLO de las líneas nuevas (las que agregó el diff) que son código
 * ejecutable. Una línea nueva sin entrada en el lcov (comentario, import de tipos,
 * archivo de test) no cuenta: no se puede cubrir ni descubrir.
 */
export function coverageOfNewCode(added, lcov, { only = (f) => f.startsWith('src/') } = {}) {
  let linesTotal = 0;
  let linesCovered = 0;
  let branchesTotal = 0;
  let branchesCovered = 0;
  const perFile = [];
  for (const [file, set] of added) {
    if (!only(file)) continue;
    const cov = lcov.get(file);
    let fTotal = 0;
    let fCovered = 0;
    const uncovered = [];
    if (cov) {
      for (const n of set) {
        if (!cov.lines.has(n)) continue;
        fTotal++;
        if (cov.lines.get(n) > 0) fCovered++;
        else uncovered.push(n);
      }
      for (const b of cov.branches) {
        if (!set.has(b.line)) continue;
        branchesTotal++;
        if (b.taken > 0) branchesCovered++;
      }
    }
    linesTotal += fTotal;
    linesCovered += fCovered;
    if (fTotal > 0) perFile.push({ file, total: fTotal, covered: fCovered, uncovered });
  }
  return {
    linesTotal,
    linesCovered,
    linesPct: pct(linesCovered, linesTotal),
    branchesTotal,
    branchesCovered,
    branchesPct: pct(branchesCovered, branchesTotal),
    perFile,
  };
}

/** Totales de un reporte `eslint -f json`. */
export function summarizeEslint(results) {
  let errors = 0;
  let warnings = 0;
  const byRule = {};
  for (const f of results) {
    errors += f.errorCount;
    warnings += f.warningCount;
    for (const m of f.messages) {
      if (m.severity !== 2) continue;
      byRule[m.ruleId ?? 'parse-error'] = (byRule[m.ruleId ?? 'parse-error'] ?? 0) + 1;
    }
  }
  return { files: results.length, errors, warnings, errorsByRule: byRule };
}

/**
 * Evalúa todos los checks. Cada uno: { id, name, value, threshold, ok, blocking, note }.
 * `inputs` puede omitir un reporte (p. ej. sin diff): ese check queda "sin datos" y no bloquea.
 */
export function evaluateGate(inputs, thresholds = THRESHOLDS) {
  const checks = [];
  const { eslint, duplicationPct, coveragePct, newCode, audit } = inputs;

  if (eslint) {
    checks.push({
      id: 'eslint-errors',
      name: 'Errores de ESLint (bugs críticos)',
      value: eslint.errors,
      threshold: `<= ${thresholds.maxEslintErrors}`,
      ok: eslint.errors <= thresholds.maxEslintErrors,
      blocking: true,
    });
  }
  if (duplicationPct !== undefined) {
    checks.push({
      id: 'duplication',
      name: 'Duplicación de código (%)',
      value: duplicationPct,
      threshold: `<= ${thresholds.maxDuplicationPct}`,
      ok: duplicationPct <= thresholds.maxDuplicationPct,
      blocking: true,
    });
  }
  if (coveragePct !== undefined) {
    checks.push({
      id: 'coverage',
      name: 'Cobertura de sentencias, todo src/ (%)',
      value: coveragePct,
      threshold: `>= ${thresholds.minCoveragePct}`,
      ok: coveragePct >= thresholds.minCoveragePct,
      blocking: true,
    });
  }
  if (newCode) {
    checks.push({
      id: 'new-code-coverage',
      name: 'Cobertura sobre código nuevo (%)',
      value: newCode.linesPct,
      threshold: `>= ${thresholds.minNewCodeCoveragePct}`,
      ok: newCode.linesPct >= thresholds.minNewCodeCoveragePct,
      blocking: true,
      note: newCode.linesTotal === 0 ? 'sin líneas ejecutables nuevas en src/' : `${newCode.linesCovered}/${newCode.linesTotal} líneas`,
    });
  }
  if (audit) {
    checks.push({
      id: 'audit-critical',
      name: 'Vulnerabilidades críticas en dependencias de producción (npm audit)',
      value: audit.critical,
      threshold: '== 0',
      ok: audit.critical === 0,
      blocking: false,
      note: `high: ${audit.high}, moderate: ${audit.moderate}, low: ${audit.low}`,
    });
  }
  const passed = checks.every((c) => c.ok || !c.blocking);
  return { passed, checks };
}

export function renderGateMarkdown(result, meta = {}) {
  const rows = result.checks.map(
    (c) =>
      `| ${c.name} | ${c.value} | ${c.threshold} | ${c.ok ? '✅' : c.blocking ? '❌ BLOQUEA' : '⚠️ aviso'} |${c.note ? ` ${c.note}` : ''}`,
  );
  return [
    `# Quality gate — ${result.passed ? '✅ APROBADO' : '❌ RECHAZADO'}`,
    '',
    meta.commit ? `Commit: \`${meta.commit}\`${meta.base ? ` (base de comparación: \`${meta.base}\`)` : ''}` : '',
    '',
    '| Chequeo | Valor | Umbral | Resultado | Nota |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ]
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n');
}
