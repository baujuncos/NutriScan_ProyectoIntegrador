type Accent = 'blue' | 'green' | 'teal' | 'indigo';

interface KpiCardProps {
  value: string;
  label: string;
  sublabel?: string;
  icon: React.ReactNode;
  accent?: Accent;
}

const ACCENTS: Record<Accent, string> = {
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-emerald-50 text-emerald-600',
  teal: 'bg-teal-50 text-teal-600',
  indigo: 'bg-indigo-50 text-indigo-600',
};

/** A KPI metric card: tinted icon chip, big value, label + sublabel. */
export default function KpiCard({ value, label, sublabel, icon, accent = 'blue' }: KpiCardProps) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 transition-shadow hover:shadow-md">
      <div className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl ${ACCENTS[accent]}`}>
        {icon}
      </div>
      <p className="text-3xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-sm font-medium text-slate-700">{label}</p>
      {sublabel && <p className="text-xs text-slate-500">{sublabel}</p>}
    </div>
  );
}
