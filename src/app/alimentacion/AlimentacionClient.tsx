'use client';

import { useRef, useState } from 'react';
import { todayAR, daysAgoAR } from '@/lib/date';

function formatFechaTitle(fecha: string): string {
  if (fecha === todayAR()) return 'Hoy';
  const [year, month, day] = fecha.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const formatted = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}
import { addItemAction, addManualItemAction, deleteItemAction, updateItemAction } from './actions';
import { type IngestaTipo } from '@/lib/nutrition';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import AIRecognitionModal from './AIRecognitionModal';

type AlimentoOption = {
  id_alimento: number;
  nombre: string;
  categoria: string | null;
};

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
  kcal_total: number | string;
  proteinas_total_g: number | string;
  grasas_total_g: number | string;
  carbs_total_g: number | string;
  items: ItemRow[] | null;
} | null;

function toNum(v: number | string | null | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v) || 0;
  return 0;
}

function getAlimentoNombre(item: ItemRow): string {
  if (item.id_alimento == null) return item.nombre_manual ?? 'Alimento sin nombre';
  if (Array.isArray(item.alimentos)) return item.alimentos[0]?.nombre ?? `Alimento #${item.id_alimento}`;
  return (item.alimentos as { nombre: string } | null)?.nombre ?? `Alimento #${item.id_alimento}`;
}

const MEAL_LABEL: Record<IngestaTipo, string> = {
  desayuno: 'Desayuno',
  almuerzo: 'Almuerzo',
  merienda: 'Merienda',
  cena: 'Cena',
  colacion: 'Colaciones',
  suplemento: 'Suplementos',
};

const MEAL_COLOR: Record<IngestaTipo, string> = {
  desayuno: '#f97316',
  almuerzo: '#16a34a',
  merienda: '#d97706',
  cena: '#4f46e5',
  colacion: '#db2777',
  suplemento: '#7c3aed',
};

const MAX_CANTIDAD = 2000;

export default function AlimentacionClient({
  alimentos,
  ingesta,
  tipoIngesta,
  fecha,
  hideNutrition,
}: {
  alimentos: AlimentoOption[];
  ingesta: IngestaRow;
  tipoIngesta: IngestaTipo;
  fecha: string;
  hideNutrition: boolean;
}) {
  const [query, setQuery] = useState('');
  const [selectedAlimento, setSelectedAlimento] = useState<AlimentoOption | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingCantidad, setEditingCantidad] = useState('');
  const [showManualModal, setShowManualModal] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const accentColor = MEAL_COLOR[tipoIngesta];
  const label = MEAL_LABEL[tipoIngesta];
  const items = ingesta?.items ?? [];
  const canEdit = fecha >= daysAgoAR(7) && fecha <= todayAR();

  // For "suplemento" only show supplement-category foods; for everything else exclude them
  const alimentosFiltrados =
    tipoIngesta === 'suplemento'
      ? alimentos.filter((a) => a.categoria?.toLowerCase().includes('suplemento'))
      : alimentos.filter((a) => !a.categoria?.toLowerCase().includes('suplemento'));

  const filtered =
    query.length >= 2
      ? alimentosFiltrados.filter((a) => a.nombre.toLowerCase().includes(query.toLowerCase())).slice(0, 80)
      : [];

  const handleSelectAlimento = (a: AlimentoOption) => {
    setSelectedAlimento(a);
    setQuery(a.nombre);
    setShowDropdown(false);
  };

  const handleCancelSelection = () => {
    setSelectedAlimento(null);
    setQuery('');
    setShowDropdown(false);
  };

  const handleOpenManualModal = () => {
    setShowDropdown(false);
    setShowManualModal(true);
  };

  const handleCloseManualModal = () => {
    setShowManualModal(false);
    setQuery('');
  };

  const handleStartEdit = (item: ItemRow) => {
    setEditingItemId(item.id_item);
    setEditingCantidad(toNum(item.cantidad).toFixed(0));
  };

  const handleCancelEdit = () => {
    setEditingItemId(null);
    setEditingCantidad('');
  };

  return (
    <div className="space-y-4 w-full">
      {!canEdit && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Solo podés cargar o editar comidas de hoy hasta 7 días atrás. Esta fecha es de solo lectura.
        </div>
      )}

      {/* Search + AI recognition button */}
      {canEdit && (
      <div className="flex items-start gap-2">
        <div className="relative flex-1">
          <div className="relative">
            <svg
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400"
              width="18" height="18"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedAlimento(null);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder={
                tipoIngesta === 'suplemento'
                  ? 'Buscar suplemento: proteína, creatina...'
                  : 'Buscar en SARA2: arroz, pollo, banana...'
              }
              className="w-full pl-10 pr-4 py-3.5 rounded-2xl border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 transition-all"
              style={{ ['--tw-ring-color' as string]: `${accentColor}40` }}
            />
          </div>

          {/* Dropdown results */}
          {showDropdown && filtered.length > 0 && !selectedAlimento && (
            <div className="absolute top-full left-0 right-0 bg-white rounded-2xl shadow-lg border border-gray-100 z-20 mt-1 overflow-hidden max-h-64 overflow-y-auto">
              {filtered.map((a) => (
                <button
                  key={a.id_alimento}
                  onMouseDown={() => handleSelectAlimento(a)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 text-sm flex items-center justify-between border-b border-gray-50 last:border-0 transition-colors"
                >
                  <span className="font-medium text-gray-900">{a.nombre}</span>
                  {a.categoria && (
                    <span className="text-xs text-gray-400 ml-2 flex-shrink-0">{a.categoria}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Empty state: no matches found */}
          {showDropdown && query.length >= 2 && filtered.length === 0 && !selectedAlimento && (
            <div className="absolute top-full left-0 right-0 bg-white rounded-2xl shadow-lg border border-gray-100 z-20 mt-1 p-4 text-center">
              <p className="text-sm text-gray-500">No encontramos &quot;{query}&quot; en el catálogo.</p>
              <button
                type="button"
                onMouseDown={handleOpenManualModal}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
                style={{ color: accentColor }}
              >
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Cargar alimento manualmente
              </button>
            </div>
          )}
        </div>

        {/* AI recognition button */}
        <button
          type="button"
          onClick={() => setShowAIModal(true)}
          className="flex-shrink-0 flex items-center gap-1.5 rounded-2xl px-4 py-3.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03] active:scale-[0.98]"
          style={{
            backgroundImage: 'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)',
            boxShadow: '0 8px 20px rgba(168,85,247,0.35)',
          }}
        >
          <span aria-hidden="true">✨</span>
          <span className="hidden sm:inline">Reconocimiento por IA</span>
        </button>
      </div>
      )}

      {/* Manual food entry modal */}
      <Modal open={showManualModal} onClose={handleCloseManualModal} title="Cargar alimento manualmente">
        <form
          action={addManualItemAction}
          className="space-y-4"
          onSubmit={() => setShowManualModal(false)}
        >
          <input type="hidden" name="fecha" value={fecha} />
          <input type="hidden" name="tipo_ingesta" value={tipoIngesta} />
          <input type="hidden" name="tipo_item" value="solido" />
          <Input
            label="Nombre del alimento"
            name="nombre_manual"
            defaultValue={query}
            placeholder="Ej: Tarta casera de verduras"
            maxLength={120}
            required
            autoFocus
          />
          <div>
            <label className="text-sm font-medium text-gray-700">Cantidad</label>
            <div className="mt-1 flex gap-2 items-center">
              <input
                type="number"
                name="cantidad"
                placeholder="Cantidad en gramos"
                min="1"
                max={MAX_CANTIDAD}
                step="any"
                required
                className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 transition-all"
                style={{ ['--tw-ring-color' as string]: `${accentColor}40` }}
              />
              <span className="text-sm text-gray-500 font-medium pr-1">g</span>
            </div>
          </div>
          <p className="text-xs text-gray-400">
            Este alimento no está en el catálogo SARA2, así que no se contabilizan sus calorías ni macros.
          </p>
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: accentColor }}
            >
              Agregar a {label}
            </button>
            <button
              type="button"
              onClick={handleCloseManualModal}
              className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </form>
      </Modal>

      {/* AI recognition modal (mockup) */}
      <AIRecognitionModal
        open={showAIModal}
        onClose={() => setShowAIModal(false)}
        onSelectOtro={() => {
          // "Otro" (NUT-160): sin foto calibrada — cerrar el modal y llevar al
          // buscador de alimentos que ya está en la página.
          setShowAIModal(false);
          setTimeout(() => searchInputRef.current?.focus(), 0);
        }}
      />

      {/* Add form (shown when food is selected) */}
      {canEdit && selectedAlimento && (
        <form
          action={addItemAction}
          className="rounded-2xl border p-4 space-y-3"
          style={{ borderColor: `${accentColor}30`, backgroundColor: `${accentColor}08` }}
        >
          <input type="hidden" name="fecha" value={fecha} />
          <input type="hidden" name="tipo_ingesta" value={tipoIngesta} />
          <input type="hidden" name="id_alimento" value={selectedAlimento.id_alimento} />
          <input type="hidden" name="tipo_item" value="solido" />

          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-gray-900">{selectedAlimento.nombre}</p>
              {selectedAlimento.categoria && (
                <p className="text-xs text-gray-400 mt-0.5">{selectedAlimento.categoria}</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleCancelSelection}
              className="text-gray-400 hover:text-gray-600 flex-shrink-0"
            >
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex gap-2 items-center">
            <input
              type="number"
              name="cantidad"
              placeholder="Cantidad en gramos"
              min="1"
              max={MAX_CANTIDAD}
              step="any"
              required
              className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 transition-all"
              style={{ ['--tw-ring-color' as string]: `${accentColor}40` }}
            />
            <span className="text-sm text-gray-500 font-medium pr-1">g</span>
          </div>

          <button
            type="submit"
            className="w-full rounded-xl py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: accentColor }}
          >
            Agregar a {label}
          </button>
        </form>
      )}

      {/* Items list + empty state */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">
            {formatFechaTitle(fecha)} en {label}
          </h3>
          <span className="text-sm text-gray-400">{items.length} ítems</span>
        </div>

        {items.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-gray-200 py-12 flex flex-col items-center text-center">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mb-4 opacity-30"
              style={{ backgroundColor: `${accentColor}20` }}
            >
              <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke={accentColor} strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-500">Aún no cargaste nada en {label.toLowerCase()}</p>
            <p className="text-xs text-gray-400 mt-1">Buscá un alimento arriba para empezar</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id_item} className="bg-white rounded-2xl border border-gray-100 p-4">
                {canEdit && editingItemId === item.id_item ? (
                  /* Inline edit form */
                  <form action={updateItemAction} className="space-y-2">
                    <input type="hidden" name="fecha" value={fecha} />
                    <input type="hidden" name="tipo_ingesta" value={tipoIngesta} />
                    <input type="hidden" name="id_item" value={item.id_item} />
                    <p className="text-sm font-semibold text-gray-900">{getAlimentoNombre(item)}</p>
                    <div className="flex gap-2 items-center">
                      <input
                        type="number"
                        name="cantidad"
                        value={editingCantidad}
                        onChange={(e) => setEditingCantidad(e.target.value)}
                        min="1"
                        max={MAX_CANTIDAD}
                        step="any"
                        required
                        autoFocus
                        className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 transition-all"
                        style={{ ['--tw-ring-color' as string]: `${accentColor}40` }}
                      />
                      <span className="text-sm text-gray-500 font-medium">g</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        className="flex-1 rounded-xl py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                        style={{ backgroundColor: accentColor }}
                      >
                        Guardar
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="flex-1 rounded-xl py-2 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                ) : (
                  /* Normal item display */
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{getAlimentoNombre(item)}</p>
                      {!hideNutrition && (
                        <>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {toNum(item.cantidad).toFixed(0)} g
                          </p>
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className="text-xs font-semibold text-gray-700">{toNum(item.kcal).toFixed(0)} kcal</span>
                            <span className="text-xs text-gray-400">P {toNum(item.proteinas_g).toFixed(1)}g</span>
                            <span className="text-xs text-gray-400">C {toNum(item.carbs_g).toFixed(1)}g</span>
                            <span className="text-xs text-gray-400">G {toNum(item.grasas_g).toFixed(1)}g</span>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {/* Edit button */}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleStartEdit(item)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                        >
                          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                          </svg>
                        </button>
                      )}
                      {/* Delete button */}
                      <form action={deleteItemAction} className="flex-shrink-0">
                        <input type="hidden" name="fecha" value={fecha} />
                        <input type="hidden" name="tipo_ingesta" value={tipoIngesta} />
                        <input type="hidden" name="id_item" value={item.id_item} />
                        <button
                          type="submit"
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                          </svg>
                        </button>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Meal totals */}
            {!hideNutrition && (
              <div
                className="rounded-2xl p-4 mt-2"
                style={{ backgroundColor: `${accentColor}10` }}
              >
                <p className="text-xs font-semibold text-gray-600 mb-1">Total {label}</p>
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-sm font-bold text-gray-900">{toNum(ingesta?.kcal_total).toFixed(0)} kcal</span>
                  <span className="text-xs text-gray-500">P {toNum(ingesta?.proteinas_total_g).toFixed(1)}g</span>
                  <span className="text-xs text-gray-500">C {toNum(ingesta?.carbs_total_g).toFixed(1)}g</span>
                  <span className="text-xs text-gray-500">G {toNum(ingesta?.grasas_total_g).toFixed(1)}g</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
