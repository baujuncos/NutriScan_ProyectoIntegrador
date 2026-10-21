/**
 * NUT-151 — /revision-ia/metricas: métricas de calidad de las detecciones de
 * Gemini (patrones de corrección) para decidir manualmente dónde priorizar
 * ejemplos de prompt o factores de calibración. Sólo lectura. El guard de rol
 * vive en `(researcher)/layout.tsx`; las vistas además aplican RLS al que consulta.
 */
import { createClient } from '@/lib/supabase/server';
import {
  alimentosConVolumen,
  confianzaVsCorreccion,
  estadoCola,
  evolucionPorPrompt,
  noDetectados,
  rankingAlimentos,
  resumenEvolucion,
} from '@/lib/metricasIa';
import { cargarMetricas, filtrarPorPrompt, parseMetricasParams, versionesDePrompt } from '@/lib/metricasIaQuery';
import MetricasClient from './MetricasClient';

export const dynamic = 'force-dynamic';

export default async function MetricasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseMetricasParams(await searchParams);
  const supabase = await createClient();
  const datos = await cargarMetricas(supabase, params);

  // Fecha y vajilla ya vienen filtradas de la base; la versión de prompt se aplica acá.
  const items = filtrarPorPrompt(datos.items, params.prompt);
  const evolucion = evolucionPorPrompt(datos.items, params.alimento || undefined); // ignora el filtro de versión: la comparación es su objetivo

  return (
    <MetricasClient
      params={params}
      versiones={versionesDePrompt(datos.items)}
      ranking={rankingAlimentos(items)}
      puntos={confianzaVsCorreccion(items)}
      evolucion={evolucion}
      resumen={resumenEvolucion(evolucion)}
      alimentosEvolucion={alimentosConVolumen(datos.items)}
      noDetectados={noDetectados(filtrarPorPrompt(datos.noDetectados, params.prompt))}
      cola={estadoCola(items)}
      totalItems={items.length}
      truncado={datos.truncado}
    />
  );
}
