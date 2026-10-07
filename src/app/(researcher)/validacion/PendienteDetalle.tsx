'use client';

/**
 * NUT-119 — Detalle de un alimento de la cola de validación: contexto de cada
 * ocurrencia (foto + bounding box, nombre IA vs final, respuestas, gramaje),
 * estimación original de Gemini (solo lectura) y formulario editable por
 * 100 g con vista previa de los totales. Validar / Descartar piden confirmación.
 */
import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { searchAlimentosAction, type AlimentoOption } from '@/app/alimentacion/actions';
import { formatFechaCorta } from '@/lib/date';
import { macrosItem, macrosPlausibles, type Macros100 } from '@/lib/macros';
import {
  descartarPendienteAction,
  getPendienteDetalleAction,
  modificarPendienteAction,
  validarPendienteAction,
  type OcurrenciaDetalle,
  type PendienteFila,
} from './actions';

interface Props {
  /** null = cerrado. */
  idPendiente: number | null;
  onClose: () => void;
  /** Se llama tras validar o descartar con éxito (la página refresca el listado). */
  onResuelto: () => void;
}

interface Datos {
  pendiente: PendienteFila;
  ocurrencias: OcurrenciaDetalle[];
  totalOcurrencias: number;
}

const redondear1 = (n: number) => Math.round(n * 10) / 10;
const aNumero = (s: string): number | null => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));
const plural = (n: number) => `${n} ítem${n === 1 ? '' : 's'}`;

function FotoOcurrencia({ o }: { o: OcurrenciaDetalle }) {
  if (!o.fotoUrl) {
    return (
      <div className="flex h-40 w-full items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-500 sm:w-40">
        Sin foto
      </div>
    );
  }
  return (
    <div className="relative h-40 w-full shrink-0 overflow-hidden rounded-xl bg-slate-900 sm:w-40">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={o.fotoUrl}
        alt={`Foto del plato de ${o.deportista ?? 'un deportista'}, ${formatFechaCorta(o.fecha)}`}
        className="h-full w-full object-cover"
      />
      {o.bbox && (
        <div
          data-testid="bbox"
          aria-hidden="true"
          className="pointer-events-none absolute rounded border-2 border-amber-400"
          style={{
            left: `${o.bbox.x * 100}%`,
            top: `${o.bbox.y * 100}%`,
            width: `${o.bbox.width * 100}%`,
            height: `${o.bbox.height * 100}%`,
          }}
        />
      )}
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      {children}
    </div>
  );
}

export default function PendienteDetalle({ idPendiente, onClose, onResuelto }: Props) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [nombre, setNombre] = useState('');
  const [categoria, setCategoria] = useState('');
  const [kcal, setKcal] = useState('');
  const [prot, setProt] = useState('');
  const [grasas, setGrasas] = useState('');
  const [carbs, setCarbs] = useState('');
  const [obs, setObs] = useState('');

  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<AlimentoOption[]>([]);
  const [vinculado, setVinculado] = useState<AlimentoOption | null>(null);

  const [confirmando, setConfirmando] = useState<'validar' | 'descartar' | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [duplicadoId, setDuplicadoId] = useState<number | null>(null);

  // Carga del detalle cada vez que se abre otro alimento.
  useEffect(() => {
    if (idPendiente == null) return;
    let cancelado = false;
    setDatos(null);
    setErrorCarga(null);
    setConfirmando(null);
    setError(null);
    setAviso(null);
    setDuplicadoId(null);
    setVinculado(null);
    setBusqueda('');
    setResultados([]);
    void getPendienteDetalleAction(idPendiente).then((r) => {
      if (cancelado) return;
      if ('error' in r) {
        setErrorCarga(r.error);
        return;
      }
      const p = r.pendiente;
      setDatos({ pendiente: p, ocurrencias: r.ocurrencias, totalOcurrencias: r.totalOcurrencias });
      // Precarga: lo que dejó el investigador (borrador) o, si no, lo que estimó Gemini.
      const num = (final: number | null, gemini: number | null) => String(final ?? gemini ?? '');
      setNombre(p.nombre_final ?? p.nombre_original);
      setCategoria(p.categoria_final ?? p.categoria_ia ?? '');
      setKcal(num(p.final_kcal_100g, p.gemini_kcal_100g));
      setProt(num(p.final_proteinas_100g, p.gemini_proteinas_100g));
      setGrasas(num(p.final_grasas_100g, p.gemini_grasas_100g));
      setCarbs(num(p.final_carbs_100g, p.gemini_carbs_100g));
      setObs(p.observaciones ?? '');
    });
    return () => {
      cancelado = true;
    };
  }, [idPendiente]);

  // Búsqueda en el catálogo (con debounce, como el resto de los buscadores).
  useEffect(() => {
    if (busqueda.trim().length < 2) {
      setResultados([]);
      return;
    }
    const timer = setTimeout(async () => {
      setResultados((await searchAlimentosAction(busqueda, '')).slice(0, 6));
    }, 300);
    return () => clearTimeout(timer);
  }, [busqueda]);

  const valores = {
    kcal: aNumero(kcal),
    proteinas: aNumero(prot),
    grasas: aNumero(grasas),
    carbs: aNumero(carbs),
  };
  const completos = Object.values(valores).every((v) => v != null);
  const macros: Macros100 | null = completos
    ? {
        kcal_100g: valores.kcal!,
        proteinas_100g: valores.proteinas!,
        grasas_100g: valores.grasas!,
        carbs_100g: valores.carbs!,
      }
    : null;
  const incoherente = macros != null && !macrosPlausibles(macros);

  const p = datos?.pendiente;
  const soloLectura = p != null && p.estado !== 'pendiente';
  const puedeResolver = !soloLectura && completos && nombre.trim() !== '' && !trabajando;
  const total = datos?.totalOcurrencias ?? 0;

  const argsForm = () => ({
    id: p!.id_pendiente,
    nombre: nombre.trim(),
    categoria: categoria.trim() || null,
    observaciones: obs.trim() || null,
  });

  const guardarBorrador = async () => {
    setTrabajando(true);
    setError(null);
    setAviso(null);
    const r = await modificarPendienteAction({ ...argsForm(), ...valores });
    setTrabajando(false);
    if ('error' in r) setError(r.error);
    else setAviso('Borrador guardado');
  };

  const validar = async (idExistente: number | null) => {
    setTrabajando(true);
    setError(null);
    setDuplicadoId(null);
    const r = await validarPendienteAction({
      ...argsForm(),
      kcal: valores.kcal!,
      proteinas: valores.proteinas!,
      grasas: valores.grasas!,
      carbs: valores.carbs!,
      idAlimentoExistente: idExistente,
    });
    setTrabajando(false);
    setConfirmando(null);
    if ('error' in r) {
      setError(r.error);
      setDuplicadoId(r.idAlimentoExistente ?? null);
      return;
    }
    onResuelto();
  };

  const descartar = async () => {
    setTrabajando(true);
    setError(null);
    const r = await descartarPendienteAction({ id: p!.id_pendiente, observaciones: obs.trim() || null });
    setTrabajando(false);
    setConfirmando(null);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    onResuelto();
  };

  return (
    <Modal open={idPendiente != null} onClose={onClose} title="Revisar alimento" wide>
      {errorCarga && <p className="text-sm text-red-600">{errorCarga}</p>}
      {!datos && !errorCarga && <p className="text-sm text-slate-500">Cargando…</p>}

      {datos && p && (
        <div className="space-y-6">
          {soloLectura && (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
              Resuelto como <strong>{p.estado}</strong>
              {p.resuelto_at ? ` el ${formatFechaCorta(p.resuelto_at)}` : ''}. Solo lectura.
            </p>
          )}

          <section aria-label="Estimación original de Gemini" role="region" className="rounded-xl bg-slate-50 p-3 text-sm">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Estimación original de Gemini (por 100 g)
            </h3>
            {p.gemini_kcal_100g == null ? (
              <p className="text-slate-500">Gemini no pudo estimar este alimento: cargá los valores a mano.</p>
            ) : (
              <p className="text-slate-700">
                {p.gemini_kcal_100g} kcal · P {p.gemini_proteinas_100g} g · C {p.gemini_carbs_100g} g · G{' '}
                {p.gemini_grasas_100g} g
                {p.gemini_modelo ? <span className="text-slate-400"> · {p.gemini_modelo}</span> : null}
              </p>
            )}
          </section>

          <section aria-label="Ocurrencias">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">
              Dónde apareció ({total} {total === 1 ? 'ocurrencia' : 'ocurrencias'})
            </h3>
            <ul className="space-y-3">
              {datos.ocurrencias.map((o) => (
                <li key={o.idGuardadoItem} className="flex flex-col gap-3 rounded-xl border border-slate-100 p-3 sm:flex-row">
                  <FotoOcurrencia o={o} />
                  <div className="min-w-0 flex-1 space-y-2 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 text-slate-500">
                      <span className="font-medium text-slate-800">{o.deportista ?? 'Deportista'}</span>
                      <span>{formatFechaCorta(o.fecha)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Campo label="La IA detectó">
                        <span>{o.nombreIa ?? 'Agregado a mano'}</span>
                      </Campo>
                      <Campo label="Nombre final">
                        <span>{o.nombreFinal}</span>
                      </Campo>
                    </div>
                    <p className="text-slate-600">
                      IA: {o.gramosIa != null ? `${redondear1(o.gramosIa)} g` : '—'} · final: {redondear1(o.gramosFinal)} g
                    </p>
                    {o.respuestas.length > 0 && (
                      <ul className="space-y-0.5 text-xs text-slate-500">
                        {o.respuestas.map((r, i) => (
                          <li key={i}>
                            <span>{r.question}</span> → <span className="font-medium text-slate-700">{r.answer ?? 'No sé'}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {total > datos.ocurrencias.length && (
              <p className="mt-2 text-xs text-slate-500">y {total - datos.ocurrencias.length} más</p>
            )}
          </section>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Input id="pv-nombre" label="Nombre" value={nombre} disabled={soloLectura} onChange={(e) => setNombre(e.target.value)} />
              <Input id="pv-categoria" label="Categoría" value={categoria} disabled={soloLectura} onChange={(e) => setCategoria(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Input id="pv-kcal" label="kcal / 100 g" type="number" min={0} step="0.1" value={kcal} disabled={soloLectura} onChange={(e) => setKcal(e.target.value)} />
              <Input id="pv-prot" label="Proteínas (g / 100 g)" type="number" min={0} step="0.1" value={prot} disabled={soloLectura} onChange={(e) => setProt(e.target.value)} />
              <Input id="pv-grasas" label="Grasas (g / 100 g)" type="number" min={0} step="0.1" value={grasas} disabled={soloLectura} onChange={(e) => setGrasas(e.target.value)} />
              <Input id="pv-carbs" label="Carbohidratos (g / 100 g)" type="number" min={0} step="0.1" value={carbs} disabled={soloLectura} onChange={(e) => setCarbs(e.target.value)} />
            </div>
            <Input id="pv-obs" label="Observaciones" value={obs} disabled={soloLectura} onChange={(e) => setObs(e.target.value)} />

            {incoherente && (
              <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                Estos valores no parecen coherentes (las kcal no cierran con 4/4/9 o algún macro es excesivo). Podés
                validarlos igual: la decisión es tuya.
              </p>
            )}

            <section aria-label="Vista previa por ocurrencia" role="region" className="rounded-xl bg-slate-50 p-3 text-sm">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Cómo quedan los totales en cada ocurrencia
              </h3>
              {macros ? (
                <ul className="space-y-0.5 text-slate-700">
                  {datos.ocurrencias.map((o) => {
                    const m = macrosItem(macros, o.gramosFinal);
                    return (
                      <li key={o.idGuardadoItem}>
                        {o.deportista ?? 'Deportista'} · {redondear1(o.gramosFinal)} g → {redondear1(m.kcal)} kcal · P{' '}
                        {redondear1(m.proteinas_g)} · C {redondear1(m.carbs_g)} · G {redondear1(m.grasas_g)}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-slate-500">Completá los cuatro valores para ver la vista previa.</p>
              )}
            </section>

            {!soloLectura && (
              <div className="space-y-2">
                <Input
                  id="pv-catalogo"
                  label="Buscar en el catálogo"
                  placeholder="Vincular a un alimento que ya existe"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                />
                {resultados.length > 0 && (
                  <ul className="space-y-1">
                    {resultados.map((a) => (
                      <li key={a.id_alimento}>
                        <button
                          type="button"
                          onClick={() => {
                            setVinculado(a);
                            setBusqueda('');
                            setResultados([]);
                          }}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50"
                        >
                          {a.nombre} <span className="text-xs text-slate-400">{a.fuente}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {vinculado && (
                  <p className="flex items-center gap-2 text-sm text-blue-700">
                    Vinculado a: {vinculado.nombre}
                    <button type="button" className="text-xs underline" onClick={() => setVinculado(null)}>
                      Quitar
                    </button>
                  </p>
                )}
              </div>
            )}

            <div aria-live="polite" className="min-h-5 text-sm">
              {error && (
                <p role="alert" className="text-red-600">
                  {error}
                </p>
              )}
              {duplicadoId != null && (
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void validar(duplicadoId)}>
                  Vincular al existente
                </Button>
              )}
              {aviso && <p role="status" className="text-emerald-700">{aviso}</p>}
            </div>

            {confirmando && (
              <div role="alertdialog" aria-label="Confirmar acción" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
                {confirmando === 'validar' ? (
                  <p>
                    Se actualizarán <strong>{plural(total)}</strong> del diario con estos valores
                    {vinculado ? ` (vinculado a ${vinculado.nombre})` : ''}, recalculados según el gramaje de cada uno.
                  </p>
                ) : (
                  <p>
                    <strong>{plural(total)}</strong> quedarán marcados como descartados. Los ítems no se borran: se
                    conservan con su nombre y gramos, pero sin kcal ni macros.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    loading={trabajando}
                    onClick={() => (confirmando === 'validar' ? void validar(vinculado?.id_alimento ?? null) : void descartar())}
                  >
                    Confirmar
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmando(null)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            {!soloLectura && !confirmando && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={trabajando} onClick={() => void guardarBorrador()}>
                  Guardar borrador
                </Button>
                <Button type="button" disabled={!puedeResolver} onClick={() => setConfirmando('validar')}>
                  Validar
                </Button>
                <Button type="button" variant="ghost" disabled={trabajando} onClick={() => setConfirmando('descartar')}>
                  Descartar
                </Button>
              </div>
            )}
          </form>
        </div>
      )}
    </Modal>
  );
}
