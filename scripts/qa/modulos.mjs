#!/usr/bin/env node
// Tabla de cobertura de sentencia y de decisión (ramas) por módulo, leída de coverage/coverage-summary.json.
// Uso: node scripts/qa/modulos.mjs > docs/evidencia/cobertura-modulos.md
import { readFileSync } from 'node:fs';

const MODULOS = [
  ['src/lib/calculations.ts', 'Cálculos TMB / GET / macros'],
  ['src/lib/dates.ts', 'Fechas de nacimiento y edad'],
  ['src/lib/password.ts', 'Reglas de contraseña'],
  ['src/lib/macros.ts', 'Macros por 100 g y mezcla'],
  ['src/lib/chat/rateLimit.ts', 'Límite de requests'],
  ['src/lib/secretEquals.ts', 'Comparación de secretos'],
  ['src/lib/supabase/findUserByEmail.ts', 'Búsqueda paginada de usuario'],
  ['src/app/api/send-reminders/route.ts', 'API recordatorios (DEF-002)'],
  ['src/app/api/admin/delete-account-by-email/route.ts', 'API borrado por email (DEF-003)'],
  ['src/app/api/validate-investigator/route.ts', 'API código de investigador (DEF-005)'],
  ['src/app/api/chat/meal/route.ts', 'API chat con IA'],
  ['src/app/api/delete-account/route.ts', 'API borrado de cuenta'],
  ['src/app/api/auth/provider-hint/route.ts', 'API pista de proveedor'],
  ['src/app/home/actions.ts', 'Acción de hidratación (DEF-008)'],
  ['src/proxy.ts', 'Middleware de sesión y onboarding'],
  ['src/lib/geminiClient.ts', 'Cliente Gemini (visión)'],
  ['src/lib/openFoodFacts.ts', 'Cliente Open Food Facts'],
];

const s = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
const root = process.cwd().replace(/\\/g, '/');
const byPath = new Map(Object.entries(s).map(([k, v]) => [k.replace(/\\/g, '/').replace(root + '/', ''), v]));

const lineas = [
  '| Módulo | Qué es | Sentencias | Decisiones (ramas) |',
  '| --- | --- | --- | --- |',
];
for (const [ruta, desc] of MODULOS) {
  const v = byPath.get(ruta);
  if (!v) continue;
  const f = (x) => `${x.pct} % (${x.covered}/${x.total})`;
  lineas.push(`| \`${ruta}\` | ${desc} | ${f(v.statements)} | ${f(v.branches)} |`);
}
const t = s.total;
lineas.push(
  `| **Todo \`src/\`** | | **${t.statements.pct} %** (${t.statements.covered}/${t.statements.total}) | **${t.branches.pct} %** (${t.branches.covered}/${t.branches.total}) |`,
);
console.log(lineas.join('\n'));
