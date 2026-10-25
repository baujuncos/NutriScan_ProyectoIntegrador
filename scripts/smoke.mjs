#!/usr/bin/env node
// Smoke test: ¿el despliegue arrancó y sus piezas críticas responden? Corre en segundos,
// sin dependencias (Node 18+) y SIN credenciales de usuario: solo toca endpoints públicos.
//
// Uso:
//   BASE_URL=https://mi-app.vercel.app node scripts/smoke.mjs
//   node scripts/smoke.mjs --base-url http://localhost:3000
// Opcionales (si están, también verifica Supabase directamente):
//   SUPABASE_URL, SUPABASE_ANON_KEY
//   VERCEL_BYPASS_SECRET  → header para saltar la protección de los previews de Vercel
// Salida: tabla en consola + reports/smoke.json + reports/smoke.md. Exit 1 si algo falla.
import { mkdirSync, writeFileSync } from 'node:fs';

const argUrl = process.argv.includes('--base-url') ? process.argv[process.argv.indexOf('--base-url') + 1] : undefined;
const BASE_URL = (argUrl || process.env.BASE_URL || process.env.E2E_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20_000);

const bypass = process.env.VERCEL_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS_SECRET } : {};

async function http(path, { method = 'GET', headers = {}, body, redirect = 'manual', base = BASE_URL } = {}) {
  const started = Date.now();
  const res = await fetch(base + path, {
    method,
    headers: { ...bypass, ...headers },
    body,
    redirect,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, ms: Date.now() - started };
}

const json = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** Cada check devuelve un string con el detalle si pasa, o lanza Error si falla. */
const checks = [
  {
    name: 'La página de login responde 200 y es NutriScan',
    run: async () => {
      const r = await http('/login');
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      if (!/NutriScan/i.test(r.text)) throw new Error('el HTML no menciona NutriScan');
      return `${r.ms} ms`;
    },
  },
  {
    name: 'El manifiesto PWA es válido',
    run: async () => {
      const r = await http('/manifest.webmanifest');
      const m = json(r.text);
      if (r.status !== 200 || m?.name !== 'NutriScan') throw new Error(`HTTP ${r.status}, name=${m?.name}`);
      return `${r.ms} ms`;
    },
  },
  {
    name: 'Una ruta protegida sin sesión redirige a /login (proxy activo)',
    run: async () => {
      const r = await http('/home');
      const loc = r.headers.get('location') || '';
      if (![302, 303, 307, 308].includes(r.status) || !loc.includes('/login')) throw new Error(`HTTP ${r.status}, location=${loc}`);
      return `${r.status} → ${loc}`;
    },
  },
  {
    name: 'API pública: /api/validate-investigator valida el cuerpo (400)',
    run: async () => {
      const r = await http('/api/validate-investigator', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (r.status !== 400 || json(r.text)?.valid !== false) throw new Error(`HTTP ${r.status}: ${r.text.slice(0, 120)}`);
      return `${r.ms} ms`;
    },
  },
  {
    name: 'API protegida: /api/chat/meal sin sesión responde 401 UNAUTHORIZED',
    run: async () => {
      const r = await http('/api/chat/meal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'una manzana' }] }),
      });
      if (r.status !== 401 || json(r.text)?.error?.code !== 'UNAUTHORIZED') throw new Error(`HTTP ${r.status}: ${r.text.slice(0, 120)}`);
      return `${r.ms} ms`;
    },
  },
  {
    name: 'Seguridad (DEF-002): /api/send-reminders sin credenciales responde 401',
    run: async () => {
      const r = await http('/api/send-reminders');
      if (r.status !== 401) throw new Error(`HTTP ${r.status} — el endpoint del cron NO está protegido`);
      return `${r.ms} ms`;
    },
  },
];

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  const sb = { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${SUPABASE_ANON_KEY}` };
  checks.push(
    {
      name: 'Supabase Auth responde (/auth/v1/health)',
      run: async () => {
        const r = await http('/auth/v1/health', { base: SUPABASE_URL, headers: sb });
        if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
        return `${r.ms} ms`;
      },
    },
    {
      name: 'Supabase REST: el catálogo de alimentos tiene datos',
      run: async () => {
        const r = await http('/rest/v1/alimentos?select=id_alimento&limit=1', { base: SUPABASE_URL, headers: sb });
        const rows = json(r.text);
        if (r.status !== 200 || !Array.isArray(rows) || rows.length !== 1) throw new Error(`HTTP ${r.status}: ${r.text.slice(0, 120)}`);
        return `${r.ms} ms`;
      },
    },
  );
}

const results = [];
for (const c of checks) {
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      const detail = await c.run();
      results.push({ name: c.name, ok: true, detail, attempts: attempt });
      break;
    } catch (e) {
      // Un reintento: un cold start de serverless no debería marcar el despliegue como roto.
      if (attempt < 2) continue;
      results.push({ name: c.name, ok: false, detail: String(e.message ?? e), attempts: attempt });
      break;
    }
  }
}

const failed = results.filter((r) => !r.ok);
const md = [
  `# Smoke test — ${failed.length === 0 ? '✅ OK' : '❌ FALLÓ'}`,
  '',
  `Destino: \`${BASE_URL}\` · ${new Date().toISOString()}`,
  '',
  '| Chequeo | Resultado | Detalle |',
  '| --- | --- | --- |',
  ...results.map((r) => `| ${r.name} | ${r.ok ? '✅' : '❌'} | ${r.detail}${r.attempts > 1 ? ' (reintento)' : ''} |`),
  '',
  `${results.length - failed.length}/${results.length} chequeos OK`,
].join('\n');

mkdirSync('reports', { recursive: true });
writeFileSync('reports/smoke.md', md);
writeFileSync('reports/smoke.json', JSON.stringify({ baseUrl: BASE_URL, at: new Date().toISOString(), results }, null, 2));
console.log(md);
process.exit(failed.length === 0 ? 0 : 1);
