'use client';

/**
 * NUT-149 — Detalle de un ítem de la cola de revisión. La foto llega como signed
 * URL de corta duración, pedida recién al abrir (nunca en la lista). Compara las
 * tres fuentes sin pisarlas: Gemini, usuario y nutricionista. Confirmar, Corregir
 * y "Candidato a ejemplo" son acciones independientes.
 */
import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { formatFechaCorta } from '@/lib/date';
import { fmt } from '@/lib/numeros';
import MotivosRevision from './MotivosRevision';
import {
  confirmarRevisionAction,
  corregirRevisionAction,
  getRevisionDetalleAction,
  marcarCandidatoAction,
  type RevisionFila,
} from './actions';

interface Props {
  /** null = cerrado. */
  idItem: number | null;
  /** Abre directo en el formulario de corrección (botón Corregir de la lista). */
  corregirAlAbrir?: boolean;
  onClose: () => void;
  /** Se llama tras cualquier acción exitosa (la página refresca el listado). */
  onCambio: () => void;
}

const VAJILLA_LABEL: Record<string, string> = {
  plato_playo: 'Plato playo',
  plato_postre: 'Plato postre',
  plato_hondo: 'Plato hondo',
};

function Columna({ titulo, alimento, gramos, vacio }: { titulo: string; alimento: string | null; gramos: number | null; vacio: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{titulo}</h3>
      {alimento == null && gramos == null ? (
        <p className="mt-1 text-sm text-slate-600">{vacio}</p>
      ) : (
        <>
          <p className="mt-1 text-sm font-medium text-slate-900">{alimento ?? '—'}</p>
          <p className="text-sm text-slate-700">{gramos != null ? `${fmt(gramos)} g` : '—'}</p>
        </>
      )}
    </div>
  );
}

export default function RevisionIaDetalle({ idItem, corregirAlAbrir = false, onClose, onCambio }: Props) {
  const [fila, setFila] = useState<RevisionFila | null>(null);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [alimento, setAlimento] = useState('');
  const [gramos, setGramos] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // La signed URL se pide al abrir el ítem (y se vuelve a pedir si se reabre).
  useEffect(() => {
    if (idItem == null) return;
    let cancelado = false;
    setFila(null);
    setFotoUrl(null);
    setErrorCarga(null);
    setCorrigiendo(corregirAlAbrir);
    setAlimento('');
    setGramos('');
    setError(null);
    getRevisionDetalleAction(idItem).then((r) => {
      if (cancelado) return;
      if ('error' in r) setErrorCarga(r.error);
      else {
        setFila(r.fila);
        setFotoUrl(r.fotoUrl);
      }
    });
    return () => {
      cancelado = true;
    };
    // corregirAlAbrir sólo se lee al abrir: cambiarlo con el modal abierto no tiene que recargar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idItem]);

  async function ejecutar(accion: () => Promise<{ ok: true } | { error: string }>, alExito: () => void) {
    setTrabajando(true);
    setError(null);
    const r = await accion();
    setTrabajando(false);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    alExito();
    onCambio();
  }

  const pendiente = fila?.estado_revision === 'pendiente';
  const gramosNum = gramos.trim() === '' ? null : Number(gramos);
  const correccionValida = (alimento.trim() !== '' || gramosNum != null) && (gramosNum == null || (Number.isFinite(gramosNum) && gramosNum > 0));

  return (
    <Modal open={idItem != null} onClose={onClose} title="Revisar predicción" wide>
      {errorCarga && <p role="alert" className="text-sm text-red-700">{errorCarga}</p>}
      {!errorCarga && !fila && <p className="text-sm text-slate-600">Cargando…</p>}
      {fila && (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div>
              {fotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fotoUrl} alt={`Foto del plato, ${formatFechaCorta(fila.created_at)}`} className="w-full rounded-xl bg-slate-900 object-contain" />
              ) : (
                <p className="rounded-xl bg-slate-100 px-3 py-10 text-center text-sm text-slate-600">Sin foto disponible</p>
              )}
              <p className="mt-2 text-xs text-slate-600">
                {VAJILLA_LABEL[fila.vajilla_tipo] ?? fila.vajilla_tipo} de {fmt(fila.vajilla_diametro_cm)} cm · ángulo{' '}
                {fila.angulo_aproximado ? '≈ ' : ''}
                {fila.angulo_captura_grados}° · {formatFechaCorta(fila.created_at)}
              </p>
            </div>

            <div className="space-y-3">
              <MotivosRevision motivos={fila.motivos_revision} />
              <p className="text-sm text-slate-700">Confianza de la IA: {Math.round(fila.confidence * 100)}%</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <Columna titulo="Gemini" alimento={fila.alimento_ia} gramos={fila.gramos_ia} vacio="" />
                <Columna titulo="Usuario" alimento={fila.alimento_usuario} gramos={fila.gramos_usuario} vacio="Lo quitó" />
                <Columna titulo="Nutricionista" alimento={fila.nutricionista_alimento} gramos={fila.nutricionista_gramos} vacio="Sin revisar" />
              </div>
            </div>
          </div>

          {corrigiendo && pendiente && (
            <fieldset className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_8rem]">
              <legend className="px-1 text-sm font-semibold text-slate-800">Tu corrección</legend>
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Alimento
                <input
                  value={alimento}
                  onChange={(e) => setAlimento(e.target.value)}
                  maxLength={200}
                  className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Peso (g)
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="1"
                  value={gramos}
                  onChange={(e) => setGramos(e.target.value)}
                  className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
            </fieldset>
          )}

          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={trabajando}
              aria-pressed={fila.candidato_ejemplo}
              onClick={() =>
                ejecutar(
                  () => marcarCandidatoAction(fila.id_deteccion_item, !fila.candidato_ejemplo),
                  () => setFila({ ...fila, candidato_ejemplo: !fila.candidato_ejemplo }),
                )
              }
            >
              {fila.candidato_ejemplo ? '★ Candidato a ejemplo' : '☆ Marcar como candidato a ejemplo'}
            </Button>

            <span className="ml-auto flex gap-2">
              {pendiente ? (
                <>
                  {!corrigiendo ? (
                    <Button type="button" variant="outline" disabled={trabajando} onClick={() => setCorrigiendo(true)}>
                      Corregir
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      disabled={trabajando || !correccionValida}
                      loading={trabajando}
                      onClick={() =>
                        ejecutar(
                          () => corregirRevisionAction({ id: fila.id_deteccion_item, alimento: alimento || null, gramos: gramosNum }),
                          onClose,
                        )
                      }
                    >
                      Guardar corrección
                    </Button>
                  )}
                  <Button
                    type="button"
                    disabled={trabajando || corrigiendo}
                    loading={trabajando && !corrigiendo}
                    onClick={() => ejecutar(() => confirmarRevisionAction(fila.id_deteccion_item), onClose)}
                  >
                    Confirmar
                  </Button>
                </>
              ) : (
                <span className="text-sm text-slate-600">
                  {fila.estado_revision === 'confirmado' ? 'Confirmado' : 'Corregido'}
                  {fila.revisado_en ? ` el ${formatFechaCorta(fila.revisado_en)}` : ''}
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
}
