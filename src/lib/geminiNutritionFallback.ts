/**
 * NUT-119 — Resolutor de Gemini para los alimentos que no tuvieron match
 * exacto en el catálogo propio. Una sola llamada batch de texto (sin imagen):
 * por cada alimento, la IA ELIGE una entrada de la lista de SARA2 (+ validados
 * por investigadores) o, si no hay equivalente razonable, estima sus valores por
 * 100 g. El escalado al gramaje lo hace nuestro código (`macrosItem`), nunca Gemini.
 *
 * Elegir de una lista (en vez de buscar por similitud de texto) evita matches
 * absurdos como "huevo" → un huevo de chocolate de ANMAT, y entiende la
 * preparación ("crudo", "hervido"). ANMAT queda afuera a propósito: son
 * productos envasados (se cargan por código de barras o a mano).
 *
 * NO lanza: ante cualquier falla devuelve todo `null` ("sin datos"), así el
 * guardado nunca se rompe por Gemini. El servidor no confía en el id que vuelve:
 * se valida contra la lista enviada.
 */
import { SchemaType, type Schema } from '@google/generative-ai';
import { z } from 'zod';
import { preseleccionarCandidatos, type EntradaCatalogo } from './catalogoAutomatico';
import { llamarGeminiJson } from './geminiClient';
import { macrosPlausibles, type Macros100 } from './macros';

// Presupuesto propio y corto: corre dentro de /save, que ya tiene maxDuration = 30.
const MAX_TOTAL_MS = 12_000;
const TIMEOUT_MS = 8_000;

export interface AlimentoAResolver {
  nombre: string;
  categoria: string;
}

/** Elegido del catálogo, estimado por la IA, o null = sin datos. */
export type ResultadoIA = { idCatalogo: number } | { macros: Macros100 } | null;

export interface ResolucionIA {
  /** Mismo orden que la entrada. */
  resultados: ResultadoIA[];
  /** Modelo que respondió; null si no hubo llamada o falló. */
  modelo: string | null;
}

const ENCABEZADO = `Sos el módulo de composición nutricional de NutriScan, una app de seguimiento nutricional. Recibís una lista numerada de alimentos detectados en un plato (nombre y categoría) y, por cada uno, tenés que resolver su aporte nutricional.`;

const PASO_CATALOGO = `1. Si el CATÁLOGO de abajo tiene una entrada que corresponda al MISMO alimento, devolvé su id en "id_catalogo" y dejá los cuatro valores nutricionales en null.
   - Elegí la entrada MÁS ESPECÍFICA y respetá la preparación y la parte que indica el nombre: crudo, hervido, frito, al horno, con piel, clara, yema, entero, etc.
   - Si el nombre no aclara la preparación, elegí la más probable para un alimento servido en un plato (por ejemplo, un huevo suelto es "Huevo de gallina, entero, hervido"; las frutas y verduras que se comen crudas, crudas).
   - No elijas golosinas, chocolates ni productos industriales para un alimento natural, ni al revés.
   - Si dudás entre dos entradas parecidas, elegí la más genérica y común.
2. Si NO hay ninguna entrada razonable, devolvé "id_catalogo": null y estimá`;

const PASO_ESTIMAR_SIN_CATALOGO = `1. Devolvé siempre "id_catalogo": null y estimá`;

const ESTIMAR = ` kcal_100g, proteinas_100g, grasas_100g y carbs_100g POR 100 g de porción comestible tal como se describe (cocido o crudo, con o sin piel, "al horno", "frito", etc.), con las tablas de composición de alimentos argentinas (SARA2 / ARGENFOODS) o USDA como referencia. Las kcal deben ser coherentes con 4 kcal/g de proteína, 4 de hidratos y 9 de grasa.
%N%. Si no reconocés el alimento y no podés estimarlo con razonable confianza, devolvé null en los cinco campos. No inventes.`;

const SALTO = String.fromCharCode(10);

const CIERRE = `Devolvé un elemento por cada alimento, con el mismo "index" que recibiste. Respondé ÚNICAMENTE con un JSON que cumpla el schema provisto.`;

/** Reglas fijas + los candidatos del catálogo para este plato. */
function construirSystemPrompt(catalogo: EntradaCatalogo[]): string {
  const conCatalogo = catalogo.length > 0;
  const reglas = [
    ENCABEZADO,
    '## Cómo resolver cada alimento',
    (conCatalogo ? PASO_CATALOGO : PASO_ESTIMAR_SIN_CATALOGO) + ESTIMAR.replace('%N%', conCatalogo ? '3' : '2'),
    CIERRE,
  ].join(SALTO + SALTO);
  if (!conCatalogo) return reglas;
  const lista = catalogo.map((e) => `${e.id}|${e.nombre}`).join(SALTO);
  return [reglas, '## CATÁLOGO (candidatos, formato id|nombre)', lista].join(SALTO + SALTO);
}

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
          id_catalogo: { type: SchemaType.INTEGER, nullable: true },
          kcal_100g: numeroONull,
          proteinas_100g: numeroONull,
          grasas_100g: numeroONull,
          carbs_100g: numeroONull,
        },
        required: ['index', 'id_catalogo', 'kcal_100g', 'proteinas_100g', 'grasas_100g', 'carbs_100g'],
      },
    },
  },
  required: ['items'],
};

const respuestaSchema = z.object({
  items: z.array(
    z.object({
      index: z.number().int(),
      id_catalogo: z.number().int().nullable(),
      kcal_100g: z.number().nullable(),
      proteinas_100g: z.number().nullable(),
      grasas_100g: z.number().nullable(),
      carbs_100g: z.number().nullable(),
    }),
  ),
});

type Respuesta = z.infer<typeof respuestaSchema>;

// Sólo valida la FORMA (null → reintento con instrucción estricta); la
// plausibilidad y la pertenencia al catálogo se chequean después, por ítem,
// sin rechazar toda la respuesta.
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

export async function resolverAlimentosConIA(
  alimentos: AlimentoAResolver[],
  catalogo: EntradaCatalogo[],
): Promise<ResolucionIA> {
  if (alimentos.length === 0) return { resultados: [], modelo: null };

  // Sólo se le muestran los candidatos parecidos (menos tokens); y sólo esos ids son válidos en la respuesta.
  const candidatos = preseleccionarCandidatos(alimentos.map((a) => a.nombre), catalogo);
  const idsValidos = new Set(candidatos.map((e) => e.id));
  const lista = alimentos.map((a, i) => `${i}. ${a.nombre} (categoría: ${a.categoria})`).join('\n');

  try {
    const { resultado, modeloUsado } = await llamarGeminiJson<Respuesta>({
      systemInstruction: construirSystemPrompt(candidatos),
      contents: [{ role: 'user', parts: [{ text: `Resolvé estos alimentos:\n${lista}` }] }],
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

    const resultados = alimentos.map((_, i): ResultadoIA => {
      const item = porIndice.get(i);
      if (!item || item === 'duplicado') return null;
      // Elegido del catálogo: sólo vale si el id está en la lista que le mandamos.
      if (item.id_catalogo != null && idsValidos.has(item.id_catalogo)) {
        return { idCatalogo: item.id_catalogo };
      }
      const { kcal_100g, proteinas_100g, grasas_100g, carbs_100g } = item;
      if (kcal_100g == null || proteinas_100g == null || grasas_100g == null || carbs_100g == null) return null;
      const macros: Macros100 = { kcal_100g, proteinas_100g, grasas_100g, carbs_100g };
      return macrosPlausibles(macros) ? { macros } : null;
    });

    return { resultados, modelo: modeloUsado };
  } catch (err) {
    console.error('Falló la resolución de alimentos con Gemini:', err);
    return { resultados: alimentos.map(() => null), modelo: null };
  }
}
