/**
 * Íconos de línea compartidos por el flujo de "Reconocimiento por IA"
 * (sesión 2, NUT-169/170/171). Reemplazan los emojis usados antes: el
 * mockup usa íconos, no emojis, y el resto del sistema de diseño ya sigue
 * ese patrón (ver los SVG inline de `Modal.tsx`/`Button.tsx`).
 */

type IconProps = { className?: string };

export function IconSparkle({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2l1.8 5.6L19.4 9.4 13.8 11.2 12 16.8l-1.8-5.6L4.6 9.4l5.6-1.8L12 2Z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
    </svg>
  );
}

export function IconRuler({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <rect x="3" y="8" width="18" height="8" rx="1.5" transform="rotate(-6 12 12)" />
      <path strokeLinecap="round" d="M7 9.5 8 12M11 9 12 11.5M15 8.5 16 11" />
    </svg>
  );
}

export function IconRepeat({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 2.1 21 6l-4 3.9M3 11V9a4 4 0 0 1 4-4h14M7 21.9 3 18l4-3.9M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

export function IconSearch({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function IconTrash({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </svg>
  );
}

export function IconCheck({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function IconCamera({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8a2 2 0 0 1 2-2h1.2a2 2 0 0 0 1.66-.89l.68-1.02A2 2 0 0 1 11.2 3h1.6a2 2 0 0 1 1.66.89l.68 1.02A2 2 0 0 0 16.8 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

export function IconImage({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m4 17 5-5 3.5 3.5L17 11l4 4" />
    </svg>
  );
}
