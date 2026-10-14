'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import {
  createChatMessage,
  LOW_CONFIDENCE_THRESHOLD,
  MAX_CHAT_HISTORY_MESSAGES,
  MAX_CHAT_MESSAGE_CHARS,
  MealChatError,
  type ChatMessage,
  type FoodChatResult,
  type FoodMacros,
  type MealChatService,
  type MealSaveService,
} from '@/lib/chatFood';
import {
  buildConfirmRequest,
  isSaveable,
  newRequestId,
  resolveItems,
  summarize,
  toConfirmedResult,
  type ItemEdits,
  type ResolvedItem,
} from '@/lib/chatFoodEdits';
import { getMealChatService } from '@/lib/chatFoodService';
import { getMealSaveService } from '@/lib/chatFoodSaveService';
import type { IngestaTipo } from '@/lib/nutrition';

const ACCENT = '#0ea5e9';

const INITIAL_MESSAGE =
  'Contame qué comiste y te ayudo a registrarlo. Por ejemplo: "Comí 2 empanadas de carne al horno".';

const UNEXPECTED_ERROR = new MealChatError('NETWORK', 'Algo salió mal. Probá de nuevo.', true);

/** Tope por ítem: el mismo que la carga manual del diario. */
const MAX_ITEM_AMOUNT = 2000;

const initialMessages = () => [createChatMessage('assistant', INITIAL_MESSAGE)];

/** Mensajes que cuentan para el límite del backend (el saludo inicial no se envía). */
function conversationLength(messages: ChatMessage[]): number {
  const firstUser = messages.findIndex((m) => m.sender === 'user');
  return firstUser < 0 ? 0 : messages.length - firstUser;
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('es-AR');
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-gray-100 px-4 py-3 w-fit">
      <span className="sr-only">El asistente está escribiendo</span>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce"
          style={{ animationDelay: `${i * 0.12}s` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.sender === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
          isUser ? 'rounded-br-sm text-white' : 'rounded-bl-sm bg-gray-100 text-gray-800'
        }`}
        style={isUser ? { backgroundColor: ACCENT } : undefined}
      >
        {message.content}
      </div>
    </div>
  );
}

function ChatErrorNotice({ error, onRetry, onRestart }: { error: MealChatError; onRetry: () => void; onRestart: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 space-y-2">
      <p>{error.message}</p>
      {error.retryable ? (
        <button type="button" onClick={onRetry} className="font-semibold text-red-700 underline underline-offset-2">
          Reintentar
        </button>
      ) : (
        <button type="button" onClick={onRestart} className="font-semibold text-red-700 underline underline-offset-2">
          Empezar de nuevo
        </button>
      )}
    </div>
  );
}

function MacroLine({ macros }: { macros: FoodMacros }) {
  return (
    <span className="text-xs text-gray-500">
      {formatNumber(macros.kcal)} kcal · P {formatNumber(macros.proteinas_g)} g · C {formatNumber(macros.carbs_g)} g · G{' '}
      {formatNumber(macros.grasas_g)} g
    </span>
  );
}

function FoodItem({
  resolved,
  isEditing,
  draft,
  disabled,
  onDraftChange,
  onStartEdit,
  onApplyEdit,
  onCancelEdit,
  onToggleRemove,
}: {
  resolved: ResolvedItem;
  isEditing: boolean;
  draft: string;
  disabled: boolean;
  onDraftChange: (value: string) => void;
  onStartEdit: () => void;
  onApplyEdit: () => void;
  onCancelEdit: () => void;
  onToggleRemove: () => void;
}) {
  const { entry, removed, macros } = resolved;
  const lowConfidence = entry.confidence !== undefined && entry.confidence < LOW_CONFIDENCE_THRESHOLD;
  const unit = entry.unidad ?? 'g';
  const draftNumber = Number(draft);
  const draftValid = Number.isFinite(draftNumber) && draftNumber > 0 && draftNumber <= MAX_ITEM_AMOUNT;
  const canEdit = entry.gramos !== undefined;
  // Siempre se muestra el gramaje vigente; si la cantidad ya lo dice ("240 g") no se repite.
  const amount = resolved.gramos !== null ? `${resolved.gramos} ${unit}` : null;
  const gramosLabel = amount && resolved.cantidad.trim() !== amount ? amount : null;

  return (
    <li className="text-sm text-gray-700">
      <div className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 ${removed ? 'line-through text-gray-400' : ''}`}>
        <span className={`font-semibold ${removed ? '' : 'text-gray-900'}`}>{entry.alimento}</span>
        <span>· {resolved.cantidad}{gramosLabel && ` · ${gramosLabel}`}</span>
        {resolved.edited && !removed && (
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700 no-underline">
            Editado
          </span>
        )}
        {entry.observaciones && <span className="text-gray-400">({entry.observaciones})</span>}
        {!removed && entry.macroSource === 'estimado_ia' && (
          <span
            className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700"
            title="No está en la tabla SARA2: los valores son una estimación del asistente."
          >
            Estimado
          </span>
        )}
        {!removed && lowConfidence && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            ⚠ Revisá este dato
          </span>
        )}
      </div>
      {!removed && macros && <MacroLine macros={macros} />}

      {isEditing ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            min={1}
            max={MAX_ITEM_AMOUNT}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (draftValid) onApplyEdit();
              }
            }}
            aria-label={`Cantidad de ${entry.alimento} en ${unit}`}
            className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
          <span className="text-xs text-gray-500">{unit}</span>
          <button
            type="button"
            onClick={onApplyEdit}
            disabled={!draftValid}
            className="rounded-lg bg-sky-500 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
          >
            Guardar cantidad
          </button>
          <button type="button" onClick={onCancelEdit} className="text-xs font-medium text-gray-500 underline">
            Cancelar edición
          </button>
        </div>
      ) : (
        <div className="mt-1 flex gap-3 text-xs">
          {!removed && canEdit && (
            <button
              type="button"
              onClick={onStartEdit}
              disabled={disabled}
              aria-label={`Editar cantidad de ${entry.alimento}`}
              className="font-medium text-sky-700 underline underline-offset-2 disabled:opacity-40"
            >
              Editar
            </button>
          )}
          <button
            type="button"
            onClick={onToggleRemove}
            disabled={disabled}
            aria-label={removed ? `Deshacer quitar ${entry.alimento}` : `Quitar ${entry.alimento}`}
            className="font-medium text-gray-500 underline underline-offset-2 disabled:opacity-40"
          >
            {removed ? 'Deshacer' : 'Quitar'}
          </button>
        </div>
      )}
    </li>
  );
}

function FoodResultSummary({
  result,
  items,
  editingIndex,
  draft,
  disabled,
  onDraftChange,
  onStartEdit,
  onApplyEdit,
  onCancelEdit,
  onToggleRemove,
}: {
  result: FoodChatResult;
  items: ResolvedItem[];
  editingIndex: number | null;
  draft: string;
  disabled: boolean;
  onDraftChange: (value: string) => void;
  onStartEdit: (index: number) => void;
  onApplyEdit: () => void;
  onCancelEdit: () => void;
  onToggleRemove: (index: number) => void;
}) {
  const hasEstimates = items.some((i) => !i.removed && i.entry.macroSource === 'estimado_ia');
  const { macros, gramos } = summarize(items, result.totalMacros);
  const allRemoved = items.every((i) => i.removed);
  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 space-y-2">
      {result.resumen && <p className="text-xs font-semibold text-sky-700">{result.resumen}</p>}
      <ul className="space-y-2">
        {items.map((resolved) => (
          <FoodItem
            key={resolved.index}
            resolved={resolved}
            isEditing={editingIndex === resolved.index}
            draft={draft}
            disabled={disabled}
            onDraftChange={onDraftChange}
            onStartEdit={() => onStartEdit(resolved.index)}
            onApplyEdit={onApplyEdit}
            onCancelEdit={onCancelEdit}
            onToggleRemove={() => onToggleRemove(resolved.index)}
          />
        ))}
      </ul>
      {allRemoved && <p className="text-xs text-amber-700">Quitaste todos los alimentos: no hay nada para guardar.</p>}
      {macros && !allRemoved && (
        <div className="border-t border-sky-200 pt-2 text-sm">
          <p className="font-semibold text-gray-900">
            Total: {formatNumber(macros.kcal)} kcal
            {gramos !== null && <span className="font-normal text-gray-500"> · {formatNumber(gramos)} g</span>}
          </p>
          <p className="text-xs text-gray-600">
            Proteínas {formatNumber(macros.proteinas_g)} g · Carbohidratos {formatNumber(macros.carbs_g)} g · Grasas{' '}
            {formatNumber(macros.grasas_g)} g
          </p>
        </div>
      )}
      {hasEstimates && (
        <p className="text-[11px] text-gray-500">
          Los ítems marcados como &quot;Estimado&quot; no están en la tabla SARA2; sus valores los calculó el asistente.
        </p>
      )}
    </div>
  );
}

export default function ChatFoodModal({
  open,
  onClose,
  onConfirm,
  fecha,
  tipoIngesta,
  service,
  saveService,
}: {
  open: boolean;
  onClose: () => void;
  /** Se llama DESPUÉS de guardar, con lo que quedó confirmado (sin los ítems quitados). */
  onConfirm: (result: FoodChatResult) => void;
  /** Fecha (AAAA-MM-DD) y comida del diario donde se guarda el registro. */
  fecha: string;
  tipoIngesta: IngestaTipo;
  /** Inyectable para tests; por defecto, el servicio real (Gemini). */
  service?: MealChatService;
  /** Inyectable para tests; por defecto POST /api/chat/meal/confirm. */
  saveService?: MealSaveService;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [inputValue, setInputValue] = useState('');
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [pendingResult, setPendingResult] = useState<FoodChatResult | null>(null);
  const [error, setError] = useState<MealChatError | null>(null);
  // NUT-191: ediciones del usuario sobre el resultado y estado del guardado.
  const [edits, setEdits] = useState<ItemEdits>({});
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<MealChatError | null>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  // Evita doble envío aunque el estado todavía no se haya re-renderizado.
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isBotTyping, error, saveError]);

  // Si el componente se desmonta con una request en curso, se cancela.
  useEffect(() => () => abortRef.current?.abort(), []);

  const limitReached = conversationLength(messages) + 1 > MAX_CHAT_HISTORY_MESSAGES;
  const inputDisabled = isBotTyping || !!pendingResult || !!error || limitReached;

  const resetState = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
    // Vuelve al saludo inicial: el modal queda montado y se reabre con este estado.
    setMessages(initialMessages());
    setInputValue('');
    setIsBotTyping(false);
    setPendingResult(null);
    setError(null);
    setEdits({});
    setEditingIndex(null);
    setDraft('');
    setRequestId(null);
    setIsSaving(false);
    setSaveError(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  /** Pide la respuesta para `history` (cuyo último mensaje es del usuario). */
  const requestReply = async (history: ChatMessage[]) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setIsBotTyping(true);

    try {
      const reply = await (service ?? getMealChatService()).sendMessage(history, controller.signal);
      if (controller.signal.aborted) return;
      setMessages((prev) => [...prev, createChatMessage('assistant', reply.message)]);
      // Solo "complete" habilita confirmar; "needs_clarification", "off_topic" e
      // "invalid_input" dejan el input habilitado para que el usuario responda.
      if (reply.status === 'complete' && reply.result) {
        setPendingResult(reply.result);
        setEdits({});
        setRequestId(newRequestId());
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof MealChatError ? err : UNEXPECTED_ERROR);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        inFlightRef.current = false;
        setIsBotTyping(false);
      }
    }
  };

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text || inputDisabled || inFlightRef.current) return;

    const nextHistory = [...messages, createChatMessage('user', text)];
    setMessages(nextHistory);
    setInputValue('');
    void requestReply(nextHistory);
  };

  // Reenvía el mismo historial: el mensaje del usuario ya está, no se duplica.
  const handleRetry = () => {
    void requestReply(messages);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const startEdit = (index: number) => {
    const current = pendingResult ? resolveItems(pendingResult, edits)[index] : null;
    setEditingIndex(index);
    setDraft(current?.gramos !== null && current?.gramos !== undefined ? String(current.gramos) : '');
  };

  const applyEdit = () => {
    const value = Number(draft);
    if (editingIndex === null || !Number.isFinite(value) || value <= 0 || value > MAX_ITEM_AMOUNT) return;
    const index = editingIndex;
    setEdits((prev) => ({ ...prev, [index]: { ...prev[index], gramos: value } }));
    setEditingIndex(null);
    setDraft('');
    setSaveError(null);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setDraft('');
  };

  const toggleRemove = (index: number) => {
    setEdits((prev) => ({ ...prev, [index]: { ...prev[index], removed: !prev[index]?.removed } }));
    if (editingIndex === index) cancelEdit();
    setSaveError(null);
  };

  const resolvedItems = pendingResult ? resolveItems(pendingResult, edits) : [];
  const canConfirm =
    !!pendingResult && isSaveable(pendingResult) && !isSaving && resolvedItems.some((i) => !i.removed);

  const handleConfirm = async () => {
    if (!pendingResult || !requestId || !canConfirm) return;
    setSaveError(null);
    setIsSaving(true);
    try {
      // Mismo requestId en cada reintento: si el guardado anterior sí llegó, no se duplica.
      const request = buildConfirmRequest(pendingResult, edits, { requestId, fecha, tipoIngesta });
      await (saveService ?? getMealSaveService()).save(request);
      const confirmed = toConfirmedResult(pendingResult, edits);
      resetState();
      router.refresh();
      onConfirm(confirmed);
    } catch (err) {
      setSaveError(err instanceof MealChatError ? err : UNEXPECTED_ERROR);
      setIsSaving(false);
    }
  };

  const remainingChars = MAX_CHAT_MESSAGE_CHARS - inputValue.length;

  return (
    <Modal open={open} onClose={handleClose} title="💬 Registrar comida por chat">
      <div className="flex flex-col gap-3">
        <div
          role="log"
          aria-live="polite"
          className="flex h-80 flex-col gap-3 overflow-y-auto rounded-2xl border border-gray-100 bg-white p-3 sm:h-96"
        >
          {messages.map((m) => (
            <ChatBubble key={m.id} message={m} />
          ))}
          {isBotTyping && <TypingIndicator />}
          {error && <ChatErrorNotice error={error} onRetry={handleRetry} onRestart={resetState} />}
          {pendingResult && (
            <FoodResultSummary
              result={pendingResult}
              items={resolvedItems}
              editingIndex={editingIndex}
              draft={draft}
              disabled={isSaving}
              onDraftChange={setDraft}
              onStartEdit={startEdit}
              onApplyEdit={applyEdit}
              onCancelEdit={cancelEdit}
              onToggleRemove={toggleRemove}
            />
          )}
          {saveError && (
            <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {saveError.message}
              {saveError.retryable && ' Tocá "Confirmar y guardar registro" para reintentar.'}
            </div>
          )}
          {limitReached && !pendingResult && (
            <p className="text-center text-xs text-gray-500">
              Llegaste al límite de mensajes de esta conversación. Cerrá el chat y empezá uno nuevo.
            </p>
          )}
          <div ref={historyEndRef} />
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={inputDisabled}
              maxLength={MAX_CHAT_MESSAGE_CHARS}
              placeholder="Escribí lo que comiste..."
              aria-label="Mensaje para el chat de registro de comida"
              aria-describedby="chat-char-counter"
              className="flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 disabled:opacity-50"
              style={{ ['--tw-ring-color' as string]: `${ACCENT}40` }}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!inputValue.trim() || inputDisabled}
              aria-label="Enviar mensaje"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-white transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
              style={{ backgroundColor: ACCENT }}
            >
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.126A59.77 59.77 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.874L5.999 12Zm0 0h7.5" />
              </svg>
            </button>
          </div>
          <p
            id="chat-char-counter"
            className={`pr-12 text-right text-[11px] ${remainingChars <= 50 ? 'text-amber-600' : 'text-gray-400'}`}
          >
            {inputValue.length}/{MAX_CHAT_MESSAGE_CHARS}
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="primary"
            className="flex-1"
            disabled={!canConfirm}
            loading={isSaving}
            onClick={handleConfirm}
          >
            {isSaving ? 'Guardando...' : 'Confirmar y guardar registro'}
          </Button>
          <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>
            Cancelar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
