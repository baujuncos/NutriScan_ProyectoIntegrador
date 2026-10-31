import Link from 'next/link';
import { notFound } from 'next/navigation';
import Card from '@/components/researcher/Card';
import PageHeader from '@/components/researcher/PageHeader';
import { todayAR } from '@/lib/date';
import { cargarMediciones, cargarPaciente } from '@/lib/researcher/antropometria/datos';
import { motivoBloqueoNuevaMedicion } from '@/lib/researcher/antropometria/reglas';
import { esOrigen, rutaFicha } from '@/lib/researcher/antropometria/rutas';
import { createClient } from '@/lib/supabase/server';
import MedicionWizard from '../../../../MedicionWizard';

export const dynamic = 'force-dynamic';

export default async function NuevaMedicionPage({ params }: { params: Promise<{ origen: string; id: string }> }) {
  const { origen, id } = await params;
  if (!esOrigen(origen)) notFound();

  const supabase = await createClient();
  const paciente = await cargarPaciente(supabase, origen, id);
  if (!paciente) notFound();

  const vigentes = (await cargarMediciones(supabase, paciente)).filter((m) => m.estado === 'vigente');
  const bloqueo = motivoBloqueoNuevaMedicion(paciente, vigentes.length);

  return (
    <div className="space-y-6">
      <PageHeader title="Nueva medición" subtitle={`${paciente.apellido}, ${paciente.nombre}`} helpId="antropometrias" />
      {bloqueo ? (
        <Card className="space-y-3 p-6">
          <p role="alert" className="text-sm text-slate-800">
            {bloqueo}
          </p>
          <Link href={rutaFicha(paciente.origen, paciente.id)} className="text-sm font-medium text-blue-700 hover:underline">
            Volver a la ficha
          </Link>
        </Card>
      ) : (
        <MedicionWizard
          paciente={paciente}
          otrasVigentes={vigentes.map((m) => ({ id: m.id, fecha_medicion: m.fecha_medicion }))}
          hoy={todayAR()}
          inicial={null}
        />
      )}
    </div>
  );
}
