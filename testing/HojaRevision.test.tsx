/**
 * NUT-119 — Contenedor del "Revisar alimento": cabecera con subtítulo y aviso "Sin guardar",
 * cuerpo con scroll y pie fijo. En el celular es una hoja inferior; en escritorio, un modal centrado.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HojaRevision from '@/app/(researcher)/validacion/HojaRevision';

const base = {
  open: true,
  onClose: vi.fn(),
  titulo: 'Revisar alimento',
  subtitulo: 'Confirmá el nombre y elegí de dónde salen los valores nutricionales.',
  pie: <button type="button">Validar</button>,
};

describe('HojaRevision', () => {
  it('es un diálogo modal con nombre accesible, subtítulo, cuerpo y pie', () => {
    render(<HojaRevision {...base}>contenido</HojaRevision>);
    const dialogo = screen.getByRole('dialog', { name: 'Revisar alimento' });
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    expect(within(dialogo).getByText(/Confirmá el nombre/)).toBeInTheDocument();
    expect(within(dialogo).getByText('contenido')).toBeInTheDocument();
    expect(within(dialogo).getByRole('button', { name: 'Validar' })).toBeInTheDocument();
  });

  it('no renderiza nada si está cerrado', () => {
    render(<HojaRevision {...base} open={false}>contenido</HojaRevision>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('el aviso "Sin guardar" aparece sólo cuando hay cambios', () => {
    const { rerender } = render(<HojaRevision {...base} sinGuardar={false}>x</HojaRevision>);
    expect(screen.queryByText('Sin guardar')).not.toBeInTheDocument();
    rerender(<HojaRevision {...base} sinGuardar>x</HojaRevision>);
    expect(screen.getByText('Sin guardar')).toBeInTheDocument();
  });

  it('se cierra con el botón Cerrar, con Escape y al hacer clic en el fondo, pero no al hacer clic adentro', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<HojaRevision {...base} onClose={onClose}>contenido</HojaRevision>);

    await user.click(screen.getByText('contenido'));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);

    await user.click(screen.getByTestId('hoja-fondo'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
