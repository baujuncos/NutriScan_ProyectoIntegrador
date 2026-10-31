import { GRUPOS_VARIABLE, type ComparacionMediciones, type ResultadoAntropometria } from '@/lib/antropometria';
import { fmtConSigno, fmtFijo } from '@/lib/researcher/antropometria/formato';
import { TITULO_GRUPO } from '@/lib/researcher/antropometria/asistente';
import { DESCRIPCION_MASA, filasMasas, filasProporcionalidad, type ClaveMasa } from '@/lib/researcher/antropometria/informe';
import { fechaLegible } from '@/lib/researcher/antropometria/reglas';
import { fmtZ } from './GraficosInforme';

const TH = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600';
const TD = 'px-3 py-1.5 text-sm tabular-nums text-slate-800';

interface Props {
  resultado: ResultadoAntropometria;
  comparacion: ComparacionMediciones | null;
  fechaAnterior: string | null;
}

/** Diferencia con la medición anterior, con signo y coma: "+1,20" / "−0,50". */
const fmtDif = fmtConSigno;

/** Parte 1: proporcionalidad (Phantom), fraccionamiento en 5 masas y control de calidad. */
export default function InformeParte1({ resultado, comparacion, fechaAnterior }: Props) {
  const filas = filasProporcionalidad(resultado, comparacion);
  const masas = filasMasas(resultado, comparacion);
  const { calidad } = resultado;
  const hayComparacion = comparacion !== null;
  const claseDif = (d: number | null) => (d === null ? '' : d > 0 ? 'text-blue-800' : d < 0 ? 'text-amber-800' : '');

  return (
    <section aria-labelledby="parte-1" className="space-y-6">
      <h2 id="parte-1" className="text-lg font-bold text-slate-900">
        Parte 1 · Proporcionalidad y composición corporal
      </h2>

      <div role="note" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        <strong className="font-semibold text-slate-900">Control de calidad.</strong> Peso estructurado (suma de las 5 masas) {fmtFijo(calidad.pesoEstructuradoKg, 2)} kg
        {' '}frente a peso bruto {fmtFijo(calidad.pesoBrutoKg, 2)} kg: diferencia de {fmtFijo(calidad.diferenciaPesoPorcentaje, 2)} %. Es un dato informativo.
      </div>

      {hayComparacion && fechaAnterior && (
        <p className="text-sm text-slate-600">
          Las columnas &quot;Δ&quot; comparan con la medición del {fechaLegible(fechaAnterior)} (actual − anterior).
        </p>
      )}

      <div className="break-inside-avoid">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Proporcionalidad (Phantom)</h3>
        <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
          <table className="w-full min-w-[34rem] border-collapse">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className={TH}>Variable</th>
                <th scope="col" className={`${TH} text-right`}>Medido</th>
                <th scope="col" className={`${TH} text-right`}>Ajustado</th>
                <th scope="col" className={`${TH} text-right`}>Z Phantom</th>
                {hayComparacion && <th scope="col" className={`${TH} text-right`}>Δ</th>}
                <th scope="col" className={`${TH} text-right`}>Error %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {GRUPOS_VARIABLE.map((g) => (
                <GrupoFilas key={g} titulo={TITULO_GRUPO[g]} columnas={hayComparacion ? 6 : 5}>
                  {filas
                    .filter((f) => f.grupo === g)
                    .map((f) => (
                      <tr key={f.clave}>
                        <th scope="row" className="px-3 py-1.5 text-left text-sm font-normal text-slate-800">
                          {f.etiqueta} <span className="text-xs text-slate-500">({f.unidad})</span>
                        </th>
                        <td className={`${TD} text-right`}>{fmtFijo(f.medido, 2)}</td>
                        <td className={`${TD} text-right`}>{f.ajustado === null ? '—' : fmtFijo(f.ajustado, 2)}</td>
                        <td className={`${TD} text-right font-medium`}>{fmtZ(f.z)}</td>
                        {hayComparacion && <td className={`${TD} text-right ${claseDif(f.diferencia)}`}>{fmtDif(f.diferencia, 2)}</td>}
                        <td className={`${TD} text-right text-slate-600`}>{fmtFijo(f.errorPorcentual, 1)}</td>
                      </tr>
                    ))}
                </GrupoFilas>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-600">
          El Z del perímetro de muslo medial usa el valor ajustado por talla, como el resto de las variables (la planilla original usaba el valor sin ajustar). El % de error es informativo.
        </p>
      </div>

      <div className="break-inside-avoid">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Fraccionamiento en 5 masas</h3>
        <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
          <table className="w-full min-w-[28rem] border-collapse">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className={TH}>Masa</th>
                <th scope="col" className={`${TH} text-right`}>kg</th>
                <th scope="col" className={`${TH} text-right`}>%</th>
                <th scope="col" className={`${TH} text-right`}>Z</th>
                {hayComparacion && <th scope="col" className={`${TH} text-right`}>Δ kg</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {masas.map((m) => (
                <tr key={m.clave} className={m.clave === 'total' ? 'bg-slate-50 font-semibold' : ''}>
                  <th scope="row" className="px-3 py-1.5 text-left text-sm font-normal text-slate-800">
                    {m.etiqueta}
                  </th>
                  <td className={`${TD} text-right`}>{fmtFijo(m.kg, 2)}</td>
                  <td className={`${TD} text-right`}>{m.porcentaje === null ? '—' : fmtFijo(m.porcentaje, 1)}</td>
                  <td className={`${TD} text-right`}>{fmtZ(m.z)}</td>
                  {hayComparacion && <td className={`${TD} text-right ${claseDif(m.diferencia)}`}>{fmtDif(m.diferencia, 2)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-slate-600 sm:grid-cols-2">
          {(Object.keys(DESCRIPCION_MASA) as Exclude<ClaveMasa, 'total'>[]).map((n) => (
            <div key={n}>
              <dt className="inline font-semibold text-slate-800">{masas.find((m) => m.clave === n)!.etiqueta}: </dt>
              <dd className="inline">{DESCRIPCION_MASA[n]}</dd>
            </div>
          ))}
        </dl>
        {resultado.masas.masaOsea.origen === 'referencia' && (
          <p className="mt-2 text-xs text-slate-600">
            Masa ósea de referencia: {fmtFijo(resultado.masas.masaOsea.usadaKg, 2)} kg (fija desde los 21 años, tomada de la primera medición).
          </p>
        )}
      </div>
    </section>
  );
}

function GrupoFilas({ titulo, columnas, children }: { titulo: string; columnas: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-slate-100/70">
        <th colSpan={columnas} scope="colgroup" className="px-3 py-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
          {titulo}
        </th>
      </tr>
      {children}
    </>
  );
}
