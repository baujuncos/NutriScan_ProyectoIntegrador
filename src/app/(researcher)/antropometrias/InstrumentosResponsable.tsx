'use client';

/**
 * Sección de la revisión del asistente (NUT-246/NUT-240): instrumentos usados, investigador que midió y su
 * error técnico de medición (solo lectura, se calcula con sus mediciones vigentes). Todo es opcional y
 * nunca bloquea "Guardar y generar informe".
 */
import Link from 'next/link';
import { CONTROL_CLASS } from '@/components/researcher/FilterBar';
import { fmtFijo } from '@/lib/researcher/antropometria/formato';
import { INSTRUMENTOS, MAX_INSTRUMENTO, type ClaveInstrumento, type Instrumentos } from '@/lib/researcher/antropometria/instrumentos';
import type { Investigador, ResumenEtmInvestigador } from '@/lib/researcher/antropometria/investigadores';
import { RUTA_CONFIGURACION } from '@/lib/researcher/antropometria/rutas';

interface Props {
  instrumentos: Instrumentos;
  onInstrumento: (clave: ClaveInstrumento, valor: string) => void;
  medidoPor: string;
  onMedidoPor: (id: string) => void;
  investigadores: readonly Investigador[];
  /** Error técnico del investigador elegido; null si todavía no tiene mediciones vigentes. */
  etm: ResumenEtmInvestigador | null;
}

const ETIQUETA = 'mb-1 block text-sm font-medium text-slate-700';
const INPUT =
  'h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30';

const porcentaje = (n: number | null) => (n === null ? '—' : `${fmtFijo(n, 2)} %`);

export default function InstrumentosResponsable({ instrumentos, onInstrumento, medidoPor, onMedidoPor, investigadores, etm }: Props) {
  const hrefTabla = medidoPor ? `${RUTA_CONFIGURACION}?investigador=${encodeURIComponent(medidoPor)}` : RUTA_CONFIGURACION;
  const nombre = investigadores.find((i) => i.id === medidoPor)?.nombre;

  return (
    <section aria-labelledby="instrumentos-titulo" className="space-y-4 rounded-xl border border-slate-200 p-4">
      <div>
        <h3 id="instrumentos-titulo" className="text-sm font-semibold text-slate-900">
          Instrumentos y responsable
        </h3>
        <p className="text-xs text-slate-600">Todo opcional: aparece al pie del informe.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {INSTRUMENTOS.map((i) => (
          <div key={i.clave}>
            <label htmlFor={`instrumento-${i.clave}`} className={ETIQUETA}>
              {i.etiqueta}
            </label>
            <input
              id={`instrumento-${i.clave}`}
              type="text"
              autoComplete="off"
              maxLength={MAX_INSTRUMENTO}
              placeholder="Modelo o marca"
              value={instrumentos[i.clave]}
              onChange={(e) => onInstrumento(i.clave, e.target.value)}
              className={INPUT}
            />
          </div>
        ))}
      </div>

      <div>
        <label htmlFor="medido-por" className={ETIQUETA}>
          Investigador que midió
        </label>
        <select id="medido-por" value={medidoPor} onChange={(e) => onMedidoPor(e.target.value)} className={CONTROL_CLASS}>
          {investigadores.map((i) => (
            <option key={i.id} value={i.id}>
              {i.nombre}
            </option>
          ))}
        </select>
      </div>

      <div role="group" aria-labelledby="etm-titulo" className="space-y-2 rounded-lg bg-slate-50 p-3">
        <h4 id="etm-titulo" className="text-sm font-medium text-slate-900">
          Error técnico de medición{nombre ? ` de ${nombre}` : ''}
        </h4>
        {etm && etm.mediciones > 0 ? (
          <>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-600">% ETM pliegues</dt>
                <dd className="font-medium tabular-nums text-slate-900">{porcentaje(etm.pliegues)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-600">% ETM otras variables</dt>
                <dd className="font-medium tabular-nums text-slate-900">{porcentaje(etm.otras)}</dd>
              </div>
            </dl>
            <p className="text-xs text-slate-600">
              Basado en {etm.mediciones} {etm.mediciones === 1 ? 'medición' : 'mediciones'}. Se calcula solo, es informativo.{' '}
              <Link
                href={hrefTabla}
                target="_blank"
                rel="noopener"
                className="font-medium text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                Ver tabla completa<span className="sr-only"> (se abre en una pestaña nueva)</span>
              </Link>
            </p>
          </>
        ) : (
          <p className="text-xs text-slate-600">Todavía no hay mediciones vigentes de este investigador para calcularlo.</p>
        )}
      </div>
    </section>
  );
}
