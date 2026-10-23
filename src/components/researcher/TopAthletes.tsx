import Avatar from './Avatar';
import EmptyState from './EmptyState';
import StatusBadge, { type BadgeTone } from './StatusBadge';

export interface TopAthlete {
  user_id: string;
  nombre: string;
  apellido: string;
  deporte: string | null;
  compliance: number;
}

const DEPORTE_LABELS: Record<string, string> = {
  basquet: 'Básquet',
  hockey: 'Hockey',
};

function complianceTone(pct: number): BadgeTone {
  if (pct >= 80) return 'emerald';
  if (pct >= 50) return 'amber';
  return 'rose';
}

/** Top 5 athletes ranked by weekly compliance. */
export default function TopAthletes({ athletes }: { athletes: TopAthlete[] }) {
  if (athletes.length === 0) {
    return <EmptyState title="No hay deportistas para rankear todavía." />;
  }

  return (
    <ul className="space-y-2">
      {athletes.map((a, idx) => (
        <li
          key={a.user_id}
          className="flex items-center gap-4 rounded-xl px-2 py-2 transition-colors hover:bg-slate-50"
        >
          <span className="w-5 shrink-0 text-center text-sm font-bold text-slate-300">{idx + 1}</span>
          <Avatar nombre={a.nombre} apellido={a.apellido} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">
              {a.nombre} {a.apellido}
            </p>
            <p className="truncate text-xs text-slate-500">
              {a.deporte ? DEPORTE_LABELS[a.deporte] ?? a.deporte : 'Sin deporte'}
            </p>
          </div>
          <div className="hidden w-32 shrink-0 sm:block">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-600 to-emerald-500"
                style={{ width: `${a.compliance}%` }}
              />
            </div>
          </div>
          <StatusBadge tone={complianceTone(a.compliance)} className="shrink-0 font-semibold">
            {a.compliance}%
          </StatusBadge>
        </li>
      ))}
    </ul>
  );
}
