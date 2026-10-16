'use client';

/**
 * NUT-119 — Método "Del catálogo": el investigador indica los GRAMOS REALES de cada
 * alimento del catálogo que hay en la foto (nunca proporciones). El sistema calcula los
 * valores por 100 g sobre el peso de la foto de referencia; ese resultado se muestra UNA
 * sola vez, en la tarjeta de resultado del detalle. Acá: buscador, ingredientes con sus
 * gramos y la barra de cuánto de la foto ya se asignó. Cubre un solo alimento (equivalencia
 * o vínculo) y compuestos ("aceite y vinagre"). El estado vive en el padre (para el borrador).
 * La foto de referencia es siempre la primera ocurrencia del alimento (no se elige).
 */
import { useEffect, useId, useState } from 'react';
import { searchAlimentosAction, type AlimentoOption } from '@/app/alimentacion/actions';
import { aComponentes, claveIngrediente, GRAMOS_MAX_INGREDIENTE, resumirComposicion, type ComponenteEditable } from '@/lib/composicion';
import type { Macros100 } from '@/lib/macros';
import { buscarAlimentosPropiosAction, type OcurrenciaDetalle } from './actions';

interface Props {
  /** La primera ocurrencia del alimento (su peso es el de referencia); null si no hay una con peso. */
  foto: OcurrenciaDetalle | null;
  ingredientes: ComponenteEditable[];
  onIngredientes: (siguiente: ComponenteEditable[]) => void;
  soloLectura?: boolean;
}

const redondear1 = (n: number) => Math.round(n * 10) / 10;

/** El catálogo puede tener alimentos sin valores nutricionales cargados. */
function aMacros(a: AlimentoOption): Macros100 | null {
  const v = [a.kcal_100g, a.proteinas_100g, a.grasas_100g, a.carbs_100g];
  if (v.some((x) => x == null)) return null;
  return {
    kcal_100g: Number(a.kcal_100g),
    proteinas_100g: Number(a.proteinas_100g),
    grasas_100g: Number(a.grasas_100g),
    carbs_100g: Number(a.carbs_100g),
  };
}

/** Etiqueta de la fuente: PROPIO violeta, SARA2 azul, ANMAT verde (todas AA sobre su fondo). */
function Fuente({ fuente }: { fuente: string }) {
  const clase =
    fuente === 'PROPIO'
      ? 'bg-violet-50 text-violet-800'
      : fuente === 'SARA2'
        ? 'bg-blue-50 text-blue-700'
        : fuente === 'ANMAT'
          ? 'bg-green-50 text-green-800'
          : 'bg-slate-100 text-slate-600';
  return <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold tracking-wide ${clase}`}>{fuente}</span>;
}

export default function ComposicionCatalogo({ foto, ingredientes, onIngredientes, soloLectura = false }: Props) {
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<AlimentoOption[]>([]);
  const idBuscador = useId();

  // Búsqueda con debounce, igual que el resto de los buscadores.
  useEffect(() => {
    if (busqueda.trim().length < 2) {
      setResultados([]);
      return;
    }
    const timer = setTimeout(async () => {
      // Los propios van primero; si su buscador falla, se muestran igual los del catálogo.
      const [catalogo, propios] = await Promise.all([
        searchAlimentosAction(busqueda, ''),
        buscarAlimentosPropiosAction(busqueda).catch(() => [] as AlimentoOption[]),
      ]);
      setResultados([...propios.slice(0, 3), ...catalogo.slice(0, 6)]);
    }, 300);
    return () => clearTimeout(timer);
  }, [busqueda]);

  const peso = foto && foto.gramosFinal > 0 ? foto.gramosFinal : 0;
  const { componentes, problemas } = aComponentes(ingredientes);
  const r = resumirComposicion(componentes, peso);

  const agregar = (a: AlimentoOption) => {
    setBusqueda('');
    setResultados([]);
    const origen = a.fuente === 'PROPIO' ? 'propio' : 'catalogo';
    if (ingredientes.some((i) => claveIngrediente(i) === claveIngrediente({ origen, id: a.id_alimento }))) return; // no se repite
    onIngredientes([
      ...ingredientes,
      {
        origen,
        id: a.id_alimento,
        nombre: a.nombre,
        fuente: a.fuente,
        // El primero arranca con todo el peso de la foto; los demás los completa el investigador.
        gramos: ingredientes.length === 0 && peso > 0 ? String(redondear1(peso)) : '',
        macros: aMacros(a),
      },
    ]);
  };

  const cambiarGramos = (clave: string, gramos: string) =>
    onIngredientes(ingredientes.map((i) => (claveIngrediente(i) === clave ? { ...i, gramos } : i)));

  const porcentaje = peso > 0 ? Math.min(100, (r.suma / peso) * 100) : 0;
  const completa = r.estado === 'completa';
  const sobra = r.estado === 'sobra';

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-slate-600">
        Indicá cuántos gramos de cada alimento hay en la foto. Nosotros calculamos los valores por 100 g.
      </p>

      {!(foto && peso > 0) && <p className="text-sm text-amber-700">No hay una foto de referencia con peso para calcular.</p>}

      {!soloLectura && (
        <div className="relative">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-3.5 text-slate-600"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <label htmlFor={idBuscador} className="sr-only">
            Agregar alimento del catálogo
          </label>
          <input
            id={idBuscador}
            type="text"
            autoComplete="off"
            placeholder="Buscar en SARA2 o ANMAT…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="h-11 w-full rounded-xl border-[1.5px] border-slate-200 bg-white pl-11 pr-3.5 text-[15px] text-slate-900 placeholder-slate-500 focus:border-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200"
          />
          {resultados.length > 0 && (
            <ul className="absolute inset-x-0 top-12 z-10 max-h-60 space-y-0.5 overflow-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
              {resultados.map((a) => (
                <li key={`${a.fuente === 'PROPIO' ? 'propio' : 'catalogo'}:${a.id_alimento}`}>
                  <button
                    type="button"
                    aria-label={`Agregar ${a.nombre}`}
                    onClick={() => agregar(a)}
                    className="flex min-h-11 w-full items-center gap-2.5 rounded-[10px] p-2.5 text-left text-sm hover:bg-blue-50 focus-visible:bg-blue-50 focus-visible:outline-none"
                  >
                    <span className="flex-1 font-semibold text-slate-900">{a.nombre}</span>
                    <Fuente fuente={a.fuente} />
                    {a.kcal_100g != null && <span className="text-xs text-slate-600">{redondear1(Number(a.kcal_100g))} kcal/100 g</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {ingredientes.length === 0 ? (
        <div className="rounded-xl border-[1.5px] border-dashed border-slate-300 p-3.5 text-center text-[13px] text-slate-600">
          Todavía no agregaste alimentos. Buscá arriba para empezar.
        </div>
      ) : (
        <ul className="space-y-2">
          {ingredientes.map((i) => {
            const g = Number(i.gramos);
            const aporte =
              i.macros && Number.isFinite(g) && g > 0
                ? `aporta ${redondear1((i.macros.kcal_100g * g) / 100)} kcal a la foto`
                : i.macros
                  ? `por 100 g: ${redondear1(i.macros.kcal_100g)} kcal`
                  : 'sin datos nutricionales';
            return (
              <li
                key={claveIngrediente(i)}
                className="grid grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2 font-semibold text-slate-900">
                  {i.nombre} <Fuente fuente={i.fuente} />
                </span>
                <span className="col-start-2 row-span-2 row-start-1 flex items-center gap-2">
                  <label className="flex h-11 items-center gap-1.5 rounded-[10px] border-[1.5px] border-slate-200 bg-white px-2.5 focus-within:border-blue-700 focus-within:ring-4 focus-within:ring-blue-200">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={GRAMOS_MAX_INGREDIENTE}
                      step="0.1"
                      aria-label={`Gramos de ${i.nombre}`}
                      value={i.gramos}
                      disabled={soloLectura}
                      placeholder="0"
                      onChange={(e) => cambiarGramos(claveIngrediente(i), e.target.value)}
                      className="w-14 bg-transparent text-right text-base font-bold text-slate-900 placeholder-slate-500 focus:outline-none disabled:text-slate-600"
                    />
                    <span className="font-semibold text-slate-600">g</span>
                  </label>
                  {!soloLectura && (
                    <button
                      type="button"
                      aria-label={`Quitar ${i.nombre}`}
                      onClick={() => onIngredientes(ingredientes.filter((x) => claveIngrediente(x) !== claveIngrediente(i)))}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-slate-600 hover:bg-red-50 hover:text-red-700"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </span>
                <span className="text-xs text-slate-600">{aporte}</span>
              </li>
            );
          })}
        </ul>
      )}

      {ingredientes.length > 0 && (
        <div role="region" aria-label="Resultado de la composición" className="space-y-1.5">
          {problemas.length > 0 ? (
            problemas.map((p) => (
              <p key={p} className="text-[13px] text-amber-800">
                {p}
              </p>
            ))
          ) : (
            <>
              <div
                role="progressbar"
                aria-label="Gramos asignados de la foto"
                aria-valuemin={0}
                aria-valuemax={peso}
                aria-valuenow={r.suma}
                className="h-2 overflow-hidden rounded-full bg-slate-200"
              >
                <i
                  className={`block h-full rounded-full transition-[width] ${sobra ? 'bg-red-700' : completa ? 'bg-green-700' : 'bg-blue-700'}`}
                  style={{ width: `${porcentaje}%` }}
                />
              </div>
              <p className={`text-[13px] ${sobra ? 'font-semibold text-red-700' : completa ? 'text-green-800' : 'text-slate-600'}`}>
                {completa && '✓ '}Sumás {redondear1(r.suma)} g de {redondear1(peso)} g de la foto.
              </p>
              {r.estado === 'falta' && (
                <p className="text-[13px] text-slate-600">Los {redondear1(r.diferencia)} g restantes se cuentan sin aporte.</p>
              )}
              {sobra && (
                <p className="text-[13px] font-semibold text-red-700">
                  Superás el peso de la foto por {redondear1(-r.diferencia)} g: revisá los gramos.
                </p>
              )}
              {r.esVinculoPuro && (
                <p className="text-[13px] text-blue-700">
                  Es el mismo alimento del catálogo: se vincula a «{componentes[0].nombre}».
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
