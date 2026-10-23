/**
 * Dashboard del panel: encabezado estándar con ayuda, tarjetas y vacíos con los componentes compartidos.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const getAthleteData = vi.hoisted(() => vi.fn());
vi.mock('@/lib/researcher/athletes', () => ({ getAthleteData }));
vi.mock('recharts', () => {
  const Vacio = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { ResponsiveContainer: Vacio, PieChart: Vacio, Pie: Vacio, BarChart: Vacio, Bar: Vacio, Cell: Vacio, XAxis: Vacio, YAxis: Vacio, CartesianGrid: Vacio, Tooltip: Vacio, LabelList: Vacio };
});

import DashboardPage from '@/app/(researcher)/dashboard/page';

const atleta = (over: Record<string, unknown>) => ({
  user_id: 'u',
  nombre: 'Ana',
  apellido: 'Pérez',
  deporte: 'hockey',
  sexo: 'F',
  compliance: 90,
  ...over,
});

describe('Dashboard', () => {
  beforeEach(() => getAthleteData.mockReset());

  it('tiene el encabezado estándar con el botón de ayuda', async () => {
    getAthleteData.mockResolvedValue({ athletes: [atleta({})] });
    render(await DashboardPage());
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard Global' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ayuda sobre esta pantalla' })).toBeInTheDocument();
  });

  it('el Top 5 usa los badges estándar según el cumplimiento', async () => {
    getAthleteData.mockResolvedValue({
      athletes: [atleta({ user_id: '1', compliance: 90 }), atleta({ user_id: '2', nombre: 'Bruno', compliance: 60 }), atleta({ user_id: '3', nombre: 'Carla', compliance: 20 })],
    });
    render(await DashboardPage());
    const top = within(screen.getByRole('heading', { name: 'Top 5 deportistas por cumplimiento' }).closest('div')!.parentElement!);
    expect(top.getByText('90%').className).toContain('text-emerald-800');
    expect(top.getByText('60%').className).toContain('text-amber-800');
    expect(top.getByText('20%').className).toContain('text-rose-800');
  });

  it('sin deportistas muestra los vacíos estándar', async () => {
    getAthleteData.mockResolvedValue({ athletes: [] });
    render(await DashboardPage());
    expect(screen.getByText('No hay deportistas para rankear todavía.')).toBeInTheDocument();
    expect(screen.getByText('Sin datos de deportistas todavía')).toBeInTheDocument();
    expect(screen.getByText('Sin registros de comidas esta semana')).toBeInTheDocument();
  });
});
