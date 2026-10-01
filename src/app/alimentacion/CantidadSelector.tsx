'use client';

import { useState } from 'react';

const CANTIDADES_RAPIDAS = [25, 50, 100, 150] as const;

export default function CantidadSelector({
  name,
  accentColor,
  maxCantidad,
  value,
  onChange,
  mostrarAvisoSinValores,
}: {
  name: string;
  accentColor: string;
  maxCantidad: number;
  value: string;
  onChange: (v: string) => void;
  mostrarAvisoSinValores: boolean;
}) {
  const [personalizar, setPersonalizar] = useState(false);

  const ajustar = (delta: number) => {
    const actual = Number(value) || 0;
    const siguiente = Math.min(maxCantidad, Math.max(1, actual + delta));
    onChange(String(siguiente));
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2">
        {CANTIDADES_RAPIDAS.map((g) => {
          const activo = value === String(g);
          return (
            <button
              key={g}
              type="button"
              onClick={() => onChange(String(g))}
              className={`rounded-xl border py-2 text-sm font-semibold transition-colors ${
                activo ? 'text-white border-transparent' : 'border-gray-200 text-gray-700 hover:border-gray-300'
              }`}
              style={activo ? { backgroundColor: accentColor } : undefined}
            >
              {g} g
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => ajustar(-1)}
          aria-label="Restar 1 gramo"
          className="w-9 h-9 flex-shrink-0 rounded-lg border border-gray-200 text-gray-600 font-bold hover:bg-gray-50"
        >
          −
        </button>
        <input type="hidden" name={name} value={value} />
        <div className="flex-1 text-center text-sm font-semibold text-gray-900">{value || 0} g</div>
        <button
          type="button"
          onClick={() => ajustar(1)}
          aria-label="Sumar 1 gramo"
          className="w-9 h-9 flex-shrink-0 rounded-lg border border-gray-200 text-gray-600 font-bold hover:bg-gray-50"
        >
          +
        </button>
      </div>

      {!personalizar ? (
        <button
          type="button"
          onClick={() => setPersonalizar(true)}
          className="w-full rounded-xl border border-gray-200 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
        >
          Personalizar
        </button>
      ) : (
        <div className="flex gap-2 items-center">
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            min="1"
            max={maxCantidad}
            step="any"
            autoFocus
            placeholder="Cantidad en gramos"
            className="flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 transition-all"
            style={{ ['--tw-ring-color' as string]: `${accentColor}40` }}
          />
          <span className="text-sm text-gray-500 font-medium pr-1">g</span>
        </div>
      )}

      {mostrarAvisoSinValores && (
        <p className="text-xs text-amber-600">
          Este alimento no tiene valores nutricionales cargados — vas a poder registrarlo igual, pero no va a sumar a tus calorías/macros.
        </p>
      )}
    </div>
  );
}
