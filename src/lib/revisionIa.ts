/**
 * NUT-149 — Cola de revisión del equipo de nutrición: decide, al guardar, qué
 * ítems detectados por Gemini necesitan revisión. Función pura (sin I/O) para
 * poder probarla con datos de prueba; la escribe la RPC `registrar_guardado_deteccion`.
 *
 * Los alimentos que el usuario agrega a mano (Gemini no los detectó) NO entran
 * acá: no hay ítem original que revisar. Quedan como `origin = 'added_manually'`
 * en `detecciones_guardados_items` y se cuentan aparte (métrica de NUT-151).
 */
import type { FinalItem } from '@/lib/deteccion';

/** Umbrales centralizados: se ajustan mirando datos reales (NUT-151). */
export const UMBRAL_CONFIANZA_BAJA = 0.6; // confidence < umbral → confianza_baja
export const UMBRAL_DIFERENCIA_PESO = 0.2; // |final − estimado| / estimado > umbral → correccion_peso_grande

/** En orden de evaluación; `item_quitado` es el más grave. */
export const MOTIVOS_REVISION = [
  'item_quitado',
  'cambio_alimento',
  'correccion_peso_grande',
  'confianza_baja',
] as const;
export type MotivoRevision = (typeof MOTIVOS_REVISION)[number];

export interface UmbralesRevision {
  confianzaBaja: number;
  diferenciaPeso: number;
}

export const UMBRALES_POR_DEFECTO: UmbralesRevision = {
  confianzaBaja: UMBRAL_CONFIANZA_BAJA,
  diferenciaPeso: UMBRAL_DIFERENCIA_PESO,
};

/** Lo que se necesita de `detecciones_ia_items` (valores de la DB, no los que mande el cliente). */
export interface ItemPredicho {
  item_uuid: string;
  confidence: number;
  estimated_weight_grams: number;
}

export interface RevisionItem {
  item_uuid: string;
  /** Vacío = no necesita revisión. */
  motivos: MotivoRevision[];
}

/** Una entrada por cada ítem predicho por Gemini (los agregados a mano se ignoran). */
export function calcularRevisiones(
  predichos: ItemPredicho[],
  finales: Pick<FinalItem, 'sourceItemId' | 'grams' | 'origin'>[],
  removidos: string[],
  umbrales: Partial<UmbralesRevision> = {},
): RevisionItem[] {
  const { confianzaBaja, diferenciaPeso } = { ...UMBRALES_POR_DEFECTO, ...umbrales };
  const quitados = new Set(removidos);

  return predichos.map((p) => {
    const motivos: MotivoRevision[] = [];
    const propios = finales.filter((f) => f.sourceItemId === p.item_uuid);
    const reemplazado = propios.some((f) => f.origin === 'replaced');

    if (quitados.has(p.item_uuid)) motivos.push('item_quitado');
    if (reemplazado) motivos.push('cambio_alimento');

    // Peso: sólo si el alimento se mantuvo (si cambió, ya entró por cambio_alimento).
    if (!reemplazado && propios.length > 0 && p.estimated_weight_grams > 0) {
      const pesoFinal = propios.reduce((acc, f) => acc + f.grams, 0);
      if (Math.abs(pesoFinal - p.estimated_weight_grams) / p.estimated_weight_grams > diferenciaPeso) {
        motivos.push('correccion_peso_grande');
      }
    }

    if (p.confidence < confianzaBaja) motivos.push('confianza_baja');

    return { item_uuid: p.item_uuid, motivos };
  });
}
