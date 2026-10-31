import Link from 'next/link';
import { notFound } from 'next/navigation';
import Card from '@/components/researcher/Card';
import EmptyState from '@/components/researcher/EmptyState';
import PageHeader from '@/components/researcher/PageHeader';
import { fmt } from '@/lib/numeros';
import { resumirMedicion } from '@/lib/researcher/antropometria/calculo';
import { cargarMediciones, cargarNombres, cargarPaciente } from '@/lib/researcher/antropometria/datos';
import { edadEn, fechaLegible, motivoBloqueoNuevaMedicion } from '@/lib/researcher/antropometria/reglas';
import {
  esOrigen,
  RUTA_LISTADO,
  rutaEditarMedicion,
  rutaInforme,
  rutaNuevaMedicion,
} from '@/lib/researcher/antropometria/rutas';
import { createClient } from '@/lib/supabase/server';
import { MAX_MEDICIONES_POR_PACIENTE } from '@/types/antropometria';

export const dynamic = 'force-dynamic';

const ENLACE = 'font-medium text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded';
const BOTON =
  'inline-flex h-10 items-center justify-center rounded-lg bg-blue-700 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';

export default async function FichaPacientePage({ params }: { params: Promise<{ origen: string; id: string }> }) {
  const { origen, id } = await params;
  if (!esOrigen(origen)) notFound();

  const supabase = await createClient();
  const paciente = await cargarPaciente(supabase, origen, id);
  if (!paciente) notFound();

  const mediciones = await cargarMediciones(supabase, paciente);
  const vigentes = mediciones.filter((m) => m.estado === 'vigente');
  const borradores = mediciones.filter((m) => m.estado === 'borrador');
  const nombres = await cargarNombres(supabase, mediciones.map((m) => m.investigador_id));

  const bloqueo = motivoBloqueoNuevaMedicion(paciente, vigentes.length);
  const edad = paciente.fechaNacimiento ? edadEn(paciente.fechaNacimiento) : null;

  return (
    <div className="space-y-6">
      <Link href={RUTA_LISTADO} className="inline-block text-sm text-slate-600 hover:text-slate-900 hover:underline">
        ← Antropometrías
      </Link>

      <PageHeader
        title={`${paciente.apellido}, ${paciente.nombre}`}
        subtitle={[
          paciente.origen === 'deportista' ? 'Deportista registrado' : 'Paciente manual',
          edad !== null ? `${edad} años` : 'Sin fecha de nacimiento',
          paciente.sexo === 'F' ? 'Femenino' : paciente.sexo === 'M' ? 'Masculino' : 'Sexo sin cargar',
        ].join(' · ')}
        helpId="antropometrias"
        actions={
          bloqueo ? (
            <button type="button" disabled className={`${BOTON} cursor-not-allowed opacity-50`} aria-describedby="bloqueo-nueva">
              Nueva medición
            </button>
          ) : (
            <Link href={rutaNuevaMedicion(paciente.origen, paciente.id)} className={BOTON}>
              Nueva medición
            </Link>
          )
        }
      />
      {bloqueo && (
        <p id="bloqueo-nueva" role="status" className="-mt-3 text-sm text-amber-800">
          {bloqueo}
        </p>
      )}

      {borradores.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">Mediciones en borrador</h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {borradores.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-slate-700">
                  <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Borrador</span>
                  {fechaLegible(m.fecha_medicion)}
                </span>
                <Link href={rutaEditarMedicion(m.id)} className={ENLACE}>
                  Retomar
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Mediciones</h2>
          <span className="text-xs text-slate-600">
            {vigentes.length} de {MAX_MEDICIONES_POR_PACIENTE}
          </span>
        </div>
        {vigentes.length === 0 ? (
          <EmptyState title="Todavía no tiene mediciones" description='Tocá "Nueva medición" para cargar la primera.' />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Fecha</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Investigador</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Peso</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Masa adiposa</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Masa muscular</th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vigentes.map((m) => {
                  const r = resumirMedicion(paciente, m);
                  return (
                    <tr key={m.id}>
                      <td className="px-4 py-3 font-medium text-slate-900">{fechaLegible(m.fecha_medicion)}</td>
                      <td className="px-4 py-3 text-slate-700">{nombres.get(m.investigador_id) ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{r ? `${fmt(r.pesoKg, 1)} kg` : '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{r ? `${fmt(r.masaAdiposaKg, 2)} kg` : '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{r ? `${fmt(r.masaMuscularKg, 2)} kg` : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <Link href={rutaInforme(m.id)} className={ENLACE}>
                          Ver informe
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
