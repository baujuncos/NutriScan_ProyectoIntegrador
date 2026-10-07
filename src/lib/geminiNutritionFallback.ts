/**
 * NUT-119 — Fallback de Gemini: kcal y macros POR 100 g de los alimentos que
 * no se encontraron en `public.alimentos`. Una sola llamada batch de texto
 * (sin imagen) por comida. El escalado al gramaje lo hace nuestro código
 * (`macrosItem`), nunca Gemini. NO lanza: ante cualquier falla devuelve todo
 * `null` ("sin datos"), así el guardado nunca se rompe por Gemini.
 */
import { SchemaType, type Schema } from '@google/generative-ai';
import { z } from 'zod';
import { llamarGeminiJson } from './geminiClient';
import { macrosPlausibles, type Macros100 } from './macros';

// Presupuesto propio y corto: corre dentro de /save, que ya tiene maxDuration = 30.
const MAX_TOTAL_MS = 12_000;
const TIMEOUT_MS = 8_000;

export interface AlimentoAEstimar {
  nombre: string;
  categoria: string;
}

export interface EstimacionMacros {
  /** Mismo orden que la entrada; null = sin datos (Gemini falló, no lo conoce o no pasó la plausibilidad). */
  valores: (Macros100 | null)[];
  /** Modelo que respondió; null si no hubo llamada o falló. */
  modelo: string | null;
}

const SYSTEM_PROMPT = `
Sos el módulo de composición nutricional de NutriScan, una app de seguimiento nutricional. Recibís una lista numerada de alimentos (nombre y categoría) y devolvés, para cada uno, su aporte por 100 g de porción comestible tal como se describe en el nombre (cocido o crudo, con o sin piel, "al horno", "frito", etc.).

Reglas:
- Usá como referencia las tablas de composición de alimentos argentinas (SARA2 / ARGENFOODS) y, si no están, USDA.
- Devolvé kcal_100g, proteinas_100g, grasas_100g y carbs_100g en gramos (kcal en kcal), SIEMPRE por 100 g.
- Las kcal deben ser coherentes con 4 kcal/g de proteína, 4 kcal/g de hidratos de carbono y 9 kcal/g de grasa.
- Si no reconocés el alimento o no podés estimarlo con razonable confianza, devolvé null en los cuatro campos. No inventes.
- Devolvé un elemento por cada alimento, con el mismo "index" que recibiste.

Respondé ÚNICAMENTE con un JSON que cumpla el schema provisto.
`.trim();

const numeroONull = { type: SchemaType.NUMBER, nullable: true } as const;

const RESPONSE_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    items: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          index: { type: SchemaType.INTEGER },
          kcal_100g: numeroONull,
          proteinas_100g: numeroONull,
          grasas_100g: numeroONull,
          carbs_100g: numeroONull,
        },
        required: ['index', 'kcal_100g', 'proteinas_100g', 'grasas_100g', 'carbs_100g'],
      },
    },
  },
  required: ['items'],
};

const respuestaSchema = z.object({
  items: z.array(
    z.object({
      index: z.number().int(),
      kcal_100g: z.number().nullable(),
      proteinas_100g: z.number().nullable(),
      grasas_100g: z.number().nullable(),
      carbs_100g: z.number().nullable(),
    }),
  ),
});

type Respuesta = z.infer<typeof respuestaSchema>;

// Solo valida la FORMA (null → reintento con instrucción estricta); la
// plausibilidad se chequea después, por ítem, sin rechazar toda la respuesta.
function parsear(text: string): Respuesta | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = respuestaSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export async function estimarMacrosPor100g(alimentos: AlimentoAEstimar[]): Promise<EstimacionMacros> {
  if (alimentos.length === 0) return { valores: [], modelo: null };

  const lista = alimentos.map((a, i) => `${i}. ${a.nombre} (categoría: ${a.categoria})`).join('\n');

  try {
    const { resultado, modeloUsado } = await llamarGeminiJson<Respuesta>({
      systemInstruction: SYSTEM_PROMPT,
      contents: [{ role: 'user', parts: [{ text: `Estimá los valores por 100 g de estos alimentos:\n${lista}` }] }],
      responseSchema: RESPONSE_SCHEMA,
      parse: parsear,
      maxTotalMs: MAX_TOTAL_MS,
      timeoutMs: TIMEOUT_MS,
    });

    // Un índice repetido es ambiguo → ese ítem queda sin datos; no se adivina cuál vale.
    const porIndice = new Map<number, Respuesta['items'][number] | 'duplicado'>();
    for (const item of resultado.items) {
      porIndice.set(item.index, porIndice.has(item.index) ? 'duplicado' : item);
    }

    const valores = alimentos.map((_, i): Macros100 | null => {
      const item = porIndice.get(i);
      if (!item || item === 'duplicado') return null;
      const { kcal_100g, proteinas_100g, grasas_100g, carbs_100g } = item;
      if (kcal_100g == null || proteinas_100g == null || grasas_100g == null || carbs_100g == null) return null;
      const macros: Macros100 = { kcal_100g, proteinas_100g, grasas_100g, carbs_100g };
      return macrosPlausibles(macros) ? macros : null;
    });

    return { valores, modelo: modeloUsado };
  } catch (err) {
    console.error('Fallo la estimación de macros con Gemini:', err);
    return { valores: alimentos.map(() => null), modelo: null };
  }
}
