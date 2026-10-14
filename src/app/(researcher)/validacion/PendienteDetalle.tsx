'use client';

/**
 * NUT-119 — Detalle de un alimento de la cola de validación: contexto de cada
 * ocurrencia (foto + bounding box, nombre IA vs final, respuestas, gramaje) y los
 * valores por 100 g en tres pestañas: IA (la estimación de Gemini), Del catálogo
 * (gramos reales de alimentos del catálogo sobre el peso de la foto) y A mano.
 * El borrador guarda la pestaña y la composición; el resultado y lo que se valida
 * salen de la pestaña activa. Validar / Descartar piden confirmación.
 */
import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import ComposicionCatalogo from './ComposicionCatalogo';
import { formatFechaCorta } from '@/lib/date';
import { macrosItem, macrosPlausibles, type Macros100 } from '@/lib/macros';
import {
  aComponentes,
  aEditables,
  resumirComposicion,
  restaurarComposicion,
  type ComponenteEditable,
  type ModoComposicion,
} from '@/lib/composicion';
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
  /** Se llama tras guardar un borrador con éxito (la página refresca el listado). */
  onGuardado?: () => void;
}

interface Datos {
  pendiente: PendienteFila;
  ocurrencias: OcurrenciaDetalle[];
  totalOcurrencias: number;
}

/** Todo lo editable del detalle; se compara con el último estado guardado para el indicador de cambios. */
interface Form {
  modo: ModoComposicion;
  nombre: string;
  categoria: string;
  obs: string;
  kcal: string;
  prot: string;
  grasas: string;
  carbs: string;
  ingredientes: ComponenteEditable[];
  referencia: number | null;
}

const PESTANIAS: Array<{ modo: ModoComposicion; titulo: string; ayuda: string }> = [
  { modo: 'ia', titulo: 'IA', ayuda: 'Usa la estimación de Gemini tal cual. Elegila si te parece razonable.' },
  {
    modo: 'catalogo',
    titulo: 'Del catálogo',
    ayuda:
      'Tomá los valores de uno o más alimentos de SARA2 o ANMAT e indicá cuántos gramos de cada uno hay en la foto. Sirve para equivalencias ("esto es palta") y para compuestos ("aceite y vinagre").',
  },
  { modo: 'manual', titulo: 'A mano', ayuda: 'Cargá los cuatro valores vos.' },
];

const redondear1 = (n: number) => Math.round(n * 10) / 10;
const aNumero = (s: string): number | null => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));
const plural = (n: number) => `${n} ítem${n === 1 ? '' : 's'}`;
const texto = (n: number | null) => (n == null ? '' : String(n));

/** Estado inicial: el borrador guardado (con su pestaña y composición) o, si no hay, la estimación de Gemini. */
function formInicial(p: PendienteFila, ocurrencias: OcurrenciaDetalle[]): Form {
  const comp = restaurarComposicion(p.composicion);
  const hayGemini = p.gemini_kcal_100g != null;
  const modo: ModoComposicion = comp?.modo ?? (p.final_kcal_100g != null ? 'manual' : hayGemini ? 'ia' : 'manual');
  const refGuardada = comp?.id_guardado_item;
  return {
    modo,
    nombre: p.nombre_final ?? p.nombre_original,
    categoria: p.categoria_final ?? p.categoria_ia ?? '',
    obs: p.observaciones ?? '',
    kcal: texto(p.final_kcal_100g ?? p.gemini_kcal_100g),
    prot: texto(p.final_proteinas_100g ?? p.gemini_proteinas_100g),
    grasas: texto(p.final_grasas_100g ?? p.gemini_grasas_100g),
    carbs: texto(p.final_carbs_100g ?? p.gemini_carbs_100g),
    ingredientes: aEditables(comp?.componentes ?? []),
    referencia:
      refGuardada != null && ocurrencias.some((o) => o.idGuardadoItem === refGuardada)
        ? refGuardada
        : (ocurrencias[0]?.idGuardadoItem ?? null),
  };
}

/** Lo derivado del formulario: valores de cada pestaña y el resultado de la activa. */
function calcular(f: Form, p: PendienteFila, ocurrencias: OcurrenciaDetalle[]) {
  const ia: Macros100 | null =
    p.gemini_kcal_100g == null || p.gemini_proteinas_100g == null || p.gemini_grasas_100g == null || p.gemini_carbs_100g == null
      ? null
      : {
          kcal_100g: p.gemini_kcal_100g,
          proteinas_100g: p.gemini_proteinas_100g,
          grasas_100g: p.gemini_grasas_100g,
          carbs_100g: p.gemini_carbs_100g,
        };
  const [k, pr, g, c] = [f.kcal, f.prot, f.grasas, f.carbs].map(aNumero);
  const manual: Macros100 | null =
    k == null || pr == null || g == null || c == null
      ? null
      : { kcal_100g: k, proteinas_100g: pr, grasas_100g: g, carbs_100g: c };
  const { componentes, problemas } = aComponentes(f.ingredientes);
  const pesoFoto = ocurrencias.find((o) => o.idGuardadoItem === f.referencia)?.gramosFinal ?? 0;
  const resumen = resumirComposicion(componentes, pesoFoto);
  const macros =
    f.modo === 'ia' ? ia : f.modo === 'manual' ? manual : problemas.length === 0 ? resumen.macros : null;
  return { macros, componentes, problemas, pesoFoto, resumen };
}

function FotoOcurrencia({ o }: { o: OcurrenciaDetalle }) {
  if (!o.fotoUrl) {
    return (
      <div className="flex h-40 w-full items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-600 sm:w-40">
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
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{label}</p>
      {children}
    </div>
  );
}

function Plegable({
  titulo,
  abierto,
  onAlternar,
  children,
}: {
  titulo: string;
  abierto: boolean;
  onAlternar: () => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <button
        type="button"
        aria-expanded={abierto}
        onClick={onAlternar}
        className="flex w-full items-center gap-2 rounded py-1 text-left text-sm font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
      >
        <span aria-hidden="true">{abierto ? '▾' : '▸'}</span>
        {titulo}
      </button>
      {abierto && <div className="mt-2">{children}</div>}
    </section>
  );
}

export default function PendienteDetalle({ idPendiente, onClose, onResuelto, onGuardado }: Props) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  /** Serialización del último estado guardado (o cargado): si difiere del actual hay cambios sin guardar. */
  const [base, setBase] = useState('');
  const [abiertos, setAbiertos] = useState({ ocurrencias: true, preview: false, mas: false });

  const [confirmando, setConfirmando] = useState<'validar' | 'descartar' | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Carga del detalle cada vez que se abre otro alimento.
  useEffect(() => {
    if (idPendiente == null) return;
    let cancelado = false;
    setDatos(null);
    setForm(null);
    setErrorCarga(null);
    setConfirmando(null);
    setError(null);
    setAviso(null);
    setAbiertos({ ocurrencias: true, preview: false, mas: false });
    void getPendienteDetalleAction(idPendiente).then((r) => {
      if (cancelado) return;
      if ('error' in r) {
        setErrorCarga(r.error);
        return;
      }
      const inicial = formInicial(r.pendiente, r.ocurrencias);
      setDatos({ pendiente: r.pendiente, ocurrencias: r.ocurrencias, totalOcurrencias: r.totalOcurrencias });
      setForm(inicial);
      setBase(JSON.stringify(inicial));
    });
    return () => {
      cancelado = true;
    };
  }, [idPendiente]);

  const cambiar = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const alternar = (k: keyof typeof abiertos) => setAbiertos((a) => ({ ...a, [k]: !a[k] }));

  const p = datos?.pendiente;
  const calc = datos && form && p ? calcular(form, p, datos.ocurrencias) : null;
  const macros = calc?.macros ?? null;
  const incoherente = macros != null && !macrosPlausibles(macros);
  const soloLectura = p != null && p.estado !== 'pendiente';
  const sinGuardar = form != null && JSON.stringify(form) !== base;
  const total = datos?.totalOcurrencias ?? 0;
  const puedeResolver = !soloLectura && macros != null && (form?.nombre.trim() ?? '') !== '' && !trabajando;

  const argsForm = () => ({
    id: p!.id_pendiente,
    nombre: form!.nombre.trim(),
    categoria: form!.categoria.trim() || null,
    observaciones: form!.obs.trim() || null,
  });

  /** Valores que se mandan: lo tipeado en A mano; en las otras pestañas, el resultado (o null si todavía no hay). */
  const valores = () =>
    form!.modo === 'manual'
      ? { kcal: aNumero(form!.kcal), proteinas: aNumero(form!.prot), grasas: aNumero(form!.grasas), carbs: aNumero(form!.carbs) }
      : {
          kcal: macros?.kcal_100g ?? null,
          proteinas: macros?.proteinas_100g ?? null,
          grasas: macros?.grasas_100g ?? null,
          carbs: macros?.carbs_100g ?? null,
        };

  const composicion = () =>
    form!.modo === 'catalogo'
      ? {
          modo: 'catalogo' as const,
          id_guardado_item: form!.referencia,
          gramos_foto: calc!.pesoFoto > 0 ? calc!.pesoFoto : null,
          componentes: calc!.componentes,
        }
      : { modo: form!.modo, id_guardado_item: null, gramos_foto: null, componentes: [] };

  const guardarBorrador = async () => {
    if (form!.modo === 'catalogo' && calc!.problemas.length > 0) {
      setError(calc!.problemas[0]);
      return;
    }
    setTrabajando(true);
    setError(null);
    setAviso(null);
    const r = await modificarPendienteAction({ ...argsForm(), ...valores(), composicion: composicion() });
    setTrabajando(false);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    setBase(JSON.stringify(form));
    setAviso('Guardado hace un momento');
    onGuardado?.();
  };

  const validar = async () => {
    setTrabajando(true);
    setError(null);
    const r = await validarPendienteAction({ ...argsForm(), ...valores(), composicion: composicion() });
    setTrabajando(false);
    setConfirmando(null);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    onResuelto();
  };

  const descartar = async () => {
    setTrabajando(true);
    setError(null);
    const r = await descartarPendienteAction({ id: p!.id_pendiente, observaciones: form!.obs.trim() || null });
    setTrabajando(false);
    setConfirmando(null);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    onResuelto();
  };

  const pestaniaActiva = PESTANIAS.find((x) => x.modo === form?.modo);
  const vinculo = form?.modo === 'catalogo' && calc?.resumen.esVinculoPuro ? calc.componentes[0].nombre : null;

  return (
    <Modal open={idPendiente != null} onClose={onClose} title="Revisar alimento" wide>
      {errorCarga && <p className="text-sm text-red-600">{errorCarga}</p>}
      {!datos && !errorCarga && <p className="text-sm text-slate-600">Cargando…</p>}

      {datos && p && form && calc && (
        <div className="space-y-5">
          {soloLectura && (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
              Resuelto como <strong>{p.estado}</strong>
              {p.resuelto_at ? ` el ${formatFechaCorta(p.resuelto_at)}` : ''}. Solo lectura.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Input
              id="pv-nombre"
              label="Nombre"
              value={form.nombre}
              disabled={soloLectura}
              onChange={(e) => cambiar({ nombre: e.target.value })}
            />
            <section aria-label="Estimación original de Gemini" role="region" className="text-sm text-slate-700">
              {p.gemini_kcal_100g == null ? (
                <p>Gemini no pudo estimar este alimento: cargá los valores vos.</p>
              ) : (
                <p>
                  IA estimó (por 100 g): {p.gemini_kcal_100g} kcal · P {p.gemini_proteinas_100g} g · C {p.gemini_carbs_100g} g · G{' '}
                  {p.gemini_grasas_100g} g
                  {p.gemini_modelo ? <span className="text-slate-600"> · {p.gemini_modelo}</span> : null}
                </p>
              )}
            </section>
          </div>

          <Plegable
            titulo={`Dónde apareció (${total} ${total === 1 ? 'ocurrencia' : 'ocurrencias'})`}
            abierto={abiertos.ocurrencias}
            onAlternar={() => alternar('ocurrencias')}
          >
            <ul className="space-y-3">
              {datos.ocurrencias.map((o) => (
                <li key={o.idGuardadoItem} className="flex flex-col gap-3 rounded-xl border border-slate-100 p-3 sm:flex-row">
                  <FotoOcurrencia o={o} />
                  <div className="min-w-0 flex-1 space-y-2 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 text-slate-600">
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
                      <ul className="space-y-0.5 text-xs text-slate-600">
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
              <p className="mt-2 text-xs text-slate-600">y {total - datos.ocurrencias.length} más</p>
            )}
          </Plegable>

          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Valores por 100 g</h3>
              <div role="tablist" aria-label="Origen de los valores" className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
                {PESTANIAS.map((t) => (
                  <button
                    key={t.modo}
                    type="button"
                    role="tab"
                    id={`pv-tab-${t.modo}`}
                    aria-selected={form.modo === t.modo}
                    aria-controls="pv-panel"
                    onClick={() => cambiar({ modo: t.modo })}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${
                      form.modo === t.modo ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-700 hover:bg-white/60'
                    }`}
                  >
                    {t.titulo}
                  </button>
                ))}
              </div>

              <div id="pv-panel" role="tabpanel" aria-labelledby={`pv-tab-${form.modo}`} className="space-y-3">
                <p className="text-sm text-slate-700">{pestaniaActiva?.ayuda}</p>
                {form.modo === 'ia' && (
                  <p className="text-sm text-slate-800">
                    {calc.macros
                      ? 'Se usan los valores estimados por Gemini (arriba).'
                      : 'Gemini no estimó este alimento: usá "Del catálogo" o "A mano".'}
                  </p>
                )}
                {form.modo === 'catalogo' && (
                  <ComposicionCatalogo
                    ocurrencias={datos.ocurrencias}
                    referencia={form.referencia}
                    onReferencia={(referencia) => cambiar({ referencia })}
                    ingredientes={form.ingredientes}
                    onIngredientes={(ingredientes) => cambiar({ ingredientes })}
                    soloLectura={soloLectura}
                  />
                )}
                {form.modo === 'manual' && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Input id="pv-kcal" label="kcal / 100 g" type="number" min={0} step="0.1" value={form.kcal} disabled={soloLectura} onChange={(e) => cambiar({ kcal: e.target.value })} />
                    <Input id="pv-prot" label="Proteínas (g / 100 g)" type="number" min={0} step="0.1" value={form.prot} disabled={soloLectura} onChange={(e) => cambiar({ prot: e.target.value })} />
                    <Input id="pv-grasas" label="Grasas (g / 100 g)" type="number" min={0} step="0.1" value={form.grasas} disabled={soloLectura} onChange={(e) => cambiar({ grasas: e.target.value })} />
                    <Input id="pv-carbs" label="Carbohidratos (g / 100 g)" type="number" min={0} step="0.1" value={form.carbs} disabled={soloLectura} onChange={(e) => cambiar({ carbs: e.target.value })} />
                  </div>
                )}
              </div>
            </div>

            <div role="region" aria-label="Resultado por 100 g" className="rounded-xl bg-slate-50 p-3 text-sm">
              {macros ? (
                <p className="font-medium text-slate-900">
                  Resultado por 100 g: {redondear1(macros.kcal_100g)} kcal · P {redondear1(macros.proteinas_100g)} g · C{' '}
                  {redondear1(macros.carbs_100g)} g · G {redondear1(macros.grasas_100g)} g
                </p>
              ) : (
                <p className="text-slate-700">Completá los valores de esta pestaña para ver el resultado.</p>
              )}
            </div>

            {incoherente && (
              <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                Estos valores no parecen coherentes (las kcal no cierran con 4/4/9 o algún macro es excesivo). Podés
                validarlos igual: la decisión es tuya.
              </p>
            )}

            <Plegable titulo="Cómo queda en cada ocurrencia" abierto={abiertos.preview} onAlternar={() => alternar('preview')}>
              <section aria-label="Vista previa por ocurrencia" role="region" className="rounded-xl bg-slate-50 p-3 text-sm">
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
                  <p className="text-slate-700">Completá los valores para ver la vista previa.</p>
                )}
              </section>
            </Plegable>

            <Plegable titulo="Más datos (categoría y observaciones)" abierto={abiertos.mas} onAlternar={() => alternar('mas')}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input id="pv-categoria" label="Categoría" value={form.categoria} disabled={soloLectura} onChange={(e) => cambiar({ categoria: e.target.value })} />
                <Input id="pv-obs" label="Observaciones" value={form.obs} disabled={soloLectura} onChange={(e) => cambiar({ obs: e.target.value })} />
              </div>
            </Plegable>

            <div aria-live="polite" className="min-h-5 text-sm">
              {error && (
                <p role="alert" className="text-red-600">
                  {error}
                </p>
              )}
              {aviso && !sinGuardar && <p role="status" className="text-emerald-700">{aviso}</p>}
            </div>

            {confirmando && (
              <div role="alertdialog" aria-label="Confirmar acción" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
                {confirmando === 'validar' ? (
                  <p>
                    Se actualizarán <strong>{plural(total)}</strong> del diario con estos valores
                    {vinculo ? ` (vinculado a ${vinculo})` : ''}, recalculados según el gramaje de cada uno.
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
                    onClick={() => (confirmando === 'validar' ? void validar() : void descartar())}
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
              <div className="flex flex-wrap items-center gap-2">
                {sinGuardar && (
                  <p role="status" className="mr-auto text-sm font-medium text-amber-700">
                    ● Cambios sin guardar
                  </p>
                )}
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
