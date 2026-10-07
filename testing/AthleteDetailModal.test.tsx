/**
 * NUT-119 — El detalle del deportista (vista previa del investigador) muestra,
 * por cada alimento que cargó: kcal y macros, y de dónde salió ese dato
 * (SARA2, ANMAT, IA, validado…).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/app/(researcher)/deportistas/actions', () => ({ getAthleteDetailAction: vi.fn() }));
// recharts no mide nada en jsdom: se reemplaza por contenedores vacíos.
vi.mock('recharts', () => {
  const Vacio = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Radar: Vacio, RadarChart: Vacio, PolarGrid: Vacio, PolarAngleAxis: Vacio, ResponsiveContainer: Vacio,
    BarChart: Vacio, Bar: Vacio, XAxis: Vacio, YAxis: Vacio, Tooltip: Vacio, Cell: Vacio,
  };
});

import AthleteDetailModal from '@/components/researcher/AthleteDetailModal';
import { getAthleteDetailAction } from '@/app/(researcher)/deportistas/actions';
import { todayAR } from '@/lib/date';

const hoy = todayAR();

async function abrir() {
  vi.mocked(getAthleteDetailAction).mockResolvedValue({
    user_id: 'dep-1',
    nombre: 'Ana',
    apellido: 'Pérez',
    email: 'a@ucc.edu.ar',
    physical: null,
    academic: null,
    psychDimensions: [],
    psychScore: null,
    weeklyMeals: [],
    recentIngestas: [
      {
        id_ingesta: 1,
        tipo: 'almuerzo',
        fecha: hoy,
        kcal_total: 800,
        items: [
          { nombre: 'Arroz blanco', cantidad: 150, kcal: 195, macros: { kcal: 195, proteinas: 4, grasas: 0.5, carbs: 42 }, fuente: 'SARA2' },
          { nombre: 'Galletitas', cantidad: 40, kcal: 180, macros: { kcal: 180, proteinas: 2.4, grasas: 7.2, carbs: 26 }, fuente: 'ANMAT' },
          { nombre: 'Flan casero', cantidad: 120, kcal: 180, macros: { kcal: 180, proteinas: 3.6, grasas: 6, carbs: 27.6 }, fuente: 'IA (pendiente de validación)' },
          { nombre: 'Yogur', cantidad: 100, kcal: 60, macros: { kcal: 60, proteinas: 3, grasas: 2, carbs: 8 }, fuente: 'IA (Gemini)' },
          { nombre: 'Budín', cantidad: 80, kcal: 0, macros: null, fuente: 'Descartado' },
        ],
      },
    ],
  });

  render(
    <AthleteDetailModal
      athlete={{
        user_id: 'dep-1', nombre: 'Ana', apellido: 'Pérez', email: 'a@ucc.edu.ar', created_at: '2026-01-01',
        sexo: 'F', deporte: 'hockey', compliance: 80, unidad_academica: null, carrera: null, anio: null,
      }}
      onClose={vi.fn()}
    />,
  );
  await screen.findByText('Arroz blanco');
}

describe('AthleteDetailModal — datos nutricionales de lo que cargó el deportista', () => {
  it('muestra la fuente de cada alimento: SARA2, ANMAT, IA (Gemini), IA pendiente y Descartado', async () => {
    await abrir();
    for (const fuente of ['SARA2', 'ANMAT', 'IA (pendiente de validación)', 'IA (Gemini)', 'Descartado']) {
      expect(screen.getByText(fuente)).toBeInTheDocument();
    }
    expect(screen.getAllByTitle('Fuente del dato nutricional')).toHaveLength(5);
  });

  it('muestra kcal y macros (P / C / G) de cada alimento', async () => {
    await abrir();
    expect(screen.getByText('195 kcal · P 4 g · C 42 g · G 0,5 g')).toBeInTheDocument();
    expect(screen.getByText('180 kcal · P 2,4 g · C 26 g · G 7,2 g')).toBeInTheDocument();
    expect(screen.getByText('60 kcal · P 3 g · C 8 g · G 2 g')).toBeInTheDocument();
  });

  it('un alimento descartado o sin datos no muestra ceros: dice que no hay dato', async () => {
    await abrir();
    expect(screen.getByText('Sin datos nutricionales')).toBeInTheDocument();
    expect(screen.queryByText(/^0 kcal/)).not.toBeInTheDocument();
  });
});
