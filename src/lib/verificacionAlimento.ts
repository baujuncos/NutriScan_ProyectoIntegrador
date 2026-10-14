/**
 * NUT-119 — Verificación de los valores de un alimento propio (spec §6.2): lo que se
 * puede revisar sin la base (rangos y coherencia). El servidor repite TODO y además
 * revisa duplicados y nombres parecidos contra el catálogo (RPC `propio_verificar`).
 */
import { kcalCoherentes } from './macros';

export const JUSTIFICACION_MIN = 10;
export const MOTIVO_RETIRO_MIN = 10;

export type FuenteDato =
  | 'etiqueta_producto'
  | 'tabla_composicion'
  | 'calculo_propio'
  | 'estimacion_ia_revisada'
  | 'otra';

export const FUENTES_DATO: ReadonlyArray<{ valor: FuenteDato; etiqueta: string }> = [
  { valor: 'etiqueta_producto', etiqueta: 'Etiqueta del producto' },
  { valor: 'tabla_composicion', etiqueta: 'Tabla de composición' },
  { valor: 'calculo_propio', etiqueta: 'Cálculo propio' },
  { valor: 'estimacion_ia_revisada', etiqueta: 'Estimación de la IA revisada' },
  { valor: 'otra', etiqueta: 'Otra' },
];

export type CodigoBloqueo =
  | 'NOMBRE_VACIO'
  | 'VALORES_INVALIDOS'
  | 'MACRO_MAYOR_100'
  | 'SUMA_MACROS'
  | 'KCAL_MAYOR_900'
  | 'DUPLICADO';
export type CodigoAdvertencia = 'KCAL_INCOHERENTE' | 'SIMILAR';

export const MENSAJE_BLOQUEO: Record<CodigoBloqueo, string> = {
  NOMBRE_VACIO: 'Ingresá el nombre del alimento.',
  VALORES_INVALIDOS: 'Los cuatro valores por 100 g son obligatorios y no pueden ser negativos.',
  MACRO_MAYOR_100: 'Un macronutriente no puede superar los 100 g por cada 100 g de alimento.',
  SUMA_MACROS: 'Proteínas + grasas + carbohidratos no pueden superar los 105 g por cada 100 g.',
  KCAL_MAYOR_900: 'Las kcal no pueden superar las 900 por cada 100 g.',
  DUPLICADO: 'Ya existe un alimento con ese nombre. Usalo desde "Del catálogo".',
};

export const MENSAJE_ADVERTENCIA: Record<CodigoAdvertencia, string> = {
  KCAL_INCOHERENTE:
    'Las kcal no cierran con 4 kcal/g de proteínas y carbohidratos y 9 kcal/g de grasas. Si el valor es correcto, explicalo en la justificación y confirmalo.',
  SIMILAR: 'Hay alimentos con un nombre muy parecido. Confirmá que el tuyo es distinto.',
};

export interface ValoresPropio {
  kcal: number | null;
  proteinas: number | null;
  grasas: number | null;
  carbs: number | null;
}

export function verificarValores(
  nombre: string,
  v: ValoresPropio,
): { bloqueos: CodigoBloqueo[]; advertencias: CodigoAdvertencia[] } {
  const bloqueos: CodigoBloqueo[] = [];
  const advertencias: CodigoAdvertencia[] = [];
  if (nombre.trim() === '') bloqueos.push('NOMBRE_VACIO');

  const valores = [v.kcal, v.proteinas, v.grasas, v.carbs];
  if (valores.some((x) => x == null || !Number.isFinite(x) || x < 0)) {
    bloqueos.push('VALORES_INVALIDOS');
    return { bloqueos, advertencias };
  }
  const [kcal, proteinas, grasas, carbs] = valores as number[];
  if (Math.max(proteinas, grasas, carbs) > 100) bloqueos.push('MACRO_MAYOR_100');
  if (proteinas + grasas + carbs > 105) bloqueos.push('SUMA_MACROS');
  if (kcal > 900) bloqueos.push('KCAL_MAYOR_900');
  if (!kcalCoherentes({ kcal_100g: kcal, proteinas_100g: proteinas, grasas_100g: grasas, carbs_100g: carbs })) {
    advertencias.push('KCAL_INCOHERENTE');
  }
  return { bloqueos, advertencias };
}
