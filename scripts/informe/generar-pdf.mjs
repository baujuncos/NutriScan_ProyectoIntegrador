#!/usr/bin/env node
// Genera docs/informe/informe-final.pdf a partir de docs/informe/informe-final.md.
// Markdown -> HTML con `marked`, HTML -> PDF con Edge o Chrome en modo headless (sin dependencias extra).
//   npm run informe:pdf            (BROWSER_BIN=<ruta> para usar otro navegador)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { marked } from 'marked';

const fuente = 'docs/informe/informe-final.md';
const html = 'reports/informe/informe-final.html';
const pdf = resolve('docs/informe/informe-final.pdf');

const candidatos = [
  process.env.BROWSER_BIN,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const navegador = candidatos.find((p) => existsSync(p));
if (!navegador) {
  console.error('No se encontró Edge/Chrome. Definí BROWSER_BIN con la ruta del ejecutable.');
  process.exit(2);
}

const css = `
  @page { size: A4; margin: 18mm 15mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #1a1a1a; }
  h1 { font-size: 20pt; border-bottom: 3px solid #2563eb; padding-bottom: 6px; }
  h2 { font-size: 14pt; color: #1d4ed8; margin-top: 22px; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; page-break-after: avoid; }
  h3 { font-size: 11.5pt; page-break-after: avoid; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 12px; font-size: 9pt; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 6px; vertical-align: top; }
  th { background: #eff6ff; text-align: left; }
  code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 9pt; }
  pre { background: #f1f5f9; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 8.5pt; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #f59e0b; background: #fffbeb; margin: 8px 0; padding: 4px 12px; }
  a { color: #1d4ed8; text-decoration: none; }
`;

const cuerpo = marked.parse(readFileSync(fuente, 'utf8'), { gfm: true });
mkdirSync('reports/informe', { recursive: true });
writeFileSync(html, `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe final — NutriScan</title><style>${css}</style></head><body>${cuerpo}</body></html>`);

const r = spawnSync(
  navegador,
  ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, pathToFileURL(resolve(html)).href],
  { encoding: 'utf8' },
);
if (!existsSync(pdf)) {
  console.error('No se generó el PDF.', r.stderr);
  process.exit(1);
}
console.log(`PDF generado: ${pdf}`);
