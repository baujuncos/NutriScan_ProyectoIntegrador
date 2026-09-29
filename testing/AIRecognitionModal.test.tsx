import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  render(
    <AIRecognitionModal
      open
      onClose={onClose}
      onSelectOtro={onSelectOtro}
      mealType="desayuno"
      mealLabel="Desayuno"
      {...props}
    />,
  );
  return { onClose, onSelectOtro, user: userEvent.setup() };
}

const RESPUESTA_SIN_DUDAS = {
  ok: true,
  predictionId: '1',
  items: [
    {
      id: 'item-1',
      ingredient: 'milanesa de pollo',
      type: 'proteína animal',
      confidence: 0.82,
      estimatedWeightGrams: 150,
      questions: [],
      boundingBox: null,
    },
  ],
  totalEstimatedWeightGrams: 150,
};

const RESPUESTA_CON_DUDA = {
  ok: true,
  predictionId: '1',
  items: [
    {
      id: 'item-1',
      ingredient: 'empanada',
      type: 'alimento compuesto',
      confidence: 0.6,
      estimatedWeightGrams: 90,
      questions: [
        {
          question: '¿De qué relleno es la empanada?',
          kind: 'identity',
          options: ['Carne', 'Pollo', 'Jamón y queso', 'Verdura'],
        },
      ],
      boundingBox: null,
    },
  ],
  totalEstimatedWeightGrams: 90,
};

beforeEach(() => {
  window.localStorage.clear();
  mockGetUserMedia(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
});

async function llevarACapturaYSubirFotoDeGaleria(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('Plato playo'));
  const file = new File(['x'], 'comida.jpg', { type: 'image/jpeg' });
  const input = (await screen.findByText('Importar de galería')).closest('button')?.parentElement
    ?.parentElement?.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
  await user.upload(input, file);
}

describe('AIRecognitionModal — Pantalla 1 unificada (NUT-169)', () => {
  it('abre mostrando la Pantalla 1 completa: vajilla, diámetro y cámara juntos desde el arranque', async () => {
    renderModal();
    expect(screen.getByRole('radiogroup', { name: 'Tipo de vajilla' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    // Sin preferencia guardada, arranca en "Plato playo" (26 cm) para que se vea todo junto, como el mockup.
    expect((screen.getByLabelText('Diámetro') as HTMLInputElement).value).toBe('26');
    expect(await screen.findByText('Importar de galería')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continuar' })).not.toBeInTheDocument();
  });

  it('elegir otro plato actualiza el diámetro precargado en la misma pantalla, sin un paso "Continuar"', async () => {
    const { user } = renderModal();
    await user.click(screen.getByText('Plato hondo'));

    expect((screen.getByLabelText('Diámetro') as HTMLInputElement).value).toBe('22');
    expect(await screen.findByText('Importar de galería')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continuar' })).not.toBeInTheDocument();
  });

  it('un diámetro fuera de rango muestra el error y oculta la cámara', async () => {
    const { user } = renderModal();
    await user.click(screen.getByText('Plato playo'));
    const input = screen.getByLabelText('Diámetro');

    await user.clear(input);
    await user.type(input, '80');

    expect(screen.getByText('El diámetro debe estar entre 22 y 32 cm')).toBeInTheDocument();
    expect(screen.queryByText('Importar de galería')).not.toBeInTheDocument();
  });

  it('"Otro" muestra el aviso de imprecisión y nunca el diámetro ni la cámara', async () => {
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

  it('recuerda la última vajilla/diámetro elegidos entre aperturas (NUT-169)', async () => {
    const { user, onClose } = renderModal();
    await user.click(screen.getByText('Plato hondo'));
    const input = screen.getByLabelText('Diámetro');
    await user.clear(input);
    await user.type(input, '20');
    onClose();

    renderModal();
    // Se re-renderiza un nuevo modal con el mismo localStorage: el diámetro precargado es 20.
    const inputs = screen.getAllByLabelText('Diámetro');
    expect((inputs[inputs.length - 1] as HTMLInputElement).value).toBe('20');
  });
});

describe('AIRecognitionModal — flujo de cámara (sin encuadre) y galería (con encuadre)', () => {
  it('con foto de galería aparece el paso de encuadre (zoom) antes de reconocer', async () => {
    mockGetUserMedia(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }));
    const { user } = renderModal();
    await llevarACapturaYSubirFotoDeGaleria(user);

    expect(await screen.findByLabelText('Zoom de la foto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconocer alimentos' })).toBeInTheDocument();
    // La vajilla y el diámetro siguen visibles arriba durante el encuadre: se ve como si fuera la cámara en vivo.
    expect(screen.getByRole('radiogroup', { name: 'Tipo de vajilla' })).toBeInTheDocument();
    expect(screen.getByLabelText('Diámetro')).toBeInTheDocument();
  });

  it('con foto de cámara (input nativo de captura) se reconoce directo, sin paso de encuadre', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => RESPUESTA_SIN_DUDAS });
    vi.stubGlobal('fetch', fetchMock);
    // getUserMedia falla → cae al input nativo `capture` (mode 'fallback'), que también es fuente "camera".
    const { user } = renderModal();
    await user.click(screen.getByText('Plato playo'));
    await screen.findByText('Tomar foto');

    const file = new File(['x'], 'comida.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"][capture]') as HTMLInputElement;
    await user.upload(input, file);

    expect(screen.queryByLabelText('Zoom de la foto')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('milanesa de pollo')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});

describe('AIRecognitionModal — reconocimiento y transición a la Pantalla 2', () => {
  it('un reconocimiento exitoso sin dudas llama a /api/food-recognition y pasa al resultado "listo"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => RESPUESTA_SIN_DUDAS });
    vi.stubGlobal('fetch', fetchMock);
    mockGetUserMedia(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }));
    const { user } = renderModal();

    await llevarACapturaYSubirFotoDeGaleria(user);
    await user.click(screen.getByRole('button', { name: 'Reconocer alimentos' }));

    expect(await screen.findByText('milanesa de pollo')).toBeInTheDocument();
    expect(screen.getByText(/Sin dudas/)).toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/food-recognition');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body.get('vajilla') as string)).toEqual({ tipo: 'plato_playo', diametroCm: 26 });

    vi.unstubAllGlobals();
  });

  it('con preguntas aclaratorias, se pueden responder de forma interactiva en la Pantalla 2 (NUT-169/170)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => RESPUESTA_CON_DUDA });
    vi.stubGlobal('fetch', fetchMock);
    mockGetUserMedia(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }));
    const { user } = renderModal();

    await llevarACapturaYSubirFotoDeGaleria(user);
    await user.click(screen.getByRole('button', { name: 'Reconocer alimentos' }));

    expect(await screen.findByText('¿De qué relleno es la empanada?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Carne' }));

    expect(screen.getByText('Carne')).toBeInTheDocument();
    expect(screen.getByText(/Sin dudas/)).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('si la llamada al endpoint falla, muestra el mensaje de error y permite reintentar', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'GEMINI_TIMEOUT', message: 'El reconocimiento tardó demasiado. Probá de nuevo.' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    mockGetUserMedia(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }));
    const { user } = renderModal();

    await llevarACapturaYSubirFotoDeGaleria(user);
    await user.click(screen.getByRole('button', { name: 'Reconocer alimentos' }));

    expect(await screen.findByText('El reconocimiento tardó demasiado. Probá de nuevo.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeEnabled();

    vi.unstubAllGlobals();
  });
});

describe('AIRecognitionModal — guardado (NUT-172) y "Repetir"', () => {
  async function llegarAlResultadoListo(user: ReturnType<typeof userEvent.setup>) {
    await llevarACapturaYSubirFotoDeGaleria(user);
    await user.click(screen.getByRole('button', { name: 'Reconocer alimentos' }));
    await screen.findByText('milanesa de pollo');
  }

  it('"Guardar" arma el SaveRequest y lo manda a /api/food-recognition/save; nunca toca el diario real', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/food-recognition') {
        return Promise.resolve({ ok: true, json: async () => RESPUESTA_SIN_DUDAS });
      }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, savedId: '9' }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    mockGetUserMedia(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }));
    const { user } = renderModal();

    await llegarAlResultadoListo(user);
    await user.click(screen.getByRole('button', { name: /Guardar en Desayuno/ }));

    expect(await screen.findByText('Guardado en Desayuno')).toBeInTheDocument();

    const saveCall = fetchMock.mock.calls.find(([url]) => url === '/api/food-recognition/save');
    expect(saveCall).toBeTruthy();
    const body = JSON.parse(saveCall![1].body as string);
    expect(body.predictionId).toBe('1');
    expect(body.mealType).toBe('desayuno');
    expect(body.items[0]).toMatchObject({ sourceItemId: 'item-1', origin: 'ai', grams: 150 });

    for (const [url] of fetchMock.mock.calls) {
      expect(url).not.toContain('ingestas');
      expect(url).not.toContain('/items');
    }

    vi.unstubAllGlobals();
  });

  it('"Repetir" vuelve a la Pantalla 1 conservando la vajilla y el diámetro elegidos', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => RESPUESTA_SIN_DUDAS });
    vi.stubGlobal('fetch', fetchMock);
    mockGetUserMedia(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }));
    const { user } = renderModal();

    await llegarAlResultadoListo(user);
    await user.click(screen.getByRole('button', { name: /Repetir/ }));

    expect(await screen.findByText('Importar de galería')).toBeInTheDocument();
    expect((screen.getByLabelText('Diámetro') as HTMLInputElement).value).toBe('26');

    vi.unstubAllGlobals();
  });
});
