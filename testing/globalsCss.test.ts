/**
 * iOS hace zoom al enfocar campos con letra < 16px: la regla global que lo evita
 * es CSS puro (jsdom no lo evalúa), así que se fija que siga existiendo.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('globals.css — sin zoom automático en iOS', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');

  it('fuerza 16px en inputs/textarea/select de pantallas táctiles, fuera de @layer', () => {
    const m = css.match(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/);
    expect(m![1]).toMatch(/textarea/);
    expect(m![1]).toMatch(/select/);
    expect(m![1]).toMatch(/font-size:\s*16px/);
    // Dentro de un @layer perdería contra las utilidades de Tailwind (text-sm).
    expect(css.slice(0, css.indexOf('@media (pointer: coarse)'))).not.toMatch(/@layer[^{]*\{[^}]*$/);
  });

  it('no bloquea el zoom del usuario en el viewport (accesibilidad)', () => {
    const layout = readFileSync('src/app/layout.tsx', 'utf8');
    expect(layout).not.toMatch(/maximumScale|userScalable/);
  });
});
