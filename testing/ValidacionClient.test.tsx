/**
 * NUT-119 — Pantalla /validacion: listado, filtros, paginación y apertura del detalle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const replaceMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: replaceMock }) }));
vi.mock('@/app/(researcher)/validacion/actions', () => ({
  getPendienteDetalleAction: vi.fn().mockResolvedValue({ error: 'no usado' }),
  buscarAlimentosPropiosAction: vi.fn().mockResolvedValue([]),
  modificarPendienteAction: vi.fn(),
  validarPendienteAction: vi.fn(),
  descartarPendienteAction: vi.fn(),
}));
vi.mock('@/app/alimentacion/actions', () => ({ searchAlimentosAction: vi.fn().mockResolvedValue([]) }));

import ValidacionClient from '@/app/(researcher)/validacion/ValidacionClient';
import { getPendienteDetalleAction } from '@/app/(researcher)/validacion/actions';
import { parseParams } from '@/lib/validacionQuery';
import { OCURRENCIA, PENDIENTE } from './fixtures/validacion';

const otra = {
  ...PENDIENTE,
  id_pendiente: 6,
  nombre_original: 'Budín',
  ocurrencias: 7,
  estado: 'validado' as const,
  nombre_final: 'Budín de pan',
};

function renderCliente(over: Partial<React.ComponentProps<typeof ValidacionClient>> = {}) {
  return render(<ValidacionClient rows={[PENDIENTE, otra]} total={45} params={parseParams({})} {...over} />);
}

describe('ValidacionClient — listado', () => {
  it('muestra nombre, estado, ocurrencias y fecha de cada alimento', () => {
    renderCliente();
    const fila = screen.getByRole('listitem', { name: /Flan casero/ });
    expect(within(fila).getByText('Flan casero')).toBeInTheDocument();
    expect(within(fila).getByText('Pendiente')).toBeInTheDocument();
    expect(within(fila).getByText('2')).toBeInTheDocument(); // ocurrencias
    expect(within(fila).getByText(/6\/10\/2026/)).toBeInTheDocument();
    // validado: muestra el nombre final y el estado
    const fila2 = screen.getByRole('listitem', { name: /Budín de pan/ });
    expect(within(fila2).getByText('Validado')).toBeInTheDocument();
  });

  it('sin filas muestra un mensaje vacío según el estado', () => {
    renderCliente({ rows: [], total: 0 });
    expect(screen.getByText(/No hay alimentos pendientes/)).toBeInTheDocument();
  });
});

describe('ValidacionClient — filtros (mismo FilterBar que Deportistas)', () => {
  beforeEach(() => replaceMock.mockClear());
  afterEach(() => vi.useRealTimers());

  it('estado, búsqueda y orden vienen precargados desde la querystring, en una sola barra y sin botón "Filtrar"', () => {
    renderCliente({ params: parseParams({ estado: 'validado', q: 'flan', orden: 'ocurrencias' }) });
    const barra = screen.getByRole('search', { name: 'Filtros' });
    expect(barra).not.toHaveAttribute('method');
    expect(screen.getByLabelText('Estado')).toHaveValue('validado');
    expect(screen.getByLabelText('Buscar por nombre')).toHaveValue('flan');
    expect(screen.getByLabelText('Ordenar por')).toHaveValue('ocurrencias');
    for (const l of ['Estado', 'Buscar por nombre', 'Ordenar por']) expect(barra).toContainElement(screen.getByLabelText(l));
    expect(screen.queryByRole('button', { name: 'Filtrar' })).not.toBeInTheDocument();
  });

  it('el estado por defecto es pendiente', () => {
    renderCliente();
    expect(screen.getByLabelText('Estado')).toHaveValue('pendiente');
  });

  it('un select se aplica al cambiar: reescribe la URL y vuelve a la página 1', () => {
    renderCliente({ params: parseParams({ q: 'flan', page: '3' }) });
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'validado' } });
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith('/validacion?estado=validado&q=flan', { scroll: false });
  });

  it('la búsqueda espera ~300 ms antes de tocar la URL', () => {
    vi.useFakeTimers();
    renderCliente();
    fireEvent.change(screen.getByLabelText('Buscar por nombre'), { target: { value: 'fl' } });
    fireEvent.change(screen.getByLabelText('Buscar por nombre'), { target: { value: 'flan' } });
    act(() => void vi.advanceTimersByTime(299));
    expect(replaceMock).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith('/validacion?q=flan', { scroll: false });
  });

  it('"Limpiar" sólo aparece con filtros distintos de los de por defecto y vuelve a ellos', async () => {
    const { unmount } = renderCliente();
    expect(screen.queryByRole('button', { name: 'Limpiar' })).not.toBeInTheDocument();
    unmount();
    renderCliente({ params: parseParams({ estado: 'todos', q: 'flan' }) });
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(replaceMock).toHaveBeenCalledWith('/validacion', { scroll: false });
  });

  it('tiene encabezado estándar con el botón de ayuda', () => {
    renderCliente();
    expect(screen.getByRole('heading', { level: 1, name: 'Validación de alimentos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ayuda sobre esta pantalla' })).toBeInTheDocument();
  });
});
