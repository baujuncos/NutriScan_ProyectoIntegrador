'use client';

/**
 * Foco atrapado para overlays (modales, panel de ayuda): al activarse mueve el
 * foco adentro (salvo que ya esté ahí, ej. un `autoFocus`), Tab / Shift+Tab
 * ciclan dentro del contenedor y, al desactivarse, el foco vuelve al elemento
 * que lo tenía antes de abrir (normalmente el botón que lo abrió).
 */
import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusables = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getAttribute('aria-hidden') !== 'true');

export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const root = containerRef.current;
    if (!active || !root) return;

    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!root.contains(document.activeElement)) (focusables(root)[0] ?? root).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables(root);
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const primero = items[0];
      const ultimo = items[items.length - 1];
      const actual = document.activeElement;
      if (e.shiftKey && (actual === primero || !root.contains(actual))) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (actual === ultimo || !root.contains(actual))) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // El overlay puede desmontarse junto con su contenido: se devuelve el foco si el elemento sigue en pantalla.
      if (previo && previo.isConnected) previo.focus();
    };
  }, [containerRef, active]);
}
