/**
 * NUT-119 — /validacion: cola de alimentos pendientes de validación.
 * El guard de rol (investigador/administrador) vive en `(researcher)/layout.tsx`;
 * la vista `v_alimentos_pendientes` además aplica RLS al que consulta.
 */
import { createClient } from '@/lib/supabase/server';
import { consultarPendientes, parseParams } from '@/lib/validacionQuery';
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

  return <ValidacionClient rows={rows as PendienteFila[]} total={total} params={params} />;
}
