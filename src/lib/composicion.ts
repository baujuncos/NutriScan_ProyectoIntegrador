/**
 * NUT-119 — Composición de un alimento pendiente de validación a partir de
 * alimentos del catálogo, con los GRAMOS REALES que hay en la foto (nunca
 * proporciones). Se guarda en `alimentos_pendientes_validacion.composicion` (borrador
 * y validación); el servidor la recalcula desde la base (ver supabase/017).
 */
import { z } from 'zod';
import { macrosMezcla, type Macros100 } from './macros';

export const MODOS_COMPOSICION = ['ia', 'catalogo', 'manual'] as const;
export type ModoComposicion = (typeof MODOS_COMPOSICION)[number];

/** Gramos máximos de un ingrediente (cordura). */
export const GRAMOS_MAX_INGREDIENTE = 1000;
/** Diferencia (g) tolerada entre la suma de ingredientes y el peso de la foto. */
export const TOLERANCIA_GRAMOS = 0.5;

const valorNutricional = z.number().min(0).max(100_000);

export const componenteSchema = z.object({
  origen: z.literal('catalogo'),
  id: z.number().int().positive(),
  nombre: z.string().trim().min(1).max(300),
  fuente: z.string().trim().max(30),
  gramos: z.number().positive().max(GRAMOS_MAX_INGREDIENTE),
  kcal_100g: valorNutricional,
  proteinas_100g: valorNutricional,
  grasas_100g: valorNutricional,
  carbs_100g: valorNutricional,
});

export const composicionSchema = z.object({
  modo: z.enum(MODOS_COMPOSICION),
  id_guardado_item: z.number().int().positive().nullish().transform((v) => v ?? null),
  gramos_foto: z.number().positive().nullish().transform((v) => v ?? null),
  componentes: z.array(componenteSchema).max(30),
});

export type ComponenteComposicion = z.infer<typeof componenteSchema>;
export type Composicion = z.infer<typeof composicionSchema>;

/** Lee una composición guardada; un valor viejo o corrupto devuelve null en vez de romper la pantalla. */
export function restaurarComposicion(raw: unknown): Composicion | null {
  const parsed = composicionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Ingrediente tal como lo edita el investigador (los gramos son el texto del campo). */
export interface ComponenteEditable {
  id: number;
  nombre: string;
  fuente: string;
  gramos: string;
  /** null = el catálogo no tiene valores nutricionales para este alimento. */
  macros: Macros100 | null;
}

export function aEditables(componentes: ComponenteComposicion[]): ComponenteEditable[] {
  return componentes.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    fuente: c.fuente,
    gramos: String(c.gramos),
    macros: {
      kcal_100g: c.kcal_100g,
      proteinas_100g: c.proteinas_100g,
      grasas_100g: c.grasas_100g,
      carbs_100g: c.carbs_100g,
    },
  }));
}

/** Pasa los ingredientes editables a válidos; lo que no sirve se reporta en `problemas` (por nombre). */
export function aComponentes(editables: ComponenteEditable[]): {
  componentes: ComponenteComposicion[];
  problemas: string[];
} {
  const componentes: ComponenteComposicion[] = [];
  const problemas: string[] = [];
  for (const e of editables) {
    if (!e.macros) {
      problemas.push(`${e.nombre} no tiene datos nutricionales en el catálogo`);
      continue;
    }
    const gramos = Number(e.gramos);
    if (e.gramos.trim() === '' || !Number.isFinite(gramos) || gramos <= 0 || gramos > GRAMOS_MAX_INGREDIENTE) {
      problemas.push(`Indicá los gramos de ${e.nombre} (más de 0 y hasta ${GRAMOS_MAX_INGREDIENTE} g)`);
      continue;
    }
    componentes.push({ origen: 'catalogo', id: e.id, nombre: e.nombre, fuente: e.fuente, gramos, ...e.macros });
  }
  return { componentes, problemas };
}

export type EstadoSuma = 'sin_ingredientes' | 'completa' | 'falta' | 'sobra';

export interface ResumenComposicion {
  /** Valores por 100 g del alimento; null si no se puede calcular. */
  macros: Macros100 | null;
  /** Gramos que suman los ingredientes. */
  suma: number;
  /** Peso de la foto − suma: positivo = faltan gramos; negativo = sobran. */
  diferencia: number;
  estado: EstadoSuma;
  /** Un solo ingrediente que iguala el peso de la foto: es ese mismo alimento del catálogo. */
  esVinculoPuro: boolean;
}

const redondear2 = (n: number) => Math.round(n * 100) / 100;

export function resumirComposicion(componentes: ComponenteComposicion[], pesoFoto: number): ResumenComposicion {
  const suma = redondear2(componentes.reduce((acc, c) => acc + c.gramos, 0));
  const diferencia = redondear2(pesoFoto - suma);
  const estado: EstadoSuma =
    componentes.length === 0
      ? 'sin_ingredientes'
      : Math.abs(diferencia) <= TOLERANCIA_GRAMOS
        ? 'completa'
        : diferencia > 0
          ? 'falta'
          : 'sobra';
  const macros = macrosMezcla(
    componentes.map((c) => ({
      macros: {
        kcal_100g: c.kcal_100g,
        proteinas_100g: c.proteinas_100g,
        grasas_100g: c.grasas_100g,
        carbs_100g: c.carbs_100g,
      },
      gramos: c.gramos,
    })),
    pesoFoto,
  );
  return { macros, suma, diferencia, estado, esVinculoPuro: componentes.length === 1 && estado === 'completa' };
}
