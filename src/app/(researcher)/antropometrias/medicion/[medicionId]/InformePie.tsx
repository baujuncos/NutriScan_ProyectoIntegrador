import { fmtFijo } from '@/lib/researcher/antropometria/formato';
import { lineasInstrumentos, type Instrumentos } from '@/lib/researcher/antropometria/instrumentos';
import type { ResumenEtmInvestigador } from '@/lib/researcher/antropometria/investigadores';

interface Props {
  /** Nombre de quien midió. */
  medidoPor: string;
  /** Instrumentos de ESTA medición (lo que se escribió al medirla, no el catálogo actual). */
  instrumentos: Instrumentos;
  /** Error técnico de quien midió; null si no hay mediciones vigentes para calcularlo. */
  etm: ResumenEtmInvestigador | null;
}

const FILA = 'flex items-baseline justify-between gap-4 border-b border-slate-100 py-1.5 text-sm last:border-0';

const porcentaje = (n: number | null) => (n === null ? '—' : `${fmtFijo(n, 2)} %`);

/**
 * Pie del informe (NUT-246): quién midió, instrumentos y error técnico de medición.
 * Los instrumentos sin informar no se muestran; si no hay ninguno, el bloque se omite.
 */
export default function InformePie({ medidoPor, instrumentos, etm }: Props) {
  const lineas = lineasInstrumentos(instrumentos);

  return (
    <footer aria-label="Responsable e instrumentos" className="break-inside-avoid space-y-4 border-t border-slate-200 pt-4">
      <p className="text-sm font-medium text-slate-900">{`Medido por: ${medidoPor}`}</p>

      {lineas.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Instrumentos</h3>
          <dl className="grid gap-x-8 sm:grid-cols-2 print:grid-cols-2">
            {lineas.map((l) => (
              <div key={l.etiqueta} className={FILA}>
                <dt className="text-slate-600">{l.etiqueta}</dt>
                <dd className="text-right font-medium text-slate-900">{l.valor}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {etm && etm.mediciones > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Error técnico de medición</h3>
          <dl className="grid gap-x-8 sm:grid-cols-2 print:grid-cols-2">
            <div className={FILA}>
              <dt className="text-slate-600">% ETM pliegues</dt>
              <dd className="text-right font-medium tabular-nums text-slate-900">{porcentaje(etm.pliegues)}</dd>
            </div>
            <div className={FILA}>
              <dt className="text-slate-600">% ETM otras variables</dt>
              <dd className="text-right font-medium tabular-nums text-slate-900">{porcentaje(etm.otras)}</dd>
            </div>
          </dl>
          <p className="mt-1 text-xs text-slate-600">
            Del investigador que midió, sobre {etm.mediciones} {etm.mediciones === 1 ? 'medición vigente' : 'mediciones vigentes'}. Es informativo.
          </p>
        </div>
      )}
    </footer>
  );
}
