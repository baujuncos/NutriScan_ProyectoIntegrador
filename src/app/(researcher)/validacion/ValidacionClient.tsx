'use client';

/**
 * NUT-119 — Listado de la cola de validación (panel de investigadores).
 * Filtros por querystring (<form method="get">, funciona sin JS) y paginación
 * del lado del servidor; el detalle se abre en un modal.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { formatFechaCorta } from '@/lib/date';
import { PAGE_SIZE, buildQuery, type ValidacionParams } from '@/lib/validacionQuery';
import PendienteDetalle from './PendienteDetalle';
import type { PendienteFila } from './actions';

interface Props {
  rows: PendienteFila[];
  total: number;
  params: ValidacionParams;
}

const ESTADO_LABEL: Record<PendienteFila['estado'], string> = {
  pendiente: 'Pendiente',
  validado: 'Validado',
  descartado: 'Descartado',
};

const ESTADO_BADGE: Record<PendienteFila['estado'], string> = {
  pendiente: 'bg-amber-50 text-amber-700',
  validado: 'bg-emerald-50 text-emerald-700',
  descartado: 'bg-slate-100 text-slate-600',
};

const GRID = 'sm:grid sm:grid-cols-[minmax(0,2fr)_6rem_5rem_7rem_auto] sm:items-center sm:gap-4';

export default function ValidacionClient({ rows, total, params }: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState<number | null>(null);
  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (page: number) => `/validacion${buildQuery(params, { page })}`;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Validación de alimentos</h1>
        <p className="mt-1 text-sm text-slate-500">
          Alimentos que los deportistas registraron y no estaban en el catálogo. {total}{' '}
          {total === 1 ? 'resultado' : 'resultados'}.
        </p>
      </header>

      <form
        role="search"
        method="get"
        action="/validacion"
        className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[10rem_1fr_12rem_auto] sm:items-end"
      >
        <Select
          id="estado"
          name="estado"
          label="Estado"
          defaultValue={params.estado}
          options={[
            { value: 'pendiente', label: 'Pendientes' },
            { value: 'validado', label: 'Validados' },
            { value: 'descartado', label: 'Descartados' },
            { value: 'todos', label: 'Todos' },
          ]}
        />
        <Input id="q" name="q" label="Buscar por nombre" defaultValue={params.q} placeholder="Ej: flan" />
        <Select
          id="orden"
          name="orden"
          label="Ordenar por"
          defaultValue={params.orden}
          options={[
            { value: 'fecha', label: 'Fecha (más reciente)' },
            { value: 'ocurrencias', label: 'Cantidad de ocurrencias' },
          ]}
        />
        <Button type="submit">Filtrar</Button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div
          aria-hidden="true"
          className={`hidden border-b border-slate-100 bg-slate-50/60 px-5 py-3 text-xs font-medium uppercase tracking-wide text-slate-500 ${GRID}`}
        >
          <span>Alimento</span>
          <span>Estado</span>
          <span>Ocurrencias</span>
          <span>Última</span>
          <span />
        </div>

        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            No hay alimentos {params.estado === 'todos' ? 'en la cola' : `${ESTADO_LABEL[params.estado].toLowerCase()}s`}
            {params.q ? ` que coincidan con “${params.q}”` : ''}.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              const nombre = r.nombre_final ?? r.nombre_original;
              return (
                <li key={r.id_pendiente} aria-label={nombre} className={`flex flex-col gap-2 px-5 py-4 ${GRID}`}>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{nombre}</p>
                    {nombre !== r.nombre_original && (
                      <p className="truncate text-xs text-slate-400">Detectado como: {r.nombre_original}</p>
                    )}
                  </div>
                  <span>
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${ESTADO_BADGE[r.estado]}`}>
                      {ESTADO_LABEL[r.estado]}
                    </span>
                  </span>
                  <span className="text-sm text-slate-700">
                    <span className="sm:hidden text-slate-400">Ocurrencias: </span>
                    <span>{r.ocurrencias}</span>
                  </span>
                  <span className="text-sm text-slate-500">{formatFechaCorta(r.ultima_ocurrencia ?? r.created_at)}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Revisar ${nombre}`}
                    onClick={() => setAbierto(r.id_pendiente)}
                  >
                    Revisar
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {totalPaginas > 1 && (
        <nav aria-label="Paginación" className="flex items-center justify-between text-sm">
          {params.page > 1 ? (
            <Link href={href(params.page - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50">
              Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-slate-500">
            Página {params.page} de {totalPaginas}
          </span>
          {params.page < totalPaginas ? (
            <Link href={href(params.page + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50">
              Siguiente
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <PendienteDetalle
        idPendiente={abierto}
        onClose={() => setAbierto(null)}
        onResuelto={() => {
          setAbierto(null);
          router.refresh();
        }}
      />
    </div>
  );
}
