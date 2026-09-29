'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import type { BoundingBox } from '@/lib/deteccion';
import { PASO_PESO_G, contarDudas, esConfianzaAlta, itemActivo, type WorkingItem } from '@/lib/deteccionResultado';
import { nutritionProviderMock, type NutritionProvider } from '@/lib/nutritionMock';
import { IconCheck, IconRepeat, IconRuler, IconSearch, IconTrash } from './icons';

const ACCENT = '#a855f7';

function ConfidenceDot({ item }: { item: WorkingItem }) {
  const alta = esConfianzaAlta(item.confidence) && item.pendingQuestions.length === 0;
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${alta ? 'bg-emerald-500' : 'bg-amber-500'}`}
    />
  );
}

function BoundingBoxHighlight({ box }: { box: BoundingBox }) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.width * 100}%`,
        height: `${box.height * 100}%`,
      }}
    >
      <div className="absolute inset-0 rounded-[50%] border-2 border-violet-400" style={{ boxShadow: `0 0 0 2000px rgba(0,0,0,0.25)` }} />
      <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
        ¿Esto?
      </span>
    </div>
  );
}

function MacroBar({ label, grams, maxGrams, color }: { label: string; grams: number; maxGrams: number; color: string }) {
  const pct = maxGrams > 0 ? Math.min(100, (grams / maxGrams) * 100) : 0;
  return (
    <div>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="text-sm font-bold text-gray-900">{Math.round(grams)} g</p>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export interface AIRecognitionResultProps {
  photoUrl: string;
  vajillaChip: string;
  items: WorkingItem[];
  mealLabel: string;
  provider?: NutritionProvider;
  saving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
  onRepetir: () => void;
  onResponder: (uiId: string, respuesta: string | null, custom?: boolean) => void;
  onAjustarPeso: (uiId: string, grams: number) => void;
  onDeshacerPeso: (uiId: string) => void;
  onQuitarItem: (uiId: string) => void;
  onAbrirCambiarAlimento: (item: WorkingItem) => void;
  onAbrirAgregarAlimento: () => void;
  onGuardar: () => void;
  onListo: () => void;
}

/**
 * NUT-169/170 — Pantalla 2 del modal "Reconocimiento por IA": resultado
 * editable, con los dos estados "dudas" y "listo" del mockup.
 */
export default function AIRecognitionResult({
  photoUrl,
  vajillaChip,
  items,
  mealLabel,
  provider = nutritionProviderMock,
  saving,
  saveError,
  saveSuccess,
  onRepetir,
  onResponder,
  onAjustarPeso,
  onDeshacerPeso,
  onQuitarItem,
  onAbrirCambiarAlimento,
  onAbrirAgregarAlimento,
  onGuardar,
  onListo,
}: AIRecognitionResultProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [customDraft, setCustomDraft] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const dudas = contarDudas(items);
  const activo = itemActivo(items);
  const listo = dudas === 0;
  const expandedActualId = expandedId ?? items[0]?.uiId ?? null;

  const totales = items.reduce(
    (acc, item) => {
      const n = provider.forGrams(item.name, item.grams);
      return {
        grams: acc.grams + item.grams,
        kcal: acc.kcal + n.kcal,
        protein: acc.protein + n.protein,
        carbs: acc.carbs + n.carbs,
        fat: acc.fat + n.fat,
      };
    },
    { grams: 0, kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
  const maxMacro = Math.max(totales.protein, totales.carbs, totales.fat, 1);

  const handleResponder = (uiId: string, respuesta: string) => {
    setShowCustomInput(false);
    setCustomDraft('');
    onResponder(uiId, respuesta);
  };

  const handleOmitir = (uiId: string) => {
    setShowCustomInput(false);
    setCustomDraft('');
    onResponder(uiId, null);
  };

  const handleConfirmarCustom = (uiId: string) => {
    const texto = customDraft.trim();
    if (!texto) return;
    setShowCustomInput(false);
    setCustomDraft('');
    onResponder(uiId, texto, true);
  };

  if (saveSuccess) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <p className="text-sm font-semibold text-gray-900">Guardado en {mealLabel}</p>
        <Button type="button" variant="primary" onClick={onListo}>
          Listo
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative h-64 overflow-hidden rounded-2xl border border-gray-100 bg-gray-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} alt="Foto de la comida" className="h-full w-full object-cover" />
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-gray-700 shadow">
          <IconRuler className="h-3 w-3" /> {vajillaChip}
        </span>
        <button
          type="button"
          onClick={onRepetir}
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-gray-700 shadow hover:bg-white"
        >
          <IconRepeat className="h-3 w-3" /> Repetir
        </button>
        {!listo && activo?.boundingBox && <BoundingBoxHighlight box={activo.boundingBox} />}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">
          {listo ? `${items.length} alimento${items.length === 1 ? '' : 's'}` : `Encontré ${items.length} alimentos`}
        </p>
        {listo ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            <IconCheck className="h-3 w-3" /> Sin dudas
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
            {dudas} duda{dudas === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <ul className="space-y-2">
        {items.map((item) => {
          const esActivo = !listo && activo?.uiId === item.uiId;
          const tieneDudaPendiente = item.pendingQuestions.length > 0;
          const expandidoListo = listo && expandedActualId === item.uiId;
          const nutricion = provider.forGrams(item.name, item.grams);

          return (
            <li
              key={item.uiId}
              className={`rounded-xl border bg-white px-3 py-2.5 ${
                expandidoListo ? 'border-violet-400' : 'border-gray-100'
              }`}
            >
              <button
                type="button"
                onClick={() => listo && setExpandedId(item.uiId)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <div className="flex items-center gap-2">
                  <ConfidenceDot item={item} />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{item.name}</p>
                    {item.origin === 'answered' ? (
                      <p className="text-xs font-semibold text-emerald-600">Vos respondiste</p>
                    ) : (
                      <p className="text-xs text-gray-400">
                        {item.category}
                        {item.confidence != null ? ` · ${Math.round(item.confidence * 100)}%` : ''}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {listo && expandidoListo && (
                    <span className="text-sm font-semibold text-gray-700">{Math.round(nutricion.kcal)} kcal</span>
                  )}
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-violet-700">
                    {Math.round(item.grams)} g
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m17 3 4 4-11 11H6v-4L17 3Z" />
                    </svg>
                  </span>
                </div>
              </button>

              {tieneDudaPendiente && esActivo && (
                <div className="mt-2 rounded-lg bg-violet-50 px-3 py-2.5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-violet-500">
                      Pregunta {item.answers.length + 1} de {item.answers.length + item.pendingQuestions.length}
                    </span>
                  </div>
                  <div className="mb-2 flex gap-1" aria-hidden="true">
                    {Array.from({ length: item.answers.length + item.pendingQuestions.length }).map((_, i) => (
                      <span
                        key={i}
                        className={`h-1 flex-1 rounded-full ${i <= item.answers.length - 1 ? 'bg-violet-500' : i === item.answers.length ? 'bg-violet-300' : 'bg-violet-100'}`}
                      />
                    ))}
                  </div>
                  <p className="mb-2 text-sm font-medium text-gray-900">{item.pendingQuestions[0].question}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {item.pendingQuestions[0].options.map((opcion) => (
                      <button
                        key={opcion}
                        type="button"
                        onClick={() => handleResponder(item.uiId, opcion)}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 hover:border-violet-300"
                      >
                        {opcion}
                      </button>
                    ))}
                    {!showCustomInput && (
                      <button
                        type="button"
                        onClick={() => setShowCustomInput(true)}
                        className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-semibold text-gray-500 hover:border-violet-300"
                      >
                        Otro…
                      </button>
                    )}
                  </div>
                  {showCustomInput && (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="text"
                        value={customDraft}
                        onChange={(e) => setCustomDraft(e.target.value)}
                        placeholder="Escribí qué es"
                        aria-label="Tu respuesta"
                        className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-2"
                        style={{ ['--tw-ring-color' as string]: `${ACCENT}40` }}
                      />
                      <button
                        type="button"
                        onClick={() => handleConfirmarCustom(item.uiId)}
                        disabled={!customDraft.trim()}
                        className="rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                      >
                        Responder
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleOmitir(item.uiId)}
                    className="mt-2 block text-xs font-medium text-gray-400 hover:text-gray-600 hover:underline"
                  >
                    No sé, seguir sin responder
                  </button>
                </div>
              )}

              {tieneDudaPendiente && !esActivo && (
                <p className="mt-1 text-xs font-medium text-amber-600">Hay una duda pendiente sobre este ítem.</p>
              )}

              {listo && expandidoListo && (
                <div className="mt-2.5 space-y-2.5 border-t border-gray-100 pt-2.5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Restar 5 gramos"
                      onClick={() => onAjustarPeso(item.uiId, item.grams - PASO_PESO_G)}
                      className="h-9 w-9 flex-shrink-0 rounded-lg bg-gray-100 text-base font-semibold text-gray-600 hover:bg-gray-200"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      aria-label={`Peso de ${item.name}`}
                      value={Math.round(item.grams)}
                      onChange={(e) => onAjustarPeso(item.uiId, Number(e.target.value) || 0)}
                      className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-center text-sm font-semibold text-gray-900"
                    />
                    <button
                      type="button"
                      aria-label="Sumar 5 gramos"
                      onClick={() => onAjustarPeso(item.uiId, item.grams + PASO_PESO_G)}
                      className="h-9 w-9 flex-shrink-0 rounded-lg bg-gray-100 text-base font-semibold text-gray-600 hover:bg-gray-200"
                    >
                      +
                    </button>
                    {item.aiGrams != null && (
                      <button
                        type="button"
                        onClick={() => onDeshacerPeso(item.uiId)}
                        className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-gray-600"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h9a5 5 0 1 1-4.9 6M3 10l4-4M3 10l4 4" />
                        </svg>
                        IA: {Math.round(item.aiGrams)} g
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => onAbrirCambiarAlimento(item)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline"
                    >
                      <IconSearch className="h-3.5 w-3.5" /> Cambiar alimento
                    </button>
                    <button
                      type="button"
                      onClick={() => onQuitarItem(item.uiId)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-500 hover:underline"
                    >
                      <IconTrash className="h-3.5 w-3.5" /> Quitar
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {listo && (
        <button
          type="button"
          onClick={onAbrirAgregarAlimento}
          className="w-full rounded-xl border border-dashed border-gray-300 py-2.5 text-sm font-semibold text-gray-500 hover:border-violet-300 hover:text-violet-600"
        >
          + Agregar alimento que falta
        </button>
      )}

      {listo ? (
        <div className="space-y-3 rounded-2xl border border-gray-100 bg-gray-50 p-3">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-medium text-gray-400">Total · {Math.round(totales.grams)} g</p>
            <p className="text-2xl font-bold text-gray-900">{Math.round(totales.kcal)} kcal</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <MacroBar label="Proteínas" grams={totales.protein} maxGrams={maxMacro} color="#3b82f6" />
            <MacroBar label="Carbohidratos" grams={totales.carbs} maxGrams={maxMacro} color="#22c55e" />
            <MacroBar label="Grasas" grams={totales.fat} maxGrams={maxMacro} color="#f59e0b" />
          </div>
        </div>
      ) : (
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold text-gray-700">Total estimado {Math.round(totales.grams)} g</p>
          <p className="text-xs text-gray-400">
            ≈ {Math.round(totales.kcal)} kcal
            <br />
            <span className="italic">puede cambiar según tu respuesta</span>
          </p>
        </div>
      )}

      {saveError && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" aria-live="polite">
          {saveError}
        </p>
      )}

      <Button
        type="button"
        variant="primary"
        className="w-full"
        disabled={!listo || saving}
        loading={saving}
        onClick={onGuardar}
      >
        {saving ? (
          'Guardando...'
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <IconCheck className="h-4 w-4" /> Guardar en {mealLabel}
          </span>
        )}
      </Button>
      {!listo && <p className="text-center text-xs text-gray-400">Respondé u omití la duda para guardar</p>}
    </div>
  );
}
