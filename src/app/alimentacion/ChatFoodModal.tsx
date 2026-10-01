'use client';

import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import {
  createChatMessage,
  LOW_CONFIDENCE_THRESHOLD,
  MAX_CHAT_HISTORY_MESSAGES,
  MAX_CHAT_MESSAGE_CHARS,
  MealChatError,
  type ChatMessage,
  type FoodChatEntry,
  type FoodChatResult,
  type FoodMacros,
  type MealChatService,
} from '@/lib/chatFood';
import { getMealChatService } from '@/lib/chatFoodService';

const ACCENT = '#0ea5e9';

const INITIAL_MESSAGE =
  'Contame qué comiste y te ayudo a registrarlo. Por ejemplo: "Comí 2 empanadas de carne al horno".';

const UNEXPECTED_ERROR = new MealChatError('NETWORK', 'Algo salió mal. Probá de nuevo.', true);

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

function FoodItem({ item }: { item: FoodChatEntry }) {
  const lowConfidence = item.confidence !== undefined && item.confidence < LOW_CONFIDENCE_THRESHOLD;
  return (
    <li className="text-sm text-gray-700">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="font-semibold text-gray-900">{item.alimento}</span>
        <span>· {item.cantidad}</span>
        {item.observaciones && <span className="text-gray-400">({item.observaciones})</span>}
        {item.macroSource === 'estimado_ia' && (
          <span
            className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700"
            title="No está en la tabla SARA2: los valores son una estimación del asistente."
          >
            Estimado
          </span>
        )}
        {lowConfidence && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            ⚠ Revisá este dato
          </span>
        )}
      </div>
      {item.macros && <MacroLine macros={item.macros} />}
    </li>
  );
}

function FoodResultSummary({ result }: { result: FoodChatResult }) {
  const hasEstimates = result.alimentos.some((a) => a.macroSource === 'estimado_ia');
  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 space-y-2">
      {result.resumen && <p className="text-xs font-semibold text-sky-700">{result.resumen}</p>}
      <ul className="space-y-1.5">
        {result.alimentos.map((item, i) => (
          <FoodItem key={i} item={item} />
        ))}
      </ul>
      {result.totalMacros && (
        <div className="border-t border-sky-200 pt-2 text-sm">
          <p className="font-semibold text-gray-900">
            Total: {formatNumber(result.totalMacros.kcal)} kcal
            {result.totalGramos !== undefined && (
              <span className="font-normal text-gray-500"> · {formatNumber(result.totalGramos)} g</span>
            )}
          </p>
          <p className="text-xs text-gray-600">
            Proteínas {formatNumber(result.totalMacros.proteinas_g)} g · Carbohidratos{' '}
            {formatNumber(result.totalMacros.carbs_g)} g · Grasas {formatNumber(result.totalMacros.grasas_g)} g
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
  service,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (result: FoodChatResult) => void;
  /** Inyectable para tests; por defecto según NEXT_PUBLIC_CHAT_SERVICE (mock|real). */
  service?: MealChatService;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [inputValue, setInputValue] = useState('');
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [pendingResult, setPendingResult] = useState<FoodChatResult | null>(null);
  const [error, setError] = useState<MealChatError | null>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  // Evita doble envío aunque el estado todavía no se haya re-renderizado.
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isBotTyping, error]);

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
      if (reply.status === 'complete' && reply.result) setPendingResult(reply.result);
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

  const handleConfirm = () => {
    if (!pendingResult) return;
    // NUT-191: acá se entrega el objeto estructurado al módulo de desglose/
    // confirmación de comida existente. Por ahora solo se loguea el payload
    // hasta que ese módulo quede definido; el contrato (FoodChatResult) es
    // el punto de integración.
    console.debug('[NUT-191] payload de alimentos desde el chat', pendingResult);
    onConfirm(pendingResult);
    resetState();
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
          {pendingResult && <FoodResultSummary result={pendingResult} />}
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
            disabled={!pendingResult}
            onClick={handleConfirm}
          >
            Confirmar y guardar registro
          </Button>
          <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>
            Cancelar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
