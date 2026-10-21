'use client';

/**
 * NUT-149 — Listado de la cola de revisión de predicciones IA (panel de
 * investigadores). Mismo patrón que `/validacion`: filtros por querystring
 * (<form method="get">), paginación del lado del servidor y detalle en modal.
 * La lista no carga fotos: la signed URL se pide al abrir cada ítem.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { formatFechaCorta } from '@/lib/date';
import { fmt } from '@/lib/numeros';
import { MOTIVOS_REVISION } from '@/lib/revisionIa';
import { PAGE_SIZE, buildRevisionQuery, type RevisionParams } from '@/lib/revisionIaQuery';
import MotivosRevision, { MOTIVO_LABEL } from './MotivosRevision';
import RevisionIaDetalle from './RevisionIaDetalle';
import type { RevisionFila } from './actions';

interface Props {
  rows: RevisionFila[];
  total: number;
  params: RevisionParams;
}

const ESTADO_LABEL: Record<RevisionFila['estado_revision'], string> = {
  pendiente: 'Pendiente',
  confirmado: 'Confirmado',
  corregido: 'Corregido',
};

const ESTADO_BADGE: Record<RevisionFila['estado_revision'], string> = {
  pendiente: 'bg-amber-50 text-amber-800',
  confirmado: 'bg-emerald-50 text-emerald-800',
  corregido: 'bg-blue-50 text-blue-800',
};

export default function RevisionIaClient({ rows, total, params }: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState<number | null>(null);
  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (page: number) => `/revision-ia${buildRevisionQuery(params, { page })}`;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Revisión de predicciones IA</h1>
        <p className="mt-1 text-sm text-slate-600">
          Ítems detectados por la IA con confianza baja o que el deportista corrigió o quitó. {total}{' '}
          {total === 1 ? 'resultado' : 'resultados'}.
        </p>
      </header>

      <form
        role="search"
        method="get"
        action="/revision-ia"
        className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Select
          id="estado"
          name="estado"
          label="Estado"
          defaultValue={params.estado}
          options={[
            { value: 'pendiente', label: 'Pendientes' },
            { value: 'confirmado', label: 'Confirmados' },
            { value: 'corregido', label: 'Corregidos' },
            { value: 'todos', label: 'Todos' },
          ]}
        />
        <Select
          id="motivo"
          name="motivo"
          label="Motivo"
          defaultValue={params.motivo}
          options={[
            { value: 'todos', label: 'Todos los motivos' },
            ...MOTIVOS_REVISION.map((m) => ({ value: m, label: MOTIVO_LABEL[m] })),
          ]}
        />
        <Input id="desde" name="desde" type="date" label="Desde" defaultValue={params.desde} />
        <Input id="hasta" name="hasta" type="date" label="Hasta" defaultValue={params.hasta} />
        <div className="sm:col-span-2">
          <Input id="q" name="q" label="Buscar por nombre de alimento" defaultValue={params.q} placeholder="Ej: milanesa" />
        </div>
        <Select
          id="orden"
          name="orden"
          label="Ordenar por"
          defaultValue={params.orden}
          options={[
            { value: 'fecha', label: 'Fecha (más reciente)' },
            { value: 'confianza', label: 'Confianza (menor primero)' },
          ]}
        />
        <div className="flex items-end">
          <Button type="submit" className="w-full sm:w-auto">
            Filtrar
          </Button>
        </div>
      </form>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-600">
            No hay ítems {params.estado === 'todos' ? 'en la cola' : `${ESTADO_LABEL[params.estado].toLowerCase()}s`} con estos filtros.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li
                key={r.id_deteccion_item}
                aria-label={r.alimento_ia}
                data-quitado={r.item_quitado ? 'true' : undefined}
                className={`flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${
                  r.item_quitado ? 'border-l-4 border-red-500 bg-red-50/40' : ''
                }`}
              >
                <div className="min-w-0 space-y-1.5">
                  <p className="truncate font-medium text-slate-900">
                    <span className="text-slate-600">Gemini: </span>
                    {r.alimento_ia} · {fmt(r.gramos_ia)} g
                  </p>
                  <p className="truncate text-sm text-slate-700">
                    <span className="text-slate-600">Usuario: </span>
                    {r.alimento_usuario == null ? 'Lo quitó' : `${r.alimento_usuario} · ${fmt(r.gramos_usuario ?? 0)} g`}
                  </p>
                  <MotivosRevision motivos={r.motivos_revision} />
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm">
                  <span className="text-slate-600">Confianza {Math.round(r.confidence * 100)}%</span>
                  <span className="text-slate-600">{formatFechaCorta(r.created_at)}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ESTADO_BADGE[r.estado_revision]}`}>
                    {ESTADO_LABEL[r.estado_revision]}
                  </span>
                  {r.candidato_ejemplo && (
                    <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-800">Candidato</span>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Revisar ${r.alimento_ia}`}
                    onClick={() => setAbierto(r.id_deteccion_item)}
                  >
                    Revisar
                  </Button>
                </div>
              </li>
            ))}
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

      <RevisionIaDetalle
        idItem={abierto}
        onClose={() => setAbierto(null)}
        onCambio={() => router.refresh()}
      />
    </div>
  );
}
