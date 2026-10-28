'use client';

/**
 * NUT-119 — "Revisar alimento" (rediseño). Hoja responsive: en el celular una sola columna
 * (contexto → pasos → resultado) con el pie fijo; en escritorio dos columnas (contexto +
 * resultado a la izquierda, pasos a la derecha). Paso 1: nombre. Paso 2: de dónde salen los
 * valores por 100 g (IA / Del catálogo / A mano). El resultado se muestra una sola vez.
 * El borrador guarda el método y la composición; lo que se valida sale del método activo.
 * Validar / Descartar piden confirmación; el pie explica por qué Validar está deshabilitado.
 */
import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import HojaRevision from './HojaRevision';
import ContextoComidas from './ContextoComidas';
import SolicitudesChat from './SolicitudesChat';
import SolicitudesManuales from './SolicitudesManuales';
import VincularAlimento, { valoresCompletos } from './VincularAlimento';
import type { AlimentoOption } from '@/app/alimentacion/actions';
import TarjetaResultado from './TarjetaResultado';
import ComposicionCatalogo from './ComposicionCatalogo';
import NuevoAlimentoPropio, { PROPIO_VACIO, propioListo, type PropioForm } from './NuevoAlimentoPropio';
import { formatFechaCorta } from '@/lib/date';
import { fmt } from '@/lib/numeros';
import { FUENTES_DATO, MOTIVO_RETIRO_MIN } from '@/lib/verificacionAlimento';
import { macrosPlausibles, type Macros100 } from '@/lib/macros';
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
  retirarAlimentoPropioAction,
  getPendienteDetalleAction,
  modificarPendienteAction,
  validarPendienteAction,
  validarComoPropioAction,
  type ExistenteCatalogo,
  type OcurrenciaDetalle,
  type PendienteFila,
  type PropioInfo,
  type SolicitudChat,
  type SolicitudManual,
  type VerificacionPropio,
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
  propio: PropioInfo | null;
  /** NUT-192: cargas manuales (sin foto) y avisos de nombre ya existente en SARA2/ANMAT. */
  solicitudesManuales: SolicitudManual[];
  totalSolicitudesManuales: number;
  /** NUT-228: ítems que el chat estimó (sin foto). */
  solicitudesChat: SolicitudChat[];
  totalSolicitudesChat: number;
  existentesCatalogo: ExistenteCatalogo[];
}

/** Todo lo editable del detalle; se compara con el último estado guardado para el aviso "Sin guardar". */
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
  propio: PropioForm;
}

const METODOS: Array<{ modo: ModoComposicion; titulo: string; etiqueta?: string; ayuda: string }> = [
  { modo: 'ia', titulo: 'IA', etiqueta: 'Rápido', ayuda: 'Estimación de Gemini. Revisala antes de usarla.' },
  { modo: 'catalogo', titulo: 'Del catálogo', etiqueta: 'Más preciso', ayuda: 'Combiná alimentos de SARA2 o ANMAT.' },
  { modo: 'manual', titulo: 'A mano', ayuda: 'Cargá los 4 valores vos, por ejemplo desde la etiqueta.' },
];
const FUENTE_RESULTADO: Record<ModoComposicion, string> = { ia: 'IA (Gemini)', catalogo: 'Del catálogo', manual: 'A mano' };

const aNumero = (s: string): number | null => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));
const plural = (n: number) => `${n} ítem${n === 1 ? '' : 's'}`;
const texto = (n: number | null) => (n == null ? '' : String(n));
const resumenMacros = (m: Macros100) =>
  `${fmt(m.kcal_100g)} kcal · P ${fmt(m.proteinas_100g)} · C ${fmt(m.carbs_100g)} · G ${fmt(m.grasas_100g)}`;

/** Estado inicial: el borrador guardado (con su método y composición) o, si no hay, la estimación de Gemini. */
function formInicial(p: PendienteFila): Form {
  const comp = restaurarComposicion(p.composicion);
  const hayGemini = p.gemini_kcal_100g != null;
  const modo: ModoComposicion = comp?.modo ?? (p.final_kcal_100g != null ? 'manual' : hayGemini ? 'ia' : 'manual');
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
    propio: PROPIO_VACIO,
  };
}

/** Lo derivado del formulario: valores de cada método y el resultado del activo. */
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
  const referencia = ocurrencias.find((o) => o.esReferencia) ?? null;
  const pesoFoto = referencia?.gramosFinal ?? 0;
  const resumen = resumirComposicion(componentes, pesoFoto);
  const catalogo = problemas.length === 0 ? resumen.macros : null;
  const macros = f.modo === 'ia' ? ia : f.modo === 'manual' ? manual : catalogo;
  return { ia, manual, catalogo, macros, componentes, problemas, referencia, pesoFoto, resumen };
}

function Paso({ n, titulo, pista, children }: { n: number; titulo: string; pista?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-700 text-[13px] font-bold text-white">
          {n}
        </span>
        <h2 className="text-base font-bold text-slate-900">{titulo}</h2>
        {pista && <span className="ml-auto hidden text-xs text-slate-600 md:inline">{pista}</span>}
      </div>
      {children}
    </section>
  );
}

const claseCampo =
  'h-11 w-full rounded-xl border-[1.5px] border-slate-200 bg-white px-3.5 text-[15px] text-slate-900 placeholder-slate-500 focus:border-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:bg-slate-100 disabled:text-slate-600';

function CampoValor({ etiqueta, unidad, ariaLabel, valor, onChange, disabled }: {
  etiqueta: string; unidad: string; ariaLabel: string; valor: string; onChange: (v: string) => void; disabled: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-slate-700">
      {etiqueta}
      <span className="flex h-11 items-center gap-1.5 rounded-[10px] border-[1.5px] border-slate-200 bg-white px-2.5 focus-within:border-blue-700 focus-within:ring-4 focus-within:ring-blue-200">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.1"
          aria-label={ariaLabel}
          value={valor}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-base font-bold text-slate-900 focus:outline-none disabled:text-slate-600"
        />
        <span className="font-semibold text-slate-600">{unidad}</span>
      </span>
    </label>
  );
}

export default function PendienteDetalle({ idPendiente, onClose, onResuelto, onGuardado }: Props) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  /** Serialización del último estado guardado (o cargado): si difiere del actual hay cambios sin guardar. */
  const [base, setBase] = useState('');
  const [masDatos, setMasDatos] = useState(false);

  const [confirmando, setConfirmando] = useState<'validar' | 'descartar' | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [verificacionPropio, setVerificacionPropio] = useState<VerificacionPropio | null>(null);
  const [retirando, setRetirando] = useState(false);
  const [motivoRetiro, setMotivoRetiro] = useState('');
  /** NUT-225: solo en entradas solo manuales. Estado de UI: no se guarda en el borrador. */
  const [vinculando, setVinculando] = useState(false);
  const [vinculado, setVinculado] = useState<AlimentoOption | null>(null);

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
    setVerificacionPropio(null);
    setRetirando(false);
    setMotivoRetiro('');
    setVinculando(false);
    setVinculado(null);
    setMasDatos(false);
    void getPendienteDetalleAction(idPendiente).then((r) => {
      if (cancelado) return;
      if ('error' in r) {
        setErrorCarga(r.error);
        return;
      }
      const inicial = formInicial(r.pendiente);
      setDatos({
        pendiente: r.pendiente,
        ocurrencias: r.ocurrencias,
        totalOcurrencias: r.totalOcurrencias,
        propio: r.propio ?? null,
        solicitudesManuales: r.solicitudesManuales ?? [],
        totalSolicitudesManuales: r.totalSolicitudesManuales ?? 0,
        solicitudesChat: r.solicitudesChat ?? [],
        totalSolicitudesChat: r.totalSolicitudesChat ?? 0,
        existentesCatalogo: r.existentesCatalogo ?? [],
      });
      setForm(inicial);
      setBase(JSON.stringify({ ...inicial, propio: null }));
    });
    return () => {
      cancelado = true;
    };
  }, [idPendiente]);

  const cambiar = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const p = datos?.pendiente;
  const total = datos?.totalOcurrencias ?? 0;
  const manuales = datos?.totalSolicitudesManuales ?? 0;
  const chats = datos?.totalSolicitudesChat ?? 0;
  /** Ítems del diario que se actualizan al resolver: con foto + cargados manualmente + estimados por el chat. */
  const totalItems = total + manuales + chats;
  /** Sin ninguna ocurrencia con foto no hay peso de referencia: solo se puede cargar «A mano», usar la IA (si hay valores precargados) o vincular. */
  const sinFoto = datos != null && total === 0;
  const soloLectura = p != null && p.estado !== 'pendiente';
  /** NUT-225: la entrada se valida vinculándola a un alimento existente (solo en entradas solo manuales). */
  const vincula = sinFoto && !soloLectura && vinculando;
  const calc = datos && form && p ? calcular(form, p, datos.ocurrencias) : null;
  const macrosVinculado: Macros100 | null =
    vincula && vinculado && valoresCompletos(vinculado)
      ? {
          kcal_100g: Number(vinculado.kcal_100g),
          proteinas_100g: Number(vinculado.proteinas_100g),
          grasas_100g: Number(vinculado.grasas_100g),
          carbs_100g: Number(vinculado.carbs_100g),
        }
      : null;
  const macros = vincula ? macrosVinculado : (calc?.macros ?? null);
  const incoherente = !vincula && macros != null && !macrosPlausibles(macros);
  const creaPropio = !vincula && form?.modo === 'manual' && form.propio.activo;
  const sinGuardar = form != null && JSON.stringify({ ...form, propio: null }) !== base;

  /** Qué falta para poder validar (el primero se muestra en el pie). */
  const pendientes: string[] = [];
  if (form && calc) {
    if (form.nombre.trim() === '') pendientes.push('Poné un nombre al alimento');
    if (form.modo === 'ia' && !calc.ia) pendientes.push('Gemini no estimó este alimento: elegí otra fuente');
    if (form.modo === 'catalogo') {
      if (form.ingredientes.length === 0) pendientes.push('Agregá al menos un alimento del catálogo');
      else if (calc.problemas.length > 0) pendientes.push(calc.problemas[0]);
      else if (calc.pesoFoto <= 0) pendientes.push('No hay una foto de referencia con peso para calcular');
    }
    if (vincula) {
      if (!vinculado) pendientes.push('Elegí el alimento con el que vincular');
    } else if (form.modo === 'manual' && !calc.manual) pendientes.push('Completá los 4 valores');
    if (creaPropio && !propioListo(form.propio, verificacionPropio)) pendientes.push('Completá la evaluación del alimento propio');
  }
  const puedeResolver = !soloLectura && pendientes.length === 0 && macros != null && !trabajando;

  const argsForm = () => ({
    id: p!.id_pendiente,
    nombre: form!.nombre.trim(),
    categoria: form!.categoria.trim() || null,
    observaciones: form!.obs.trim() || null,
  });

  /** Valores que se mandan: lo tipeado en A mano; en los otros métodos, el resultado (o null si todavía no hay). */
  const valores = () =>
    form!.modo === 'manual'
      ? { kcal: aNumero(form!.kcal), proteinas: aNumero(form!.prot), grasas: aNumero(form!.grasas), carbs: aNumero(form!.carbs) }
      : {
          kcal: macros?.kcal_100g ?? null,
          proteinas: macros?.proteinas_100g ?? null,
          grasas: macros?.grasas_100g ?? null,
          carbs: macros?.carbs_100g ?? null,
        };

  /**
   * Composición a mandar. El borrador conserva los ingredientes cargados aunque el método
   * activo sea otro (no se pierde lo armado); al validar sólo cuenta el método activo.
   */
  const composicion = (conservarIngredientes: boolean) =>
    form!.modo === 'catalogo' || (conservarIngredientes && calc!.componentes.length > 0)
      ? {
          modo: form!.modo,
          id_guardado_item: calc!.referencia?.idGuardadoItem ?? null,
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
    const r = await modificarPendienteAction({ ...argsForm(), ...valores(), composicion: composicion(true) });
    setTrabajando(false);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    setBase(JSON.stringify({ ...form, propio: null }));
    setAviso('Guardado hace un momento');
    onGuardado?.();
  };

  const validar = async () => {
    setTrabajando(true);
    setError(null);
    const r = creaPropio
      ? await validarComoPropioAction({
          ...argsForm(),
          kcal: macros!.kcal_100g,
          proteinas: macros!.proteinas_100g,
          grasas: macros!.grasas_100g,
          carbs: macros!.carbs_100g,
          propio: {
            fuenteDato: form!.propio.fuente as Exclude<PropioForm['fuente'], ''>,
            justificacion: form!.propio.justificacion.trim(),
            confirmaciones: { reviseFuente: true, valoresPor100g: true, busqueExistente: true },
            confirmaIncoherente: form!.propio.confirmaIncoherente,
            confirmaDistinto: form!.propio.confirmaDistinto,
          },
        })
      : vincula
        ? // NUT-225: sin valores ni composición; la acción relee el alimento y la RPC copia sus 4 valores.
          await validarPendienteAction({ ...argsForm(), idAlimentoExistente: vinculado!.id_alimento })
        : await validarPendienteAction({ ...argsForm(), ...valores(), composicion: composicion(false) });
    setTrabajando(false);
    setConfirmando(null);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    onResuelto();
  };

  const retirarPropio = async () => {
    setTrabajando(true);
    setError(null);
    const r = await retirarAlimentoPropioAction({ id: datos!.propio!.id, motivo: motivoRetiro.trim() });
    setTrabajando(false);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    setDatos((d) => (d && d.propio ? { ...d, propio: { ...d.propio, estado: 'retirado', motivoRetiro: motivoRetiro.trim() } } : d));
    setRetirando(false);
    setMotivoRetiro('');
    onGuardado?.();
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

  const vinculo = vincula
    ? (vinculado?.nombre ?? null)
    : form?.modo === 'catalogo' && calc?.resumen.esVinculoPuro
      ? calc.componentes[0].nombre
      : null;
  const textoVacio = vincula
    ? 'Elegí un alimento para ver el resultado.'
    : form?.modo === 'catalogo'
      ? 'Agregá alimentos y sus gramos para ver el resultado.'
      : form?.modo === 'ia'
        ? 'Gemini no estimó este alimento: elegí otra fuente.'
        : 'Completá los 4 valores para ver el resultado.';

  const resumenDe = (modo: ModoComposicion): string => {
    if (!calc) return '';
    const m = modo === 'ia' ? calc.ia : modo === 'catalogo' ? calc.catalogo : calc.manual;
    if (m && (modo !== 'catalogo' || form!.ingredientes.length > 0)) return resumenMacros(m);
    return modo === 'ia' ? 'Sin estimación' : modo === 'catalogo' ? 'Elegí alimentos' : 'Sin cargar';
  };

  const pie =
    datos && p && form && calc ? (
      soloLectura ? (
        error ? (
          <p role="alert" className="text-sm font-semibold text-red-700">
            {error}
          </p>
        ) : null
      ) : confirmando ? (
        <div role="alertdialog" aria-label="Confirmar acción" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-900">
          {confirmando === 'validar' ? (
            <p>
              Se actualizarán <strong>{plural(totalItems)}</strong> del diario con estos valores
              {vinculo ? ` (vinculado a ${vinculo})` : ''}, recalculados según el gramaje de cada uno.
              {creaPropio ? ` Además se agregará «${form.nombre.trim()}» al catálogo propio.` : ''}
              {vincula &&
                ` Lo pidieron ${p.usuarios_distintos} ${p.usuarios_distintos === 1 ? 'usuario' : 'usuarios'}. Cada ítem conserva el nombre que escribió la persona y su gramaje, y las próximas cargas con este nombre se resolverán solas con este alimento. No se puede deshacer.`}
            </p>
          ) : (
            <p>
              <strong>{plural(totalItems)}</strong> quedarán marcados como descartados. Los ítems no se borran: se conservan con su
              nombre y gramos, pero sin kcal ni macros.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              loading={trabajando}
              disabled={confirmando === 'validar' && !puedeResolver}
              onClick={() => (confirmando === 'validar' ? void validar() : void descartar())}
            >
              Confirmar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmando(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:gap-3">
          <div aria-hidden="true" className="flex flex-wrap items-baseline gap-2 text-[13px] text-slate-600 md:hidden">
            {macros ? (
              <>
                <b className="text-xl tracking-tight text-slate-900">{fmt(macros.kcal_100g)} kcal</b> por 100 g · P {fmt(macros.proteinas_100g)} · C{' '}
                {fmt(macros.carbs_100g)} · G {fmt(macros.grasas_100g)}
              </>
            ) : (
              'Todavía sin resultado'
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            {error && (
              <p role="alert" className="text-sm font-semibold text-red-700">
                {error}
              </p>
            )}
            {aviso && !sinGuardar && <p className="text-sm font-semibold text-green-800">{aviso}</p>}
            <div
              role="status"
              aria-label="Estado de la validación"
              className={`flex items-center gap-2 text-[13px] font-semibold ${pendientes.length === 0 ? 'text-green-800' : 'text-amber-700'}`}
            >
              <i aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-current" />
              <span>{pendientes.length === 0 ? 'Listo para validar' : pendientes[0]}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 items-center gap-2.5 md:flex">
            <button
              type="button"
              disabled={trabajando}
              onClick={() => setConfirmando('descartar')}
              className="order-3 h-11 whitespace-nowrap rounded-xl border-[1.5px] border-transparent px-[18px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 md:order-1"
            >
              Descartar
            </button>
            <button
              type="button"
              disabled={trabajando}
              onClick={() => void guardarBorrador()}
              className="order-2 h-11 whitespace-nowrap rounded-xl border-[1.5px] border-blue-700 bg-white px-[18px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60"
            >
              Guardar borrador
            </button>
            <button
              type="button"
              disabled={!puedeResolver}
              title={pendientes[0] ?? ''}
              onClick={() => setConfirmando('validar')}
              className="order-1 col-span-2 h-[50px] whitespace-nowrap rounded-xl bg-[linear-gradient(90deg,#1d4ed8,#0f766e)] px-[26px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-none disabled:bg-slate-200 disabled:text-slate-600 md:order-3 md:col-span-1 md:h-11"
            >
              Validar
            </button>
          </div>
        </div>
      )
    ) : null;

  return (
    <HojaRevision
      open={idPendiente != null}
      onClose={onClose}
      titulo="Revisar alimento"
      subtitulo="Confirmá el nombre y elegí de dónde salen los valores nutricionales."
      sinGuardar={sinGuardar && !soloLectura}
      pie={pie}
    >
      {errorCarga && <p className="p-6 text-sm font-semibold text-red-700">{errorCarga}</p>}
      {!datos && !errorCarga && <p className="p-6 text-sm text-slate-600">Cargando…</p>}

      {datos && p && form && calc && (
        <div className="grid grid-cols-1 md:min-h-full md:grid-cols-[340px_1fr] md:grid-rows-[auto_1fr]">
          {/* CONTEXTO */}
          <div className="order-1 border-b border-slate-200 bg-slate-50 p-4 md:col-start-1 md:row-start-1 md:border-b-0 md:border-r md:px-6 md:py-5">
            {total > 0 && <ContextoComidas ocurrencias={datos.ocurrencias} total={total} />}
            {manuales > 0 && (
              <div className={total > 0 ? 'mt-5' : undefined}>
                <SolicitudesManuales solicitudes={datos.solicitudesManuales} total={manuales} usuarios={p.usuarios_distintos ?? 0} />
              </div>
            )}
            {chats > 0 && (
              <div className={total > 0 || manuales > 0 ? 'mt-5' : undefined}>
                <SolicitudesChat solicitudes={datos.solicitudesChat} total={chats} usuarios={p.usuarios_distintos ?? 0} />
              </div>
            )}
          </div>

          {/* RESULTADO (único lugar donde se muestra) */}
          <div className="order-3 border-t border-slate-200 bg-slate-50 p-4 md:col-start-1 md:row-start-2 md:border-r md:border-t-0 md:px-6 md:pb-5 md:pt-0">
            <div className="md:sticky md:bottom-4 md:pt-1">
              <TarjetaResultado
                macros={macros}
                fuente={vincula ? 'Vinculado' : FUENTE_RESULTADO[form.modo]}
                ocurrencias={datos.ocurrencias}
                incoherente={incoherente}
                vacio={textoVacio}
                listo={pendientes.length === 0}
              />
            </div>
          </div>

          {/* PASOS */}
          <form
            onSubmit={(e) => e.preventDefault()}
            className="order-2 flex min-w-0 flex-col gap-[22px] p-4 md:col-start-2 md:row-span-2 md:row-start-1 md:gap-[26px] md:px-7 md:pb-7 md:pt-[22px]"
          >
            {soloLectura && (
              <p className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700">
                Resuelto como <strong>{p.estado}</strong>
                {p.resuelto_at ? ` el ${formatFechaCorta(p.resuelto_at)}` : ''}. Solo lectura.
              </p>
            )}

            <Paso n={1} titulo="Nombre del alimento">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pv-nombre" className="sr-only">
                  Nombre
                </label>
                <input
                  id="pv-nombre"
                  type="text"
                  autoComplete="off"
                  value={form.nombre}
                  disabled={soloLectura}
                  onChange={(e) => cambiar({ nombre: e.target.value })}
                  className={claseCampo}
                />
                <span className="text-xs text-slate-600">Así se va a guardar en tu catálogo.</span>
                {!soloLectura && datos.existentesCatalogo.length > 0 && (
                  <p role="note" className="rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                    Ya hay un alimento con este nombre en el catálogo:{' '}
                    {datos.existentesCatalogo.map((e) => `«${e.nombre}» (${e.fuente})`).join(', ')}.{' '}
                    {sinFoto ? 'Revisá que no sea el mismo antes de validar.' : 'Si es el mismo, usalo desde «Del catálogo».'} No te impide validar.
                  </p>
                )}
              </div>
              {!soloLectura && form.nombre.trim() !== p.nombre_original.trim() && (
                <button
                  type="button"
                  onClick={() => cambiar({ nombre: p.nombre_original })}
                  className="self-start rounded-full border-[1.5px] border-dashed border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                >
                  Usar «{p.nombre_original}»
                </button>
              )}
            </Paso>

            <Paso n={2} titulo="¿De dónde salen los valores?" pista="Valores por 100 g">
              <fieldset className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0">
                <legend className="sr-only">Fuente de los valores nutricionales</legend>
                {sinFoto && chats === 0 && (
                  <p className="text-xs text-slate-600">
                    Este alimento se cargó manualmente, sin foto: no hay una estimación de la IA ni un peso de referencia para armar una
                    mezcla del catálogo. Cargá los 4 valores.
                  </p>
                )}
                {sinFoto && chats > 0 && (
                  <p className="text-xs text-slate-600">
                    Este alimento lo estimó el chat{manuales > 0 ? ' y también se cargó manualmente' : ''}, sin foto: no hay un peso de
                    referencia para armar una mezcla del catálogo. Revisá la estimación de la IA o cargá los 4 valores.
                  </p>
                )}
                {METODOS.filter((m) => !sinFoto || m.modo === 'manual' || (m.modo === 'ia' && !!calc.ia)).map((m) => {
                  const sel = form.modo === m.modo && !vincula;
                  const sinIA = m.modo === 'ia' && !calc.ia;
                  return (
                    <div
                      key={m.modo}
                      className={`rounded-2xl border-[1.5px] bg-white transition-shadow ${
                        sel ? 'border-blue-700 shadow-[0_0_0_4px_#bfdbfe]' : 'border-slate-200'
                      }`}
                    >
                      <label className={`flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3.5 md:flex-nowrap ${sinIA ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                        <input
                          type="radio"
                          name="metodo-valores"
                          value={m.modo}
                          checked={sel}
                          disabled={sinIA}
                          onChange={() => {
                            if (sinFoto) setVinculando(false);
                            cambiar({ modo: m.modo });
                          }}
                          className="peer sr-only"
                        />
                        <span
                          aria-hidden="true"
                          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-700 ${
                            sel ? 'border-blue-700' : 'border-slate-500'
                          }`}
                        >
                          {sel && <span className="h-2.5 w-2.5 rounded-full bg-blue-700" />}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <b className="text-[15px] text-slate-900">
                            {m.titulo}
                            {m.etiqueta && <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-px align-[1px] text-[11px] font-bold text-slate-600">{m.etiqueta}</span>}
                          </b>
                          <small className="text-[12.5px] text-slate-600">{sinIA ? 'Gemini no pudo estimar este alimento.' : m.ayuda}</small>
                        </span>
                        <span className="w-full pl-8 text-left text-[12.5px] font-semibold text-slate-900 md:ml-auto md:w-auto md:pl-0 md:text-right md:whitespace-nowrap">
                          {resumenDe(m.modo)}
                        </span>
                      </label>

                      {sel && (
                        <div className="flex flex-col gap-3 px-3.5 pb-3.5 pt-0.5 md:pb-4 md:pl-12 md:pr-4">
                          {m.modo === 'ia' && calc.ia && (
                            <div role="region" aria-label="Estimación original de Gemini" className="space-y-2.5">
                              <p className="text-[13px] text-slate-600">
                                Gemini estimó estos valores por 100 g
                                {p.gemini_modelo ? ` (modelo ${p.gemini_modelo})` : ''}. Si te parecen razonables, quedan como resultado.
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {[
                                  `${fmt(calc.ia.kcal_100g)} kcal`,
                                  `P ${fmt(calc.ia.proteinas_100g)} g`,
                                  `C ${fmt(calc.ia.carbs_100g)} g`,
                                  `G ${fmt(calc.ia.grasas_100g)} g`,
                                ].map((t) => (
                                  <span key={t} className="rounded-[10px] border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[13px] font-semibold text-slate-900">
                                    {t}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {m.modo === 'catalogo' && (
                            <ComposicionCatalogo
                              foto={calc.referencia}
                              ingredientes={form.ingredientes}
                              onIngredientes={(ingredientes) => cambiar({ ingredientes })}
                              soloLectura={soloLectura}
                            />
                          )}
                          {m.modo === 'manual' && (
                            <>
                              <div className="grid grid-cols-2 gap-3">
                                <CampoValor etiqueta="Energía" unidad="kcal" ariaLabel="Energía en kcal por 100 g" valor={form.kcal} disabled={soloLectura} onChange={(v) => cambiar({ kcal: v })} />
                                <CampoValor etiqueta="Proteínas" unidad="g" ariaLabel="Proteínas en gramos por 100 g" valor={form.prot} disabled={soloLectura} onChange={(v) => cambiar({ prot: v })} />
                                <CampoValor etiqueta="Carbohidratos" unidad="g" ariaLabel="Carbohidratos en gramos por 100 g" valor={form.carbs} disabled={soloLectura} onChange={(v) => cambiar({ carbs: v })} />
                                <CampoValor etiqueta="Grasas" unidad="g" ariaLabel="Grasas en gramos por 100 g" valor={form.grasas} disabled={soloLectura} onChange={(v) => cambiar({ grasas: v })} />
                              </div>
                              {!soloLectura && (
                                <NuevoAlimentoPropio
                                  nombre={form.nombre}
                                  valores={{ kcal: aNumero(form.kcal), proteinas: aNumero(form.prot), grasas: aNumero(form.grasas), carbs: aNumero(form.carbs) }}
                                  propio={form.propio}
                                  onChange={(patch) => setForm((f) => (f ? { ...f, propio: { ...f.propio, ...patch } } : f))}
                                  onVerificacion={setVerificacionPropio}
                                />
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {sinFoto && !soloLectura && (
                  <VincularAlimento activo={vinculando} onActivar={() => setVinculando(true)} seleccionado={vinculado} onSeleccionar={setVinculado} />
                )}
              </fieldset>
            </Paso>

            <section className="rounded-2xl border border-slate-200 bg-white">
              <button
                type="button"
                aria-expanded={masDatos}
                onClick={() => setMasDatos((v) => !v)}
                className="flex min-h-12 w-full items-center gap-2 rounded-2xl px-4 py-3.5 text-left font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
              >
                <span aria-hidden="true" className="text-slate-600">{masDatos ? '▾' : '▸'}</span>
                Más datos <small className="font-normal text-slate-600">· categoría y observaciones (opcional)</small>
              </button>
              {masDatos && (
                <div className="grid gap-3 px-4 pb-4 md:grid-cols-2">
                  <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-slate-700">
                    Categoría
                    <input className={claseCampo} value={form.categoria} disabled={soloLectura} onChange={(e) => cambiar({ categoria: e.target.value })} />
                  </label>
                  <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-slate-700">
                    Observaciones
                    <input className={claseCampo} placeholder="Opcional" value={form.obs} disabled={soloLectura} onChange={(e) => cambiar({ obs: e.target.value })} />
                  </label>
                </div>
              )}
            </section>

            {datos.propio && (
              <section aria-label="Alimento propio" role="region" className="space-y-2 rounded-2xl border border-violet-200 bg-violet-50/50 p-4 text-sm">
                <h3 className="font-semibold text-slate-900">
                  <span className="mr-2 rounded bg-violet-50 px-1.5 py-0.5 text-xs font-semibold text-violet-800">PROPIO</span>
                  Se agregó al catálogo propio
                </h3>
                <p className="text-slate-700">
                  Fuente: {FUENTES_DATO.find((f) => f.valor === datos.propio!.fuenteDato)?.etiqueta ?? datos.propio.fuenteDato}.{' '}
                  {datos.propio.justificacion}
                </p>
                {datos.propio.estado === 'retirado' ? (
                  <p className="text-slate-800">
                    Retirado del catálogo propio{datos.propio.motivoRetiro ? `: ${datos.propio.motivoRetiro}` : '.'}
                  </p>
                ) : retirando ? (
                  <div className="space-y-2">
                    <div>
                      <label htmlFor="pv-motivo-retiro" className="block text-sm font-medium text-slate-700">
                        Motivo del retiro
                      </label>
                      <textarea
                        id="pv-motivo-retiro"
                        value={motivoRetiro}
                        onChange={(e) => setMotivoRetiro(e.target.value)}
                        rows={2}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                      />
                      <span className="text-xs text-slate-600">
                        {motivoRetiro.trim().length}/{MOTIVO_RETIRO_MIN} caracteres como mínimo. Los ítems ya validados no cambian.
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" loading={trabajando} disabled={motivoRetiro.trim().length < MOTIVO_RETIRO_MIN} onClick={() => void retirarPropio()}>
                        Confirmar retiro
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRetirando(false)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" size="sm" variant="outline" onClick={() => setRetirando(true)}>
                    Retirar del catálogo propio
                  </Button>
                )}
              </section>
            )}
          </form>
        </div>
      )}
    </HojaRevision>
  );
}
