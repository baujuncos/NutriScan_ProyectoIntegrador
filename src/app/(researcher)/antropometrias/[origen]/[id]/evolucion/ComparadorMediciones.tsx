/**
 * Comparador A/B. La elección vive en la URL (`?a=&b=`): es un formulario GET, así la página se
 * renderiza en el servidor, funciona sin JavaScript y el enlace se puede compartir.
 */
import Card from '@/components/researcher/Card';
import {
  compararAB,
  DECIMALES_COMPARADOR,
  etiquetaMedicion,
  type MedicionNumerada,
} from '@/lib/researcher/antropometria/evolucion';
import { fechaLegible } from '@/lib/researcher/antropometria/reglas';
import { fmtConSigno, fmtFijo } from '@/lib/researcher/antropometria/formato';

const SELECT =
  'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';
const BOTON =
  'inline-flex h-10 items-center justify-center rounded-lg bg-blue-700 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

interface Props {
  mediciones: MedicionNumerada[];
  idA: string;
  idB: string;
}

export default function ComparadorMediciones({ mediciones, idA, idB }: Props) {
  const puedeComparar = mediciones.length >= 2;
  const comparacion = puedeComparar ? compararAB(mediciones, idA, idB) : null;

  return (
    <section id="comparador" aria-labelledby="titulo-comparador" className="space-y-3 scroll-mt-4">
      <h2 id="titulo-comparador" className="text-base font-semibold text-slate-900">
        Comparar dos mediciones
      </h2>
      <Card className="space-y-4 p-4">
        <form method="get" action="#comparador" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Selector id="medicion-a" nombre="a" etiqueta="Medición A" mediciones={mediciones} valor={idA} deshabilitado={!puedeComparar} />
          <Selector id="medicion-b" nombre="b" etiqueta="Medición B" mediciones={mediciones} valor={idB} deshabilitado={!puedeComparar} />
          <button type="submit" disabled={!puedeComparar} className={BOTON}>
            Comparar
          </button>
        </form>

        {!puedeComparar && (
          <p role="status" className="text-sm text-slate-600">
            Para comparar hacen falta al menos dos mediciones. Cuando cargues otra, vas a poder elegir cuáles comparar.
          </p>
        )}

        {comparacion?.mismaMedicion && (
          <p role="status" className="text-sm text-amber-800">
            Elegiste la misma medición en A y en B. Elegí dos distintas para ver las diferencias.
          </p>
        )}
      </Card>

      {comparacion && !comparacion.mismaMedicion && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">
                Comparación entre la medición {etiquetaMedicion(comparacion.a)} y la {etiquetaMedicion(comparacion.b)}. Diferencia = B − A.
              </caption>
              <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Variable</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Nº {comparacion.a.nro}
                    <span className="block text-[11px] font-normal normal-case tracking-normal">{fechaLegible(comparacion.a.fecha)}</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Nº {comparacion.b.nro}
                    <span className="block text-[11px] font-normal normal-case tracking-normal">{fechaLegible(comparacion.b.fecha)}</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Diferencia
                    <span className="block text-[11px] font-normal normal-case tracking-normal">B − A</span>
                  </th>
                </tr>
              </thead>
              {comparacion.grupos.map((g) => (
                <tbody key={g.id} className="divide-y divide-slate-100 border-t border-slate-100">
                  <tr className="bg-slate-50/60">
                    <th scope="colgroup" colSpan={4} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {g.titulo}
                    </th>
                  </tr>
                  {g.filas.map((f) => (
                    <tr key={f.clave}>
                      <th scope="row" className="px-4 py-2 font-medium text-slate-900">
                        {f.etiqueta}
                        {f.unidad && <span className="ml-1 font-normal text-slate-500">({f.unidad})</span>}
                      </th>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-700">{fmtFijo(f.valorA, DECIMALES_COMPARADOR)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-700">{fmtFijo(f.valorB, DECIMALES_COMPARADOR)}</td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">
                        {fmtConSigno(f.diferencia, DECIMALES_COMPARADOR)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </Card>
      )}
    </section>
  );
}

function Selector({
  id,
  nombre,
  etiqueta,
  mediciones,
  valor,
  deshabilitado,
}: {
  id: string;
  nombre: string;
  etiqueta: string;
  mediciones: MedicionNumerada[];
  valor: string;
  deshabilitado: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-700">
        {etiqueta}
      </label>
      <select id={id} name={nombre} defaultValue={valor} disabled={deshabilitado} className={SELECT}>
        {mediciones.map((m) => (
          <option key={m.id} value={m.id}>
            {etiquetaMedicion(m)}
          </option>
        ))}
      </select>
    </div>
  );
}
