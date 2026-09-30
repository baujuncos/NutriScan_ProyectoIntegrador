'use client';

import { useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import type { BoundingBox } from '@/lib/deteccion';
import type { NutritionProvider } from '@/lib/nutritionMock';
import { searchAlimentosAction, type AlimentoOption } from './actions';

const ACCENT = '#a855f7';
const MAX_RESULTADOS = 6;

/** Recorte del `boundingBox` sobre la foto completa, vía CSS puro (sin canvas). */
function BoundingBoxThumbnail({
  photoUrl,
  boundingBox,
  size = 56,
}: {
  photoUrl: string | null;
  boundingBox: BoundingBox | null;
  size?: number;
}) {
  if (!photoUrl) return null;

  if (!boundingBox || boundingBox.width <= 0 || boundingBox.height <= 0) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={photoUrl}
        alt=""
        aria-hidden="true"
        className="flex-shrink-0 rounded-xl object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="flex-shrink-0 overflow-hidden rounded-xl bg-gray-100"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photoUrl}
        alt=""
        style={{
          position: 'relative',
          width: `${100 / boundingBox.width}%`,
          height: `${100 / boundingBox.height}%`,
          left: `-${(boundingBox.x / boundingBox.width) * 100}%`,
          top: `-${(boundingBox.y / boundingBox.height) * 100}%`,
          maxWidth: 'none',
        }}
      />
    </div>
  );
}

export interface ChangeFoodTarget {
  name: string;
  grams: number;
  boundingBox: BoundingBox | null;
  dudaOptions: string[];
}

/**
 * NUT-171 — Hoja "Cambiar alimento": reutiliza el buscador manual existente
 * (`searchAlimentosAction`) para elegir un alimento, pero los valores
 * nutricionales que se muestran salen del `NutritionProvider` mock, no de la
 * base (ver `src/lib/nutritionMock.ts`).
 */
export default function ChangeFoodSheet({
  mode,
  target,
  photoUrl,
  mealType,
  provider,
  onConfirm,
}: {
  mode: 'replace' | 'add';
  /** Sólo en modo "replace": el ítem que se está reemplazando. */
  target?: ChangeFoodTarget;
  photoUrl: string | null;
  mealType: string;
  provider: NutritionProvider;
  onConfirm: (alimento: { nombre: string; categoria: string }) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AlimentoOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AlimentoOption | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      const data = await searchAlimentosAction(query, mealType);
      setResults(data);
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, mealType]);

  const handleChip = (opcion: string) => {
    setQuery(opcion);
    setSelected(null);
  };

  const handleConfirm = () => {
    if (!selected) return;
    onConfirm({ nombre: selected.nombre, categoria: selected.categoria ?? 'Sin categoría' });
  };

  const elegido = mode === 'replace' ? 'Reemplaza' : 'Agrega';

  return (
    <div className="space-y-4">
      {mode === 'replace' && target && (
        <div className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-3">
          <BoundingBoxThumbnail photoUrl={photoUrl} boundingBox={target.boundingBox} />
          <div>
            <p className="text-xs font-medium text-gray-400">{elegido}</p>
            <p className="text-sm font-semibold text-gray-900">
              {target.name} · {Math.round(target.grams)} g
            </p>
          </div>
        </div>
      )}

      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="m20 20-3.5-3.5" />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          placeholder="Buscar alimento..."
          aria-label="Buscar alimento"
          className="w-full rounded-2xl border border-gray-200 bg-white py-2.5 pl-9 pr-9 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2"
          style={{ ['--tw-ring-color' as string]: `${ACCENT}40` }}
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setSelected(null);
            }}
            aria-label="Limpiar búsqueda"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        )}
      </div>

      {mode === 'replace' && target && target.dudaOptions.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-gray-500">La IA dudó entre</p>
          <div className="flex flex-wrap gap-1.5">
            {target.dudaOptions.map((opcion) => (
              <button
                key={opcion}
                type="button"
                onClick={() => handleChip(opcion)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:border-gray-300"
              >
                {opcion}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-semibold text-gray-500">Resultados</p>
        {loading && <p className="py-2 text-sm text-gray-400">Buscando...</p>}
        {!loading && query.trim().length >= 2 && results.length === 0 && (
          <p className="py-2 text-sm text-gray-400">No encontramos &quot;{query}&quot; en el catálogo.</p>
        )}
        <ul className="space-y-1.5">
          {results.slice(0, MAX_RESULTADOS).map((alimento) => {
            const nutricion = provider.per100g(alimento.nombre);
            const isSelected = selected?.id_alimento === alimento.id_alimento;
            return (
              <li key={alimento.id_alimento}>
                <button
                  type="button"
                  onClick={() => setSelected(alimento)}
                  aria-pressed={isSelected}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    isSelected ? 'border-transparent' : 'border-gray-100 hover:border-gray-200'
                  }`}
                  style={
                    isSelected ? { backgroundColor: `${ACCENT}14`, boxShadow: `0 0 0 2px ${ACCENT}` } : undefined
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-gray-900">{alimento.nombre}</span>
                    <span className="text-sm font-semibold text-gray-700">{Math.round(nutricion.kcal)} kcal</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-400">{alimento.categoria ?? 'Sin categoría'} · por 100 g</span>
                    <span className="text-xs text-gray-400">
                      P {nutricion.protein.toFixed(0)} · C {nutricion.carbs.toFixed(0)} · G{' '}
                      {nutricion.fat.toFixed(0)}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {mode === 'replace' && target && (
        <p className="text-xs text-gray-400">
          Mantenemos los {Math.round(target.grams)} g estimados. Los podés ajustar al volver.
        </p>
      )}

      <Button type="button" variant="primary" className="w-full" disabled={!selected} onClick={handleConfirm}>
        {selected ? `Usar ${selected.nombre}` : mode === 'replace' ? 'Usar alimento' : 'Agregar alimento'}
      </Button>
    </div>
  );
}
