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

  it('el flujo de un plato arma la EntradaReconocimiento (vajilla + encuadre + ángulo)', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    mockGetUserMedia(() =>
      Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }),
    );
    const { user } = renderModal();

    await user.click(screen.getByText('Plato playo'));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(await screen.findByText('Importar de galería'));

    const file = new File(['x'], 'comida.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
    await user.upload(input, file);

    await user.click(await screen.findByRole('button', { name: 'Reconocer alimentos' }));

    await waitFor(() =>
      expect(debugSpy).toHaveBeenCalledWith(
        '[NUT-161] entrada de reconocimiento',
        expect.objectContaining({
          vajilla: expect.objectContaining({ tipo: 'plato_playo', diametroCm: 26, calibracionPorFoto: true }),
          encuadre: expect.objectContaining({ zoom: 1, panX: 0, panY: 0 }),
          angulo: expect.objectContaining({ estado: 'desconocido', dentroDeRango: true }),
        }),
      ),
    );
    debugSpy.mockRestore();
  });
});
