/** Tarjeta base del panel: fondo blanco, radio, sombra y ring (el patrón de Dashboard y Deportistas). */
export const CARD_CLASS = 'rounded-2xl bg-white shadow-sm ring-1 ring-slate-100';

export default function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`${CARD_CLASS} ${className}`}>{children}</div>;
}
