// NUT-188 — Muestra cómo decide el matcher contra SARA2 para ingredientes de ejemplo.
// NO llama a Gemini (no gasta cuota): solo lee el catálogo SARA2 de Supabase (anon key).
//
//   npx tsx --env-file=.env.local scripts/preview-sara2-matching.ts                    # lista de ejemplo
//   npx tsx --env-file=.env.local scripts/preview-sara2-matching.ts "pan lactal" "palta"  # los que quieras
//   npx tsx --env-file=.env.local scripts/preview-sara2-matching.ts --min-score=0.7 --min-margin=0.05
//
// Útil para ajustar MATCH_MIN_SCORE / MATCH_MIN_MARGIN (src/lib/chat/sara2Matcher.ts).

import { createClient } from '@supabase/supabase-js';
import { createSupabaseSara2Catalog } from '../src/lib/chat/sara2Catalog';
import { MATCH_MIN_MARGIN, MATCH_MIN_SCORE, matchIngredient, type ScoredFood } from '../src/lib/chat/sara2Matcher';

const EXAMPLES = [
  // Nombres exactos o casi exactos
  'banana', 'palta', 'fernet', 'jamón cocido', 'queso de máquina', 'queso crema', 'arroz blanco hervido', 'pollo sin piel grillado',
  // Genéricos: hay varias variantes en el catálogo
  'arroz hervido', 'pollo grillado', 'queso', 'leche entera', 'fideos hervidos', 'tostada', 'factura', 'milanesa',
  // El caso real que originó el cambio
  'tostada de pan blanco', 'pan blanco', 'pan lactal', 'pan integral', 'pan francés',
  // Sin equivalente en SARA2
  'huevo revuelto', 'huevo hervido', 'café', 'gaseosa cola', 'empanada de carne', 'salsa tuco', 'mate cocido', 'papa frita',
];

const fmt = (x: ScoredFood | null) => (x ? `${x.score.toFixed(2)} ${x.food.nombre.replace(/\s+/g, ' ').slice(0, 46)}` : '-');

async function main() {
  const args = process.argv.slice(2);
  const num = (flag: string) => {
    const raw = args.find((a) => a.startsWith(`--${flag}=`));
    return raw ? Number(raw.split('=')[1]) : undefined;
  };
  const minScore = num('min-score') ?? MATCH_MIN_SCORE;
  const minMargin = num('min-margin') ?? MATCH_MIN_MARGIN;
  const ingredients = args.filter((a) => !a.startsWith('--'));

  const supabase = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_ANON_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const foods = await createSupabaseSara2Catalog(supabase).getAll();
  console.log(`Catálogo SARA2: ${foods.length} alimentos | umbral: score >= ${minScore}, margen >= ${minMargin}\n`);

  console.log('| ingrediente | decisión | mejor candidato | segundo |');
  console.log('|---|---|---|---|');
  for (const ingredient of ingredients.length ? ingredients : EXAMPLES) {
    const d = matchIngredient(ingredient, foods, { minScore, minMargin });
    const verdict = d.reason === 'accepted' ? '✅ sara2' : `❌ estimado_ia (${d.reason})`;
    console.log(`| ${ingredient} | ${verdict} | ${fmt(d.best)} | ${fmt(d.second)} |`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
