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
import { CARD_CLASS } from '@/components/researcher/Card';
import EmptyState from '@/components/researcher/EmptyState';
import FilterBar, { type FilterField } from '@/components/researcher/FilterBar';
import PageHeader from '@/components/researcher/PageHeader';
import StatusBadge, { type BadgeTone } from '@/components/researcher/StatusBadge';
import { useFiltrosServidor } from '@/components/researcher/useFiltrosServidor';
import { formatFechaCorta } from '@/lib/date';
import { PAGE_SIZE, buildQuery, parseParams, type ValidacionParams } from '@/lib/validacionQuery';
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

const ESTADO_TONE: Record<PendienteFila['estado'], BadgeTone> = {
  pendiente: 'amber',
  validado: 'emerald',
  descartado: 'slate',
};

/** "1 manual", "2 manuales". */
const manuales = (n: number) => `${n} ${n === 1 ? 'manual' : 'manuales'}`;
/** NUT-228: "1 chat", "2 chats". */
const chats = (n: number) => `${n} ${n === 1 ? 'chat' : 'chats'}`;

const GRID = 'sm:grid sm:grid-cols-[minmax(0,2fr)_6rem_5rem_7rem_auto] sm:items-center sm:gap-4';

export default function ValidacionClient({ rows, total, params }: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState<number | null>(null);
  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (page: number) => `/validacion${buildQuery(params, { page })}`;

  const defaults = parseParams({});
  const { pending, onChange, onClear } = useFiltrosServidor({ path: '/validacion', params, defaults, build: buildQuery });
  const campos: FilterField[] = [
    {
      type: 'select',
      id: 'estado',
      label: 'Estado',
      value: params.estado,
      width: 'md',
      options: [
        { value: 'pendiente', label: 'Pendientes' },
        { value: 'validado', label: 'Validados' },
        { value: 'descartado', label: 'Descartados' },
        { value: 'todos', label: 'Todos' },
      ],
    },
    { type: 'search', id: 'q', label: 'Buscar por nombre', value: params.q, placeholder: 'Ej: flan' },
    {
      type: 'select',
      id: 'orden',
      label: 'Ordenar por',
      value: params.orden,
      width: 'lg',
      options: [
        { value: 'fecha', label: 'Fecha (más reciente)' },
        { value: 'ocurrencias', label: 'Cantidad de ocurrencias' },
      ],
    },
  ];
  const canClear = params.estado !== defaults.estado || params.q !== '' || params.orden !== defaults.orden;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Validación de alimentos"
        subtitle={`Alimentos que los deportistas registraron y no estaban en el catálogo. ${total} ${total === 1 ? 'resultado' : 'resultados'}.`}
        helpId="validacion"
      />

      <FilterBar fields={campos} onChange={onChange} onClear={onClear} canClear={canClear} busy={pending} />

      <div className={`${CARD_CLASS} overflow-hidden transition-opacity ${pending ? 'opacity-60' : ''}`} aria-busy={pending}>
        <div
          aria-hidden="true"
          className={`hidden border-b border-slate-100 bg-slate-50/60 px-5 py-3 text-xs font-medium uppercase tracking-wide text-slate-600 ${GRID}`}
        >
          <span>Alimento</span>
          <span>Estado</span>
          <span>Ocurrencias</span>
          <span>Última</span>
          <span />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={`No hay alimentos ${params.estado === 'todos' ? 'en la cola' : `${ESTADO_LABEL[params.estado].toLowerCase()}s`}${params.q ? ` que coincidan con “${params.q}”` : ''}.`}
            action={
              canClear ? (
                <button type="button" onClick={onClear} className="text-sm font-medium text-blue-700 hover:underline">
                  Limpiar filtros
                </button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              const nombre = r.nombre_final ?? r.nombre_original;
              return (
                <li key={r.id_pendiente} aria-label={nombre} className={`flex flex-col gap-2 px-5 py-4 ${GRID}`}>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">
                      {nombre}
                      {r.origen === 'manual' && (
                        <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 align-[1px] text-[11px] font-semibold text-slate-700">Manual</span>
                      )}
                      {r.origen === 'chat' && (
                        <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 align-[1px] text-[11px] font-semibold text-slate-700">Chat</span>
                      )}
                    </p>
                    {nombre !== r.nombre_original && (
                      <p className="truncate text-xs text-slate-600">Detectado como: {r.nombre_original}</p>
                    )}
                  </div>
                  <span>
                    <StatusBadge tone={ESTADO_TONE[r.estado]}>{ESTADO_LABEL[r.estado]}</StatusBadge>
                  </span>
                  <span className="text-sm text-slate-700">
                    <span className="sm:hidden text-slate-600">Ocurrencias: </span>
                    {r.ocurrencias === 0 && r.ocurrencias_manuales === 0 && (r.ocurrencias_chat ?? 0) > 0 ? (
                      // NUT-228: solo chat (sin foto ni cargas manuales).
                      <span>{chats(r.ocurrencias_chat ?? 0)}</span>
                    ) : r.ocurrencias === 0 && r.ocurrencias_manuales > 0 ? (
                      // Solo manual: no hay ocurrencias con foto, así que no se muestra un "0".
                      <>
                        <span>{manuales(r.ocurrencias_manuales)}</span>
                        {(r.ocurrencias_chat ?? 0) > 0 && <span className="block text-xs text-slate-600">+{chats(r.ocurrencias_chat ?? 0)}</span>}
                      </>
                    ) : (
                      <>
                        <span>{r.ocurrencias}</span>
                        {r.ocurrencias_manuales > 0 && <span className="block text-xs text-slate-600">+{manuales(r.ocurrencias_manuales)}</span>}
                        {(r.ocurrencias_chat ?? 0) > 0 && <span className="block text-xs text-slate-600">+{chats(r.ocurrencias_chat ?? 0)}</span>}
                      </>
                    )}
                    {r.usuarios_distintos > 0 && (
                      <span className="block text-xs text-slate-600">
                        {r.usuarios_distintos} {r.usuarios_distintos === 1 ? 'usuario' : 'usuarios'}
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-slate-600">{formatFechaCorta(r.ultima_ocurrencia ?? r.created_at)}</span>
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
          <span className="text-slate-600">
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
        onGuardado={() => router.refresh()}
        onResuelto={() => {
          setAbierto(null);
          router.refresh();
        }}
      />
    </div>
  );
}
