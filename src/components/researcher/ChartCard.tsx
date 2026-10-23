import Card from './Card';

interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}

/** White rounded card wrapper used around the dashboard charts and lists. */
export default function ChartCard({ title, subtitle, children, className = '' }: ChartCardProps) {
  return (
    <Card className={`p-5 sm:p-6 ${className}`}>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </Card>
  );
}
