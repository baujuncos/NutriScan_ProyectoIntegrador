'use client';

/**
 * NUT-225 — "Vincular con un alimento existente": para una entrada SOLO manual (sin foto, así que no hay
 * peso de referencia para armar una mezcla del catálogo), el investigador busca un alimento ya existente
 * (SARA2, ANMAT o VALIDADO), lo elige y valida la entrada vinculándola a él. Los ítems pendientes reciben
 * sus valores por 100 g conservando el nombre que escribió cada persona y el gramaje.
 *
 * Es una tarjeta más del paso 2 de "Revisar alimento", con el mismo aspecto que los métodos; su estado
 * vive en PendienteDetalle y no se guarda en el borrador. No se puede elegir un alimento al que le falte
 * alguno de los 4 valores (la acción lo vuelve a comprobar en el servidor).
 */
import { useEffect, useId, useState } from 'react';
import { searchAlimentosAction, type AlimentoOption } from '@/app/alimentacion/actions';
import { fmt } from '@/lib/numeros';

const CAMPOS = ['kcal_100g', 'proteinas_100g', 'grasas_100g', 'carbs_100g'] as const;

/** Mismo criterio que la acción: un 0 es válido; NULL, vacío o no numérico, no. */
const esValor = (v: unknown) =>
  (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));

export function valoresCompletos(a: AlimentoOption): boolean {
  return CAMPOS.every((c) => esValor(a[c]));
}

function Fuente({ fuente }: { fuente: string }) {
  const clase =
    fuente === 'SARA2'
      ? 'bg-blue-50 text-blue-700'
      : fuente === 'ANMAT'
        ? 'bg-green-50 text-green-800'
        : fuente === 'VALIDADO'
          ? 'bg-amber-50 text-amber-800'
          : 'bg-slate-100 text-slate-600';
  return <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold tracking-wide ${clase}`}>{fuente}</span>;
}

function Valores({ a }: { a: AlimentoOption }) {
  return (
    <span className="text-xs text-slate-700">
      {fmt(Number(a.kcal_100g))} kcal · P {fmt(Number(a.proteinas_100g))} · C {fmt(Number(a.carbs_100g))} · G {fmt(Number(a.grasas_100g))} (por 100 g)
    </span>
  );
}

interface Props {
  /** La tarjeta está elegida como método (en lugar de «A mano»). */
  activo: boolean;
  onActivar: () => void;
  seleccionado: AlimentoOption | null;
  onSeleccionar: (a: AlimentoOption | null) => void;
}

export default function VincularAlimento({ activo, onActivar, seleccionado, onSeleccionar }: Props) {
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<AlimentoOption[]>([]);
  const [buscado, setBuscado] = useState(false);
  const idBuscador = useId();

  // Búsqueda con debounce, igual que el resto de los buscadores de la pantalla.
  useEffect(() => {
    if (busqueda.trim().length < 2) {
      setResultados([]);
      setBuscado(false);
      return;
    }
    let cancelado = false;
    const timer = setTimeout(async () => {
      const r = await searchAlimentosAction(busqueda, '');
      if (cancelado) return;
      setResultados(r.slice(0, 8));
      setBuscado(true);
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [busqueda]);

  const elegir = (a: AlimentoOption) => {
    if (!valoresCompletos(a)) return;
    onSeleccionar(a);
    setBusqueda('');
    setResultados([]);
    setBuscado(false);
  };

  return (
    <div
      className={`rounded-2xl border-[1.5px] bg-white transition-shadow ${
        activo ? 'border-blue-700 shadow-[0_0_0_4px_#bfdbfe]' : 'border-slate-200'
      }`}
    >
      <label className="flex cursor-pointer flex-wrap items-center gap-3 rounded-2xl px-4 py-3.5 md:flex-nowrap">
        <input type="radio" name="metodo-valores" value="vincular" checked={activo} onChange={onActivar} className="peer sr-only" />
        <span
          aria-hidden="true"
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-700 ${
            activo ? 'border-blue-700' : 'border-slate-500'
          }`}
        >
          {activo && <span className="h-2.5 w-2.5 rounded-full bg-blue-700" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="text-[15px] text-slate-900">Vincular con un alimento existente</b>
          <small className="text-[12.5px] text-slate-600">
            Si es el mismo producto que uno que ya está cargado (SARA2, ANMAT o validado), usá sus valores. Las próximas cargas con este
            nombre se resuelven solas.
          </small>
        </span>
        {seleccionado && (
          <span className="w-full pl-8 text-left text-[12.5px] font-semibold text-slate-900 md:ml-auto md:w-auto md:pl-0 md:text-right md:whitespace-nowrap">
            {seleccionado.nombre}
          </span>
        )}
      </label>

      {activo && (
        <div className="flex flex-col gap-3 px-3.5 pb-3.5 pt-0.5 md:pb-4 md:pl-12 md:pr-4">
          {seleccionado ? (
            <div role="region" aria-label="Alimento elegido" className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                {seleccionado.nombre} <Fuente fuente={seleccionado.fuente} />
              </p>
              {seleccionado.marca && <p className="text-xs text-slate-600">{seleccionado.marca}</p>}
              <Valores a={seleccionado} />
              <div>
                <button
                  type="button"
                  onClick={() => onSeleccionar(null)}
                  className="rounded-full border-[1.5px] border-dashed border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                >
                  Elegir otro alimento
                </button>
              </div>
            </div>
          ) : (
            <>
              <label htmlFor={idBuscador} className="sr-only">
                Buscar un alimento existente
              </label>
              <input
                id={idBuscador}
                type="text"
                autoComplete="off"
                placeholder="Buscar en SARA2, ANMAT o validados…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="h-11 w-full rounded-xl border-[1.5px] border-slate-200 bg-white px-3.5 text-[15px] text-slate-900 placeholder-slate-500 focus:border-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200"
              />
              {resultados.length > 0 && (
                <ul className="max-h-60 space-y-0.5 overflow-auto rounded-2xl border border-slate-200 bg-white p-1.5">
                  {resultados.map((a) => {
                    const completo = valoresCompletos(a);
                    return (
                      <li key={a.id_alimento}>
                        <button
                          type="button"
                          aria-label={`Vincular con ${a.nombre}`}
                          disabled={!completo}
                          onClick={() => elegir(a)}
                          className="flex min-h-11 w-full flex-col items-start gap-0.5 rounded-[10px] p-2.5 text-left text-sm hover:bg-blue-50 focus-visible:bg-blue-50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-transparent"
                        >
                          <span className="flex w-full flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-900">{a.nombre}</span>
                            <Fuente fuente={a.fuente} />
                          </span>
                          {completo ? (
                            <Valores a={a} />
                          ) : (
                            <span className="text-xs font-semibold text-amber-800">
                              Sin sus 4 valores nutricionales cargados: no se puede vincular.
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {buscado && resultados.length === 0 && (
                <p className="text-[13px] text-slate-600">No encontré alimentos con ese nombre.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
