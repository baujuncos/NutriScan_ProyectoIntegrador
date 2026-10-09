'use client';

/**
 * NUT-119 — Armar un alimento "compuesto" a partir de VARIOS del catálogo, para
 * validar cosas como un aderezo "aceite y vinagre" que no existen como una sola
 * entrada. El investigador elige cada ingrediente, indica cuántos gramos lleva
 * y se calculan los valores POR 100 g de la mezcla (promedio ponderado). Los
 * vuelca al formulario, donde siguen siendo editables antes de validar.
 */
import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { searchAlimentosAction, type AlimentoOption } from '@/app/alimentacion/actions';
import { macrosMezcla, type Macros100 } from '@/lib/macros';

interface Componente {
  alimento: AlimentoOption;
  gramos: string;
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

interface Props {
  /** Recibe los valores por 100 g de la mezcla (ya calculados). */
  onUsar: (macros: Macros100) => void;
}

export default function MezclaCatalogo({ onUsar }: Props) {
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<AlimentoOption[]>([]);
  const [componentes, setComponentes] = useState<Componente[]>([]);

  // Búsqueda con debounce, igual que el resto de los buscadores.
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

  const sinDatos = componentes.filter((c) => aMacros(c.alimento) == null);
  const gramosOk = componentes.every((c) => Number(c.gramos) > 0);
  const mezcla =
    componentes.length >= 2 && sinDatos.length === 0 && gramosOk
      ? macrosMezcla(
          componentes.map((c) => ({ macros: aMacros(c.alimento)!, gramos: Number(c.gramos) })),
        )
      : null;
  const totalGramos = componentes.reduce((acc, c) => acc + (Number(c.gramos) || 0), 0);

  const agregar = (alimento: AlimentoOption) => {
    // Mismo alimento dos veces no tiene sentido: se suma una sola vez.
    setComponentes((prev) =>
      prev.some((c) => c.alimento.id_alimento === alimento.id_alimento) ? prev : [...prev, { alimento, gramos: '50' }],
    );
    setBusqueda('');
    setResultados([]);
  };

  let mensaje: string | null = null;
  if (componentes.length < 2) mensaje = 'Agregá al menos 2 ingredientes para calcular la mezcla.';
  else if (sinDatos.length > 0)
    mensaje = `${sinDatos.map((c) => c.alimento.nombre).join(', ')} no tiene datos nutricionales en el catálogo: quitalo o cargá los valores a mano.`;
  else if (!gramosOk) mensaje = 'Indicá los gramos de cada ingrediente (mayores a 0).';

  return (
    <section aria-label="Armar una mezcla con varios alimentos" className="space-y-3 rounded-xl border border-slate-200 p-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Armar una mezcla con varios alimentos</h3>
        <p className="mt-0.5 text-xs text-slate-600">
          Para cosas como &quot;aceite y vinagre&quot; que no están como una sola entrada: elegí cada ingrediente del
          catálogo e indicá cuántos gramos lleva (son proporciones). Se calcula por 100 g de mezcla.
        </p>
      </div>

      <Input
        id="pv-mezcla"
        label="Agregar ingrediente a la mezcla"
        placeholder="Buscar en el catálogo…"
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
                {a.nombre} <span className="text-xs text-slate-600">{a.fuente}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {componentes.length > 0 && (
        <ul className="space-y-2">
          {componentes.map((c) => (
            <li key={c.alimento.id_alimento} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-slate-800">{c.alimento.nombre}</span>
              <input
                type="number"
                min={0}
                step="1"
                aria-label={`Gramos de ${c.alimento.nombre}`}
                value={c.gramos}
                onChange={(e) =>
                  setComponentes((prev) =>
                    prev.map((x) => (x.alimento.id_alimento === c.alimento.id_alimento ? { ...x, gramos: e.target.value } : x)),
                  )
                }
                className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm text-slate-900"
              />
              <span className="text-xs text-slate-600">g</span>
              <button
                type="button"
                aria-label={`Quitar ${c.alimento.nombre}`}
                onClick={() => setComponentes((prev) => prev.filter((x) => x.alimento.id_alimento !== c.alimento.id_alimento))}
                className="rounded p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div aria-label="Resultado de la mezcla" role="region" className="rounded-lg bg-slate-50 p-2 text-sm">
        {mezcla ? (
          <p className="text-slate-800">
            Por 100 g de mezcla (total {redondear1(totalGramos)} g): {redondear1(mezcla.kcal_100g)} kcal · P{' '}
            {redondear1(mezcla.proteinas_100g)} g · C {redondear1(mezcla.carbs_100g)} g · G{' '}
            {redondear1(mezcla.grasas_100g)} g
          </p>
        ) : (
          <p className="text-slate-600">{mensaje}</p>
        )}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!mezcla}
        onClick={() => mezcla && onUsar(mezcla)}
      >
        Usar estos valores
      </Button>
    </section>
  );
}
