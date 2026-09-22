'use client';

import { useState } from 'react';
import { INGESTA_TIPOS, formatIngestaLabel, type IngestaTipo } from '@/lib/nutrition';
import AlimentacionClient from './AlimentacionClient';
import DatePicker from './DatePicker';

type ItemRow = {
  id_item: number;
  id_alimento: number | null;
  nombre_manual: string | null;
  tipo_item: string;
  cantidad: number | string;
  kcal: number | string;
  proteinas_g: number | string;
  grasas_g: number | string;
  carbs_g: number | string;
  alimentos: { nombre: string; categoria: string | null } | Array<{ nombre: string; categoria: string | null }> | null;
};

type IngestaRow = {
  id_ingesta: number;
  tipo: IngestaTipo;
  fecha: string;
  kcal_total: number | string;
  proteinas_total_g: number | string;
  grasas_total_g: number | string;
  carbs_total_g: number | string;
  items: ItemRow[] | null;
};

function toNum(v: number | string | null | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v) || 0;
  return 0;
}

const MEAL_GRADIENT: Record<IngestaTipo, string> = {
  desayuno: 'linear-gradient(135deg, #f97316 0%, #fb923c 100%)',
  almuerzo: 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)',
  merienda: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
  cena: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
  colacion: 'linear-gradient(135deg, #db2777 0%, #ec4899 100%)',
  suplemento: 'linear-gradient(135deg, #7c3aed 0%, #8b5cf6 100%)',
};

const MEAL_COLOR: Record<IngestaTipo, string> = {
  desayuno: '#f97316',
  almuerzo: '#16a34a',
  merienda: '#d97706',
  cena: '#4f46e5',
  colacion: '#db2777',
  suplemento: '#7c3aed',
};

function MealIcon({ tipo, size = 20 }: { tipo: IngestaTipo; size?: number }) {
  const sw = 1.8;
  if (tipo === 'desayuno') return (
    <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
    </svg>
  );
  if (tipo === 'almuerzo') return (
    <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
      <path d="M7 2v20" />
      <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3" />
      <path d="M21 15v7" />
    </svg>
  );
  if (tipo === 'merienda') return (
    <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5" />
      <path d="M8.5 8.5v.01" />
      <path d="M16 15.5v.01" />
      <path d="M12 12v.01" />
      <path d="M11 17v.01" />
      <path d="M7 14v.01" />
    </svg>
  );
  if (tipo === 'cena') return (
    <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
    </svg>
  );
  if (tipo === 'colacion') return (
    <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 13.94 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z" />
      <path d="M10 2c1 .5 2 2 2 5" />
    </svg>
  );
  return (
    <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
      <path d="m8.5 8.5 7 7" />
    </svg>
  );
}

export default function AlimentacionView({
  ingestas,
  fecha,
  initialTipo,
  hideNutrition,
}: {
  ingestas: IngestaRow[];
  fecha: string;
  initialTipo: IngestaTipo;
  hideNutrition: boolean;
}) {
  const [selectedTipo, setSelectedTipo] = useState<IngestaTipo>(initialTipo);

  const ingestaByTipo = new Map<IngestaTipo, IngestaRow>();
  ingestas.forEach((i) => ingestaByTipo.set(i.tipo, i));

  const totalKcal = ingestas.reduce((a, i) => a + toNum(i.kcal_total), 0);
  const selectedIngesta = ingestaByTipo.get(selectedTipo) ?? null;
  const selectedKcal = toNum(selectedIngesta?.kcal_total);
  const selectedItems = selectedIngesta?.items?.length ?? 0;

  const gradient = MEAL_GRADIENT[selectedTipo];
  const accentColor = MEAL_COLOR[selectedTipo];

  const handleSelectTipo = (tipo: IngestaTipo) => {
    setSelectedTipo(tipo);
    const url = new URL(window.location.href);
    url.searchParams.set('tipo', tipo);
    window.history.replaceState(null, '', url);
  };

  return (
    <>
      {/* Meal banner */}
      <div className="rounded-2xl text-white p-5" style={{ background: gradient }}>
        <p className="text-xs font-semibold uppercase tracking-widest text-white/70">Registro de comidas</p>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <MealIcon tipo={selectedTipo} size={28} />
              <span>{formatIngestaLabel(selectedTipo)}</span>
            </h2>
            <p className="text-sm text-white/70 mt-0.5">
              {selectedItems === 0
                ? 'Sin registros aún'
                : `${selectedItems} ítem${selectedItems !== 1 ? 's' : ''} cargado${selectedItems !== 1 ? 's' : ''}`}
            </p>
          </div>
          {!hideNutrition && (
            <div
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold"
              style={{ backgroundColor: 'rgba(255,255,255,0.25)' }}
            >
              🔥 {Math.round(selectedKcal)} kcal
            </div>
          )}
        </div>
        {!hideNutrition && totalKcal > 0 && (
          <p className="text-xs text-white/60 mt-2">Total del día: {Math.round(totalKcal)} kcal</p>
        )}
      </div>

      {/* Meal type tabs — client-side switch, no server navigation */}
      <div className="py-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {INGESTA_TIPOS.map((tipo) => {
            const isActive = tipo === selectedTipo;
            const hasItems = (ingestaByTipo.get(tipo)?.items?.length ?? 0) > 0;
            return (
              <button
                key={tipo}
                type="button"
                onClick={() => handleSelectTipo(tipo)}
                className={`w-full flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all border text-center ${
                  isActive
                    ? ''
                    : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
                style={isActive ? { backgroundColor: accentColor, borderColor: accentColor, color: 'white' } : undefined}
              >
                <span className="leading-none">
                  <MealIcon tipo={tipo} size={18} />
                </span>
                <span>{formatIngestaLabel(tipo)}</span>
                {hasItems && !isActive && (
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: MEAL_COLOR[tipo] }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Date picker */}
      <div className="pb-3">
        <DatePicker fecha={fecha} tipo={selectedTipo} />
      </div>

      <AlimentacionClient
        ingesta={selectedIngesta}
        tipoIngesta={selectedTipo}
        fecha={fecha}
        hideNutrition={hideNutrition}
      />
    </>
  );
}
