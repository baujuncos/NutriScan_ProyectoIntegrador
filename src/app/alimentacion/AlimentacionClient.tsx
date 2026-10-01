'use client';

import { useEffect, useRef, useState } from 'react';
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
import { addItemAction, addManualItemAction, deleteItemAction, updateItemAction, type AlimentoOption } from './actions';
import { type IngestaTipo } from '@/lib/nutrition';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import AIRecognitionModal from './AIRecognitionModal';
import ChatFoodModal from './ChatFoodModal';
import BarcodeScannerModal from './BarcodeScannerModal';
import BusquedaAlimento, { type BusquedaAlimentoHandle } from './BusquedaAlimento';
import CantidadSelector from './CantidadSelector';
import type { FoodChatResult } from '@/lib/chatFood';

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
  alimentos: AlimentoDetalle | AlimentoDetalle[] | null;
  id_alimento_barcode?: number | null;
  alimentos_barcode?: AlimentoBarcodeDetalle | AlimentoBarcodeDetalle[] | null;
};

type AlimentoDetalle = { nombre: string; categoria: string | null; marca?: string | null; denominacion?: string | null; fuente?: string };

type AlimentoBarcodeDetalle = {
  nombre: string;
  marca: string | null;
  categoria?: string | null;
  porcion?: number | string;
  kcal_100g?: number | string | null;
  proteinas_100g?: number | string | null;
  grasas_100g?: number | string | null;
  carbs_100g?: number | string | null;
  imagen_url?: string | null;
  nutriscore_grade?: string | null;
  nova_group?: number | null;
  is_gluten_free?: boolean;
  is_vegan?: boolean;
  is_vegetarian?: boolean;
  serving_quantity_label?: string | null;
};

/** El join de supabase puede devolver el relacionado como objeto o como array de 1 — normaliza a uno solo. */
function unoSolo<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

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
  if (item.id_alimento_barcode != null) {
    return unoSolo(item.alimentos_barcode)?.nombre ?? `Alimento #${item.id_alimento_barcode}`;
  }
  if (item.id_alimento == null) return item.nombre_manual ?? 'Alimento sin nombre';
  return unoSolo(item.alimentos)?.nombre ?? `Alimento #${item.id_alimento}`;
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
  ingesta,
  tipoIngesta,
  fecha,
  hideNutrition,
}: {
  ingesta: IngestaRow;
  tipoIngesta: IngestaTipo;
  fecha: string;
  hideNutrition: boolean;
}) {
  const [selectedAlimento, setSelectedAlimento] = useState<AlimentoOption | null>(null);
  const [manualQuery, setManualQuery] = useState('');
  const [cantidadValue, setCantidadValue] = useState('50');
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingCantidad, setEditingCantidad] = useState('');
  const [showManualModal, setShowManualModal] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [detalleItem, setDetalleItem] = useState<ItemRow | null>(null);
  const searchHandleRef = useRef<BusquedaAlimentoHandle>(null);

  const accentColor = MEAL_COLOR[tipoIngesta];
  const label = MEAL_LABEL[tipoIngesta];
  const items = ingesta?.items ?? [];
  const canEdit = fecha >= daysAgoAR(7) && fecha <= todayAR();

  useEffect(() => {
    setCantidadValue('50');
  }, [selectedAlimento?.id_alimento]);

  const handleCloseManualModal = () => {
    setShowManualModal(false);
    setManualQuery('');
    searchHandleRef.current?.clear();
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

      {/* Búsqueda de alimentos */}
      <BusquedaAlimento
        ref={searchHandleRef}
        tipoIngesta={tipoIngesta}
        accentColor={accentColor}
        canEdit={canEdit}
        selectedAlimento={selectedAlimento}
        onSelectAlimento={setSelectedAlimento}
        onClearSelection={() => setSelectedAlimento(null)}
        onOpenManual={(query) => { setManualQuery(query); setShowManualModal(true); }}
        onOpenAI={() => setShowAIModal(true)}
        onOpenChat={() => setShowChatModal(true)}
        onOpenBarcode={() => setShowBarcodeModal(true)}
      />

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
            defaultValue={manualQuery}
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
          setTimeout(() => searchHandleRef.current?.focus(), 0);
        }}
        mealType={tipoIngesta}
        mealLabel={MEAL_LABEL[tipoIngesta]}
      />

      {/* Chat food registration modal (NUT-187) */}
      <ChatFoodModal
        open={showChatModal}
        onClose={() => setShowChatModal(false)}
        onConfirm={(result: FoodChatResult) => {
          // NUT-191: acá se debe redirigir/enviar `result` al módulo de
          // desglose/confirmación de comida cuando ese módulo exista. Por
          // ahora cerramos el chat y enfocamos el buscador, como con "Otro".
          console.debug('[NUT-191] alimentos a integrar en el módulo de desglose', result.alimentos);
          setShowChatModal(false);
          setTimeout(() => searchHandleRef.current?.focus(), 0);
        }}
      />

      {/* Barcode scanner modal */}
      <BarcodeScannerModal
        open={showBarcodeModal}
        onClose={() => setShowBarcodeModal(false)}
        fecha={fecha}
        tipoIngesta={tipoIngesta}
        hideNutrition={hideNutrition}
      />

      {/* Detalle del ítem cargado — mismo modal para catálogo, código de
          barra (datos ya guardados en alimentos_barcode, sin re-pegarle a
          Open Food Facts) y carga manual. */}
      <Modal open={detalleItem !== null} onClose={() => setDetalleItem(null)} title="Detalle del alimento">
        {detalleItem && detalleItem.id_alimento_barcode != null ? (
          (() => {
            const ab = unoSolo(detalleItem.alimentos_barcode);
            return (
              <div className="space-y-3 text-sm">
                {ab?.imagen_url && (
                  // eslint-disable-next-line @next/next/no-img-element -- imagen remota de Open Food Facts, ya cacheada en nuestra DB
                  <img src={ab.imagen_url} alt={ab.nombre} className="w-full max-h-48 object-contain rounded-xl bg-gray-50" />
                )}
                <p className="font-semibold text-gray-900">{ab?.nombre ?? getAlimentoNombre(detalleItem)}</p>
                {ab?.marca && <p className="text-xs text-gray-500">{ab.marca}</p>}
                {ab?.categoria && <p className="text-xs text-gray-400">{ab.categoria}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {ab?.nutriscore_grade && (
                    <span className="text-xs px-1.5 py-0.5 rounded font-bold bg-gray-900 text-white uppercase">Nutri-Score {ab.nutriscore_grade}</span>
                  )}
                  {ab?.nova_group != null && (
                    <span className="text-xs px-1.5 py-0.5 rounded font-semibold bg-gray-100 text-gray-600">NOVA {ab.nova_group}</span>
                  )}
                  {ab?.is_vegan ? (
                    <span className="text-xs px-1.5 py-0.5 rounded font-semibold bg-green-50 text-green-700">Vegano</span>
                  ) : ab?.is_vegetarian ? (
                    <span className="text-xs px-1.5 py-0.5 rounded font-semibold bg-green-50 text-green-700">Vegetariano</span>
                  ) : null}
                  {ab?.is_gluten_free && <span className="text-xs px-1.5 py-0.5 rounded font-semibold bg-amber-50 text-amber-700">Sin TACC</span>}
                </div>
                {!hideNutrition && ab && (
                  <div className="grid grid-cols-4 gap-2 rounded-xl bg-gray-50 p-2 text-center">
                    <div><p className="text-sm font-bold text-gray-900">{toNum(ab.kcal_100g).toFixed(0)}</p><p className="text-[10px] text-gray-400">kcal/100g</p></div>
                    <div><p className="text-sm font-bold text-gray-900">{toNum(ab.proteinas_100g).toFixed(1)}</p><p className="text-[10px] text-gray-400">P</p></div>
                    <div><p className="text-sm font-bold text-gray-900">{toNum(ab.carbs_100g).toFixed(1)}</p><p className="text-[10px] text-gray-400">C</p></div>
                    <div><p className="text-sm font-bold text-gray-900">{toNum(ab.grasas_100g).toFixed(1)}</p><p className="text-[10px] text-gray-400">G</p></div>
                  </div>
                )}
                {ab?.serving_quantity_label && (
                  <p className="text-xs text-gray-400">Porción de referencia: {ab.serving_quantity_label}</p>
                )}
                <p className="text-[11px] text-gray-300">Datos guardados de Open Food Facts al escanear el código — no se vuelve a consultar la API.</p>
              </div>
            );
          })()
        ) : detalleItem && detalleItem.id_alimento != null ? (
          (() => {
            const a = unoSolo(detalleItem.alimentos);
            return (
              <div className="space-y-2 text-sm">
                <p className="font-semibold text-gray-900">{a?.nombre ?? getAlimentoNombre(detalleItem)}</p>
                {([
                  ['Fuente', a?.fuente],
                  ['Marca', a?.marca],
                  ['Categoría', a?.categoria],
                  ['Denominación', a?.denominacion],
                ] as const).map(([label, value]) =>
                  value ? (
                    <div key={label}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
                      <p className="text-gray-700 leading-relaxed">{value}</p>
                    </div>
                  ) : null,
                )}
              </div>
            );
          })()
        ) : detalleItem ? (
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-gray-900">{detalleItem.nombre_manual ?? 'Alimento sin nombre'}</p>
            <p className="text-xs text-gray-400">Cargado manualmente, sin datos de catálogo.</p>
          </div>
        ) : null}
      </Modal>

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
              {selectedAlimento.marca && (
                <p className="text-xs text-gray-500 mt-0.5">{selectedAlimento.marca}</p>
              )}
              {selectedAlimento.categoria && (
                <p className="text-xs text-gray-400 mt-0.5">{selectedAlimento.categoria}</p>
              )}
              {selectedAlimento.denominacion && (
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{selectedAlimento.denominacion}</p>
              )}
              <span className={`inline-block mt-1 text-xs px-1.5 py-0.5 rounded font-semibold ${
                selectedAlimento.fuente === 'ANMAT' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'
              }`}>
                {selectedAlimento.fuente}
              </span>
            </div>
            <button
              type="button"
              onClick={() => { setSelectedAlimento(null); searchHandleRef.current?.clear(); }}
              aria-label="Quitar selección"
              className="text-gray-400 hover:text-gray-600 flex-shrink-0"
            >
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <CantidadSelector
            name="cantidad"
            accentColor={accentColor}
            maxCantidad={MAX_CANTIDAD}
            value={cantidadValue}
            onChange={setCantidadValue}
            kcal100={selectedAlimento.kcal_100g}
            proteinas100={selectedAlimento.proteinas_100g}
            grasas100={selectedAlimento.grasas_100g}
            carbs100={selectedAlimento.carbs_100g}
            mostrarAvisoSinValores={
              !hideNutrition &&
              selectedAlimento.kcal_100g == null &&
              selectedAlimento.proteinas_100g == null &&
              selectedAlimento.grasas_100g == null &&
              selectedAlimento.carbs_100g == null
            }
          />

          <button
            type="submit"
            disabled={!(Number(cantidadValue) > 0 && Number(cantidadValue) <= MAX_CANTIDAD)}
            className="w-full rounded-xl py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
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
                      <p className="text-sm font-semibold text-gray-900 truncate" title={getAlimentoNombre(item)}>{getAlimentoNombre(item)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {toNum(item.cantidad).toFixed(0)} g
                      </p>
                      {!hideNutrition && (
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-xs font-semibold text-gray-700">{toNum(item.kcal).toFixed(0)} kcal</span>
                          <span className="text-xs text-gray-400">P {toNum(item.proteinas_g).toFixed(1)}g</span>
                          <span className="text-xs text-gray-400">C {toNum(item.carbs_g).toFixed(1)}g</span>
                          <span className="text-xs text-gray-400">G {toNum(item.grasas_g).toFixed(1)}g</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {/* Ver detalle — disponible para cualquier método de carga */}
                      <button
                        type="button"
                        onClick={() => setDetalleItem(item)}
                        aria-label="Ver detalle del alimento"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                      >
                        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        </svg>
                      </button>
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
