/**
 * NUT-149 — /revision-ia: cola de predicciones de IA que el equipo de nutrición
 * tiene que revisar (confianza baja, correcciones grandes, cambios de alimento,
 * ítems quitados). El guard de rol vive en `(researcher)/layout.tsx`; la vista
 * `v_revision_ia` además aplica RLS al que consulta.
 */
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PAGE_SIZE, buildRevisionQuery, consultarRevisiones, contarPorEstado, parseRevisionParams } from '@/lib/revisionIaQuery';
import RevisionIaClient from './RevisionIaClient';
import type { RevisionFila } from './actions';

export const dynamic = 'force-dynamic';

export default async function RevisionIaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseRevisionParams(await searchParams);
  const supabase = await createClient();
  const [{ rows, total }, conteos] = await Promise.all([consultarRevisiones(supabase, params), contarPorEstado(supabase)]);

  // Quedó en una página que ya no existe (ej. se revisó el último de la última página): ir a la última válida.
  const ultimaPagina = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (params.page > ultimaPagina) redirect(`/revision-ia${buildRevisionQuery(params, { page: ultimaPagina })}`);

  return <RevisionIaClient rows={rows as RevisionFila[]} total={total} params={params} conteos={conteos} />;
}
