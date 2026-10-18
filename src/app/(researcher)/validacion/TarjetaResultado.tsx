'use client';

/**
 * NUT-119 — Tarjeta de resultado del "Revisar alimento": el único lugar donde se muestran los
 * valores por 100 g resultantes (sin repetirlos en cada método) y cómo quedan en cada comida.
 * Siempre a la vista (en escritorio queda fija al pie de la columna izquierda).
 */
import { macrosItem, type Macros100 } from '@/lib/macros';
import { fmt } from '@/lib/numeros';
import type { OcurrenciaDetalle } from './actions';

interface Props {
  macros: Macros100 | null;
  /** "IA (Gemini)", "Del catálogo" o "A mano". */
  fuente: string;
  ocurrencias: OcurrenciaDetalle[];
  incoherente: boolean;
  /** Qué falta para ver el resultado (se muestra cuando todavía no hay valores). */
  vacio: string;
  listo: boolean;
}

function Macro({ punto, nombre, valor }: { punto: string; nombre: string; valor: number }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-2">
      <small className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-slate-600">
        <i aria-hidden="true" className={`h-2 w-2 rounded-full ${punto}`} />
        {nombre}
      </small>
      <b className="text-base text-slate-900">
        {fmt(valor)} <em className="text-xs font-medium not-italic text-slate-600">g</em>
      </b>
    </div>
  );
}

export default function TarjetaResultado({ macros, fuente, ocurrencias, incoherente, vacio, listo }: Props) {
  return (
    <div
      role="region"
      aria-label="Resultado por 100 g"
      aria-live="polite"
      className={`flex flex-col gap-3 rounded-2xl border-[1.5px] bg-white p-4 shadow-[0_6px_18px_rgba(15,23,42,0.06)] ${
        listo ? 'border-green-300' : 'border-slate-200'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">Resultado</h3>
        <span className="whitespace-nowrap rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">{fuente}</span>
      </div>

      {macros ? (
        <>
          <div className="flex items-baseline gap-1.5">
            <b className="text-[34px] leading-none tracking-tight text-slate-900">{fmt(macros.kcal_100g)}</b>
            <span className="font-semibold text-slate-600">kcal por 100 g</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <Macro punto="bg-blue-600" nombre="Proteínas" valor={macros.proteinas_100g} />
            <Macro punto="bg-amber-600" nombre="Carbohid." valor={macros.carbs_100g} />
            <Macro punto="bg-violet-600" nombre="Grasas" valor={macros.grasas_100g} />
          </div>
          {incoherente && (
            <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
              Estos valores no parecen coherentes (las kcal no cierran con 4/4/9 o algún macro es excesivo). Podés validarlos
              igual: la decisión es tuya.
            </p>
          )}
          <div role="region" aria-label="Vista previa por ocurrencia" className="border-t border-slate-200 pt-2.5 text-[13px] text-slate-600">
            Así queda en tu comida:
            <ul className="mt-1 space-y-0.5">
              {ocurrencias.map((o) => {
                const m = macrosItem(macros, o.gramosFinal);
                return (
                  <li key={o.idGuardadoItem}>
                    <b className="text-slate-900">{o.deportista ?? 'Deportista'}</b> · {fmt(o.gramosFinal)} g{' '}
                    <span className="font-semibold text-slate-900">→ {fmt(m.kcal)} kcal</span> · P {fmt(m.proteinas_g)} · C{' '}
                    {fmt(m.carbs_g)} · G {fmt(m.grasas_g)}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      ) : (
        <p className="py-1.5 text-[13px] text-slate-600">{vacio}</p>
      )}
    </div>
  );
}
