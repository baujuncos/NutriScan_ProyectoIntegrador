import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BarcodeScannerModal from '@/app/alimentacion/BarcodeScannerModal';
import { obtenerProductoPorEAN } from '@/lib/openFoodFacts';
import { addScannedItemAction } from '@/app/alimentacion/actions';

const mockStart = vi.fn().mockResolvedValue(null);
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockClear = vi.fn();
const mockScanFileV2 = vi.fn();

vi.mock('html5-qrcode', () => ({
  // Arrow functions can't be invoked with `new` — the real Html5Qrcode is a
  // class, and the component correctly does `new Html5Qrcode(...)`, so the
  // mock constructor must be a regular function.
  Html5Qrcode: vi.fn().mockImplementation(function () {
    return {
      start: mockStart,
      stop: mockStop,
      clear: mockClear,
      scanFileV2: mockScanFileV2,
    };
  }),
  Html5QrcodeSupportedFormats: { EAN_13: 9 },
}));

vi.mock('@/lib/openFoodFacts', () => ({
  obtenerProductoPorEAN: vi.fn(),
}));

vi.mock('@/app/alimentacion/actions', () => ({
  addScannedItemAction: vi.fn().mockResolvedValue(undefined),
}));

const PRODUCTO_OK = {
  encontrado: true as const,
  ean: '7790040000100',
  nombre: 'Alfajor Triple',
  categoria: 'Snacks dulces',
  marca: 'Havanna',
  porcion: 45,
  nutrientes100g: { kcal: 450, proteinas: 5, grasas: 20, carbs: 60 },
  imagenUrl: null,
  esSuplemento: false,
  porcionEtiqueta: null,
  pesoNetoTotal: null,
  infoAmpliada: { nutriscore: null, novaGroup: null, sinGluten: false, vegano: false, vegetariano: false },
};

function mockPointerCoarse(coarse: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(pointer: coarse)' ? coarse : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function renderModal(props: Partial<React.ComponentProps<typeof BarcodeScannerModal>> = {}) {
  const onClose = vi.fn();
  const user = userEvent.setup();
  const { rerender } = render(
    <BarcodeScannerModal open onClose={onClose} fecha="2026-09-21" tipoIngesta="almuerzo" {...props} />,
  );
  // `onClose` es un mock: no cambia `open` solo. Un test que necesite simular
  // lo que hace AlimentacionClient en producción (bajar `open` a false cuando
  // se llama onClose) puede pasar rerenderWithOpen(false).
  const rerenderWithOpen = (open: boolean) =>
    rerender(
      <BarcodeScannerModal open={open} onClose={onClose} fecha="2026-09-21" tipoIngesta="almuerzo" {...props} />,
    );
  return { onClose, user, rerenderWithOpen };
}

async function simularEscaneo() {
  await waitFor(() => expect(mockStart).toHaveBeenCalled());
  const successCallback = mockStart.mock.calls[0][2] as (decodedText: string) => void;
  await act(async () => successCallback('7790040000100'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPointerCoarse(true);
  vi.mocked(obtenerProductoPorEAN).mockResolvedValue(PRODUCTO_OK);
});

describe('BarcodeScannerModal — captura', () => {
  it('en dispositivo táctil, la pestaña "Usar cámara" está activa por defecto y arranca restringida a EAN_13', async () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Usar cámara' })).toHaveClass('bg-white');
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    const { Html5Qrcode } = await import('html5-qrcode');
    expect(vi.mocked(Html5Qrcode).mock.calls[0][1]).toMatchObject({
      formatsToSupport: [9],
    });
  });

  it('en desktop (sin pointer coarse), la pestaña "Subir imagen" está activa por defecto y no arranca la cámara', async () => {
    mockPointerCoarse(false);
    renderModal();
    expect(screen.getByRole('button', { name: 'Subir imagen' })).toHaveClass('bg-white');
    await new Promise((r) => setTimeout(r, 0));
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('detiene la cámara (stop + clear) al cerrar el modal', async () => {
    const { user } = renderModal();
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    await user.click(screen.getByLabelText('Cerrar'));

    await waitFor(() => expect(mockStop).toHaveBeenCalled());
    expect(mockClear).toHaveBeenCalled();
  });

  it('al detectar un EAN por cámara, detiene el escaneo y consulta obtenerProductoPorEAN', async () => {
    renderModal();
    await simularEscaneo();

    await waitFor(() => expect(mockStop).toHaveBeenCalled());
    expect(obtenerProductoPorEAN).toHaveBeenCalledWith('7790040000100');
    expect(await screen.findByText('¿Es este tu alimento?')).toBeInTheDocument();
  });

  it('si el modal se cierra mientras start() todavía está pendiente, igual detiene la cámara cuando termina de arrancar', async () => {
    // Reproduce el estado real de html5-qrcode: stop() rechaza si se llama
    // antes de que start() haya resuelto ("Cannot stop, scanner is not
    // running"). El primer stop() (disparado por el cierre del modal) cae en
    // esa ventana y falla; solo un segundo intento, después de que start()
    // resuelva, puede apagar la cámara de verdad.
    let resolveStart!: () => void;
    mockStart.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = () => resolve(null);
        }),
    );
    mockStop
      .mockImplementationOnce(() => Promise.reject(new Error('Cannot stop, scanner is not running.')))
      .mockImplementationOnce(() => Promise.resolve(undefined));

    const { user, rerenderWithOpen } = renderModal();
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    // Igual que en producción: cerrar dispara handleClose (detenerCamara()
    // directo, que acá falla) y el padre baja `open` a false, lo que además
    // dispara el cleanup del efecto de escaneo.
    await user.click(screen.getByLabelText('Cerrar'));
    rerenderWithOpen(false);
    await waitFor(() => expect(mockStop).toHaveBeenCalledTimes(1));

    // Ahora start() resuelve "tarde": la cámara recién queda realmente viva acá.
    await act(async () => {
      resolveStart();
    });

    await waitFor(() => expect(mockStop).toHaveBeenCalledTimes(2));
  });
});

describe('BarcodeScannerModal — confirmación y porción', () => {
  it('"No, es otro" pasa a la pantalla de descarte sugiriendo otro método', async () => {
    const { user } = renderModal();
    await simularEscaneo();
    await screen.findByText('¿Es este tu alimento?');

    await user.click(screen.getByRole('button', { name: 'No, es otro' }));

    expect(
      await screen.findByText(/te sugerimos usar otro método de registro/i),
    ).toBeInTheDocument();
  });

  it('si el producto no se encuentra (o sin datos nutricionales), va directo a la pantalla de descarte', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ encontrado: false, ean: '0000000000000' });
    renderModal();
    await simularEscaneo();

    expect(
      await screen.findByText(/no pudimos encontrar datos nutricionales confiables/i),
    ).toBeInTheDocument();
  });

  it('"Escanear otro código" vuelve a la pantalla inicial', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ encontrado: false, ean: '0000000000000' });
    const { user } = renderModal();
    await simularEscaneo();
    await screen.findByText(/no pudimos encontrar datos nutricionales confiables/i);

    await user.click(screen.getByRole('button', { name: 'Escanear otro código' }));

    expect(screen.getByRole('button', { name: 'Usar cámara' })).toBeInTheDocument();
  });

  it('los botones de porción muestran los gramos calculados según la porción del producto', async () => {
    const { user } = renderModal();
    await simularEscaneo();
    await user.click(await screen.findByRole('button', { name: 'Sí, es correcto' }));

    expect(screen.getByRole('button', { name: /1\/4 de porción/ })).toHaveTextContent('11 g'); // 45 * 0.25 ≈ 11
    expect(screen.getByRole('button', { name: /^1 porción/ })).toHaveTextContent('45 g');
    expect(screen.getByRole('button', { name: /2 porciones/ })).toHaveTextContent('90 g');
  });

  it('al elegir una porción, llama a addScannedItemAction con fecha/tipo_ingesta/ean/cantidad correctos', async () => {
    const { user } = renderModal();
    await simularEscaneo();
    await user.click(await screen.findByRole('button', { name: 'Sí, es correcto' }));

    await user.click(screen.getByRole('button', { name: /^1 porción/ }));

    await waitFor(() => expect(addScannedItemAction).toHaveBeenCalled());
    const formData = vi.mocked(addScannedItemAction).mock.calls[0][0] as FormData;
    expect(formData.get('fecha')).toBe('2026-09-21');
    expect(formData.get('tipo_ingesta')).toBe('almuerzo');
    expect(formData.get('ean')).toBe('7790040000100');
    expect(formData.get('cantidad')).toBe('45');
  });

  it('al elegir una porción, cierra el modal (no se queda esperando sobre la pantalla de porción)', async () => {
    const { user, onClose } = renderModal();
    await simularEscaneo();
    await user.click(await screen.findByRole('button', { name: 'Sí, es correcto' }));

    await user.click(screen.getByRole('button', { name: /^1 porción/ }));

    expect(onClose).toHaveBeenCalled();
  });

  it('"Volver" desde la pantalla de porción regresa a la confirmación', async () => {
    const { user } = renderModal();
    await simularEscaneo();
    await user.click(await screen.findByRole('button', { name: 'Sí, es correcto' }));

    await user.click(screen.getByRole('button', { name: 'Volver' }));

    expect(await screen.findByText('¿Es este tu alimento?')).toBeInTheDocument();
  });
});
