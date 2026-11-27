'use client';

import { useState, useTransition } from 'react';
import Card from '@/components/researcher/Card';
import { CONTROL_CLASS } from '@/components/researcher/FilterBar';
import Button from '@/components/ui/Button';
import type { ErrorTecnico } from '@/lib/antropometria';
import { fmtFijo } from '@/lib/researcher/antropometria/formato';
import { INSTRUMENTOS, MAX_INSTRUMENTO, type ClaveInstrumento, type Instrumentos } from '@/lib/researcher/antropometria/instrumentos';
import type { Investigador } from '@/lib/researcher/antropometria/investigadores';
import { guardarMisInstrumentosAction } from '../actions';
import TablaErrorTecnico from './TablaErrorTecnico';

interface Props {
  misInstrumentos: Instrumentos;
  investigadores: Investigador[];
  /** Error técnico por investigador (id → ETM); falta el que no tiene mediciones vigentes. */
  errorTecnico: Record<string, ErrorTecnico>;
  investigadorInicial: string;
}

const ETIQUETA = 'mb-1 block text-sm font-medium text-slate-700';
const INPUT =
  'h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30';

type Mensaje = { tipo: 'ok' | 'error'; texto: string } | null;

export default function ConfiguracionClient({ misInstrumentos, investigadores, errorTecnico, investigadorInicial }: Props) {
  const [instrumentos, setInstrumentos] = useState<Instrumentos>(misInstrumentos);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [guardando, empezarGuardado] = useTransition();
  const [seleccionado, setSeleccionado] = useState(investigadorInicial);

  function cambiar(clave: ClaveInstrumento, valor: string) {
    setMensaje(null);
    setInstrumentos((i) => ({ ...i, [clave]: valor }));
  }

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    setMensaje(null);
    empezarGuardado(async () => {
      try {
        const r = await guardarMisInstrumentosAction(instrumentos);
        setMensaje('ok' in r ? { tipo: 'ok', texto: 'Instrumentos guardados.' } : { tipo: 'error', texto: r.error });
      } catch {
        setMensaje({ tipo: 'error', texto: 'No se pudieron guardar los instrumentos. Probá de nuevo.' });
      }
    });
  }

  const nombre = investigadores.find((i) => i.id === seleccionado)?.nombre ?? '';
  const etm = errorTecnico[seleccionado];
  const hayDatos = !!etm && etm.mediciones > 0;

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-4 sm:p-6">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Mis instrumentos</h2>
          <p className="text-xs text-slate-600">
            Todo opcional. Se precargan en cada medición nueva y podés cambiarlos ahí; las mediciones ya guardadas no se modifican.
          </p>
        </div>
        <form onSubmit={guardar} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {INSTRUMENTOS.map((i) => (
              <div key={i.clave}>
                <label htmlFor={`mi-instrumento-${i.clave}`} className={ETIQUETA}>
                  {i.etiqueta}
                </label>
                <input
                  id={`mi-instrumento-${i.clave}`}
                  type="text"
                  autoComplete="off"
                  maxLength={MAX_INSTRUMENTO}
                  placeholder="Modelo o marca"
                  value={instrumentos[i.clave]}
                  onChange={(e) => cambiar(i.clave, e.target.value)}
                  className={INPUT}
                />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={guardando}>
              Guardar instrumentos
            </Button>
            {mensaje && (
              <p role={mensaje.tipo === 'error' ? 'alert' : 'status'} className={`text-sm ${mensaje.tipo === 'error' ? 'text-red-700' : 'text-green-800'}`}>
                {mensaje.texto}
              </p>
            )}
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="space-y-3 border-b border-slate-100 px-4 py-4 sm:px-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Error técnico de medición</h2>
            <p className="text-xs text-slate-600">
              Se calcula solo con las mediciones vigentes de cada investigador (2 o 3 series por variable). Es informativo: no hay un valor de corte.
            </p>
          </div>
          <div className="max-w-sm">
            <label htmlFor="etm-investigador" className={ETIQUETA}>
              Investigador
            </label>
            <select id="etm-investigador" value={seleccionado} onChange={(e) => setSeleccionado(e.target.value)} className={CONTROL_CLASS}>
              {investigadores.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nombre}
                </option>
              ))}
            </select>
          </div>
          {hayDatos && (
            <p className="text-sm text-slate-700">
              Promedio: {fmtFijo(etm.resumen.pliegues, 2)} % en pliegues y {fmtFijo(etm.resumen.otras, 2)} % en las otras variables, basado en{' '}
              {etm.mediciones} {etm.mediciones === 1 ? 'medición' : 'mediciones'}.
            </p>
          )}
        </div>
        {hayDatos ? (
          <TablaErrorTecnico errorTecnico={etm} nombre={nombre} />
        ) : (
          <p className="px-4 py-6 text-sm text-slate-600 sm:px-6">Todavía no hay mediciones vigentes de este investigador para calcularlo.</p>
        )}
      </Card>
    </div>
  );
}
