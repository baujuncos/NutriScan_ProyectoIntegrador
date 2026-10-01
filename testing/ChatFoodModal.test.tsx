import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatFoodModal from '@/app/alimentacion/ChatFoodModal';
import { MealChatError, type ChatMessage, type MealChatService } from '@/lib/chatFood';

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

// NUT-189 — Con un servicio falso inyectado (no usa red ni cuota de Gemini).
describe('ChatFoodModal — preguntas aclaratorias, errores y macros (NUT-189)', () => {
  type Reply = Awaited<ReturnType<MealChatService['sendMessage']>>;

  function fakeService(...steps: (Reply | Error)[]) {
    const sendMessage = vi.fn(async (history: ChatMessage[]) => {
      void history;
      const step = steps.shift();
      if (!step) throw new Error('sin respuestas');
      if (step instanceof Error) throw step;
      return step;
    });
    return { sendMessage };
  }

  async function send(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.type(screen.getByPlaceholderText(INPUT_PLACEHOLDER), text);
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
  }

  const completeReply: Reply = {
    status: 'complete',
    message: 'Te anoté la comida.',
    result: {
      alimentos: [
        {
          alimento: 'Banana', cantidad: '120 g', confidence: 0.9, macroSource: 'sara2',
          macros: { kcal: 110.4, proteinas_g: 1.44, carbs_g: 24.48, grasas_g: 0.24 },
        },
        {
          alimento: 'Empanada de carne', cantidad: '240 g', confidence: 0.5, macroSource: 'estimado_ia',
          macros: { kcal: 600, proteinas_g: 25.2, carbs_g: 64.8, grasas_g: 26.4 },
        },
      ],
      totalGramos: 360,
      totalMacros: { kcal: 710.4, proteinas_g: 26.64, carbs_g: 89.28, grasas_g: 26.64 },
    },
  };

  it('needs_clarification: muestra la pregunta y deja el input habilitado sin habilitar confirmar', async () => {
    const service = fakeService({ status: 'needs_clarification', message: '¿Cuántas empanadas comiste?' });
    const { user } = renderModal({ service });
    await send(user, 'comí empanadas');

    expect(await screen.findByText('¿Cuántas empanadas comiste?')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(INPUT_PLACEHOLDER)).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Confirmar y guardar registro' })).toBeDisabled();
  });

  it('off_topic: muestra el mensaje y permite seguir escribiendo', async () => {
    const service = fakeService({ status: 'off_topic', message: 'Solo puedo ayudarte a registrar lo que comiste.' });
    const { user } = renderModal({ service });
    await send(user, '¿capital de Francia?');

    expect(await screen.findByText('Solo puedo ayudarte a registrar lo que comiste.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(INPUT_PLACEHOLDER)).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Confirmar y guardar registro' })).toBeDisabled();
  });

  it('complete: muestra totales, marca estimados y baja confianza, y habilita confirmar', async () => {
    const service = fakeService(completeReply);
    const { user, onConfirm } = renderModal({ service });
    await send(user, 'banana y 3 empanadas');

    expect(await screen.findByText(/Total: 710 kcal/)).toBeInTheDocument();
    expect(screen.getByText(/Proteínas 27 g · Carbohidratos 89 g · Grasas 27 g/)).toBeInTheDocument();
    expect(screen.getAllByText('Estimado')).toHaveLength(1);
    expect(screen.getAllByText(/Revisá este dato/)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Confirmar y guardar registro' }));
    expect(onConfirm).toHaveBeenCalledWith(completeReply.result);
  });

  it('error reintentable: "Reintentar" reenvía el mismo historial sin duplicar el mensaje', async () => {
    const service = fakeService(
      new MealChatError('AI_UNAVAILABLE', 'El asistente no está disponible en este momento.', true),
      { status: 'needs_clarification', message: '¿De qué eran?' },
    );
    const { user } = renderModal({ service });
    await send(user, 'comí empanadas');

    expect(await screen.findByRole('alert')).toHaveTextContent('El asistente no está disponible');
    expect(screen.getByPlaceholderText(INPUT_PLACEHOLDER)).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('¿De qué eran?')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByText('comí empanadas')).toHaveLength(1);

    const [first, second] = service.sendMessage.mock.calls.map(([history]) => history);
    expect(second).toEqual(first);
  });

  it('error no reintentable: ofrece empezar de nuevo y vuelve al saludo', async () => {
    const service = fakeService(new MealChatError('UNAUTHORIZED', 'Tu sesión venció.', false));
    const { user } = renderModal({ service });
    await send(user, 'comí una banana');

    expect(await screen.findByRole('alert')).toHaveTextContent('Tu sesión venció.');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Empezar de nuevo' }));

    expect(screen.queryByText('comí una banana')).not.toBeInTheDocument();
    expect(screen.getByText(/Contame qué comiste/)).toBeInTheDocument();
  });

  it('un error inesperado (no MealChatError) muestra un mensaje genérico', async () => {
    const service = fakeService(new TypeError('boom'));
    const { user } = renderModal({ service });
    await send(user, 'comí una banana');
    expect(await screen.findByRole('alert')).toHaveTextContent('Algo salió mal');
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  });

  it('no envía dos veces con Enter + click seguidos', async () => {
    const service = fakeService({ status: 'needs_clarification', message: '¿Cuántas?' });
    const { user } = renderModal({ service });
    const input = screen.getByPlaceholderText(INPUT_PLACEHOLDER);
    await user.type(input, 'comí empanadas{Enter}');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    await screen.findByText('¿Cuántas?');
    expect(service.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('limita el mensaje a 500 caracteres y muestra el contador', async () => {
    const { user } = renderModal({ service: fakeService() });
    const input = screen.getByPlaceholderText(INPUT_PLACEHOLDER);
    expect(input).toHaveAttribute('maxLength', '500');
    expect(screen.getByText('0/500')).toBeInTheDocument();
    await user.type(input, 'hola');
    expect(screen.getByText('4/500')).toBeInTheDocument();
  });

  it('al cerrar y volver a abrir arranca con el saludo inicial', async () => {
    const service = fakeService({ status: 'needs_clarification', message: '¿Cuántas?' });
    const onClose = vi.fn();
    const { rerender } = render(<ChatFoodModal open onClose={onClose} onConfirm={vi.fn()} service={service} />);
    const user = userEvent.setup();
    await send(user, 'comí empanadas');
    await screen.findByText('¿Cuántas?');

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    rerender(<ChatFoodModal open={false} onClose={onClose} onConfirm={vi.fn()} service={service} />);
    rerender(<ChatFoodModal open onClose={onClose} onConfirm={vi.fn()} service={service} />);

    expect(screen.getByText(/Contame qué comiste/)).toBeInTheDocument();
    expect(screen.queryByText('comí empanadas')).not.toBeInTheDocument();
  });
});
