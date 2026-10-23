'use server';

/**
 * NUT-151 — Resumen descargable (.md) de las métricas de calidad, para pasárselo a una IA que mejore el
 * prompt de reconocimiento y estimación. Sólo investigadores. Usa los MISMOS filtros que el dashboard
 * (fecha, vajilla y versión de prompt) y no incluye datos personales.
 */
import { PROMPT_VERSION } from '@/lib/deteccion';
import { construirSystemPrompt } from '@/lib/geminiFoodPrompt';
import { cargarMetricas, filtrarPorPrompt, parseMetricasParams } from '@/lib/metricasIaQuery';
import { clienteInvestigador } from '@/lib/researcher/clienteInvestigador';
import { construirResumenMd, nombreArchivoResumen } from '@/lib/resumenMetricasMd';

export type ResumenResultado = { ok: true; filename: string; markdown: string } | { error: string };

export interface FiltrosResumen {
  desde: string;
  hasta: string;
  vajilla: string;
  prompt: string;
}

/** Contexto de ejemplo para mostrar el prompt completo (en cada foto cambian la vajilla, el diámetro y el ángulo). */
const CONTEXTO_EJEMPLO = { tipoVajilla: 'plato_playo', diametroCm: 26, anguloCapturaGrados: 35 } as const;

export async function generarResumenMdAction(filtros: FiltrosResumen): Promise<ResumenResultado> {
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  // Se normaliza igual que la querystring del dashboard: lo inválido cae al valor por defecto.
  const params = parseMetricasParams({ desde: filtros.desde, hasta: filtros.hasta, vajilla: filtros.vajilla, prompt: filtros.prompt });

  let datos: Awaited<ReturnType<typeof cargarMetricas>>;
  try {
    datos = await cargarMetricas(auth.supabase, params);
  } catch (err) {
    console.error('No se pudo armar el resumen de métricas:', err instanceof Error ? err.message : 'error');
    return { error: 'No se pudieron leer las métricas. Probá de nuevo.' };
  }

  const generadoEn = new Date();
  const markdown = construirResumenMd({
    items: filtrarPorPrompt(datos.items, params.prompt),
    itemsTodasLasVersiones: datos.items,
    noDetectados: filtrarPorPrompt(datos.noDetectados, params.prompt),
    params,
    prompt: { version: PROMPT_VERSION, texto: construirSystemPrompt(CONTEXTO_EJEMPLO) },
    generadoEn,
    truncado: datos.truncado,
  });
  return { ok: true, filename: nombreArchivoResumen(generadoEn), markdown };
}
