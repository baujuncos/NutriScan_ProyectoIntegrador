'use client';

/**
 * NUT-119 — Contenedor del "Revisar alimento" (rediseño): cabecera con subtítulo y aviso
 * "Sin guardar", cuerpo con scroll y pie fijo con las acciones. En el celular es una hoja
 * inferior (con tirador); desde `md`, un modal centrado de 960 px.
 */
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '@/lib/overlayMovil';
import { useFocusTrap } from '@/lib/useFocusTrap';

interface Props {
  open: boolean;
  onClose: () => void;
  titulo: string;
  subtitulo?: string;
  /** Hay cambios sin guardar: muestra el aviso "Sin guardar" en la cabecera. */
  sinGuardar?: boolean;
  children: React.ReactNode;
  /** Pie fijo (estado + acciones). */
  pie?: React.ReactNode;
}

export default function HojaRevision({ open, onClose, titulo, subtitulo, sinGuardar, children, pie }: Props) {
  const idTitulo = useId();
  // `overflow: hidden` en el body no alcanza en iOS: se fija el body mientras la hoja está abierta.
  useBodyScrollLock(open);
  // Foco atrapado mientras está abierta; al cerrar vuelve al botón que la abrió (igual que el Modal base).
  const hojaRef = useRef<HTMLElement>(null);
  useFocusTrap(hojaRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  // Portal a <body>: evita quedar atrapado en el stacking context de un contenedor con su propio z-index.
  return createPortal(
    <div
      data-testid="hoja-fondo"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/45 md:items-center md:p-6"
      onClick={onClose}
    >
      <section
        ref={hojaRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[calc(100dvh-2rem)] w-full flex-col focus:outline-none overflow-hidden rounded-t-3xl bg-white shadow-2xl md:h-auto md:max-h-[calc(100dvh-3rem)] md:min-h-[620px] md:max-w-[960px] md:rounded-[20px]"
      >
        <header className="flex flex-wrap items-start gap-3 border-b border-slate-200 px-4 pb-3 pt-2 md:flex-nowrap md:px-6 md:pb-4 md:pt-5">
          <span aria-hidden="true" className="mx-auto mb-1 block h-[5px] w-10 basis-full rounded-full bg-slate-300 md:hidden" />
          <div className="min-w-0 flex-1">
            <h1 id={idTitulo} className="text-lg font-bold leading-tight text-slate-900 md:text-xl">
              {titulo}
            </h1>
            {subtitulo && <p className="mt-0.5 text-[13px] text-slate-600">{subtitulo}</p>}
          </div>
          {sinGuardar && (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"
            >
              <i aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-current" />
              Sin guardar
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">{children}</div>

        {pie && <footer className="border-t border-slate-200 bg-white px-4 pb-[18px] pt-3 md:px-6 md:py-3.5">{pie}</footer>}
      </section>
    </div>,
    document.body,
  );
}
