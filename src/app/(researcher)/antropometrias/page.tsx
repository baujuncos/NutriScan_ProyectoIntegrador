import { createClient } from '@/lib/supabase/server';
import { cargarListado } from '@/lib/researcher/antropometria/listado';
import AntropometriasClient from './AntropometriasClient';

export const dynamic = 'force-dynamic';

export default async function AntropometriasPage() {
  const supabase = await createClient();
  const pacientes = await cargarListado(supabase);
  return <AntropometriasClient pacientes={pacientes} />;
}
