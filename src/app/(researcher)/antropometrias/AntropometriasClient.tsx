'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import Card from '@/components/researcher/Card';
import EmptyState from '@/components/researcher/EmptyState';
import FilterBar from '@/components/researcher/FilterBar';
import PageHeader from '@/components/researcher/PageHeader';
import type { PacienteListado } from '@/lib/researcher/antropometria/listado';
import { fechaLegible, normalizarNombre } from '@/lib/researcher/antropometria/reglas';
import { MAX_MEDICIONES_POR_PACIENTE, type OrigenPaciente } from '@/types/antropometria';

type FiltroOrigen = 'todos' | OrigenPaciente;

const OPCIONES_ORIGEN = [
  { value: 'todos', label: 'Todos' },
  { value: 'deportista', label: 'Deportistas' },
  { value: 'manual', label: 'Manuales' },
];

const BOTON_AGREGAR =
  'inline-flex h-10 items-center justify-center rounded-lg bg-blue-700 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';

export default function AntropometriasClient({ pacientes }: { pacientes: PacienteListado[] }) {
  const [busqueda, setBusqueda] = useState('');
  const [origen, setOrigen] = useState<FiltroOrigen>('todos');

  const visibles = useMemo(() => {
    const q = normalizarNombre(busqueda);
    return pacientes.filter(
      (p) => (origen === 'todos' || p.origen === origen) && (!q || normalizarNombre(`${p.nombre} ${p.apellido}`).includes(q)),
    );
  }, [pacientes, busqueda, origen]);

  const hayFiltros = busqueda !== '' || origen !== 'todos';
  const agregar = (
    <Link href="/antropometrias/nuevo" className={BOTON_AGREGAR}>
      Agregar paciente
    </Link>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Antropometrías"
        subtitle="Mediciones antropométricas de deportistas registrados y pacientes cargados a mano"
        helpId="antropometrias"
        actions={pacientes.length > 0 ? agregar : undefined}
      />

      {pacientes.length === 0 ? (
        <Card>
          <EmptyState
            title="Todavía no hay pacientes"
            description="Agregá un paciente para cargar su primera medición."
            action={agregar}
          />
        </Card>
      ) : (
        <>
          <FilterBar
            debounceMs={0}
            canClear={hayFiltros}
            onClear={() => {
              setBusqueda('');
              setOrigen('todos');
            }}
            onChange={(id, value) => (id === 'q' ? setBusqueda(value) : setOrigen(value as FiltroOrigen))}
            fields={[
              { type: 'search', id: 'q', label: 'Buscar por nombre', value: busqueda, placeholder: 'Nombre o apellido' },
              { type: 'select', id: 'origen', label: 'Origen', value: origen, options: OPCIONES_ORIGEN },
            ]}
          />

          <Card className="overflow-hidden">
            {visibles.length === 0 ? (
              <EmptyState title="Ningún paciente coincide con la búsqueda" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold">Paciente</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Edad</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Origen</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Mediciones</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Última medición</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibles.map((p) => (
                      <tr key={`${p.origen}-${p.id}`} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">
                          <Link
                            href={`/antropometrias/${p.origen}/${p.id}`}
                            className="rounded hover:text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          >
                            {p.apellido}, {p.nombre}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{p.edad !== null ? `${p.edad} años` : '—'}</td>
                        <td className="px-4 py-3 text-slate-700">{p.origen === 'deportista' ? 'Deportista' : 'Manual'}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {p.cantidadMediciones} de {MAX_MEDICIONES_POR_PACIENTE}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{p.ultimaMedicion ? fechaLegible(p.ultimaMedicion) : 'Sin mediciones'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
