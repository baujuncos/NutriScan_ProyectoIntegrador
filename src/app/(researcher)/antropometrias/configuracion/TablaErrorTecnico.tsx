import { GRUPOS_VARIABLE, VARIABLES, type ErrorTecnico, type GrupoVariable } from '@/lib/antropometria';
import { fmtFijo } from '@/lib/researcher/antropometria/formato';

const TITULO: Record<GrupoVariable, string> = {
  basicas: 'Básicos',
  diametros: 'Diámetros',
  perimetros: 'Perímetros',
  pliegues: 'Pliegues',
};

/** Las 25 variables agrupadas con su ETM (en la unidad de la variable), %ETM y mediciones usadas (n). */
export default function TablaErrorTecnico({ errorTecnico, nombre }: { errorTecnico: ErrorTecnico; nombre: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-left text-sm">
        <caption className="sr-only">Error técnico de medición de {nombre} por variable</caption>
        <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">Variable</th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">ETM</th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">% ETM</th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">n</th>
          </tr>
        </thead>
        {GRUPOS_VARIABLE.map((grupo) => (
          <tbody key={grupo} className="divide-y divide-slate-100 border-b border-slate-100">
            <tr className="bg-slate-50/60">
              <th scope="rowgroup" colSpan={4} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700">
                {TITULO[grupo]}
              </th>
            </tr>
            {VARIABLES.filter((v) => v.grupo === grupo).map((v) => {
              const e = errorTecnico.variables[v.clave];
              return (
                <tr key={v.clave}>
                  <th scope="row" className="px-4 py-2.5 font-medium text-slate-900">{v.etiqueta}</th>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{e ? `${fmtFijo(e.tem, 2)} ${e.unidad}` : '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{e ? `${fmtFijo(e.porcentaje, 2)} %` : '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{e ? e.n : 0}</td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}
