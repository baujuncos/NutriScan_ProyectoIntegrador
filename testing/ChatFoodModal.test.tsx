import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatFoodModal from '@/app/alimentacion/ChatFoodModal';

beforeAll(() => {
  // jsdom no implementa scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

function renderModal(props: Partial<React.ComponentProps<typeof ChatFoodModal>> = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(<ChatFoodModal open onClose={onClose} onConfirm={onConfirm} {...props} />);
  return { onClose, onConfirm, user: userEvent.setup() };
}

const INPUT_PLACEHOLDER = 'Escribí lo que comiste...';

describe('ChatFoodModal — chat de registro de comida por texto (NUT-187)', () => {
  it('abre con el saludo del asistente y el botón de confirmar deshabilitado', () => {
    renderModal();
    expect(screen.getByText(/Contame qué comiste/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar y guardar registro' })).toBeDisabled();
  });

  it('no deja enviar mensajes vacíos', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Enviar mensaje' })).toBeDisabled();
  });

  it('al enviar un mensaje muestra el indicador de escritura y luego la pregunta aclaratoria', async () => {
    const { user } = renderModal();
    await user.type(screen.getByPlaceholderText(INPUT_PLACEHOLDER), 'Comí 2 empanadas de carne al horno');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));

    expect(screen.getByText('Comí 2 empanadas de carne al horno')).toBeInTheDocument();
    expect(screen.getByText('El asistente está escribiendo')).toBeInTheDocument();

    expect(
      await screen.findByText('¿De qué era el relleno de las empanadas y cuántas comiste?', {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText('El asistente está escribiendo')).not.toBeInTheDocument();
  });

  it('tras la segunda respuesta muestra el resumen estructurado y habilita confirmar', async () => {
    const { user } = renderModal();
    await user.type(screen.getByPlaceholderText(INPUT_PLACEHOLDER), 'Comí 2 empanadas de carne al horno');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    await screen.findByText('¿De qué era el relleno de las empanadas y cuántas comiste?', {}, { timeout: 2000 });

    await user.type(screen.getByPlaceholderText(INPUT_PLACEHOLDER), 'Eran de carne, comí 3');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));

    expect(await screen.findByText('Empanada de carne', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText(/3 unidades/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar y guardar registro' })).toBeEnabled();
    // Con el resultado listo, el input de texto se deshabilita (la conversación terminó).
    expect(screen.getByPlaceholderText(INPUT_PLACEHOLDER)).toBeDisabled();
  });

  it('confirmar entrega el payload estructurado a onConfirm y cierra el chat', async () => {
    const { user, onConfirm } = renderModal();
    await user.type(screen.getByPlaceholderText(INPUT_PLACEHOLDER), 'Comí 2 empanadas de carne al horno');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    await screen.findByText('¿De qué era el relleno de las empanadas y cuántas comiste?', {}, { timeout: 2000 });

    await user.type(screen.getByPlaceholderText(INPUT_PLACEHOLDER), 'Eran de carne, comí 3');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    await screen.findByText('Empanada de carne', {}, { timeout: 2000 });

    await user.click(screen.getByRole('button', { name: 'Confirmar y guardar registro' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        alimentos: [
          expect.objectContaining({ alimento: 'Empanada de carne', cantidad: '3 unidades' }),
        ],
      }),
    );
  });

  it('cancelar llama a onClose sin llamar a onConfirm', async () => {
    const { user, onClose, onConfirm } = renderModal();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
