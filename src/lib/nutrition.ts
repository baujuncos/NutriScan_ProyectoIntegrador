export const INGESTA_TIPOS = [
  'desayuno',
  'almuerzo',
  'merienda',
  'cena',
  'colacion',
  'suplemento',
] as const;

export const ITEM_TIPOS = ['solido', 'liquido', 'en polvo'] as const;

/** Tope de gramos/ml por ítem — lo comparten el alta manual y el guardado de detecciones. */
export const MAX_CANTIDAD = 2000;

export type IngestaTipo = (typeof INGESTA_TIPOS)[number];
export type ItemTipo = (typeof ITEM_TIPOS)[number];

export function isValidDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function toFixed2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatIngestaLabel(tipo: IngestaTipo): string {
  if (tipo === 'colacion') return 'Colaciones';
  if (tipo === 'suplemento') return 'Suplementos';
  return tipo.charAt(0).toUpperCase() + tipo.slice(1);
}

/** "Desayuno" / "Colación" → 'desayuno' / 'colacion'; null si no es un tipo de ingesta válido. */
export function normalizarTipoIngesta(raw: string): IngestaTipo | null {
  const limpio = raw.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
  return (INGESTA_TIPOS as readonly string[]).includes(limpio) ? (limpio as IngestaTipo) : null;
}
