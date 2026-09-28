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
  render(
    <BarcodeScannerModal open onClose={onClose} fecha="2026-09-21" tipoIngesta="almuerzo" {...props} />,
  );
  return { onClose, user };
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
});
