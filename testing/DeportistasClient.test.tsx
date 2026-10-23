/**
 * Pantalla Deportistas (la referencia de filtros): filtra en memoria, sin botón
 * "Filtrar", búsqueda al instante, "Limpiar", ayuda "i" y estado vacío.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/app/(researcher)/deportistas/actions', () => ({ generateExcelAction: vi.fn(), getAthleteDetailAction: vi.fn() }));
vi.mock('recharts', () => {
  const Vacio = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Radar: Vacio, RadarChart: Vacio, PolarGrid: Vacio, PolarAngleAxis: Vacio, ResponsiveContainer: Vacio, BarChart: Vacio, Bar: Vacio, XAxis: Vacio, YAxis: Vacio, Tooltip: Vacio, Cell: Vacio };
});

import DeportistasClient from '@/app/(researcher)/deportistas/DeportistasClient';
import type { AthleteRow } from '@/components/researcher/AthletesTable';

const fila = (over: Partial<AthleteRow>): AthleteRow => ({
  user_id: 'u',
  nombre: 'Ana',
  apellido: 'Pérez',
  email: 'ana@ucc.edu.ar',
  created_at: '2026-09-01T00:00:00Z',
  sexo: 'F',
  deporte: 'hockey',
  compliance: 85,
  unidad_academica: 'Ciencias de la Salud',
  carrera: 'Nutrición',
  anio: 2024,
  ...over,
});

const ATLETAS = [
  fila({ user_id: '1' }),
  fila({ user_id: '2', nombre: 'Bruno', apellido: 'Gómez', email: 'bruno@ucc.edu.ar', deporte: 'basquet', sexo: 'M', compliance: 40, carrera: 'Kinesiología', anio: 2023 }),
  fila({ user_id: '3', nombre: 'Carla', apellido: 'Ruiz', email: 'carla@ucc.edu.ar', compliance: 60, unidad_academica: 'Ingeniería', carrera: 'Sistemas', anio: 2023 }),
];

const renderPantalla = (athletes = ATLETAS) => render(<DeportistasClient athletes={athletes} />);

describe('Deportistas', () => {
  it('tiene encabezado estándar con el botón de ayuda y ningún botón "Filtrar"', () => {
    renderPantalla();
    expect(screen.getByRole('heading', { level: 1, name: 'Deportistas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ayuda sobre esta pantalla' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^filtrar$/i })).not.toBeInTheDocument();
  });

  it('todos los filtros (búsqueda incluida) están en la misma barra', () => {
    renderPantalla();
    const barra = screen.getByRole('search', { name: 'Filtros' });
    for (const l of ['Buscar', 'Unidad académica', 'Carrera', 'Año ingreso', 'Deporte']) expect(barra).toContainElement(screen.getByLabelText(l));
  });

  it('un select filtra apenas cambia', () => {
    renderPantalla();
    fireEvent.change(screen.getByLabelText('Deporte'), { target: { value: 'basquet' } });
    expect(screen.getByText('Bruno Gómez')).toBeInTheDocument();
    expect(screen.queryByText('Ana Pérez')).not.toBeInTheDocument();
    expect(screen.getByText('1 de 3 deportistas')).toBeInTheDocument();
  });

  it('la búsqueda filtra al instante (en memoria, sin esperar)', () => {
    renderPantalla();
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'car' } });
    expect(screen.getByText('Carla Ruiz')).toBeInTheDocument();
    expect(screen.queryByText('Ana Pérez')).not.toBeInTheDocument();
  });

  it('cambiar la unidad académica reinicia la carrera', () => {
    renderPantalla();
    fireEvent.change(screen.getByLabelText('Unidad académica'), { target: { value: 'Ciencias de la Salud' } });
    fireEvent.change(screen.getByLabelText('Carrera'), { target: { value: 'Kinesiología' } });
    fireEvent.change(screen.getByLabelText('Unidad académica'), { target: { value: 'Ingeniería' } });
    expect(screen.getByLabelText('Carrera')).toHaveValue('');
  });

  it('"Limpiar" aparece con filtros activos y los saca todos', async () => {
    renderPantalla();
    expect(screen.queryByRole('button', { name: 'Limpiar' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Deporte'), { target: { value: 'basquet' } });
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(screen.getByLabelText('Deporte')).toHaveValue('');
    expect(screen.getByText('3 deportistas registrados')).toBeInTheDocument();
  });

  it('sin coincidencias muestra el vacío con la acción de limpiar; sin deportistas, otro mensaje', () => {
    const { unmount } = renderPantalla();
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'zzz' } });
    expect(screen.getByText('No se encontraron deportistas con los filtros aplicados.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpiar filtros' })).toBeInTheDocument();
    unmount();
    renderPantalla([]);
    expect(screen.getByText('No hay deportistas registrados aún.')).toBeInTheDocument();
  });

  it('los badges de deporte y cumplimiento usan StatusBadge (mismo estilo en todo el panel)', () => {
    renderPantalla();
    expect(within(screen.getByText('Ana Pérez').closest('tr')!).getByText('Hockey').className).toMatch(/rounded-full/);
    expect(screen.getByText('85%').className).toContain('text-emerald-800');
    expect(screen.getByText('40%').className).toContain('text-rose-800');
  });
});
