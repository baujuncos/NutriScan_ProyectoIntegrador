import { notFound } from 'next/navigation';
import PageHeader from '@/components/researcher/PageHeader';
import { todayAR } from '@/lib/date';
import { cargarMedicion, cargarMediciones, cargarPacienteDeMedicion } from '@/lib/researcher/antropometria/datos';
import { createClient } from '@/lib/supabase/server';
import MedicionWizard from '../../../MedicionWizard';

export const dynamic = 'force-dynamic';

/** Retomar un borrador o editar una medición ya generada (las anuladas no se abren). */
export default async function EditarMedicionPage({ params }: { params: Promise<{ medicionId: string }> }) {
  const { medicionId } = await params;
  const supabase = await createClient();

  const medicion = await cargarMedicion(supabase, medicionId);
  if (!medicion || medicion.estado === 'anulada') notFound();
  const paciente = await cargarPacienteDeMedicion(supabase, medicion);
  if (!paciente) notFound();

  const otras = (await cargarMediciones(supabase, paciente)).filter((m) => m.estado === 'vigente' && m.id !== medicion.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title={medicion.estado === 'borrador' ? 'Retomar medición' : 'Editar medición'}
        subtitle={`${paciente.apellido}, ${paciente.nombre}`}
        helpId="antropometrias"
      />
      <MedicionWizard
        paciente={paciente}
        otrasVigentes={otras.map((m) => ({ id: m.id, fecha_medicion: m.fecha_medicion }))}
        hoy={todayAR()}
        inicial={{
          id: medicion.id,
          estado: medicion.estado,
          fechaMedicion: medicion.fecha_medicion,
          nivelActividad: medicion.nivel_actividad,
          deporte: medicion.deporte,
          series: medicion.series,
        }}
      />
    </div>
  );
}
