'use client';

import { useEffect } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Muestra una flecha "atrás" a la izquierda del título (hoja secundaria dentro del mismo modal). */
  onBack?: () => void;
  /** Ícono opcional antes del título (reemplaza a poner un emoji dentro del string de `title`). */
  icon?: React.ReactNode;
}

export default function Modal({ open, onClose, title, children, onBack, icon }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);

    // `overflow: hidden` en el body no alcanza en iOS (Safari/PWA instalada):
    // el touch-scroll de la página de atrás sigue andando igual mientras el
    // modal está abierto. Fijar el body en su lugar con `position: fixed` sí
    // lo bloquea de verdad ahí; se restaura el scroll al cerrar.
    const scrollY = window.scrollY;
    const { body } = document;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 py-8 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label="Volver"
                className="text-gray-400 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            )}
            {icon && (
              <span className="text-violet-600" aria-hidden="true">
                {icon}
              </span>
            )}
            <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="text-gray-400 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
