'use client';

/**
 * NUT-149 — "Ejemplo para la IA" (en la base: `candidato_ejemplo`): marca un caso para que el equipo lo
 * pueda sumar, más adelante y a mano, como ejemplo en las instrucciones de la IA. No dispara nada solo.
 * Dos usos con la misma etiqueta y el mismo texto de ayuda: el control de la tarjeta (estrella + etiqueta,
 * dos estados visibles) y la casilla del modal. La ayuda es un popover que se abre con clic o teclado
 * (no depende del hover) y se cierra con Esc, con clic afuera o volviendo a tocar el ícono.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { EJEMPLO_IA_AYUDA, EJEMPLO_IA_TITULO } from '@/components/researcher/helpContent';

/** Ícono "?" que abre la explicación de "Ejemplo para la IA". */
export function AyudaEjemploIa() {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  const contenedor = useRef<HTMLSpanElement>(null);
  const boton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!abierto) return;
    // En captura: si el popover está dentro de un modal, Esc cierra sólo el popover (no llega al modal).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setAbierto(false);
      boton.current?.focus();
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!contenedor.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [abierto]);

  return (
    <span ref={contenedor} className="relative inline-flex">
      <button
        ref={boton}
        type="button"
        aria-label={`Qué significa ${EJEMPLO_IA_TITULO}`}
        aria-expanded={abierto}
        aria-controls={abierto ? id : undefined}
        onClick={() => setAbierto((v) => !v)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M12 11v5.5M12 7.75v.01" />
        </svg>
      </button>
      {abierto && (
        <div id={id} role="region" aria-label={EJEMPLO_IA_TITULO} className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs leading-relaxed text-slate-700 shadow-lg">
          <p className="mb-1 text-sm font-semibold text-slate-900">{EJEMPLO_IA_TITULO}</p>
          <p>{EJEMPLO_IA_AYUDA}</p>
        </div>
      )}
    </span>
  );
}

interface ToggleProps {
  marcado: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** Para distinguir las tarjetas entre sí con lectores de pantalla (se suma a la etiqueta visible). */
  contexto?: string;
}

/** Control de la tarjeta: estrella + "Ejemplo para la IA", con dos estados visibles (marcado / sin marcar) y la ayuda al lado. */
export function EjemploIaToggle({ marcado, onToggle, disabled, contexto }: ToggleProps) {
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={marcado}
        aria-label={contexto ? `${EJEMPLO_IA_TITULO}: ${contexto}` : EJEMPLO_IA_TITULO}
        onClick={onToggle}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 ${
          marcado ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
        }`}
      >
        <span aria-hidden="true" className={`text-base leading-none ${marcado ? 'text-amber-500' : 'text-slate-500'}`}>
          {marcado ? '★' : '☆'}
        </span>
        {EJEMPLO_IA_TITULO}
      </button>
      <AyudaEjemploIa />
    </span>
  );
}

/** Casilla del modal de corrección: misma etiqueta y misma ayuda que el control de la tarjeta. */
export function EjemploIaCasilla({ marcado, onToggle, disabled }: Omit<ToggleProps, 'contexto'>) {
  return (
    <span className="inline-flex items-center gap-1">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
        <input type="checkbox" checked={marcado} disabled={disabled} onChange={onToggle} className="h-4 w-4 accent-blue-600" />
        {EJEMPLO_IA_TITULO}
      </label>
      <AyudaEjemploIa />
    </span>
  );
}
