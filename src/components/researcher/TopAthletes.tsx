import Avatar from './Avatar';

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

function complianceTone(pct: number): string {
  if (pct >= 80) return 'bg-emerald-50 text-emerald-700';
  if (pct >= 50) return 'bg-amber-50 text-amber-700';
  return 'bg-rose-50 text-rose-700';
}

/** Top 5 athletes ranked by weekly compliance. */
export default function TopAthletes({ athletes }: { athletes: TopAthlete[] }) {
  if (athletes.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-slate-500">
        No hay deportistas para rankear todavía.
      </div>
    );
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
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${complianceTone(a.compliance)}`}
          >
            {a.compliance}%
          </span>
        </li>
      ))}
    </ul>
  );
}
