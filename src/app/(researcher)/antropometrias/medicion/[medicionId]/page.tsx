import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Card from '@/components/researcher/Card';
import PageHeader from '@/components/researcher/PageHeader';
import { compararMediciones } from '@/lib/antropometria';
import { FACTORES_ACTIVIDAD } from '@/lib/antropometria/datos/actividad';
import { deportesDisponibles } from '@/lib/antropometria';
import { formatFechaCorta } from '@/lib/date';
import { calcularMedicion } from '@/lib/researcher/antropometria/calculo';
import { cargarMedicion, cargarMediciones, cargarNombres, cargarPacienteDeMedicion } from '@/lib/researcher/antropometria/datos';
import { nombreArchivoInforme } from '@/lib/researcher/antropometria/informe';
import { fechaLegible } from '@/lib/researcher/antropometria/reglas';
import { rutaEditarMedicion, rutaFicha } from '@/lib/researcher/antropometria/rutas';
import { createClient } from '@/lib/supabase/server';
import AccionesInforme from './AccionesInforme';
import InformeParte1 from './InformeParte1';
import InformeParte2 from './InformeParte2';

export const dynamic = 'force-dynamic';

export default async function InformePage({ params }: { params: Promise<{ medicionId: string }> }) {
  const { medicionId } = await params;
  const supabase = await createClient();

  const medicion = await cargarMedicion(supabase, medicionId);
  if (!medicion || medicion.estado === 'anulada') notFound();
  // Un borrador todavía no tiene informe: se vuelve al asistente.
  if (medicion.estado === 'borrador') redirect(rutaEditarMedicion(medicion.id));

  const paciente = await cargarPacienteDeMedicion(supabase, medicion);
  if (!paciente) notFound();

  // Medición anterior = la vigente inmediatamente previa por fecha (a igual fecha, la creada antes).
  const vigentes = (await cargarMediciones(supabase, paciente)).filter((m) => m.estado === 'vigente' && m.id !== medicion.id);
  const filaAnterior = vigentes
    .filter((m) => m.fecha_medicion < medicion.fecha_medicion || (m.fecha_medicion === medicion.fecha_medicion && m.creado_en < medicion.creado_en))
    .at(-1);

  const calculo = calcularMedicion(paciente, medicion);
  const calculoAnterior = filaAnterior ? calcularMedicion(paciente, filaAnterior) : null;
  const anterior = calculoAnterior?.ok ? calculoAnterior.resultado : null;

  const nombres = await cargarNombres(supabase, [medicion.investigador_id, medicion.actualizado_por]);
  const volver = (
    <Link href={rutaFicha(paciente.origen, paciente.id)} className="inline-block text-sm text-slate-600 hover:text-slate-900 hover:underline no-imprimir">
      ← {paciente.apellido}, {paciente.nombre}
    </Link>
  );

  if (!calculo.ok) {
    return (
      <div className="space-y-6">
        {volver}
        <PageHeader title="Informe de antropometría" subtitle={`${paciente.apellido}, ${paciente.nombre}`} helpId="antropometrias" />
        <Card className="space-y-3 p-6">
          <p role="alert" className="text-sm text-red-800">
            No se pudo calcular el informe: {calculo.motivo}
          </p>
          <Link href={rutaEditarMedicion(medicion.id)} className="text-sm font-medium text-blue-700 hover:underline">
            Editar la medición
          </Link>
        </Card>
      </div>
    );
  }

  const { resultado } = calculo;
  const comparacion = anterior ? compararMediciones(resultado, anterior) : null;
  const nivel = medicion.nivel_actividad!;
  const deporte =
    medicion.deporte && paciente.sexo ? (deportesDisponibles(paciente.sexo).find((d) => d.id === medicion.deporte)?.nombre ?? null) : null;
  const investigador = nombres.get(medicion.investigador_id) ?? '—';
  const modificadoPor = medicion.actualizado_por ? (nombres.get(medicion.actualizado_por) ?? '—') : null;

  return (
    <div className="space-y-6">
      {volver}
      <PageHeader
        title="Informe de antropometría"
        subtitle={`${paciente.apellido}, ${paciente.nombre} · ${fechaLegible(medicion.fecha_medicion)}`}
        helpId="antropometrias"
        actions={
          <AccionesInforme
            medicionId={medicion.id}
            fecha={fechaLegible(medicion.fecha_medicion)}
            nombreArchivo={nombreArchivoInforme(paciente, medicion.fecha_medicion)}
            hrefEditar={rutaEditarMedicion(medicion.id)}
          />
        }
      />

      <div id="informe-imprimible" className="space-y-8 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:p-8 print:p-0 print:shadow-none print:ring-0">
        <header className="space-y-1 border-b border-slate-200 pb-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">NutriScan · Informe de antropometría</p>
          <h1 className="text-2xl font-bold text-slate-900">
            {paciente.apellido}, {paciente.nombre}
          </h1>
          <dl className="grid gap-x-8 gap-y-1 pt-2 text-sm sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
            <Dato etiqueta="Fecha de medición" valor={fechaLegible(medicion.fecha_medicion)} />
            <Dato etiqueta="Edad" valor={`${resultado.edad.anios} años`} />
            <Dato etiqueta="Sexo" valor={paciente.sexo === 'F' ? 'Femenino' : 'Masculino'} />
            <Dato etiqueta="Nivel de actividad" valor={FACTORES_ACTIVIDAD[nivel].categoria} />
            <Dato etiqueta="Deporte de referencia" valor={deporte ?? 'Sin comparación'} />
            <Dato etiqueta="Medición realizada por" valor={investigador} />
            {modificadoPor && <Dato etiqueta="Última modificación" valor={`${modificadoPor}, ${formatFechaCorta(medicion.actualizado_en)}`} />}
          </dl>
        </header>

        <InformeParte1 resultado={resultado} comparacion={comparacion} fechaAnterior={filaAnterior?.fecha_medicion ?? null} />
        <div className="print:break-before-page">
          <InformeParte2 resultado={resultado} anterior={anterior} nivelActividad={nivel} />
        </div>
      </div>
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{etiqueta}</dt>
      <dd className="font-medium text-slate-900">{valor}</dd>
    </div>
  );
}
