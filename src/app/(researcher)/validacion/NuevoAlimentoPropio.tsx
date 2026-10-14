'use client';

/**
 * NUT-119 — "Agregar este alimento al catálogo propio" (pestaña "A mano"): fuente del
 * dato, justificación y tres confirmaciones, con la verificación del servidor en vivo
 * (duplicados, nombres parecidos y kcal incoherentes). La verificación se repite cada
 * vez que cambia el nombre o un valor; mientras corre, el alimento no está "listo".
 */
import { useEffect, useState } from 'react';
import {
  FUENTES_DATO,
  JUSTIFICACION_MIN,
  MENSAJE_ADVERTENCIA,
  MENSAJE_BLOQUEO,
  verificarValores,
  type FuenteDato,
  type ValoresPropio,
} from '@/lib/verificacionAlimento';
import { verificarAlimentoPropioAction, type VerificacionPropio } from './actions';

export interface PropioForm {
  activo: boolean;
  fuente: FuenteDato | '';
  justificacion: string;
  reviseFuente: boolean;
  valores100: boolean;
  busque: boolean;
  confirmaIncoherente: boolean;
  confirmaDistinto: boolean;
}

export const PROPIO_VACIO: PropioForm = {
  activo: false,
  fuente: '',
  justificacion: '',
  reviseFuente: false,
  valores100: false,
  busque: false,
  confirmaIncoherente: false,
  confirmaDistinto: false,
};

/** ¿Se puede crear el propio? Evaluación completa, sin bloqueos y con las advertencias confirmadas. */
export function propioListo(p: PropioForm, v: VerificacionPropio | null): boolean {
  if (!p.activo || v == null || v.bloqueos.length > 0) return false;
  if (p.fuente === '' || p.justificacion.trim().length < JUSTIFICACION_MIN) return false;
  if (!p.reviseFuente || !p.valores100 || !p.busque) return false;
  if (v.advertencias.some((a) => a.codigo === 'KCAL_INCOHERENTE') && !p.confirmaIncoherente) return false;
  if (v.advertencias.some((a) => a.codigo === 'SIMILAR') && !p.confirmaDistinto) return false;
  return true;
}

interface Props {
  nombre: string;
  valores: ValoresPropio;
  propio: PropioForm;
  onChange: (patch: Partial<PropioForm>) => void;
  /** Resultado de la última verificación del servidor; null mientras verifica o si falló. */
  onVerificacion: (v: VerificacionPropio | null) => void;
}

const claseCampo = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

export default function NuevoAlimentoPropio({ nombre, valores, propio, onChange, onVerificacion }: Props) {
  const [verificacion, setVerificacion] = useState<VerificacionPropio | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [falloVerificar, setFalloVerificar] = useState(false);

  const local = verificarValores(nombre, valores);
  const completos = [valores.kcal, valores.proteinas, valores.grasas, valores.carbs].every((v) => v != null);

  // Verificación del servidor (duplicados y parecidos viven en la base). Cualquier cambio invalida la anterior.
  useEffect(() => {
    setVerificacion(null);
    onVerificacion(null);
    setFalloVerificar(false);
    if (!propio.activo || !completos || nombre.trim() === '') {
      setVerificando(false);
      return;
    }
    let cancelado = false;
    setVerificando(true);
    const timer = setTimeout(async () => {
      const r = await verificarAlimentoPropioAction({ nombre: nombre.trim(), ...valores });
      if (cancelado) return;
      setVerificando(false);
      if ('error' in r) {
        setFalloVerificar(true);
        return;
      }
      const v = { bloqueos: r.bloqueos, advertencias: r.advertencias };
      setVerificacion(v);
      onVerificacion(v);
    }, 400);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propio.activo, nombre, valores.kcal, valores.proteinas, valores.grasas, valores.carbs]);

  if (!propio.activo) {
    return (
      <div className="rounded-xl border border-slate-200 p-3">
        <label className="flex items-start gap-2 text-sm font-medium text-slate-900">
          <input
            type="checkbox"
            checked={false}
            onChange={() => onChange({ activo: true })}
            className="mt-0.5 h-4 w-4"
          />
          Agregar este alimento al catálogo propio
        </label>
        <p className="mt-1 pl-6 text-xs text-slate-600">
          Para reutilizarlo después desde &quot;Del catálogo&quot; (etiqueta PROPIO). Se verifica antes de entrar y se puede retirar.
        </p>
      </div>
    );
  }

  const bloqueos = [
    ...local.bloqueos.filter((c) => c !== 'DUPLICADO').map((c) => MENSAJE_BLOQUEO[c]),
    ...(verificacion?.bloqueos ?? []).map((b) =>
      b.codigo === 'DUPLICADO' && b.existente
        ? `Ya existe «${b.existente.nombre}» (${b.existente.fuente}). Usalo desde "Del catálogo".`
        : MENSAJE_BLOQUEO[b.codigo],
    ),
  ];
  const incoherente = verificacion?.advertencias.some((a) => a.codigo === 'KCAL_INCOHERENTE');
  const similar = verificacion?.advertencias.find((a) => a.codigo === 'SIMILAR');

  return (
    <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-3">
      <label className="flex items-start gap-2 text-sm font-medium text-slate-900">
        <input type="checkbox" checked onChange={() => onChange({ activo: false })} className="mt-0.5 h-4 w-4" />
        Agregar este alimento al catálogo propio
      </label>

      <div aria-live="polite" className="space-y-1 text-sm">
        {verificando && <p className="text-slate-700">Verificando…</p>}
        {falloVerificar && <p className="text-amber-700">No se pudo verificar ahora. Revisá los valores y probá de nuevo.</p>}
        {bloqueos.map((m) => (
          <p key={m} role="alert" className="text-red-700">
            {m}
          </p>
        ))}
        {incoherente && (
          <div className="rounded-lg bg-amber-50 p-2 text-amber-800">
            <p>{MENSAJE_ADVERTENCIA.KCAL_INCOHERENTE}</p>
            <label className="mt-1 flex items-start gap-2 font-medium">
              <input
                type="checkbox"
                checked={propio.confirmaIncoherente}
                onChange={(e) => onChange({ confirmaIncoherente: e.target.checked })}
                className="mt-0.5 h-4 w-4"
              />
              Confirmo que las kcal son correctas
            </label>
          </div>
        )}
        {similar && (
          <div className="rounded-lg bg-amber-50 p-2 text-amber-800">
            <p>{MENSAJE_ADVERTENCIA.SIMILAR}</p>
            <ul className="ml-4 list-disc">
              {(similar.similares ?? []).map((s) => (
                <li key={`${s.origen}:${s.id}`}>
                  {s.nombre} <span className="text-xs">({s.fuente})</span>
                </li>
              ))}
            </ul>
            <label className="mt-1 flex items-start gap-2 font-medium">
              <input
                type="checkbox"
                checked={propio.confirmaDistinto}
                onChange={(e) => onChange({ confirmaDistinto: e.target.checked })}
                className="mt-0.5 h-4 w-4"
              />
              Confirmo que es un alimento distinto
            </label>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Fuente del dato
          <select
            value={propio.fuente}
            onChange={(e) => onChange({ fuente: e.target.value as FuenteDato | '' })}
            className={`mt-1 ${claseCampo}`}
          >
            <option value="">Elegí una fuente…</option>
            {FUENTES_DATO.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.etiqueta}
              </option>
            ))}
          </select>
        </label>
        <div>
          <label htmlFor="pv-propio-justificacion" className="block text-sm font-medium text-slate-700">
            Justificación
          </label>
          <textarea
            id="pv-propio-justificacion"
            value={propio.justificacion}
            onChange={(e) => onChange({ justificacion: e.target.value })}
            rows={2}
            placeholder="De dónde sale el valor (o por qué un valor llamativo es correcto)"
            className={`mt-1 ${claseCampo}`}
          />
          <span className="text-xs text-slate-600">
            {propio.justificacion.trim().length}/{JUSTIFICACION_MIN} caracteres como mínimo
          </span>
        </div>
      </div>

      <div className="space-y-1 text-sm text-slate-800">
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={propio.reviseFuente} onChange={(e) => onChange({ reviseFuente: e.target.checked })} className="mt-0.5 h-4 w-4" />
          Revisé la fuente
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={propio.valores100} onChange={(e) => onChange({ valores100: e.target.checked })} className="mt-0.5 h-4 w-4" />
          Los valores son por 100 g
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={propio.busque} onChange={(e) => onChange({ busque: e.target.checked })} className="mt-0.5 h-4 w-4" />
          Busqué y no existe ya en SARA2, ANMAT ni en los propios
        </label>
      </div>
    </div>
  );
}
