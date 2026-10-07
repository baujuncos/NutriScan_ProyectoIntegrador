'use client';

import { useEffect, useState } from 'react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from 'recharts';
import Avatar from './Avatar';
import type { AthleteDetail, IngestaDetail } from '@/app/(researcher)/deportistas/actions';
import { getAthleteDetailAction } from '@/app/(researcher)/deportistas/actions';
import type { AthleteRow } from './AthletesTable';

interface Props {
  athlete: AthleteRow | null;
  onClose: () => void;
}

const MEAL_LABELS: Record<string, string> = {
  desayuno: 'Desayuno',
  almuerzo: 'Almuerzo',
  merienda: 'Merienda',
  cena: 'Cena',
  colacion: 'Colaciones',
  suplemento: 'Suplementos',
};

const MEAL_EMOJI: Record<string, string> = {
  desayuno: '☀️',
  almuerzo: '🍽️',
  merienda: '🍪',
  cena: '🌙',
  colacion: '🍎',
  suplemento: '💊',
};

const MEAL_COLOR: Record<string, string> = {
  desayuno: 'bg-orange-50 text-orange-700 border-orange-100',
  almuerzo: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  merienda: 'bg-amber-50 text-amber-700 border-amber-100',
  cena: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  colacion: 'bg-pink-50 text-pink-700 border-pink-100',
  suplemento: 'bg-violet-50 text-violet-700 border-violet-100',
};

function calcEdad(fechaNacimiento: string | null): number | null {
  if (!fechaNacimiento) return null;
  const dob = new Date(fechaNacimiento);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

function InfoCard({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-800">{value ?? '—'}</p>
    </div>
  );
}

function DateLabel({ fecha, todayStr, yesterdayStr }: { fecha: string; todayStr: string; yesterdayStr: string }) {
  if (fecha === todayStr) return <span className="text-xs font-semibold text-blue-600">Hoy</span>;
  if (fecha === yesterdayStr) return <span className="text-xs font-semibold text-slate-600">Ayer</span>;
  return <span className="text-xs text-slate-600">{fecha}</span>;
}

/** 1 decimal como máximo, con coma (es-AR): 0,5 / 42 / 7,2 */
const num = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 });

function IngestaCard({ ingesta, todayStr, yesterdayStr }: { ingesta: IngestaDetail; todayStr: string; yesterdayStr: string }) {
  const colorClass = MEAL_COLOR[ingesta.tipo] ?? 'bg-slate-50 text-slate-700 border-slate-100';
  return (
    <div className={`rounded-xl border p-3 ${colorClass}`}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-base">{MEAL_EMOJI[ingesta.tipo] ?? '🍴'}</span>
          <span className="text-sm font-semibold">{MEAL_LABELS[ingesta.tipo] ?? ingesta.tipo}</span>
          <DateLabel fecha={ingesta.fecha} todayStr={todayStr} yesterdayStr={yesterdayStr} />
        </div>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-bold">
          {Math.round(ingesta.kcal_total)} kcal
        </span>
      </div>
      {ingesta.items.length > 0 ? (
        <ul className="space-y-0.5">
          {ingesta.items.map((it, i) => (
            <li key={i} className="text-xs">
              <div className="flex items-center justify-between">
                <span className="truncate">{it.nombre}</span>
                <span className="ml-2 flex shrink-0 items-center gap-1.5">
                  <span
                    title="Fuente del dato nutricional"
                    className={`rounded-full px-1.5 py-px text-[11px] font-semibold ${
                      it.fuente.startsWith('IA') ? 'bg-amber-100 text-amber-800' : 'bg-white/70 text-slate-700'
                    }`}
                  >
                    {it.fuente}
                  </span>
                  <span className="font-medium">{it.cantidad} g</span>
                </span>
              </div>
              <p className="mb-1 text-xs">
                {it.macros
                  ? `${num(it.macros.kcal)} kcal · P ${num(it.macros.proteinas)} g · C ${num(it.macros.carbs)} g · G ${num(it.macros.grasas)} g`
                  : 'Sin datos nutricionales'}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs opacity-80">Sin alimentos registrados</p>
      )}
    </div>
  );
}

export default function AthleteDetailModal({ athlete, onClose }: Props) {
  const [detail, setDetail] = useState<AthleteDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tz = 'America/Argentina/Buenos_Aires';
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone: tz });

  useEffect(() => {
    if (!athlete) {
      setDetail(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setDetail(null);
    getAthleteDetailAction(athlete.user_id).then((res) => {
      if ('error' in res) {
        setError(res.error);
      } else {
        setDetail(res);
      }
      setLoading(false);
    });
  }, [athlete]);

  useEffect(() => {
    if (!athlete) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [athlete, onClose]);

  if (!athlete) return null;

  const phys = detail?.physical ?? null;
  const acad = detail?.academic ?? null;
  const edad = calcEdad(phys?.fecha_nacimiento ?? null);

  // Group ingestas by date for display
  const ingestasByDate = new Map<string, IngestaDetail[]>();
  for (const ing of detail?.recentIngestas ?? []) {
    if (!ingestasByDate.has(ing.fecha)) ingestasByDate.set(ing.fecha, []);
    ingestasByDate.get(ing.fecha)!.push(ing);
  }
  const dateGroups = [todayStr, yesterdayStr].filter((d) => ingestasByDate.has(d));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="my-auto w-full max-w-3xl rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center gap-4 border-b border-slate-100 p-6">
          <Avatar nombre={athlete.nombre} apellido={athlete.apellido} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-slate-900">
              {athlete.nombre} {athlete.apellido}
            </h2>
            <p className="truncate text-sm text-slate-600">{athlete.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="space-y-6 p-6">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <svg className="h-8 w-8 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
          )}

          {detail && (
            <>
              {/* Profile info grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <InfoCard label="Carrera" value={acad?.carrera ?? null} />
                <InfoCard
                  label="Deporte / Posición"
                  value={
                    acad?.deporte && acad?.posicion
                      ? `${acad.deporte.charAt(0).toUpperCase() + acad.deporte.slice(1)} · ${acad.posicion}`
                      : acad?.deporte
                        ? acad.deporte.charAt(0).toUpperCase() + acad.deporte.slice(1)
                        : null
                  }
                />
                <InfoCard label="Año ingreso" value={acad?.anio ?? null} />
                <InfoCard
                  label="Edad / Género"
                  value={
                    edad !== null && phys?.sexo
                      ? `${edad} · ${phys.sexo === 'F' ? 'Femenino' : 'Masculino'}`
                      : edad !== null
                        ? String(edad)
                        : null
                  }
                />
                <InfoCard
                  label="Frecuencia"
                  value={
                    acad?.frecuencia_practicas_semana
                      ? `${acad.frecuencia_practicas_semana}x semana`
                      : null
                  }
                />
                <InfoCard
                  label="Unidad de análisis"
                  value={
                    detail.psychScore !== null
                      ? detail.psychScore.toFixed(1)
                      : null
                  }
                />
              </div>

              {/* Charts row */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Radar chart */}
                <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                  <h3 className="mb-3 text-sm font-semibold text-slate-700">Valoración psicológica</h3>
                  {detail.psychDimensions.every((d) => d.value === 0) ? (
                    <div className="flex h-40 items-center justify-center text-xs text-slate-600">
                      Sin encuesta completada
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <RadarChart data={detail.psychDimensions}>
                        <PolarGrid stroke="#e2e8f0" />
                        <PolarAngleAxis
                          dataKey="dimension"
                          tick={{ fontSize: 10, fill: '#64748b' }}
                        />
                        <Radar
                          dataKey="value"
                          stroke="#2563eb"
                          fill="#2563eb"
                          fillOpacity={0.25}
                          strokeWidth={2}
                        />
                      </RadarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Bar chart */}
                <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                  <h3 className="mb-3 text-sm font-semibold text-slate-700">Comidas registradas (semana)</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={detail.weeklyMeals} barSize={24}>
                      <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={20} />
                      <Tooltip
                        cursor={{ fill: '#f1f5f9' }}
                        contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                        formatter={(v) => [`${v ?? 0} comidas`, '']}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {detail.weeklyMeals.map((entry, i) => (
                          <Cell
                            key={i}
                            fill={entry.count > 0 ? '#22c55e' : '#e2e8f0'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Recent meal history */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-slate-700">Histórico reciente</h3>
                {dateGroups.length === 0 ? (
                  <div className="rounded-xl border-2 border-dashed border-slate-100 py-8 text-center text-sm text-slate-600">
                    Sin comidas registradas hoy o ayer
                  </div>
                ) : (
                  <div className="space-y-4">
                    {dateGroups.map((fecha) => (
                      <div key={fecha}>
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                            {fecha === todayStr ? 'Hoy' : 'Ayer'}
                          </span>
                          <span className="text-xs text-slate-500">·</span>
                          <span className="text-xs text-slate-600">{fecha.split('-').reverse().join('-')}</span>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {(ingestasByDate.get(fecha) ?? []).map((ing) => (
                            <IngestaCard
                              key={ing.id_ingesta}
                              ingesta={ing}
                              todayStr={todayStr}
                              yesterdayStr={yesterdayStr}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
