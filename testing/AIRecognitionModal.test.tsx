import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AIRecognitionModal from '@/app/alimentacion/AIRecognitionModal';

beforeAll(() => {
  // jsdom no implementa estas APIs de media.
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
    value: vi.fn().mockResolvedValue(undefined),
    configurable: true,
  });
});

function mockGetUserMedia(impl: () => Promise<unknown>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(impl) },
    configurable: true,
  });
}

function renderModal(props: Partial<React.ComponentProps<typeof AIRecognitionModal>> = {}) {
  const onClose = vi.fn();
  const onSelectOtro = vi.fn();
  render(<AIRecognitionModal open onClose={onClose} onSelectOtro={onSelectOtro} {...props} />);
  return { onClose, onSelectOtro, user: userEvent.setup() };
}

beforeEach(() => {
  mockGetUserMedia(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
});

describe('AIRecognitionModal — paso previo de vajilla (NUT-157)', () => {
  it('abre en el selector de vajilla, no en la cámara', () => {
    renderModal();
    expect(screen.getByRole('radiogroup', { name: 'Tipo de vajilla' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.queryByText(/Capturar foto|Tomar foto/)).not.toBeInTheDocument();
  });

  it('elegir un plato muestra el paso de diámetro con el valor por defecto precargado (NUT-159)', async () => {
    const { user } = renderModal();
    await user.click(screen.getByText('Plato playo'));

    const input = screen.getByLabelText('Diámetro') as HTMLInputElement;
    expect(input.value).toBe('26');
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });

  it('bloquea "Continuar" y muestra error con un diámetro fuera de rango o negativo (NUT-159)', async () => {
    const { user } = renderModal();
    await user.click(screen.getByText('Plato playo'));
    const input = screen.getByLabelText('Diámetro');

    await user.clear(input);
    await user.type(input, '-3');
    expect(screen.getByText('El diámetro debe ser mayor a 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();

    await user.clear(input);
    await user.type(input, '80');
    expect(screen.getByText('El diámetro debe estar entre 22 y 32 cm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('con un diámetro válido "Continuar" lleva al paso de captura de foto', async () => {
    const { user } = renderModal();
    await user.click(screen.getByText('Plato de postre'));

    const input = screen.getByLabelText('Diámetro');
    await user.clear(input);
    await user.type(input, '19');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    // CameraCapture montado: aparecen las acciones de foto/galería.
    expect(await screen.findByText('Importar de galería')).toBeInTheDocument();
  });

  it('si getUserMedia falla, cae al fallback de subir foto sin romperse', async () => {
    const { user } = renderModal();
    await user.click(screen.getByText('Plato hondo'));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText(/No diste permiso para la cámara/)).toBeInTheDocument();
    expect(screen.getByText('Tomar foto')).toBeInTheDocument();
    expect(screen.getByText('Importar de galería')).toBeInTheDocument();
  });
});

describe('AIRecognitionModal — rama "Otro" (NUT-160)', () => {
  it('elegir "Otro" muestra el aviso de imprecisión y nunca el paso de diámetro', async () => {
    const { user } = renderModal();
    await user.click(screen.getByText('Otro'));

    expect(screen.getByText(/estimación de peso por foto\s+puede ser muy imprecisa/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Diámetro')).not.toBeInTheDocument();
  });

  it('"Cargar sin foto" deriva a la carga manual (onSelectOtro)', async () => {
    const { user, onSelectOtro } = renderModal();
    await user.click(screen.getByText('Otro'));
    await user.click(screen.getByRole('button', { name: 'Cargar sin foto' }));
    expect(onSelectOtro).toHaveBeenCalledTimes(1);
  });

  it('el preview permite reencuadrar la foto con zoom para alinearla con la guía', async () => {
    mockGetUserMedia(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }));
    const { user } = renderModal();

    await user.click(screen.getByText('Plato hondo'));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(await screen.findByText('Importar de galería'));

    const file = new File(['x'], 'comida.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
    await user.upload(input, file);

    expect(await screen.findByLabelText('Zoom de la foto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reencuadrar' })).toBeInTheDocument();
  });

  async function llevarACapturaYSubirFoto(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByText('Plato playo'));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(await screen.findByText('Importar de galería'));

    const file = new File(['x'], 'comida.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
    await user.upload(input, file);
  }

  it('un reconocimiento exitoso llama a /api/food-recognition con un FormData y muestra los ingredientes detectados (NUT-154/156)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        detectedIngredients: [
          {
            ingredient: 'milanesa de pollo',
            type: 'proteína animal',
            confidence: 0.82,
            estimatedWeightGrams: 150,
            questionForUser: null,
          },
        ],
        totalEstimatedWeightGrams: 150,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    mockGetUserMedia(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }));
    const { user } = renderModal();

    await llevarACapturaYSubirFoto(user);
    await user.click(await screen.findByRole('button', { name: 'Reconocer alimentos' }));

    expect(await screen.findByText('milanesa de pollo')).toBeInTheDocument();
    expect(screen.getByText('150 g')).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/food-recognition');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(JSON.parse(init.body.get('vajilla') as string)).toEqual({
      tipo: 'plato_playo',
      diametroCm: 26,
    });

    vi.unstubAllGlobals();
  });

  it('si Gemini devuelve una pregunta aclaratoria, responderla dispara una segunda llamada con previousDetection + respuestaUsuario', async () => {
    const primeraRespuesta = {
      ok: true,
      detectedIngredients: [
        {
          ingredient: 'empanada',
          type: 'alimento compuesto',
          confidence: 0.6,
          estimatedWeightGrams: 90,
          questionForUser: '¿De qué relleno es la empanada?',
        },
      ],
      totalEstimatedWeightGrams: 90,
    };
    const segundaRespuesta = {
      ok: true,
      detectedIngredients: [{ ...primeraRespuesta.detectedIngredients[0], questionForUser: null }],
      totalEstimatedWeightGrams: 90,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => primeraRespuesta })
      .mockResolvedValueOnce({ ok: true, json: async () => segundaRespuesta });
    vi.stubGlobal('fetch', fetchMock);
    mockGetUserMedia(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }));
    const { user } = renderModal();

    await llevarACapturaYSubirFoto(user);
    await user.click(await screen.findByRole('button', { name: 'Reconocer alimentos' }));

    expect(await screen.findByText('¿De qué relleno es la empanada?')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Tu respuesta'), 'De carne');
    await user.click(screen.getByRole('button', { name: 'Responder' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, secondInit] = fetchMock.mock.calls[1];
    // `recognitionResult` sólo guarda detectedIngredients/totalEstimatedWeightGrams
    // (el `ok` del sobre de la respuesta HTTP no viaja en el estado del modal).
    expect(JSON.parse(secondInit.body.get('previousDetection') as string)).toEqual({
      detectedIngredients: primeraRespuesta.detectedIngredients,
      totalEstimatedWeightGrams: primeraRespuesta.totalEstimatedWeightGrams,
    });
    expect(JSON.parse(secondInit.body.get('respuestaUsuario') as string)).toEqual({
      ingredient: 'empanada',
      respuesta: 'De carne',
    });

    vi.unstubAllGlobals();
  });

  it('si la llamada al endpoint falla, muestra el mensaje de error y permite reintentar', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: 'GEMINI_TIMEOUT',
        message: 'El reconocimiento tardó demasiado. Probá de nuevo.',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    mockGetUserMedia(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }));
    const { user } = renderModal();

    await llevarACapturaYSubirFoto(user);
    await user.click(await screen.findByRole('button', { name: 'Reconocer alimentos' }));

    expect(
      await screen.findByText('El reconocimiento tardó demasiado. Probá de nuevo.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeEnabled();

    vi.unstubAllGlobals();
  });
});
