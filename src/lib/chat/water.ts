// NUT-191 — ¿Un ítem detectado por el chat es agua (va a hidratación) o es otro líquido?
//
// El chat no tiene un campo específico: `type` es "bebida" tanto para agua como para café,
// mate, jugo o gaseosa, y `unit` es "ml" para todos los líquidos. Por eso se decide por el
// NOMBRE del ingrediente, con una lista cerrada: solo cuenta como agua lo que es agua.
// Quedan afuera a propósito "agua saborizada", "agua de coco", "galletitas de agua", etc.

import { normalizeText } from './sara2Matcher';

const WATER_NAMES = new Set([
  'agua',
  'agua mineral',
  'agua mineral con gas',
  'agua mineral sin gas',
  'agua con gas',
  'agua sin gas',
  'agua de la canilla',
  'agua de canilla',
  'agua de red',
  'agua potable',
  'agua filtrada',
  'soda',
]);

export function isWaterIngredient(ingredient: string): boolean {
  return WATER_NAMES.has(normalizeText(ingredient));
}
