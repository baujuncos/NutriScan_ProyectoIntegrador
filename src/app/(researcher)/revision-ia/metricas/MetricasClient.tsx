'use client';

/**
 * NUT-151 — Dashboard "Métricas de calidad". Cinco piezas: ranking de alimentos más
 * corregidos (nombre / peso / quitado por separado), confianza vs. corrección
 * (cuadrante rojo = "confiado y equivocado"), evolución por versión de prompt,
 * alimentos no detectados (aparte) y estado de la cola de NUT-149. Sólo lectura:
 * nada de acá modifica el modelo ni el prompt.
 */
import Link from 'next/link';
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
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import ChartCard from '@/components/researcher/ChartCard';
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
import type { MetricasParams } from '@/lib/metricasIaQuery';

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

const KPIS: Array<{ estado: keyof EstadoCola; etiqueta: string; clase: string }> = [
  { estado: 'pendiente', etiqueta: 'Pendientes', clase: 'bg-amber-50 text-amber-800' },
  { estado: 'confirmado', etiqueta: 'Confirmados', clase: 'bg-emerald-50 text-emerald-800' },
  { estado: 'corregido', etiqueta: 'Corregidos', clase: 'bg-blue-50 text-blue-800' },
];

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

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Métricas de calidad</h1>
          <p className="mt-1 max-w-xl text-sm text-slate-600">
            Patrones de corrección sobre las detecciones de Gemini, para decidir dónde priorizar ejemplos de prompt o factores de calibración.
          </p>
        </div>
        <nav aria-label="Estado de la cola de revisión" className="flex gap-2">
          {KPIS.map((k) => (
            <Link key={k.estado} href={`/revision-ia?estado=${k.estado}`} className={`min-w-[6.5rem] rounded-xl px-4 py-2.5 ${k.clase}`}>
              <span className="block text-xl font-bold leading-tight">{cola[k.estado]}</span>
              <span className="block text-xs font-medium">{k.etiqueta}</span>
            </Link>
          ))}
        </nav>
      </header>

      <div role="tablist" aria-label="Secciones" className="inline-flex gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
        <Link role="tab" aria-selected="false" href="/revision-ia" className="px-4 py-2 text-slate-600 hover:text-slate-900">
          Cola de revisión
        </Link>
        <span role="tab" aria-selected="true" className="rounded-lg bg-white px-4 py-2 text-slate-900 shadow-sm">
          Métricas
        </span>
      </div>

      <form
        role="search"
        method="get"
        action="/revision-ia/metricas"
        className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end"
      >
        <Input id="desde" name="desde" type="date" label="Desde" defaultValue={params.desde} />
        <Input id="hasta" name="hasta" type="date" label="Hasta" defaultValue={params.hasta} />
        <Select
          id="vajilla"
          name="vajilla"
          label="Vajilla"
          defaultValue={params.vajilla}
          options={[
            { value: 'todas', label: 'Todas' },
            { value: 'plato_playo', label: 'Plato playo' },
            { value: 'plato_postre', label: 'Plato postre' },
            { value: 'plato_hondo', label: 'Plato hondo' },
          ]}
        />
        <Select
          id="prompt"
          name="prompt"
          label="Versión de prompt"
          defaultValue={params.prompt}
          options={[{ value: 'todas', label: 'Todas' }, ...versiones.map((v) => ({ value: v, label: v }))]}
        />
        <Button type="submit">Filtrar</Button>
        {params.alimento && <input type="hidden" name="alimento" value={params.alimento} />}
      </form>

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
          <form method="get" action="/revision-ia/metricas" className="mb-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="desde" value={params.desde} />
            <input type="hidden" name="hasta" value={params.hasta} />
            <input type="hidden" name="vajilla" value={params.vajilla} />
            <input type="hidden" name="prompt" value={params.prompt} />
            <Select
              id="alimento"
              name="alimento"
              label={`Alimento (con ${MIN_DETECCIONES_EVOLUCION}+ detecciones)`}
              defaultValue={params.alimento}
              options={[{ value: '', label: 'Todos' }, ...alimentosEvolucion.map((a) => ({ value: a.alimento_norm, label: `${a.alimento} (${a.detecciones})` }))]}
            />
            <Button type="submit" variant="outline" size="sm">Ver</Button>
          </form>
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
