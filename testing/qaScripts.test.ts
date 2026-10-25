// Pruebas del quality gate (scripts/qa/lib.mjs): el gate es código y se prueba como tal.
// Casos con clases de equivalencia y valores límite documentados en docs/casos-de-prueba.md (grupo QG).
import { describe, expect, it } from 'vitest';
import {
  THRESHOLDS,
  coverageOfNewCode,
  evaluateGate,
  parseDiffAddedLines,
  parseLcov,
  renderGateMarkdown,
  summarizeEslint,
} from '../scripts/qa/lib.mjs';

describe('parseDiffAddedLines', () => {
  it('devuelve las líneas agregadas de un hunk con rango explícito', () => {
    // Arrange
    const diff = ['+++ b/src/lib/a.ts', '@@ -10,0 +11,3 @@', '+uno', '+dos', '+tres'].join('\n');
    // Act
    const added = parseDiffAddedLines(diff);
    // Assert
    expect([...(added.get('src/lib/a.ts') ?? [])]).toEqual([11, 12, 13]);
  });

  it('un hunk sin cantidad (+N) cuenta una sola línea', () => {
    const added = parseDiffAddedLines(['+++ b/src/x.ts', '@@ -5 +5 @@', '+x'].join('\n'));
    expect([...(added.get('src/x.ts') ?? [])]).toEqual([5]);
  });

  it('un hunk de solo borrado (+N,0) no agrega líneas', () => {
    const added = parseDiffAddedLines(['+++ b/src/x.ts', '@@ -5,2 +4,0 @@', '-a', '-b'].join('\n'));
    expect(added.get('src/x.ts')?.size ?? 0).toBe(0);
  });

  it('ignora archivos borrados (+++ /dev/null)', () => {
    const added = parseDiffAddedLines(['+++ /dev/null', '@@ -1,2 +0,0 @@'].join('\n'));
    expect(added.size).toBe(0);
  });
});

describe('parseLcov', () => {
  const lcov = ['SF:C:\\repo\\src\\lib\\a.ts', 'DA:1,1', 'DA:2,0', 'BRDA:2,0,0,1', 'BRDA:2,0,1,-', 'end_of_record'].join('\n');

  it('normaliza rutas de Windows a relativas con "/"', () => {
    const files = parseLcov(lcov, 'C:\\repo');
    expect([...files.keys()]).toEqual(['src/lib/a.ts']);
  });

  it('lee hits por línea y ramas (rama "-" cuenta como no tomada)', () => {
    const f = parseLcov(lcov, 'C:\\repo').get('src/lib/a.ts')!;
    expect(f.lines.get(1)).toBe(1);
    expect(f.lines.get(2)).toBe(0);
    expect(f.branches).toEqual([
      { line: 2, taken: 1 },
      { line: 2, taken: 0 },
    ]);
  });
});

describe('coverageOfNewCode', () => {
  const lcov = parseLcov(['SF:src/a.ts', 'DA:1,1', 'DA:2,1', 'DA:3,0', 'DA:4,0', 'BRDA:3,0,0,0', 'BRDA:3,0,1,1', 'end_of_record'].join('\n'), '/r');

  it('cuenta solo líneas nuevas ejecutables (la 9 no está en el lcov y se ignora)', () => {
    const r = coverageOfNewCode(new Map([['src/a.ts', new Set([1, 3, 9])]]), lcov);
    expect(r.linesTotal).toBe(2);
    expect(r.linesCovered).toBe(1);
    expect(r.linesPct).toBe(50);
  });

  it('valor límite: exactamente 80 % (4 de 5) cumple el umbral', () => {
    const l = parseLcov(['SF:src/b.ts', 'DA:1,1', 'DA:2,1', 'DA:3,1', 'DA:4,1', 'DA:5,0', 'end_of_record'].join('\n'), '/r');
    const r = coverageOfNewCode(new Map([['src/b.ts', new Set([1, 2, 3, 4, 5])]]), l);
    expect(r.linesPct).toBe(80);
    expect(evaluateGate({ newCode: r }).passed).toBe(true);
  });

  it('valor límite: 79.99 % no cumple', () => {
    expect(evaluateGate({ newCode: { linesPct: 79.99, linesTotal: 10, linesCovered: 8 } }).passed).toBe(false);
  });

  it('sin líneas ejecutables nuevas el resultado es 100 % (nada que cubrir)', () => {
    const r = coverageOfNewCode(new Map([['src/a.ts', new Set([50])]]), lcov);
    expect(r.linesTotal).toBe(0);
    expect(r.linesPct).toBe(100);
  });

  it('ignora archivos fuera de src/ (p. ej. tests) y mide las ramas de las líneas nuevas', () => {
    const r = coverageOfNewCode(
      new Map([
        ['testing/a.test.ts', new Set([1, 2])],
        ['src/a.ts', new Set([3])],
      ]),
      lcov,
    );
    expect(r.linesTotal).toBe(1);
    expect(r.branchesTotal).toBe(2);
    expect(r.branchesCovered).toBe(1);
    expect(r.branchesPct).toBe(50);
  });
});

describe('evaluateGate — tabla de decisión', () => {
  const bueno = {
    eslint: { errors: 0, warnings: 3 },
    duplicationPct: 2.5,
    coveragePct: 85,
    newCode: { linesPct: 90, linesTotal: 10, linesCovered: 9 },
    audit: { critical: 0, high: 1, moderate: 0, low: 0 },
  };

  it('R1: todo en regla → aprobado', () => {
    expect(evaluateGate(bueno).passed).toBe(true);
  });

  it.each([
    ['R2: un error de ESLint', { eslint: { errors: 1, warnings: 0 } }],
    ['R3: duplicación 5.01 %', { duplicationPct: 5.01 }],
    ['R4: cobertura global 79.99 %', { coveragePct: 79.99 }],
    ['R5: cobertura de código nuevo 79 %', { newCode: { linesPct: 79, linesTotal: 100, linesCovered: 79 } }],
  ])('%s → rechazado', (_nombre, cambio) => {
    expect(evaluateGate({ ...bueno, ...cambio }).passed).toBe(false);
  });

  it('valor límite: duplicación exactamente 5 % es aceptable', () => {
    expect(evaluateGate({ ...bueno, duplicationPct: THRESHOLDS.maxDuplicationPct }).passed).toBe(true);
  });

  it('una vulnerabilidad crítica avisa pero no bloquea', () => {
    const r = evaluateGate({ ...bueno, audit: { critical: 1, high: 0, moderate: 0, low: 0 } });
    expect(r.passed).toBe(true);
    expect(r.checks.find((c) => c.id === 'audit-critical')?.ok).toBe(false);
  });

  it('sin ningún reporte no hay checks y no bloquea', () => {
    expect(evaluateGate({})).toEqual({ passed: true, checks: [] });
  });
});

describe('summarizeEslint y renderGateMarkdown', () => {
  it('suma errores y warnings y agrupa los errores por regla', () => {
    const s = summarizeEslint([
      { errorCount: 2, warningCount: 1, messages: [{ severity: 2, ruleId: 'a' }, { severity: 2, ruleId: 'a' }, { severity: 1, ruleId: 'b' }] },
      { errorCount: 1, warningCount: 0, messages: [{ severity: 2, ruleId: null }] },
    ]);
    expect(s).toEqual({ files: 2, errors: 3, warnings: 1, errorsByRule: { a: 2, 'parse-error': 1 } });
  });

  it('el markdown indica aprobado/rechazado y el commit', () => {
    const md = renderGateMarkdown(evaluateGate({ duplicationPct: 9 }), { commit: 'abc1234' });
    expect(md).toContain('RECHAZADO');
    expect(md).toContain('abc1234');
    expect(md).toContain('BLOQUEA');
  });
});
