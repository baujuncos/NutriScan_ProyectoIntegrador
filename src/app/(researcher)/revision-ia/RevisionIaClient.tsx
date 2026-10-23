'use client';

/**
 * NUT-149 — Cola de revisión de predicciones IA (panel de investigadores).
 * Chips de estado y FilterBar estándar (sin botón: se aplican al cambiar y viven en la URL),
 * filas con Confirmar / Corregir / "Ejemplo para la IA" directo en la lista y
 * paginación del lado del servidor. Las fotos llegan firmadas en lote desde el servidor (una sola
 * llamada por página); si una URL vence se pide una nueva una sola vez por foto, y después, el fallback.
 */
import { useEffect, useRef, useState } from 'react';
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
import { cajaDeFila } from '@/lib/marcaFoto';
import { MOTIVOS_REVISION, UMBRAL_CONFIANZA_BAJA } from '@/lib/revisionIa';
import { PAGE_SIZE, buildRevisionQuery, parseRevisionParams, type ConteosRevision, type RevisionParams } from '@/lib/revisionIaQuery';
import { EjemploIaToggle } from './EjemploParaIa';
import EstadoColaChips from './EstadoColaChips';
import FotoMiniatura from './FotoMiniatura';
import MotivosRevision, { MOTIVO_LABEL } from './MotivosRevision';
import RevisionIaDetalle from './RevisionIaDetalle';
import TrioRevisado, { lineaRevision } from './TrioRevisado';
import { confirmarRevisionAction, marcarCandidatoAction, reabrirRevisionAction, renovarFotoAction, type RevisionFila } from './actions';
import Modal from '@/components/ui/Modal';
import { resumenInvestigador } from '@/lib/revisionIaForm';

interface Props {
  rows: RevisionFila[];
  total: number;
  params: RevisionParams;
  conteos: ConteosRevision;
  /** Signed URLs por `imagen_path`, firmadas en lote en el servidor. */
  fotos: Record<string, string>;
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

/** Ítem Confirmado: quién, cuándo y el valor final que quedó. */
function LineaConfirmado({ r }: { r: RevisionFila }) {
  const inv = resumenInvestigador(r);
  return (
    <p className="mt-2 text-xs text-slate-600">
      {lineaRevision(r)} · Valor final: <strong className="font-semibold text-slate-800">{inv.nombre == null ? 'ítem quitado' : `${inv.nombre} · ${fmt(inv.gramos ?? 0)} g`}</strong>
    </p>
  );
}

export default function RevisionIaClient({ rows, total, params, conteos, fotos }: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState<{ id: number; corregir: boolean } | null>(null);
  const [trabajando, setTrabajando] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Ítem ya revisado que se está por reabrir (pide confirmación: se borran los valores del investigador). */
  const [reabriendo, setReabriendo] = useState<RevisionFila | null>(null);

  // URLs de las fotos: las del servidor + las que se renovaron. Cuando llega otra página (props nuevas) se reinician.
  const [urls, setUrls] = useState(fotos);
  const [fotosPrevias, setFotosPrevias] = useState(fotos);
  if (fotosPrevias !== fotos) {
    setFotosPrevias(fotos);
    setUrls(fotos);
  }
  const urlsRef = useRef(urls);
  const intentos = useRef(new Map<string, Promise<string | null>>());
  useEffect(() => {
    urlsRef.current = urls;
  }, [urls]);
  useEffect(() => {
    intentos.current = new Map();
  }, [fotos]);

  /** Una URL nueva para una foto cuya URL falló, UNA sola vez por foto (sin loops); null = no hay otra. */
  async function renovarFoto(path: string, urlFallida: string): Promise<string | null> {
    const actual = urlsRef.current[path];
    if (actual && actual !== urlFallida) return actual; // otra tarjeta de la misma foto ya la renovó
    let intento = intentos.current.get(path);
    if (!intento) {
      intento = renovarFotoAction(path).then((r) => {
        if (!('url' in r)) return null;
        urlsRef.current = { ...urlsRef.current, [path]: r.url };
        setUrls((u) => ({ ...u, [path]: r.url }));
        return r.url;
      });
      intentos.current.set(path, intento);
    }
    const nueva = await intento;
    return nueva === urlFallida ? null : nueva; // la renovada también falló: se acabó
  }

  const filaAbierta = rows.find((r) => r.id_deteccion_item === abierto?.id) ?? null;
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
                <button
                  type="button"
                  aria-label={`Ver detalle y foto de ${r.alimento_ia}`}
                  onClick={() => setAbierto({ id: r.id_deteccion_item, corregir: false })}
                  className="shrink-0 self-start rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <FotoMiniatura
                    src={r.imagen_path ? urls[r.imagen_path] ?? null : null}
                    alt={`Foto de la comida: ${r.alimento_ia}`}
                    caja={cajaDeFila(r)}
                    onFallo={(fallida) => (r.imagen_path ? renovarFoto(r.imagen_path, fallida) : Promise.resolve(null))}
                  />
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <MotivosRevision motivos={r.motivos_revision} />
                    <span className="text-xs text-slate-500">
                      {fechaCorta(r.created_at)} · {VAJILLA_LABEL[r.vajilla_tipo] ?? r.vajilla_tipo} · {fmt(r.vajilla_diametro_cm)} cm ·{' '}
                      {r.angulo_captura_grados}°
                    </span>
                  </div>
                  {r.estado_revision === 'corregido' ? (
                    <TrioRevisado fila={r} />
                  ) : (
                    <>
                      <Comparacion r={r} />
                      {r.estado_revision === 'confirmado' && <LineaConfirmado r={r} />}
                    </>
                  )}
                  <div className="mt-3">
                    <EjemploIaToggle
                      marcado={r.candidato_ejemplo}
                      disabled={ocupado}
                      contexto={r.alimento_ia}
                      onToggle={() => ejecutar(r.id_deteccion_item, () => marcarCandidatoAction(r.id_deteccion_item, !r.candidato_ejemplo))}
                    />
                  </div>
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
                    <>
                      <StatusBadge tone={r.estado_revision === 'confirmado' ? 'emerald' : 'blue'} className="justify-center py-1.5 text-sm">
                        {ESTADO_LABEL[r.estado_revision]}
                      </StatusBadge>
                      <Button type="button" variant="outline" size="sm" aria-label={`Ver detalle de ${r.alimento_ia}`} onClick={() => setAbierto({ id: r.id_deteccion_item, corregir: false })}>
                        Ver detalle
                      </Button>
                      <Button type="button" variant="ghost" size="sm" disabled={ocupado} aria-label={`Reabrir ${r.alimento_ia}`} onClick={() => setReabriendo(r)}>
                        Reabrir
                      </Button>
                    </>
                  )}
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
        key={abierto?.id ?? 'cerrado'}
        fila={filaAbierta}
        fotoUrl={filaAbierta?.imagen_path ? urls[filaAbierta.imagen_path] ?? null : null}
        onFotoFallo={(fallida) => (filaAbierta?.imagen_path ? renovarFoto(filaAbierta.imagen_path, fallida) : Promise.resolve(null))}
        onClose={() => setAbierto(null)}
        onCambio={() => router.refresh()}
        onReabrir={() => {
          setReabriendo(filaAbierta);
          setAbierto(null);
        }}
      />

      <Modal
        open={reabriendo != null}
        onClose={() => setReabriendo(null)}
        title="Reabrir revisión"
        size="sm"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setReabriendo(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={async () => {
                if (!reabriendo) return;
                setError(null);
                const r = await reabrirRevisionAction(reabriendo.id_deteccion_item);
                setReabriendo(null);
                if ('error' in r) setError(r.error);
                else router.refresh();
              }}
            >
              Reabrir
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          «{reabriendo?.alimento_ia}» vuelve a Pendientes y se borra la corrección del investigador. Lo que detectó la IA y lo que dejó el deportista no cambia.
        </p>
      </Modal>
    </div>
  );
}
