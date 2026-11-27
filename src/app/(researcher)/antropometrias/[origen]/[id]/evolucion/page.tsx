import Link from 'next/link';
import { notFound } from 'next/navigation';
import Card from '@/components/researcher/Card';
import EmptyState from '@/components/researcher/EmptyState';
import PageHeader from '@/components/researcher/PageHeader';
import SubTabs from '@/components/researcher/SubTabs';
import { cargarMediciones, cargarPaciente } from '@/lib/researcher/antropometria/datos';
import {
  construirEvolucion,
  medicionesParaEvolucion,
  AVISO_RECALCULO,
  resolverSeleccion,
} from '@/lib/researcher/antropometria/evolucion';
import { fmtFijo } from '@/lib/researcher/antropometria/formato';
import { fechaLegible, motivoBloqueoNuevaMedicion } from '@/lib/researcher/antropometria/reglas';
import { esOrigen, rutaEvolucion, rutaFicha, rutaNuevaMedicion } from '@/lib/researcher/antropometria/rutas';
import { createClient } from '@/lib/supabase/server';
import { Somatocarta, type PuntoSomatocarta } from '../../../medicion/[medicionId]/GraficosInforme';
import ComparadorMediciones from './ComparadorMediciones';
import GraficoEvolucion from './GraficoEvolucion';

export const dynamic = 'force-dynamic';

const BOTON =
  'inline-flex h-10 items-center justify-center rounded-lg bg-blue-700 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';

type Param = string | string[] | undefined;
const primero = (p: Param) => (Array.isArray(p) ? p[0] : p);

export default async function EvolucionPacientePage({
  params,
  searchParams,
}: {
  params: Promise<{ origen: string; id: string }>;
  searchParams: Promise<{ a?: Param; b?: Param }>;
}) {
  const { origen, id } = await params;
  if (!esOrigen(origen)) notFound();
  const { a, b } = await searchParams;

  const supabase = await createClient();
  const paciente = await cargarPaciente(supabase, origen, id);
  if (!paciente) notFound();

  const filas = await cargarMediciones(supabase, paciente);
  const { mediciones, sinCalcular } = medicionesParaEvolucion(paciente, filas);
  const evolucion = construirEvolucion(mediciones);
  const seleccion = resolverSeleccion(evolucion.mediciones, primero(a), primero(b));
  const vigentes = filas.filter((f) => f.estado === 'vigente').length;
  const bloqueo = motivoBloqueoNuevaMedicion(paciente, vigentes);

  const { trayectoria } = evolucion;
  const ultimo = trayectoria.puntos.length - 1;
  const puntosCarta: PuntoSomatocarta[] = [
    ...trayectoria.puntos.map(
      (p, i): PuntoSomatocarta => ({
        etiqueta: p.etiqueta,
        x: p.x,
        y: p.y,
        tipo: 'trayectoria',
        numero: p.nro,
        extremo: ultimo === 0 ? 'unica' : i === 0 ? 'primera' : i === ultimo ? 'ultima' : undefined,
      }),
    ),
    ...(trayectoria.referencia
      ? [{ etiqueta: `Referencia: ${trayectoria.referencia.nombre}`, x: trayectoria.referencia.x, y: trayectoria.referencia.y, tipo: 'deporte' as const }]
      : []),
  ];

  return (
    <div className="space-y-6">
      <Link href={rutaFicha(paciente.origen, paciente.id)} className="inline-block text-sm text-slate-600 hover:text-slate-900 hover:underline">
        ← {paciente.apellido}, {paciente.nombre}
      </Link>

      <PageHeader title={`Evolución · ${paciente.apellido}, ${paciente.nombre}`} subtitle="Cómo cambiaron las mediciones vigentes a lo largo del tiempo" helpId="antropometrias" />

      <SubTabs
        label="Secciones del paciente"
        activeHref={rutaEvolucion(paciente.origen, paciente.id)}
        tabs={[
          { label: 'Historial', href: rutaFicha(paciente.origen, paciente.id) },
          { label: 'Evolución', href: rutaEvolucion(paciente.origen, paciente.id) },
        ]}
      />

      {sinCalcular > 0 && (
        <p role="status" className="text-sm text-amber-800">
          {sinCalcular === 1
            ? '1 medición vigente no se pudo calcular y no aparece en los gráficos.'
            : `${sinCalcular} mediciones vigentes no se pudieron calcular y no aparecen en los gráficos.`}{' '}
          Abrí su informe para ver el motivo.
        </p>
      )}

      {evolucion.mediciones.length === 0 ? (
        <Card>
          <EmptyState
            title="Todavía no hay mediciones para mostrar"
            description="La evolución se arma con las mediciones vigentes. Cargá la primera para ver los gráficos."
            action={
              bloqueo ? (
                <p className="text-sm text-amber-800">{bloqueo}</p>
              ) : (
                <Link href={rutaNuevaMedicion(paciente.origen, paciente.id)} className={BOTON}>
                  Nueva medición
                </Link>
              )
            }
          />
        </Card>
      ) : (
        <>
          <ul aria-label="Resumen de la última medición" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {evolucion.kpis.map((k) => (
              <li key={k.clave}>
                <Card className="h-full p-4">
                  <p className="text-xs font-medium text-slate-600">{k.etiqueta}</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
                    {k.valorTexto} <span className="text-sm font-medium text-slate-600">{k.unidad}</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-600">{k.diferenciaTexto}</p>
                </Card>
              </li>
            ))}
          </ul>

          <Card className="p-4">
            <GraficoEvolucion id="grafico-masas" titulo="Masas corporales" unidad="kg" eje={evolucion.eje} series={evolucion.masas} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <GraficoEvolucion id="grafico-peso" titulo="Peso" unidad="kg" eje={evolucion.eje} series={[evolucion.peso]} />
            </Card>
            <Card className="p-4">
              <GraficoEvolucion id="grafico-suma6" titulo="Suma de 6 pliegues" unidad="mm" eje={evolucion.eje} series={[evolucion.suma6]} />
            </Card>
          </div>

          <section aria-labelledby="titulo-somatocarta" className="space-y-3">
            <h2 id="titulo-somatocarta" className="text-base font-semibold text-slate-900">
              Trayectoria del somatotipo
            </h2>
            <Card className="grid gap-6 p-4 lg:grid-cols-2">
              <Somatocarta puntos={puntosCarta} />
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Somatotipo de cada medición</caption>
                  <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th scope="col" className="py-2 pr-3 font-semibold">Medición</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Endo</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Meso</th>
                      <th scope="col" className="py-2 pl-3 text-right font-semibold">Ecto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {trayectoria.puntos.map((p) => (
                      <tr key={p.nro}>
                        <th scope="row" className="py-2 pr-3 font-medium text-slate-900">
                          Nº {p.nro}
                          <span className="ml-1 font-normal text-slate-500">{fechaLegible(p.fecha)}</span>
                        </th>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtFijo(p.endomorfia, 1)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtFijo(p.mesomorfia, 1)}</td>
                        <td className="py-2 pl-3 text-right tabular-nums text-slate-700">{fmtFijo(p.ectomorfia, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>

          {seleccion && <ComparadorMediciones mediciones={evolucion.mediciones} idA={seleccion.idA} idB={seleccion.idB} />}

          <p className="text-xs text-slate-600">{AVISO_RECALCULO}</p>
        </>
      )}
    </div>
  );
}
