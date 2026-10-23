'use client';

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '@/lib/overlayMovil';
import { useFocusTrap } from '@/lib/useFocusTrap';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Muestra una flecha "atrás" a la izquierda del título (hoja secundaria dentro del mismo modal). */
  onBack?: () => void;
  /** Ícono opcional antes del título (reemplaza a poner un emoji dentro del string de `title`). */
  icon?: React.ReactNode;
  /** Panel ancho (detalles con foto + formulario). Equivale a `size="lg"`; por defecto `md`. */
  wide?: boolean;
  /** Ancho del panel: sm / md (por defecto) / lg / xl. Gana sobre `wide`. */
  size?: ModalSize;
  /** Pie de acciones (botones), separado del contenido por una línea. */
  footer?: React.ReactNode;
}

export default function Modal({ open, onClose, title, children, onBack, icon, wide, size, footer }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // `overflow: hidden` en el body no alcanza en iOS: se fija el body mientras el modal está abierto.
  useBodyScrollLock(open);
  // Foco atrapado mientras está abierto; al cerrar vuelve al elemento que lo abrió.
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  // Portal a <body>: si el modal se renderiza dentro de un contenedor con su
  // propio stacking context (ej. el sidebar sticky), su z-index queda atrapado
  // ahí y el contenido de la página lo tapa.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 py-8 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`w-full ${SIZE_CLASS[size ?? (wide ? 'lg' : 'md')]} rounded-2xl bg-white p-6 shadow-xl my-auto focus:outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label="Volver"
                className="text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
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
            <h2 id={titleId} className="text-lg font-bold text-gray-900">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>
        {children}
        {footer && <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 pt-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
