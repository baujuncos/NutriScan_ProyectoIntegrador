/**
 * Modal base: tamaños, pie de acciones, cierre con Esc y clic afuera, foco atrapado y devuelto.
 */
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from '@/components/ui/Modal';

function Demo({ onClose = vi.fn(), ...props }: Partial<React.ComponentProps<typeof Modal>> & { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      <Modal open={open} onClose={() => { onClose(); setOpen(false); }} title="Título" {...props}>
        <input aria-label="Campo" />
      </Modal>
    </>
  );
}

describe('Modal base', () => {
  it('está nombrado por su título y muestra el pie de acciones', async () => {
    render(<Demo footer={<button>Guardar</button>} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(screen.getByRole('dialog', { name: 'Título' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
  });

  it('tamaños: md por defecto, wide = lg, size manda sobre wide', async () => {
    const ancho = async (props: object) => {
      const { unmount } = render(<Demo {...props} />);
      await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
      const clase = screen.getByRole('dialog').firstElementChild!.className;
      unmount();
      return clase;
    };
    expect(await ancho({})).toContain('max-w-lg');
    expect(await ancho({ wide: true })).toContain('max-w-3xl');
    expect(await ancho({ size: 'sm' })).toContain('max-w-sm');
    expect(await ancho({ size: 'xl', wide: true })).toContain('max-w-5xl');
  });

  it('Esc y clic afuera lo cierran; clic adentro no', async () => {
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    await userEvent.click(screen.getByLabelText('Campo'));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    await userEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('atrapa el foco al abrir y lo devuelve al botón que lo abrió', async () => {
    render(<Demo />);
    const abrir = screen.getByRole('button', { name: 'Abrir' });
    await userEvent.click(abrir);
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard('{Escape}');
    expect(abrir).toHaveFocus();
  });
});
