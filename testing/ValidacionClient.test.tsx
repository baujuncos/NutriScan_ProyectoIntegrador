/**
 * NUT-119 — Pantalla /validacion: listado, filtros, paginación y apertura del detalle.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/(researcher)/validacion/actions', () => ({
  getPendienteDetalleAction: vi.fn().mockResolvedValue({ error: 'no usado' }),
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

describe('ValidacionClient — filtros', () => {
  it('es un form GET con estado, búsqueda y orden precargados desde la querystring', () => {
    renderCliente({ params: parseParams({ estado: 'validado', q: 'flan', orden: 'ocurrencias' }) });
    expect(screen.getByRole('search')).toHaveAttribute('method', 'get');
    expect(screen.getByLabelText('Estado')).toHaveValue('validado');
    expect(screen.getByLabelText('Buscar por nombre')).toHaveValue('flan');
    expect(screen.getByLabelText('Ordenar por')).toHaveValue('ocurrencias');
    expect(screen.getByRole('button', { name: 'Filtrar' })).toBeInTheDocument();
  });

  it('el estado por defecto es pendiente', () => {
    renderCliente();
    expect(screen.getByLabelText('Estado')).toHaveValue('pendiente');
  });
});

describe('ValidacionClient — paginación del lado del servidor', () => {
  it('muestra "Página X de Y" con links que conservan los filtros', () => {
    renderCliente({ total: 45, params: parseParams({ page: '2', q: 'flan' }) });
    expect(screen.getByText('Página 2 de 3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Anterior' })).toHaveAttribute('href', '/validacion?q=flan');
    expect(screen.getByRole('link', { name: 'Siguiente' })).toHaveAttribute('href', '/validacion?q=flan&page=3');
  });

  it('en la primera página no hay "Anterior"; en la última no hay "Siguiente"', () => {
    const { unmount } = renderCliente({ total: 45, params: parseParams({}) });
    expect(screen.queryByRole('link', { name: 'Anterior' })).not.toBeInTheDocument();
    unmount();
    renderCliente({ total: 45, params: parseParams({ page: '3' }) });
    expect(screen.queryByRole('link', { name: 'Siguiente' })).not.toBeInTheDocument();
  });

  it('con una sola página no muestra la navegación', () => {
    renderCliente({ total: 2 });
    expect(screen.queryByText(/Página/)).not.toBeInTheDocument();
  });
});

describe('ValidacionClient — detalle', () => {
  it('"Revisar" abre el detalle de ese alimento', async () => {
    vi.mocked(getPendienteDetalleAction).mockResolvedValueOnce({
      ok: true,
      pendiente: PENDIENTE,
      ocurrencias: [OCURRENCIA],
      totalOcurrencias: 2,
    });
    const user = userEvent.setup();
    renderCliente();
    await user.click(screen.getByRole('button', { name: 'Revisar Flan casero' }));
    expect(getPendienteDetalleAction).toHaveBeenCalledWith(5);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByLabelText('Nombre')).toHaveValue('Flan casero');
  });
});
