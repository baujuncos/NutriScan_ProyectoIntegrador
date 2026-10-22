'use client';

/**
 * NUT-151 — Dashboard "Métricas de calidad". Cinco piezas: ranking de alimentos más
 * corregidos (nombre / peso / quitado por separado), confianza vs. corrección
 * (cuadrante rojo = "confiado y equivocado"), evolución por versión de prompt,
 * alimentos no detectados (aparte) y estado de la cola de NUT-149. Sólo lectura:
 * nada de acá modifica el modelo ni el prompt.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import ChartCard from '@/components/researcher/ChartCard';
import FilterBar, { CONTROL_CLASS, type FilterField } from '@/components/researcher/FilterBar';
import PageHeader from '@/components/researcher/PageHeader';
import SubTabs from '@/components/researcher/SubTabs';
import { useFiltrosServidor } from '@/components/researcher/useFiltrosServidor';
import {
  MIN_DETECCIONES_EVOLUCION,
  UMBRAL_CONFIANZA_ALTA,
  UMBRAL_TASA_CORRECCION_ALTA,
  type Cuadrante,
  type EstadoCola,
  type FilaNoDetectado,
  type FilaRanking,
  type PuntoConfianza,
  type ResumenEvolucion,
  type VersionPrompt,
} from '@/lib/metricasIa';
import { buildMetricasQuery, defaultsMetricas, type MetricasParams } from '@/lib/metricasIaQuery';
import EstadoColaChips from '../EstadoColaChips';

interface Props {
  params: MetricasParams;
  versiones: string[];
  ranking: FilaRanking[];
  puntos: PuntoConfianza[];
  evolucion: VersionPrompt[];
  resumen: ResumenEvolucion | null;
  alimentosEvolucion: Array<{ alimento_norm: string; alimento: string; detecciones: number }>;
  noDetectados: FilaNoDetectado[];
  cola: EstadoCola;
  totalItems: number;
  truncado: boolean;
}

const MAX_FILAS_RANKING = 10;
const MAX_NO_DETECTADOS = 10;

const pct = (x: number) => `${Math.round(x * 100)}%`;

const COLOR_CUADRANTE: Record<Cuadrante, string> = {
  confiado_equivocado: '#ef4444',
  dudoso_equivocado: '#f59e0b',
  dudoso_ok: '#f59e0b',
  confiado_ok: '#10b981',
};

const Vacio = ({ children }: { children: React.ReactNode }) => (
  <p className="flex min-h-32 items-center justify-center text-center text-sm text-slate-600">{children}</p>
);

function Barra({ valor, color, etiqueta }: { valor: number; color: string; etiqueta: string }) {
  return (
    <div className="min-w-24">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${etiqueta}: ${pct(valor)}`}>
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(valor * 100, valor > 0 ? 3 : 0)}%` }} />
      </div>
      <span className="text-xs text-slate-600">{pct(valor)}</span>
    </div>
  );
}

export default function MetricasClient({
  params,
  versiones,
  ranking,
  puntos,
  evolucion,
  resumen,
  alimentosEvolucion,
  noDetectados,
  cola,
  totalItems,
  truncado,
}: Props) {
  const confiadosEquivocados = puntos.filter((p) => p.cuadrante === 'confiado_equivocado').sort((a, b) => b.tasaCorreccion - a.tasaCorreccion);
  const datosEvolucion = evolucion.map((v) => ({ version: v.prompt_version, error: v.errorPesoPromedio == null ? 0 : Math.round(v.errorPesoPromedio * 100) }));
  const sinDatosDePeso = evolucion.every((v) => v.errorPesoPromedio == null);

  const defaults = defaultsMetricas();
  const { pending, onChange, onClear } = useFiltrosServidor({ path: '/revision-ia/metricas', params, defaults, build: buildMetricasQuery });
  const campos: FilterField[] = [
    { type: 'date', id: 'desde', label: 'Desde', value: params.desde, max: params.hasta || undefined, invalidMessage: 'Desde no puede ser posterior a Hasta.' },
    { type: 'date', id: 'hasta', label: 'Hasta', value: params.hasta, min: params.desde || undefined, invalidMessage: 'Hasta no puede ser anterior a Desde.' },
    {
      type: 'select',
      id: 'vajilla',
      label: 'Vajilla',
      value: params.vajilla,
      width: 'md',
      options: [
        { value: 'todas', label: 'Todas' },
        { value: 'plato_playo', label: 'Plato playo' },
        { value: 'plato_postre', label: 'Plato postre' },
        { value: 'plato_hondo', label: 'Plato hondo' },
      ],
    },
    {
      type: 'select',
      id: 'prompt',
      label: 'Versión de prompt',
      value: params.prompt,
      width: 'lg',
      options: [{ value: 'todas', label: 'Todas' }, ...versiones.map((v) => ({ value: v, label: v }))],
    },
  ];
  const canClear = params.desde !== defaults.desde || params.hasta !== defaults.hasta || params.vajilla !== defaults.vajilla || params.prompt !== defaults.prompt;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Métricas de calidad"
        subtitle="Patrones de corrección sobre las detecciones de Gemini, para decidir dónde priorizar ejemplos de prompt o factores de calibración."
        helpId="revision-metricas"
        actions={<EstadoColaChips conteos={cola} hrefDe={(estado) => `/revision-ia?estado=${estado}`} />}
      />

      <SubTabs
        tabs={[
          { label: 'Cola de revisión', href: '/revision-ia' },
          { label: 'Métricas', href: '/revision-ia/metricas' },
        ]}
        activeHref="/revision-ia/metricas"
      />

      <FilterBar fields={campos} onChange={onChange} onClear={onClear} canClear={canClear} busy={pending} />

      {truncado && (
        <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Hay más datos que el límite de lectura: estas métricas son parciales. Acotá el rango de fechas.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <ChartCard title="Alimentos más corregidos" subtitle="Corrección de nombre, de peso y alimentos quitados por separado: son problemas distintos.">
          {ranking.length === 0 ? (
            <Vacio>No hay detecciones evaluadas en este período.</Vacio>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <th className="py-2 pr-3">Alimento</th>
                    <th className="py-2 pr-3">Detecciones</th>
                    <th className="py-2 pr-3">% corrección nombre</th>
                    <th className="py-2 pr-3">% corrección peso</th>
                    <th className="py-2">% quitado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ranking.slice(0, MAX_FILAS_RANKING).map((f) => (
                    <tr key={f.alimento_norm}>
                      <th scope="row" className="py-3 pr-3 font-semibold text-slate-900">{f.alimento}</th>
                      <td className="py-3 pr-3 text-slate-700">{f.detecciones}</td>
                      <td className="py-3 pr-3"><Barra valor={f.tasaNombre} color="bg-violet-600" etiqueta={`${f.alimento}, corrección de nombre`} /></td>
                      <td className="py-3 pr-3"><Barra valor={f.tasaPeso} color="bg-blue-600" etiqueta={`${f.alimento}, corrección de peso`} /></td>
                      <td className="py-3"><Barra valor={f.tasaQuitado} color="bg-red-500" etiqueta={`${f.alimento}, quitado`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ranking.length > MAX_FILAS_RANKING && (
                <p className="mt-2 text-xs text-slate-600">Mostrando los {MAX_FILAS_RANKING} más corregidos de {ranking.length} alimentos.</p>
              )}
            </div>
          )}
        </ChartCard>

        <ChartCard title="Confianza vs. corrección" subtitle="El cuadrante rojo es el que más importa: el modelo estaba seguro y se equivocó igual.">
          {puntos.length === 0 ? (
            <Vacio>Sin datos para graficar.</Vacio>
          ) : (
            <>
              <div className="h-72 w-full" role="img" aria-label="Dispersión de confianza promedio contra tasa de corrección por alimento">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={288}>
                  <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                    <XAxis type="number" dataKey="tasaCorreccion" name="Tasa de corrección" domain={[0, 1]} tickFormatter={pct} tick={{ fontSize: 12, fill: '#64748b' }} label={{ value: 'Tasa de corrección →', position: 'insideBottom', offset: -8, fontSize: 12, fill: '#64748b' }} />
                    <YAxis type="number" dataKey="confianzaPromedio" name="Confianza promedio" domain={[0, 1]} tickFormatter={pct} tick={{ fontSize: 12, fill: '#64748b' }} label={{ value: 'Confianza promedio →', angle: -90, position: 'insideLeft', fontSize: 12, fill: '#64748b' }} />
                    <ReferenceArea x1={UMBRAL_TASA_CORRECCION_ALTA} x2={1} y1={UMBRAL_CONFIANZA_ALTA} y2={1} fill="#fee2e2" fillOpacity={0.7} label={{ value: 'CONFIADO Y EQUIVOCADO', position: 'insideTopRight', fontSize: 11, fontWeight: 700, fill: '#b91c1c' }} />
                    <ReferenceLine x={UMBRAL_TASA_CORRECCION_ALTA} stroke="#cbd5e1" strokeDasharray="4 4" />
                    <ReferenceLine y={UMBRAL_CONFIANZA_ALTA} stroke="#cbd5e1" strokeDasharray="4 4" />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v) => pct(Number(v))} labelFormatter={() => ''} />
                    <Scatter data={puntos} isAnimationActive={false}>
                      {puntos.map((p) => (
                        <Cell key={p.alimento_norm} fill={COLOR_CUADRANTE[p.cuadrante]} />
                      ))}
                      <LabelList dataKey="alimento" position="top" fontSize={11} />
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 text-sm">
                <h3 className="font-semibold text-red-800">Confiado y equivocado ({confiadosEquivocados.length})</h3>
                {confiadosEquivocados.length === 0 ? (
                  <p className="text-slate-600">Ningún alimento cae en este cuadrante.</p>
                ) : (
                  <ul className="mt-1 space-y-0.5 text-slate-700">
                    {confiadosEquivocados.map((p) => (
                      <li key={p.alimento_norm}>
                        <span className="font-medium">{p.alimento}</span> — confianza {pct(p.confianzaPromedio)}, corregido {pct(p.tasaCorreccion)} ({p.detecciones} detecciones)
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <ChartCard
          title="Evolución por versión de prompt"
          subtitle={`Error promedio de peso${params.alimento ? ' del alimento elegido' : ''}, comparado entre versiones del prompt${params.prompt !== 'todas' ? ' (ignora el filtro de versión)' : ''}.`}
        >
          <div className="mb-3 max-w-xs">
            <label htmlFor="alimento-evolucion" className="mb-1 block text-xs font-medium text-slate-600">
              {`Alimento (con ${MIN_DETECCIONES_EVOLUCION}+ detecciones)`}
            </label>
            <select
              id="alimento-evolucion"
              value={params.alimento}
              onChange={(e) => onChange('alimento', e.target.value)}
              className={CONTROL_CLASS}
            >
              <option value="">Todos</option>
              {alimentosEvolucion.map((a) => (
                <option key={a.alimento_norm} value={a.alimento_norm}>{`${a.alimento} (${a.detecciones})`}</option>
              ))}
            </select>
          </div>
          {evolucion.length === 0 || sinDatosDePeso ? (
            <Vacio>Todavía no hay datos de peso para comparar versiones.</Vacio>
          ) : (
            <>
              <div className="h-56 w-full" role="img" aria-label="Error promedio de peso por versión de prompt">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={224}>
                  <BarChart data={datosEvolucion} margin={{ top: 20, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f6" />
                    <XAxis dataKey="version" tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} unit="%" />
                    <Tooltip formatter={(v) => `${v}%`} />
                    <Bar dataKey="error" maxBarSize={72} radius={[6, 6, 0, 0]} isAnimationActive={false}>
                      {datosEvolucion.map((d, i) => (
                        <Cell key={d.version} fill={i === datosEvolucion.length - 1 && datosEvolucion.length > 1 ? '#10b981' : '#cbd5e1'} />
                      ))}
                      <LabelList dataKey="error" position="top" fontSize={12} formatter={(v) => `${v}%`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {resumen ? (
                <p className={`mt-2 text-sm font-semibold ${resumen.puntos < 0 ? 'text-emerald-800' : resumen.puntos > 0 ? 'text-red-700' : 'text-slate-700'}`}>
                  {resumen.puntos < 0 ? '↓' : resumen.puntos > 0 ? '↑' : '='} {Math.abs(resumen.puntos)} puntos de error entre {resumen.desde} y {resumen.hasta}
                </p>
              ) : (
                <p className="mt-2 text-sm text-slate-600">Todavía hay una sola versión de prompt con datos: la comparación aparece cuando haya otra.</p>
              )}
            </>
          )}
        </ChartCard>

        <ChartCard title="Alimentos no detectados" subtitle="Agregados a mano porque Gemini no los vio — mide detección, no estimación.">
          {noDetectados.length === 0 ? (
            <Vacio>Ningún alimento agregado a mano en este período.</Vacio>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {noDetectados.slice(0, MAX_NO_DETECTADOS).map((f) => (
                <li key={f.alimento_norm} className="flex items-center justify-between py-2.5">
                  <span className="font-semibold text-slate-900">{f.alimento}</span>
                  <span className="text-slate-600">{f.veces} {f.veces === 1 ? 'vez' : 'veces'}</span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      </div>

      <p className="text-xs text-slate-600">{totalItems} detecciones evaluadas en el período filtrado.</p>
    </div>
  );
}
