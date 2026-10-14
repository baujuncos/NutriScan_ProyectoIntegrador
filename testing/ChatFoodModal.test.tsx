import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatFoodModal from '@/app/alimentacion/ChatFoodModal';
import { MealChatError, type ChatMessage, type MealChatService, type MealSaveService } from '@/lib/chatFood';
import { mockMealChatService } from '@/lib/chatFoodService';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));

beforeEach(() => refreshMock.mockClear());

const okSave = (): MealSaveService => ({ save: vi.fn(async () => ({ ok: true as const, mlAgua: 250, itemsDiario: 2, yaGuardado: false })) });

beforeAll(() => {
  // jsdom no implementa scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

function renderModal(props: Partial<React.ComponentProps<typeof ChatFoodModal>> = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(<ChatFoodModal open onClose={onClose} onConfirm={onConfirm} fecha="2026-10-08" tipoIngesta="almuerzo" service={mockMealChatService} saveService={okSave()} {...props} />);
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
          expect.objectContaining({ alimento: 'Banana' }),
          expect.objectContaining({ alimento: 'Agua' }),
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
          alimento: 'Banana', cantidad: '120 g', gramos: 120, unidad: 'g' as const, tipo: 'fruta', idAlimento: 375,
          confidence: 0.9, macroSource: 'sara2' as const,
          macros: { kcal: 110.4, proteinas_g: 1.44, carbs_g: 24.48, grasas_g: 0.24 },
        },
        {
          alimento: 'Empanada de carne', cantidad: '240 g', gramos: 240, unidad: 'g' as const, tipo: 'otro', idAlimento: null,
          confidence: 0.5, macroSource: 'estimado_ia' as const,
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
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ alimentos: completeReply.result!.alimentos, totalGramos: 360 }));
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
    const { rerender } = render(<ChatFoodModal open onClose={onClose} onConfirm={vi.fn()} service={service} fecha="2026-10-08" tipoIngesta="almuerzo" />);
    const user = userEvent.setup();
    await send(user, 'comí empanadas');
    await screen.findByText('¿Cuántas?');

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    rerender(<ChatFoodModal open={false} onClose={onClose} onConfirm={vi.fn()} service={service} fecha="2026-10-08" tipoIngesta="almuerzo" />);
    rerender(<ChatFoodModal open onClose={onClose} onConfirm={vi.fn()} service={service} fecha="2026-10-08" tipoIngesta="almuerzo" />);

    expect(screen.getByText(/Contame qué comiste/)).toBeInTheDocument();
    expect(screen.queryByText('comí empanadas')).not.toBeInTheDocument();
  });
});

// NUT-191 — Editar cantidades, quitar ítems y guardar (con servicios falsos: sin red ni cuota).
describe('ChatFoodModal — editar, quitar y guardar (NUT-191)', () => {
  const threeItems: Awaited<ReturnType<MealChatService['sendMessage']>> = {
    status: 'complete',
    message: 'Te anoté la comida.',
    result: {
      alimentos: [
        { alimento: 'Empanada de carne', cantidad: '240 g', gramos: 240, unidad: 'g', tipo: 'otro', idAlimento: null,
          confidence: 0.7, macroSource: 'estimado_ia', macros: { kcal: 600, proteinas_g: 25.2, carbs_g: 64.8, grasas_g: 26.4 } },
        { alimento: 'Banana', cantidad: '120 g', gramos: 120, unidad: 'g', tipo: 'fruta', idAlimento: 375,
          confidence: 0.9, macroSource: 'sara2', macros: { kcal: 110.4, proteinas_g: 1.44, carbs_g: 24.48, grasas_g: 0.24 } },
        { alimento: 'Agua', cantidad: '250 ml', gramos: 250, unidad: 'ml', tipo: 'bebida', idAlimento: null,
          confidence: 0.9, macroSource: 'estimado_ia', macros: { kcal: 0, proteinas_g: 0, carbs_g: 0, grasas_g: 0 } },
      ],
      totalGramos: 610,
      totalMacros: { kcal: 710.4, proteinas_g: 26.64, carbs_g: 89.28, grasas_g: 26.64 },
    },
  };

  const chatService = (): MealChatService => ({ sendMessage: vi.fn(async () => threeItems) });

  async function openResult(props: Partial<React.ComponentProps<typeof ChatFoodModal>> = {}) {
    const rendered = renderModal({ service: chatService(), ...props });
    await rendered.user.type(screen.getByPlaceholderText(INPUT_PLACEHOLDER), 'empanada, banana y agua');
    await rendered.user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    await screen.findByText(/Total: 710 kcal/);
    return rendered;
  }

  it('editar la cantidad escala las macros y el total, y marca el ítem como editado', async () => {
    const { user } = await openResult();
    await user.click(screen.getByRole('button', { name: 'Editar cantidad de Empanada de carne' }));
    const input = screen.getByLabelText('Cantidad de Empanada de carne en g');
    await user.clear(input);
    await user.type(input, '120');
    await user.click(screen.getByRole('button', { name: 'Guardar cantidad' }));

    expect(screen.getAllByText('· 120 g')).toHaveLength(2); // la empanada editada y la banana (120 g)
    expect(screen.getByText('Editado')).toBeInTheDocument();
    expect(screen.getByText(/Total: 410 kcal/)).toBeInTheDocument(); // 300 + 110.4
  });

  it('muestra siempre el gramaje, también cuando la cantidad viene en otra unidad (ej. "3 unidades")', async () => {
    const withUnits: MealChatService = {
      sendMessage: vi.fn(async () => ({
        ...threeItems,
        result: { ...threeItems.result!, alimentos: threeItems.result!.alimentos.map((a, i) => (i === 0 ? { ...a, cantidad: '3 unidades' } : a)) },
      })),
    };
    const { user } = renderModal({ service: withUnits });
    await user.type(screen.getByPlaceholderText(INPUT_PLACEHOLDER), 'empanadas');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    expect(await screen.findByText('· 3 unidades · 240 g')).toBeInTheDocument();
    // Si la cantidad ya es el gramaje, no se repite.
    expect(screen.getByText('· 120 g')).toBeInTheDocument();
  });

  it('no acepta cantidades inválidas (0 o más del tope por ítem)', async () => {
    const { user } = await openResult();
    await user.click(screen.getByRole('button', { name: 'Editar cantidad de Banana' }));
    const input = screen.getByLabelText('Cantidad de Banana en g');
    await user.clear(input);
    await user.type(input, '0');
    expect(screen.getByRole('button', { name: 'Guardar cantidad' })).toBeDisabled();
    await user.clear(input);
    await user.type(input, '2001');
    expect(screen.getByRole('button', { name: 'Guardar cantidad' })).toBeDisabled();
  });

  it('quitar un ítem lo tacha, lo descuenta del total y se puede deshacer', async () => {
    const { user } = await openResult();
    await user.click(screen.getByRole('button', { name: 'Quitar Banana' }));
    expect(screen.getByText(/Total: 600 kcal/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deshacer quitar Banana' }));
    expect(screen.getByText(/Total: 710 kcal/)).toBeInTheDocument();
  });

  it('confirmar manda lo de la IA y lo final por ítem, con el origen correcto, y después refresca y avisa', async () => {
    const saveService = okSave();
    const { user, onConfirm } = await openResult({ saveService });

    await user.click(screen.getByRole('button', { name: 'Editar cantidad de Empanada de carne' }));
    const input = screen.getByLabelText('Cantidad de Empanada de carne en g');
    await user.clear(input);
    await user.type(input, '120');
    await user.click(screen.getByRole('button', { name: 'Guardar cantidad' }));
    await user.click(screen.getByRole('button', { name: 'Quitar Banana' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar y guardar registro' }));

    expect(saveService.save).toHaveBeenCalledTimes(1);
    const request = (saveService.save as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(request).toMatchObject({ fecha: '2026-10-08', tipoIngesta: 'almuerzo' });
    expect(request.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(request.items).toEqual([
      expect.objectContaining({ ingrediente: 'Empanada de carne', origin: 'edited', gramosIa: 240, gramosFinal: 120, macroSource: 'estimado_ia', idAlimento: null }),
      expect.objectContaining({ ingrediente: 'Banana', origin: 'removed', gramosIa: 120, gramosFinal: null, macroSource: 'sara2', idAlimento: 375 }),
      expect.objectContaining({ ingrediente: 'Agua', origin: 'ai', unidad: 'ml', gramosIa: 250, gramosFinal: 250, tipo: 'bebida' }),
    ]);

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        alimentos: [
          expect.objectContaining({ alimento: 'Empanada de carne', gramos: 120 }),
          expect.objectContaining({ alimento: 'Agua' }),
        ],
        totalGramos: 370,
      }),
    );
  });

  it('si falla el guardado muestra el error y reintentar usa el MISMO requestId (no duplica)', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new MealChatError('PERSISTENCE_ERROR', 'No pudimos guardar el registro. Probá de nuevo.', true))
      .mockResolvedValueOnce({ ok: true, mlAgua: 250, itemsDiario: 2, yaGuardado: false });
    const { user, onConfirm } = await openResult({ saveService: { save } });

    await user.click(screen.getByRole('button', { name: 'Confirmar y guardar registro' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos guardar el registro');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirmar y guardar registro' }));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].requestId).toBe(save.mock.calls[0][0].requestId);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('con todos los ítems quitados no deja confirmar', async () => {
    const { user } = await openResult();
    for (const name of ['Empanada de carne', 'Banana', 'Agua']) {
      await user.click(screen.getByRole('button', { name: `Quitar ${name}` }));
    }
    expect(screen.getByText(/no hay nada para guardar/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar y guardar registro' })).toBeDisabled();
  });

  it('no guarda dos veces con doble click en confirmar', async () => {
    let release: () => void = () => {};
    const save = vi.fn(() => new Promise<{ ok: true; mlAgua: number; itemsDiario: number; yaGuardado: boolean }>((resolve) => {
      release = () => resolve({ ok: true, mlAgua: 0, itemsDiario: 3, yaGuardado: false });
    }));
    const { user } = await openResult({ saveService: { save } });
    await user.dblClick(screen.getByRole('button', { name: 'Confirmar y guardar registro' }));
    expect(save).toHaveBeenCalledTimes(1);
    release();
    await screen.findByText(/Contame qué comiste/);
  });

  it('un resultado sin gramos/macros (formato viejo) no se puede guardar', async () => {
    const legacy: MealChatService = {
      sendMessage: vi.fn(async () => ({
        status: 'complete' as const,
        message: 'ok',
        result: { alimentos: [{ alimento: 'Empanada', cantidad: '3 unidades' }] },
      })),
    };
    const { user } = renderModal({ service: legacy });
    await user.type(screen.getByPlaceholderText(INPUT_PLACEHOLDER), 'empanadas');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    await screen.findByText('Empanada');
    expect(screen.getByRole('button', { name: 'Confirmar y guardar registro' })).toBeDisabled();
  });
});
