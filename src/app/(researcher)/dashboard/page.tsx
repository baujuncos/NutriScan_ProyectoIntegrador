import { getAthleteData } from '@/lib/researcher/athletes';
import { averageCompliance } from '@/lib/researcher/compliance';
import KpiCard from '@/components/researcher/KpiCard';
import PageHeader from '@/components/researcher/PageHeader';
import ChartCard from '@/components/researcher/ChartCard';
import SportDonut from '@/components/researcher/SportDonut';
import ComplianceBar, { type ComplianceSegment } from '@/components/researcher/ComplianceBar';
import TopAthletes from '@/components/researcher/TopAthletes';

export const dynamic = 'force-dynamic';

const ICONS = {
  users: (
    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
    </svg>
  ),
  activity: (
    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h4l2 7 4-14 2 7h6" />
    </svg>
  ),
  target: (
    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="12" r="8.25" />
      <circle cx="12" cy="12" r="4.75" />
      <circle cx="12" cy="12" r="1.25" />
    </svg>
  ),
  trend: (
    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4 4 8.5-8.5M21.75 6.75H16.5m5.25 0V12" />
    </svg>
  ),
};

export default async function DashboardPage() {
  const { athletes } = await getAthleteData(new Date());

  const total = athletes.length;
  const basquet = athletes.filter((a) => a.deporte === 'basquet');
  const hockey = athletes.filter((a) => a.deporte === 'hockey');
  const femenino = athletes.filter((a) => a.sexo === 'F');
  const masculino = athletes.filter((a) => a.sexo === 'M');

  const avgCompliance = averageCompliance(athletes.map((a) => a.compliance));

  const barData: ComplianceSegment[] = [
    { name: 'Básquet', value: averageCompliance(basquet.map((a) => a.compliance)), color: '#2563eb' },
    { name: 'Hockey', value: averageCompliance(hockey.map((a) => a.compliance)), color: '#16a34a' },
    { name: 'Femenino', value: averageCompliance(femenino.map((a) => a.compliance)), color: '#2563eb' },
    { name: 'Masculino', value: averageCompliance(masculino.map((a) => a.compliance)), color: '#16a34a' },
  ];

  const top5 = [...athletes].sort((a, b) => b.compliance - a.compliance).slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard Global" subtitle="Métricas en tiempo real de la cohorte UCC" helpId="dashboard" />

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          value={String(total)}
          label="Deportistas registrados"
          sublabel="cohorte activa"
          icon={ICONS.users}
          accent="blue"
        />
        <KpiCard
          value={`${basquet.length} / ${hockey.length}`}
          label="Básquet / Hockey"
          sublabel="distribución por deporte"
          icon={ICONS.activity}
          accent="green"
        />
        <KpiCard
          value={`${avgCompliance}%`}
          label="Cumplimiento promedio"
          sublabel="carga de datos"
          icon={ICONS.target}
          accent="teal"
        />
        <KpiCard
          value={`${femenino.length} / ${masculino.length}`}
          label="Femenino / Masculino"
          sublabel="distribución por sexo"
          icon={ICONS.trend}
          accent="indigo"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Distribución por deporte" subtitle="Cantidad de deportistas activos">
          <SportDonut basquet={basquet.length} hockey={hockey.length} />
        </ChartCard>
        <ChartCard title="Cumplimiento de carga de datos" subtitle="% promedio por segmento">
          <ComplianceBar data={barData} />
        </ChartCard>
      </div>

      {/* Top athletes */}
      <ChartCard title="Top 5 deportistas por cumplimiento" subtitle="ranking semanal">
        <TopAthletes athletes={top5} />
      </ChartCard>
    </div>
  );
}
