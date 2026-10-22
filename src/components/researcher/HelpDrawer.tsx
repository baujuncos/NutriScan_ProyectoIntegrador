'use client';

/**
 * Botón "i" + panel lateral con la guía de la pantalla (qué es, para qué sirve,
 * cómo se usa, glosario). Siempre disponible, sólo se abre a pedido. Accesible:
 * Esc cierra, Tab queda dentro del panel y, al cerrar, el foco vuelve al botón.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '@/lib/overlayMovil';
import { useFocusTrap } from '@/lib/useFocusTrap';
import { HELP, type HelpId } from './helpContent';

export default function HelpDrawer({ helpId }: { helpId: HelpId }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const contenido = HELP[helpId];

  useBodyScrollLock(open);
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ayuda sobre esta pantalla"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M12 11v5.5M12 7.75v.01" />
        </svg>
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex justify-end bg-slate-900/40" onClick={() => setOpen(false)}>
            <aside
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
              className="flex h-full w-full max-w-md flex-col bg-white shadow-xl focus:outline-none"
            >
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ayuda</p>
                  <h2 id={titleId} className="text-lg font-bold text-slate-900">
                    {contenido.titulo}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Cerrar ayuda"
                  className="rounded text-slate-600 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 text-sm text-slate-700">
                {contenido.secciones.map((s) => (
                  <section key={s.titulo}>
                    <h3 className="mb-2 text-sm font-bold text-slate-900">{s.titulo}</h3>
                    {s.texto?.map((p) => (
                      <p key={p} className="mb-2 leading-relaxed">
                        {p}
                      </p>
                    ))}
                    {s.lista && (
                      <ul className="list-disc space-y-1.5 pl-5 leading-relaxed">
                        {s.lista.map((i) => (
                          <li key={i}>{i}</li>
                        ))}
                      </ul>
                    )}
                    {s.pasos && (
                      <ol className="list-decimal space-y-1.5 pl-5 leading-relaxed">
                        {s.pasos.map((i) => (
                          <li key={i}>{i}</li>
                        ))}
                      </ol>
                    )}
                  </section>
                ))}
                {contenido.glosario && (
                  <section>
                    <h3 className="mb-2 text-sm font-bold text-slate-900">Glosario</h3>
                    <dl className="space-y-3">
                      {contenido.glosario.map((g) => (
                        <div key={g.termino}>
                          <dt className="font-semibold text-slate-900">{g.termino}</dt>
                          <dd className="leading-relaxed">{g.definicion}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                )}
              </div>
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
}
