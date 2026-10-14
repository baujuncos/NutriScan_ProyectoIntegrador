'use client';

/**
 * NUT-119 — Pestaña "Del catálogo": el investigador indica los GRAMOS REALES de
 * cada alimento del catálogo que hay en la foto (nunca proporciones). El sistema
 * calcula los valores por 100 g del alimento sobre el peso de la foto de
 * referencia. Cubre un solo alimento (equivalencia o vínculo) y compuestos
 * ("aceite y vinagre"). El estado vive en el padre (para guardarlo en el borrador).
 * La foto de referencia es siempre la primera ocurrencia del alimento (no se elige).
 */
import { useEffect, useState } from 'react';
import Input from '@/components/ui/Input';
import { searchAlimentosAction, type AlimentoOption } from '@/app/alimentacion/actions';
import { formatFechaCorta } from '@/lib/date';
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

function Fuente({ fuente }: { fuente: string }) {
  return fuente === 'PROPIO' ? (
    <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs font-semibold text-violet-800">PROPIO</span>
  ) : (
    <span className="text-xs text-slate-600">{fuente}</span>
  );
}

export default function ComposicionCatalogo({
  foto,
  ingredientes,
  onIngredientes,
  soloLectura = false,
}: Props) {
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<AlimentoOption[]>([]);

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

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">
        Indicá cuántos gramos de cada alimento del catálogo hay en la foto. El sistema calcula los valores por 100 g.
      </p>

      {foto && peso > 0 ? (
        <p className="text-sm text-slate-800">
          En la foto de {foto.deportista ?? 'un deportista'}, {formatFechaCorta(foto.fecha)}, pesa{' '}
          <strong>{redondear1(peso)} g</strong>.
        </p>
      ) : (
        <p className="text-sm text-amber-700">No hay una foto de referencia con peso para calcular.</p>
      )}

      {!soloLectura && (
        <>
          <Input
            id="pv-catalogo"
            label="Agregar alimento del catálogo"
            placeholder="Buscar en SARA2 o ANMAT…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          {resultados.length > 0 && (
            <ul className="space-y-1">
              {resultados.map((a) => (
                <li key={a.id_alimento}>
                  <button
                    type="button"
                    aria-label={`Agregar ${a.nombre}`}
                    onClick={() => agregar(a)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    {a.nombre} <Fuente fuente={a.fuente} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {ingredientes.length > 0 && (
        <ul className="space-y-2">
          {ingredientes.map((i) => (
            <li key={claveIngrediente(i)} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-slate-800">
                {i.nombre} <Fuente fuente={i.fuente} />
              </span>
              <input
                type="number"
                min={0}
                max={GRAMOS_MAX_INGREDIENTE}
                step="0.1"
                aria-label={`Gramos de ${i.nombre}`}
                value={i.gramos}
                disabled={soloLectura}
                onChange={(e) => cambiarGramos(claveIngrediente(i), e.target.value)}
                className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm text-slate-900 disabled:bg-slate-100"
              />
              <span className="text-xs text-slate-600">g en la foto</span>
              {!soloLectura && (
                <button
                  type="button"
                  aria-label={`Quitar ${i.nombre}`}
                  onClick={() => onIngredientes(ingredientes.filter((x) => claveIngrediente(x) !== claveIngrediente(i)))}
                  className="rounded p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div role="region" aria-label="Resultado de la composición" className="space-y-1 rounded-lg bg-slate-50 p-2 text-sm">
        {ingredientes.length === 0 ? (
          <p className="text-slate-700">Agregá al menos un alimento del catálogo para calcular.</p>
        ) : problemas.length > 0 ? (
          problemas.map((p) => (
            <p key={p} className="text-amber-700">
              {p}
            </p>
          ))
        ) : (
          <>
            <p className="text-slate-800">
              Sumás {redondear1(r.suma)} g de {redondear1(peso)} g de la foto.
            </p>
            {r.estado === 'falta' && (
              <p className="text-amber-700">Los {redondear1(r.diferencia)} g restantes se cuentan sin aporte.</p>
            )}
            {r.estado === 'sobra' && (
              <p className="text-amber-700">
                Superás el peso de la foto por {redondear1(-r.diferencia)} g: revisá los gramos.
              </p>
            )}
            {r.esVinculoPuro && (
              <p className="text-blue-800">
                Es el mismo alimento del catálogo: se vincula a «{componentes[0].nombre}».
              </p>
            )}
            {r.macros && (
              <p className="font-medium text-slate-900">
                Por 100 g del alimento: {redondear1(r.macros.kcal_100g)} kcal · P {redondear1(r.macros.proteinas_100g)} g · C{' '}
                {redondear1(r.macros.carbs_100g)} g · G {redondear1(r.macros.grasas_100g)} g
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
