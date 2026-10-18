'use client';

/**
 * Utilidades para overlays a pantalla completa en celular (el buscador de
 * alimentos, los modales). El problema que resuelven, en iOS Safari: al abrirse
 * el teclado, el navegador desplaza la página para mostrar el campo enfocado y
 * un elemento `position: fixed` pegado arriba (la barra de búsqueda) queda
 * fuera de la zona visible. Se combina:
 *  - `useBodyScrollLock`: fija el body para que la página de atrás no pueda
 *    desplazarse;
 *  - `useVisualViewportBox`: medidas del área REALMENTE visible (sin el
 *    teclado), para ajustar el overlay a ella;
 *  - `useEsMobile`: para aplicar todo esto sólo en pantallas chicas.
 */
import { useEffect, useState } from 'react';

/**
 * `overflow: hidden` en el body no alcanza en iOS (Safari/PWA instalada): el
 * touch-scroll de la página de atrás sigue andando. Fijar el body con
 * `position: fixed` sí lo bloquea; se restaura el scroll al soltar.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
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
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [active]);
}

export interface VisualViewportBox {
  top: number;
  height: number;
}

/** Área visible del viewport (descontado el teclado). null si está inactivo o el navegador no tiene `visualViewport`. */
export function useVisualViewportBox(active: boolean): VisualViewportBox | null {
  const [box, setBox] = useState<VisualViewportBox | null>(null);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!active || !vv) {
      setBox(null);
      return;
    }
    const actualizar = () => setBox({ top: vv.offsetTop, height: vv.height });
    actualizar();
    vv.addEventListener('resize', actualizar);
    vv.addEventListener('scroll', actualizar);
    return () => {
      vv.removeEventListener('resize', actualizar);
      vv.removeEventListener('scroll', actualizar);
      setBox(null);
    };
  }, [active]);

  return box;
}

/** ¿Coincide la media query? (por defecto: pantallas chicas, < sm de Tailwind). false en SSR o sin `matchMedia`. */
export function useEsMobile(query = '(max-width: 639px)'): boolean {
  const [es, setEs] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const actualizar = () => setEs(mql.matches);
    actualizar();
    mql.addEventListener('change', actualizar);
    return () => mql.removeEventListener('change', actualizar);
  }, [query]);

  return es;
}
