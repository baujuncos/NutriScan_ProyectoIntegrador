import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/antropometrias' }));

import AntropometriasClient from '@/app/(researcher)/antropometrias/AntropometriasClient';
import type { PacienteListado } from '@/lib/researcher/antropometria/listado';

const base = { fechaNacimiento: '2000-01-01', sexo: 'F' as const };
const PACIENTES: PacienteListado[] = [
  { ...base, origen: 'deportista', id: 'd1', nombre: 'Lucía', apellido: 'Vega', edad: 26, cantidadMediciones: 2, ultimaMedicion: '2026-10-01' },
  { ...base, origen: 'manual', id: 'm1', nombre: 'Julieta', apellido: 'Marchetti', edad: 24, cantidadMediciones: 0, ultimaMedicion: null },
];

describe('AntropometriasClient', () => {
  it('sin pacientes: estado vacío con botón "Agregar paciente"', () => {
    render(<AntropometriasClient pacientes={[]} />);
    expect(screen.getByRole('heading', { name: 'Antropometrías' })).toBeInTheDocument();
    expect(screen.getByText('Todavía no hay pacientes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agregar paciente' })).toHaveAttribute('href', '/antropometrias/nuevo');
  });

  it('lista origen, cantidad "n de 12" y última medición en formato local', () => {
    render(<AntropometriasClient pacientes={PACIENTES} />);
    const filaLucia = screen.getByRole('row', { name: /Vega, Lucía/ });
    expect(within(filaLucia).getByText('Deportista')).toBeInTheDocument();
    expect(within(filaLucia).getByText('2 de 12')).toBeInTheDocument();
    expect(within(filaLucia).getByText('01/10/2026')).toBeInTheDocument();
    const filaJulieta = screen.getByRole('row', { name: /Marchetti, Julieta/ });
    expect(within(filaJulieta).getByText('Manual')).toBeInTheDocument();
    expect(within(filaJulieta).getByText('Sin mediciones')).toBeInTheDocument();
  });

  it('cada paciente enlaza a su ficha según el origen', () => {
    render(<AntropometriasClient pacientes={PACIENTES} />);
    expect(screen.getByRole('link', { name: 'Vega, Lucía' })).toHaveAttribute('href', '/antropometrias/deportista/d1');
    expect(screen.getByRole('link', { name: 'Marchetti, Julieta' })).toHaveAttribute('href', '/antropometrias/manual/m1');
  });

  it('busca por nombre sin importar tildes ni mayúsculas', async () => {
    render(<AntropometriasClient pacientes={PACIENTES} />);
    await userEvent.type(screen.getByLabelText('Buscar por nombre'), 'LUCIA');
    expect(screen.getByText('Vega, Lucía')).toBeInTheDocument();
    expect(screen.queryByText('Marchetti, Julieta')).not.toBeInTheDocument();
  });

  it('filtra por origen y avisa cuando nadie coincide', async () => {
    render(<AntropometriasClient pacientes={PACIENTES} />);
    await userEvent.selectOptions(screen.getByLabelText('Origen'), 'manual');
    expect(screen.queryByText('Vega, Lucía')).not.toBeInTheDocument();
    expect(screen.getByText('Marchetti, Julieta')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Buscar por nombre'), 'zzz');
    expect(screen.getByText('Ningún paciente coincide con la búsqueda')).toBeInTheDocument();
  });
});
