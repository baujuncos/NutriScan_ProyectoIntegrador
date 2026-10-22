'use client';

/**
 * NUT-149 — Cola de revisión de predicciones IA (panel de investigadores).
 * Chips de estado y FilterBar estándar (sin botón: se aplican al cambiar y viven en la URL),
 * filas con Confirmar / Corregir / candidato a ejemplo directo en la lista y
 * paginación del lado del servidor. La lista no carga fotos (muestra un
 * placeholder): la signed URL se pide al abrir el detalle de cada ítem.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { CARD_CLASS } from '@/components/researcher/Card';
import EmptyState from '@/components/researcher/EmptyState';
import FilterBar, { type FilterField } from '@/components/researcher/FilterBar';
import PageHeader from '@/components/researcher/PageHeader';
import StatusBadge from '@/components/researcher/StatusBadge';
import SubTabs from '@/components/researcher/SubTabs';
import { useFiltrosServidor } from '@/components/researcher/useFiltrosServidor';
import { fmt } from '@/lib/numeros';
import { MOTIVOS_REVISION, UMBRAL_CONFIANZA_BAJA } from '@/lib/revisionIa';
import { PAGE_SIZE, buildRevisionQuery, parseRevisionParams, type ConteosRevision, type RevisionParams } from '@/lib/revisionIaQuery';
import EstadoColaChips from './EstadoColaChips';
import MotivosRevision, { MOTIVO_LABEL } from './MotivosRevision';
import RevisionIaDetalle from './RevisionIaDetalle';
import { confirmarRevisionAction, marcarCandidatoAction, type RevisionFila } from './actions';

interface Props {
  rows: RevisionFila[];
  total: number;
  params: RevisionParams;
  conteos: ConteosRevision;
}

const VAJILLA_LABEL: Record<string, string> = {
  plato_playo: 'Plato playo',
  plato_postre: 'Plato postre',
  plato_hondo: 'Plato hondo',
};

const ESTADO_LABEL: Record<RevisionFila['estado_revision'], string> = {
  pendiente: 'Pendiente',
  confirmado: 'Confirmado',
  corregido: 'Corregido',
};

/** "18 oct" (hora de Argentina). */
const fechaCorta = (iso: string) =>
  new Date(iso)
    .toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: 'America/Argentina/Buenos_Aires' })
    .replace('.', '');

const Etiqueta = ({ children }: { children: React.ReactNode }) => (
  <span className="w-[4.5rem] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{children}</span>
);

const Flecha = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="shrink-0 text-slate-500">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-5-5 5 5-5 5" />
  </svg>
);

/** Las tres líneas de comparación: Gemini vs. final del usuario, y peso estimado vs. final. */
function Comparacion({ r }: { r: RevisionFila }) {
  const cambioPeso = r.gramos_usuario != null ? Math.round(((r.gramos_usuario - r.gramos_ia) / r.gramos_ia) * 100) : null;
  const pesoGrande = r.motivos_revision.includes('correccion_peso_grande');
  const alimentoCambio = r.alimento_usuario != null && r.alimento_usuario !== r.alimento_ia;
  const confianzaBaja = r.confidence < UMBRAL_CONFIANZA_BAJA;

  return (
    <div className="mt-2 space-y-1.5 text-sm">
      {r.item_quitado ? (
        <p className="flex flex-wrap items-baseline gap-x-2">
          <Etiqueta>Gemini</Etiqueta>
          <span className="font-semibold text-slate-900">{r.alimento_ia}</span>
          <span className="text-slate-600">— el usuario lo quitó, no estaba en el plato</span>
        </p>
      ) : alimentoCambio ? (
        <p className="flex flex-wrap items-center gap-x-2">
          <Etiqueta>Gemini</Etiqueta>
          <span className="font-semibold text-slate-900">{r.alimento_ia}</span>
          <Flecha />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Final</span>
          <span className="font-semibold text-slate-900">{r.alimento_usuario}</span>
        </p>
      ) : (
        <p className="flex flex-wrap items-baseline gap-x-2">
          <Etiqueta>Alimento</Etiqueta>
          <span className="font-semibold text-slate-900">{r.alimento_ia}</span>
          <span className="text-slate-600">— sin cambio</span>
        </p>
      )}

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Etiqueta>Peso</Etiqueta>
        <span className="text-slate-700">{fmt(r.gramos_ia)} g estimado</span>
        {r.gramos_usuario != null &&
          (pesoGrande ? (
            <>
              <Flecha />
              <span className="font-semibold text-slate-900">{fmt(r.gramos_usuario)} g final</span>
              {cambioPeso != null && (
                <span className="font-semibold text-red-700">
                  ({cambioPeso > 0 ? '+' : ''}
                  {cambioPeso}%)
                </span>
              )}
            </>
          ) : (
            <span className="text-slate-700">· {fmt(r.gramos_usuario)} g final</span>
          ))}
        <StatusBadge tone={confianzaBaja ? 'red' : 'emerald'} className="font-semibold">
          Confianza {Math.round(r.confidence * 100)}%
        </StatusBadge>
      </p>
    </div>
  );
}

export default function RevisionIaClient({ rows, total, params, conteos }: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState<{ id: number; corregir: boolean } | null>(null);
  const [trabajando, setTrabajando] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (page: number) => `/revision-ia${buildRevisionQuery(params, { page })}`;

  async function ejecutar(id: number, accion: () => Promise<{ ok: true } | { error: string }>) {
    setTrabajando(id);
    setError(null);
    const r = await accion();
    setTrabajando(null);
    if ('error' in r) setError(r.error);
    else router.refresh();
  }

  const defaults = parseRevisionParams({});
  const { pending, onChange, onClear } = useFiltrosServidor({ path: '/revision-ia', params, defaults, build: buildRevisionQuery });
  const campos: FilterField[] = [
    {
      type: 'select',
      id: 'estado',
      label: 'Estado',
      value: params.estado,
      width: 'sm',
      options: [
        { value: 'pendiente', label: 'Pendientes' },
        { value: 'confirmado', label: 'Confirmados' },
        { value: 'corregido', label: 'Corregidos' },
        { value: 'todos', label: 'Todos' },
      ],
    },
    {
      type: 'select',
      id: 'motivo',
      label: 'Motivo',
      value: params.motivo,
      width: 'md',
      options: [{ value: 'todos', label: 'Todos' }, ...MOTIVOS_REVISION.map((m) => ({ value: m, label: MOTIVO_LABEL[m] }))],
    },
    { type: 'search', id: 'q', label: 'Buscar por alimento', value: params.q, placeholder: 'Ej: empanada' },
    {
      type: 'select',
      id: 'vajilla',
      label: 'Vajilla',
      value: params.vajilla,
      width: 'sm',
      options: [{ value: 'todas', label: 'Todas' }, ...Object.entries(VAJILLA_LABEL).map(([value, label]) => ({ value, label }))],
    },
    {
      type: 'select',
      id: 'orden',
      label: 'Ordenar por',
      value: params.orden,
      width: 'md',
      options: [
        { value: 'fecha', label: 'Más recientes' },
        { value: 'confianza', label: 'Menor confianza' },
      ],
    },
  ];
  // Desde/Hasta ya no tienen control en la barra (no entran en una fila); si vienen en la URL siguen aplicándose y "Limpiar" los saca.
  const canClear =
    params.estado !== defaults.estado || params.motivo !== defaults.motivo || params.vajilla !== defaults.vajilla ||
    params.q !== '' || params.orden !== defaults.orden || params.desde !== '' || params.hasta !== '';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Revisión de IA"
        subtitle="Detecciones de Gemini marcadas para revisión manual del equipo de nutrición."
        helpId="revision-cola"
        actions={
          <EstadoColaChips
            conteos={conteos}
            activo={params.estado}
            hrefDe={(estado) => `/revision-ia${buildRevisionQuery(params, { estado: params.estado === estado ? 'todos' : estado, page: 1 })}`}
          />
        }
      />

      <SubTabs
        tabs={[
          { label: 'Cola de revisión', href: '/revision-ia' },
          { label: 'Métricas', href: '/revision-ia/metricas' },
        ]}
        activeHref="/revision-ia"
      />

      <FilterBar fields={campos} onChange={onChange} onClear={onClear} canClear={canClear} busy={pending} />

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <div className={CARD_CLASS}>
          <EmptyState
            title={`No hay ítems ${params.estado === 'todos' ? 'en la cola' : `${ESTADO_LABEL[params.estado].toLowerCase()}s`} con estos filtros.`}
            action={
              canClear ? (
                <button type="button" onClick={onClear} className="text-sm font-medium text-blue-700 hover:underline">
                  Limpiar filtros
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ul className={`space-y-4 transition-opacity ${pending ? 'opacity-60' : ''}`} aria-busy={pending}>
          {rows.map((r) => {
            const pendiente = r.estado_revision === 'pendiente';
            const ocupado = trabajando === r.id_deteccion_item;
            return (
              <li
                key={r.id_deteccion_item}
                aria-label={r.alimento_ia}
                data-quitado={r.item_quitado ? 'true' : undefined}
                className={`${CARD_CLASS} flex flex-col gap-4 p-5 sm:flex-row`}
              >
                {/* Placeholder: la foto real (signed URL) se pide al abrir el detalle. */}
                <button
                  type="button"
                  aria-label={`Ver detalle y foto de ${r.alimento_ia}`}
                  onClick={() => setAbierto({ id: r.id_deteccion_item, corregir: false })}
                  className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                    <circle cx="9" cy="9" r="1.75" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 15-4.5-4.5L6 21" />
                  </svg>
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <MotivosRevision motivos={r.motivos_revision} />
                    <span className="text-xs text-slate-500">
                      {fechaCorta(r.created_at)} · {VAJILLA_LABEL[r.vajilla_tipo] ?? r.vajilla_tipo} · {fmt(r.vajilla_diametro_cm)} cm ·{' '}
                      {r.angulo_captura_grados}°
                    </span>
                  </div>
                  <Comparacion r={r} />
                </div>

                <div className="flex shrink-0 flex-row items-center gap-2 sm:w-32 sm:flex-col sm:items-stretch">
                  {pendiente ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        disabled={ocupado}
                        loading={ocupado}
                        aria-label={`Confirmar ${r.alimento_ia}`}
                        onClick={() => ejecutar(r.id_deteccion_item, () => confirmarRevisionAction(r.id_deteccion_item))}
                      >
                        ✓ Confirmar
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={ocupado}
                        aria-label={`Corregir ${r.alimento_ia}`}
                        onClick={() => setAbierto({ id: r.id_deteccion_item, corregir: true })}
                      >
                        ✎ Corregir
                      </Button>
                    </>
                  ) : (
                    <StatusBadge tone={r.estado_revision === 'confirmado' ? 'emerald' : 'blue'} className="justify-center py-1.5 text-sm">
                      {ESTADO_LABEL[r.estado_revision]}
                    </StatusBadge>
                  )}
                  <button
                    type="button"
                    disabled={ocupado}
                    aria-pressed={r.candidato_ejemplo}
                    aria-label={`Candidato a ejemplo: ${r.alimento_ia}`}
                    title="Marcar como candidato a ejemplo"
                    onClick={() => ejecutar(r.id_deteccion_item, () => marcarCandidatoAction(r.id_deteccion_item, !r.candidato_ejemplo))}
                    className={`mx-auto flex h-8 w-8 items-center justify-center rounded-lg border text-lg leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 ${
                      r.candidato_ejemplo ? 'border-amber-300 bg-amber-50 text-amber-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {r.candidato_ejemplo ? '★' : '☆'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

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
        idItem={abierto?.id ?? null}
        corregirAlAbrir={abierto?.corregir ?? false}
        onClose={() => setAbierto(null)}
        onCambio={() => router.refresh()}
      />
    </div>
  );
}
