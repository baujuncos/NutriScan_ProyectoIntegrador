'use client';

import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { createChatMessage, type ChatMessage, type FoodChatResult } from '@/lib/chatFood';
import { fetchMockChatReply } from '@/lib/chatFoodMockService';

const ACCENT = '#0ea5e9';

const INITIAL_MESSAGE =
  'Contame qué comiste y te ayudo a registrarlo. Por ejemplo: "Comí 2 empanadas de carne al horno".';

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

function FoodResultSummary({ result }: { result: FoodChatResult }) {
  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 space-y-2">
      {result.resumen && <p className="text-xs font-semibold text-sky-700">{result.resumen}</p>}
      <ul className="space-y-1.5">
        {result.alimentos.map((item, i) => (
          <li key={i} className="text-sm text-gray-700">
            <span className="font-semibold text-gray-900">{item.alimento}</span>
            {' · '}
            {item.cantidad}
            {item.observaciones && <span className="text-gray-400"> ({item.observaciones})</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ChatFoodModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (result: FoodChatResult) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    createChatMessage('assistant', INITIAL_MESSAGE),
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [pendingResult, setPendingResult] = useState<FoodChatResult | null>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isBotTyping]);

  const resetState = () => {
    setMessages([]);
    setInputValue('');
    setIsBotTyping(false);
    setPendingResult(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isBotTyping || pendingResult) return;

    const userMessage = createChatMessage('user', text);
    const nextHistory = [...messages, userMessage];
    setMessages(nextHistory);
    setInputValue('');
    setIsBotTyping(true);

    const reply = await fetchMockChatReply(nextHistory);

    setMessages((prev) => [...prev, createChatMessage('assistant', reply.message)]);
    setIsBotTyping(false);
    if (reply.kind === 'result' && reply.result) {
      setPendingResult(reply.result);
    }
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
          {pendingResult && <FoodResultSummary result={pendingResult} />}
          <div ref={historyEndRef} />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isBotTyping || !!pendingResult}
            placeholder="Escribí lo que comiste..."
            aria-label="Mensaje para el chat de registro de comida"
            className="flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 disabled:opacity-50"
            style={{ ['--tw-ring-color' as string]: `${ACCENT}40` }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputValue.trim() || isBotTyping || !!pendingResult}
            aria-label="Enviar mensaje"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-white transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
            style={{ backgroundColor: ACCENT }}
          >
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.126A59.77 59.77 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.874L5.999 12Zm0 0h7.5" />
            </svg>
          </button>
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
