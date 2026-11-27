import Link from 'next/link';
import PageHeader from '@/components/researcher/PageHeader';
import {
  cargarErrorTecnicoPorInvestigador,
  cargarInvestigadores,
  cargarMisInstrumentos,
  cargarUsuarioId,
} from '@/lib/researcher/antropometria/investigadores';
import { RUTA_LISTADO } from '@/lib/researcher/antropometria/rutas';
import { createClient } from '@/lib/supabase/server';
import ConfiguracionClient from './ConfiguracionClient';

export const dynamic = 'force-dynamic';

/** "Mis instrumentos" y el error técnico de medición de cada investigador (NUT-246). */
export default async function ConfiguracionPage({ searchParams }: { searchParams: Promise<{ investigador?: string | string[] }> }) {
  const { investigador } = await searchParams;
  const supabase = await createClient();

  const [investigadores, miId, errorTecnico] = await Promise.all([
    cargarInvestigadores(supabase),
    cargarUsuarioId(supabase),
    cargarErrorTecnicoPorInvestigador(supabase),
  ]);
  const misInstrumentos = await cargarMisInstrumentos(supabase, miId);

  // Por defecto se ve el error técnico propio; ?investigador=<id> (el link de la revisión) abre el de otro.
  const pedido = typeof investigador === 'string' ? investigador : null;
  const inicial = [pedido, miId].find((id) => id && investigadores.some((i) => i.id === id)) ?? investigadores[0]?.id ?? '';

  return (
    <div className="space-y-6">
      <Link href={RUTA_LISTADO} className="inline-block text-sm text-slate-600 hover:text-slate-900 hover:underline">
        ← Antropometrías
      </Link>
      <PageHeader
        title="Instrumentos y error técnico"
        subtitle="Tus instrumentos de medición habituales y el error técnico de medición de cada investigador"
        helpId="antropometrias"
      />
      <ConfiguracionClient
        misInstrumentos={misInstrumentos}
        investigadores={investigadores}
        errorTecnico={errorTecnico}
        investigadorInicial={inicial}
      />
    </div>
  );
}
