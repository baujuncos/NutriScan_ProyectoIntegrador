export type BadgeTone = 'amber' | 'emerald' | 'blue' | 'violet' | 'red' | 'rose' | 'slate';

// Fondo -50 y texto -800 (contraste AA sobre el fondo); slate para estados neutros.
const TONES: Record<BadgeTone, string> = {
  amber: 'bg-amber-50 text-amber-800',
  emerald: 'bg-emerald-50 text-emerald-800',
  blue: 'bg-blue-50 text-blue-800',
  violet: 'bg-violet-50 text-violet-800',
  red: 'bg-red-50 text-red-800',
  rose: 'bg-rose-50 text-rose-800',
  slate: 'bg-slate-100 text-slate-700',
};

interface Props {
  tone: BadgeTone;
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

/** Etiqueta de estado / categoría con la misma forma y tamaño en todo el panel. */
export default function StatusBadge({ tone, children, icon, className = '' }: Props) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${TONES[tone]} ${className}`}>
      {icon}
      {children}
    </span>
  );
}
