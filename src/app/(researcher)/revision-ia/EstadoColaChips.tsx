import Link from 'next/link';
import type { ConteosRevision } from '@/lib/revisionIaQuery';

const KPIS: Array<{ estado: keyof ConteosRevision; etiqueta: string; clase: string }> = [
  { estado: 'pendiente', etiqueta: 'Pendientes', clase: 'bg-amber-50 text-amber-800' },
  { estado: 'confirmado', etiqueta: 'Confirmados', clase: 'bg-emerald-50 text-emerald-800' },
  { estado: 'corregido', etiqueta: 'Corregidos', clase: 'bg-blue-50 text-blue-800' },
];

interface Props {
  conteos: ConteosRevision;
  /** Link de cada chip (la Cola filtra por estado; Métricas lleva a la Cola ya filtrada). */
  hrefDe: (estado: keyof ConteosRevision) => string;
  /** Estado resaltado, si la pantalla filtra por estado. */
  activo?: keyof ConteosRevision | 'todos';
}

/** Estado de la cola de revisión (pendientes / confirmados / corregidos): acciones del encabezado de Cola y Métricas. */
export default function EstadoColaChips({ conteos, hrefDe, activo }: Props) {
  return (
    <nav aria-label="Estado de la cola de revisión" className="flex gap-2">
      {KPIS.map((k) => (
        <Link
          key={k.estado}
          href={hrefDe(k.estado)}
          aria-current={activo === k.estado ? 'true' : undefined}
          className={`min-w-[6.5rem] rounded-xl px-4 py-2.5 ${k.clase} ${activo === k.estado ? 'ring-2 ring-current' : ''}`}
        >
          <span className="block text-xl font-bold leading-tight">{conteos[k.estado]}</span>
          <span className="block text-xs font-medium">{k.etiqueta}</span>
        </Link>
      ))}
    </nav>
  );
}
