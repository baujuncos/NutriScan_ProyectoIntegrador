/**
 * NUT-149 — "Ejemplo para la IA": etiqueta visible, dos estados, y la ayuda que se abre con clic o
 * teclado (no depende del hover), se cierra con Esc y no cierra el modal que la contiene.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AyudaEjemploIa, EjemploIaCasilla, EjemploIaToggle } from '@/app/(researcher)/revision-ia/EjemploParaIa';
import Modal from '@/components/ui/Modal';
import { EJEMPLO_IA_AYUDA, EJEMPLO_IA_TITULO, HELP } from '@/components/researcher/helpContent';

const ayuda = () => screen.getByRole('button', { name: 'Qué significa Ejemplo para la IA' });

describe('EjemploIaToggle (tarjeta)', () => {
  it('es un control con texto (estrella + "Ejemplo para la IA"), no un ícono sin explicación', () => {
    render(<EjemploIaToggle marcado={false} onToggle={vi.fn()} contexto="Empanada" />);
    const boton = screen.getByRole('button', { name: 'Ejemplo para la IA: Empanada' });
    expect(boton).toHaveTextContent('Ejemplo para la IA');
    expect(boton).toHaveTextContent('☆');
  });

  it('tiene dos estados visibles con el aria-pressed correcto', () => {
    const { rerender } = render(<EjemploIaToggle marcado={false} onToggle={vi.fn()} />);
    const sin = screen.getByRole('button', { name: 'Ejemplo para la IA' });
    expect(sin).toHaveAttribute('aria-pressed', 'false');
    expect(sin).toHaveTextContent('☆');
    const claseSin = sin.className;

    rerender(<EjemploIaToggle marcado onToggle={vi.fn()} />);
    const con = screen.getByRole('button', { name: 'Ejemplo para la IA' });
    expect(con).toHaveAttribute('aria-pressed', 'true');
    expect(con).toHaveTextContent('★');
    expect(con.className).not.toBe(claseSin); // se ve distinto
  });

  it('al tocarlo llama a onToggle; deshabilitado no', async () => {
    const onToggle = vi.fn();
    const { rerender } = render(<EjemploIaToggle marcado={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ejemplo para la IA' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<EjemploIaToggle marcado={false} onToggle={onToggle} disabled />);
    await userEvent.click(screen.getByRole('button', { name: 'Ejemplo para la IA' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('el ícono de ayuda va al lado, con la explicación', async () => {
    render(<EjemploIaToggle marcado={false} onToggle={vi.fn()} />);
    expect(ayuda()).toBeInTheDocument();
  });
});

describe('EjemploIaCasilla (modal)', () => {
  it('es una casilla con la misma etiqueta y la misma ayuda', async () => {
    const onToggle = vi.fn();
    render(<EjemploIaCasilla marcado onToggle={onToggle} />);
    const casilla = screen.getByRole('checkbox', { name: 'Ejemplo para la IA' });
    expect(casilla).toBeChecked();
    await userEvent.click(casilla);
    expect(onToggle).toHaveBeenCalledTimes(1);
    await userEvent.click(ayuda());
    expect(screen.getByRole('region', { name: 'Ejemplo para la IA' })).toHaveTextContent(EJEMPLO_IA_AYUDA);
  });
});

describe('AyudaEjemploIa (popover)', () => {
  it('arranca cerrada y se abre con clic, mostrando la explicación', async () => {
    render(<AyudaEjemploIa />);
    expect(ayuda()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    await userEvent.click(ayuda());
    expect(ayuda()).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('region', { name: 'Ejemplo para la IA' });
    expect(panel).toHaveTextContent('error claro y típico de la IA');
    expect(panel).toHaveTextContent('Marcarlo no cambia nada por sí solo');
    expect(ayuda()).toHaveAttribute('aria-controls', panel.id);
  });

  it('se abre y se cierra con el teclado (Enter / Espacio) y Esc la cierra devolviendo el foco', async () => {
    render(<AyudaEjemploIa />);
    ayuda().focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('region')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(ayuda()).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(screen.getByRole('region')).toBeInTheDocument();
    await userEvent.keyboard(' ');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('un clic afuera la cierra', async () => {
    render(
      <>
        <AyudaEjemploIa />
        <button>Afuera</button>
      </>,
    );
    await userEvent.click(ayuda());
    await userEvent.click(screen.getByRole('button', { name: 'Afuera' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('dentro de un modal, Esc cierra sólo la ayuda; un segundo Esc cierra el modal', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Modal">
        <EjemploIaCasilla marcado={false} onToggle={vi.fn()} />
      </Modal>,
    );
    await userEvent.click(ayuda());
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('guía de la pestaña', () => {
  it('usa el mismo nombre y el mismo texto que el control', () => {
    const guia = HELP['revision-cola'];
    expect(guia.glosario).toContainEqual({ termino: EJEMPLO_IA_TITULO, definicion: EJEMPLO_IA_AYUDA });
    expect(JSON.stringify(guia)).toContain('Ejemplo para la IA');
    expect(JSON.stringify(HELP)).not.toMatch(/candidato/i);
  });
});
