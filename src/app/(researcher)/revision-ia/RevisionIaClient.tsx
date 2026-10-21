'use client';

/**
 * NUT-149 — Cola de revisión de predicciones IA (panel de investigadores).
 * Chips de estado (filtran por querystring), filtros en <form method="get">,
 * filas con Confirmar / Corregir / candidato a ejemplo directo en la lista y
 * paginación del lado del servidor. La lista no carga fotos (muestra un
 * placeholder): la signed URL se pide al abrir el detalle de cada ítem.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { fmt } from '@/lib/numeros';
import { MOTIVOS_REVISION, UMBRAL_CONFIANZA_BAJA } from '@/lib/revisionIa';
import { PAGE_SIZE, buildRevisionQuery, type ConteosRevision, type RevisionParams } from '@/lib/revisionIaQuery';
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

const KPIS: Array<{ estado: keyof ConteosRevision; etiqueta: string; clase: string }> = [
  { estado: 'pendiente', etiqueta: 'Pendientes', clase: 'bg-amber-50 text-amber-800' },
  { estado: 'confirmado', etiqueta: 'Confirmados', clase: 'bg-emerald-50 text-emerald-800' },
  { estado: 'corregido', etiqueta: 'Corregidos', clase: 'bg-blue-50 text-blue-800' },
];

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
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            confianzaBaja ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'
          }`}
        >
          Confianza {Math.round(r.confidence * 100)}%
        </span>
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

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Revisión de IA</h1>
          <p className="mt-1 text-sm text-slate-600">
            Detecciones de Gemini marcadas para revisión manual del equipo de nutrición.
          </p>
        </div>
        <nav aria-label="Filtrar por estado" className="flex gap-2">
          {KPIS.map((k) => {
            const activo = params.estado === k.estado;
            return (
              <Link
                key={k.estado}
                href={`/revision-ia${buildRevisionQuery(params, { estado: activo ? 'todos' : k.estado, page: 1 })}`}
                aria-current={activo ? 'true' : undefined}
                className={`min-w-[6.5rem] rounded-xl px-4 py-2.5 ${k.clase} ${activo ? 'ring-2 ring-current' : ''}`}
              >
                <span className="block text-xl font-bold leading-tight">{conteos[k.estado]}</span>
                <span className="block text-xs font-medium">{k.etiqueta}</span>
              </Link>
            );
          })}
        </nav>
      </header>

      <div role="tablist" aria-label="Secciones" className="inline-flex gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
        <span role="tab" aria-selected="true" className="rounded-lg bg-white px-4 py-2 text-slate-900 shadow-sm">
          Cola de revisión
        </span>
        {/* Se habilita con el dashboard de métricas (NUT-151). */}
        <span role="tab" aria-selected="false" aria-disabled="true" title="Próximamente" className="cursor-not-allowed px-4 py-2 text-slate-500">
          Métricas
        </span>
      </div>

      <form
        role="search"
        method="get"
        action="/revision-ia"
        className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"
      >
        <input type="hidden" name="estado" value={params.estado} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_1fr_1fr_auto] lg:items-end">
          <Select
            id="motivo"
            name="motivo"
            label="Motivo"
            defaultValue={params.motivo}
            options={[
              { value: 'todos', label: 'Todos' },
              ...MOTIVOS_REVISION.map((m) => ({ value: m, label: MOTIVO_LABEL[m] })),
            ]}
          />
          <Input id="q" name="q" label="Buscar por alimento" defaultValue={params.q} placeholder="Ej: empanada" />
          <Select
            id="vajilla"
            name="vajilla"
            label="Vajilla"
            defaultValue={params.vajilla}
            options={[{ value: 'todas', label: 'Todas' }, ...Object.entries(VAJILLA_LABEL).map(([value, label]) => ({ value, label }))]}
          />
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
          <Button type="submit">Filtrar</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:max-w-md">
          <Input id="desde" name="desde" type="date" label="Desde" defaultValue={params.desde} />
          <Input id="hasta" name="hasta" type="date" label="Hasta" defaultValue={params.hasta} />
        </div>
      </form>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-600">
          No hay ítems {params.estado === 'todos' ? 'en la cola' : `${ESTADO_LABEL[params.estado].toLowerCase()}s`} con estos filtros.
        </p>
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => {
            const pendiente = r.estado_revision === 'pendiente';
            const ocupado = trabajando === r.id_deteccion_item;
            return (
              <li
                key={r.id_deteccion_item}
                aria-label={r.alimento_ia}
                data-quitado={r.item_quitado ? 'true' : undefined}
                className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row"
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
                    <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-center text-sm font-medium text-slate-700">
                      {ESTADO_LABEL[r.estado_revision]}
                    </span>
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
