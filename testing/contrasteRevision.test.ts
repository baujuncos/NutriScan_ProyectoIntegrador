/**
 * NUT-119 — Legibilidad del "Revisar alimento" rediseñado: contraste de los colores de texto
 * (WCAG 2.x, AA = 4,5:1 para texto normal) y barrido del código para que no vuelvan los grises claros.
 * Los hex son los de la paleta de Tailwind v4/v3 que usan las clases (jsdom no evalúa estilos).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

const BLANCO = '#ffffff';
const SLATE = { 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 500: '#64748b', 600: '#475569', 700: '#334155', 900: '#0f172a' };

// [descripción, color del texto, fondo]
const PARES: Array<[string, string, string]> = [
  ['texto principal slate-900 / blanco', SLATE[900], BLANCO],
  ['texto secundario slate-600 / blanco', SLATE[600], BLANCO],
  ['texto secundario slate-600 / slate-50 (columna de contexto)', SLATE[600], SLATE[50]],
  ['texto secundario slate-600 / slate-100 (etiquetas, macros)', SLATE[600], SLATE[100]],
  ['ayudas slate-500 / blanco (sólo sobre blanco)', SLATE[500], BLANCO],
  ['enlace y selección blue-700 / blanco', '#1d4ed8', BLANCO],
  ['chip blue-700 / blue-50', '#1d4ed8', '#eff6ff'],
  ['botón principal: blanco / blue-700 (inicio del degradé)', BLANCO, '#1d4ed8'],
  ['botón principal: blanco / teal-700 (fin del degradé)', BLANCO, '#0f766e'],
  ['botón Validar deshabilitado slate-600 / slate-200', SLATE[600], SLATE[200]],
  ['aviso "Sin guardar" amber-700 / amber-50', '#b45309', '#fffbeb'],
  ['advertencia amber-800 / amber-50', '#92400e', '#fffbeb'],
  ['pie: pendiente amber-700 / blanco', '#b45309', BLANCO],
  ['error red-700 / blanco', '#b91c1c', BLANCO],
  ['error red-700 / red-50', '#b91c1c', '#fef2f2'],
  ['listo para validar green-800 / blanco', '#166534', BLANCO],
  ['etiqueta SARA2 blue-700 / blue-50', '#1d4ed8', '#eff6ff'],
  ['etiqueta ANMAT green-800 / green-50', '#166534', '#f0fdf4'],
  ['etiqueta PROPIO violet-800 / violet-50', '#5b21b6', '#f5f3ff'],
  ['placeholder slate-500 / blanco', SLATE[500], BLANCO],
];

describe('contraste de los colores de texto del Revisar alimento (AA = 4,5:1)', () => {
  it.each(PARES)('%s', (_nombre, texto, fondo) => {
    expect(contraste(texto, fondo)).toBeGreaterThanOrEqual(4.5);
  });

  it('el chequeo detecta lo que el diseño original tenía flojo (gris deshabilitado slate-500 / slate-200 y slate-500 / slate-100)', () => {
    expect(contraste(SLATE[500], SLATE[200])).toBeLessThan(4.5); // 3,86
    expect(contraste(SLATE[500], SLATE[100])).toBeLessThan(4.5); // 4,34
  });
});

describe('barrido del código: sin grises claros para texto', () => {
  const ARCHIVOS = [
    'src/app/(researcher)/validacion/HojaRevision.tsx',
    'src/app/(researcher)/validacion/ContextoComidas.tsx',
    'src/app/(researcher)/validacion/TarjetaResultado.tsx',
    'src/app/(researcher)/validacion/PendienteDetalle.tsx',
    'src/app/(researcher)/validacion/ComposicionCatalogo.tsx',
    'src/app/(researcher)/validacion/NuevoAlimentoPropio.tsx',
  ];
  // text-/placeholder-slate|gray-{300,400}: 2,5:1 o menos sobre blanco. slate-500 sólo se permite sobre blanco (revisión manual).
  const PROHIBIDAS = /\b(?:text|placeholder)-(?:slate|gray|zinc|neutral)-(?:200|300|400)\b/;

  it.each(ARCHIVOS)('%s no usa text/placeholder-slate-300/400', (archivo) => {
    expect(readFileSync(archivo, 'utf8')).not.toMatch(PROHIBIDAS);
  });

  it.each(ARCHIVOS)('%s no usa slate-500 sobre fondos grises (bg-slate-50/100/200 en la misma línea)', (archivo) => {
    const lineas = readFileSync(archivo, 'utf8').split('\n');
    const malas = lineas.filter((l) => /\btext-slate-500\b/.test(l) && /\bbg-slate-(?:50|100|200)\b/.test(l));
    expect(malas).toEqual([]);
  });
});
