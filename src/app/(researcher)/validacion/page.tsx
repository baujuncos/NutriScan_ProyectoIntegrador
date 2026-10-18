/**
 * NUT-119 — /validacion: cola de alimentos pendientes de validación.
 * El guard de rol (investigador/administrador) vive en `(researcher)/layout.tsx`;
 * la vista `v_alimentos_pendientes` además aplica RLS al que consulta.
 */
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PAGE_SIZE, buildQuery, consultarPendientes, parseParams } from '@/lib/validacionQuery';
import ValidacionClient from './ValidacionClient';
import type { PendienteFila } from './actions';

export const dynamic = 'force-dynamic';

export default async function ValidacionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseParams(await searchParams);
  const supabase = await createClient();
  const { rows, total } = await consultarPendientes(supabase, params);

  // Quedó en una página que ya no existe (ej. se validó el último de la última página): ir a la última válida.
  const ultimaPagina = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (params.page > ultimaPagina) redirect(`/validacion${buildQuery(params, { page: ultimaPagina })}`);

  return <ValidacionClient rows={rows as PendienteFila[]} total={total} params={params} />;
}
