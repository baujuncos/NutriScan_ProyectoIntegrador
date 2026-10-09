'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

const COLORS = {
  basquet: '#2563eb',
  hockey: '#16a34a',
} as const;

interface SportDonutProps {
  basquet: number;
  hockey: number;
}

/** Donut chart of athlete distribution between basketball and hockey. */
export default function SportDonut({ basquet, hockey }: SportDonutProps) {
  const data = [
    { name: 'Básquet', value: basquet, color: COLORS.basquet },
    { name: 'Hockey', value: hockey, color: COLORS.hockey },
  ];
  const total = basquet + hockey;

  if (total === 0) {
    return <EmptyState />;
  }

  return (
    <div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={256}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="58%"
              outerRadius="85%"
              paddingAngle={2}
              stroke="none"
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [`${value ?? 0} deportistas`, name ?? '']}
              contentStyle={{
                borderRadius: 12,
                border: '1px solid #e2e8f0',
                fontSize: 13,
                boxShadow: '0 4px 12px rgba(15,23,42,0.08)',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-center justify-center gap-6">
        {data.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2 text-sm text-slate-600">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="font-medium">{entry.name}</span>
            <span className="text-slate-500">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-slate-500">
      Sin datos de deportistas todavía
    </div>
  );
}
