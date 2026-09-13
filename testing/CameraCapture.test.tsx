import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CameraCapture from '@/app/alimentacion/CameraCapture';

beforeAll(() => {
  Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
    value: vi.fn().mockResolvedValue(undefined),
    configurable: true,
  });
});

function mockCamaraOk() {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
    configurable: true,
  });
}

type OrientacionKind = 'android' | 'ios' | 'ninguno';

function setDeviceOrientation(kind: OrientacionKind, requestPermission?: () => Promise<'granted' | 'denied'>) {
  let value: unknown;
  if (kind === 'ninguno') {
    value = undefined;
  } else {
    const DOE = function () {} as unknown as Record<string, unknown>;
    if (kind === 'ios') {
      DOE.requestPermission = requestPermission ?? vi.fn().mockResolvedValue('granted');
    }
    value = DOE;
  }
  Object.defineProperty(window, 'DeviceOrientationEvent', { value, configurable: true });
}

function emitirBeta(beta: number) {
  const ev = new Event('deviceorientation');
  Object.defineProperty(ev, 'beta', { value: beta, configurable: true });
  window.dispatchEvent(ev);
}

async function esperarCamaraLista() {
  return screen.findByRole('button', { name: /Capturar foto/ });
}

beforeEach(() => {
  mockCamaraOk();
  setDeviceOrientation('ninguno');
});

describe('CameraCapture — feedback de ángulo (NUT-163)', () => {
  it('Android: beta dentro del rango → "Ángulo correcto" y sin bloquear la captura', async () => {
    setDeviceOrientation('android');
    render(<CameraCapture guiaTipo="plato_playo" onCapture={vi.fn()} />);
    await esperarCamaraLista();

    act(() => emitirBeta(56));

    expect(screen.getByText('Ángulo correcto ✓')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Capturar foto/ })).toBeEnabled();
  });

  it('Android: beta fuera de rango (cenital) → mensaje de alerta pero el botón sigue habilitado (bloqueo blando)', async () => {
    setDeviceOrientation('android');
    render(<CameraCapture guiaTipo="plato_playo" onCapture={vi.fn()} />);
    await esperarCamaraLista();

    act(() => emitirBeta(5));

    expect(screen.getByText(/muy desde arriba/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Capturar foto/ })).toBeEnabled();
  });

  it('sin soporte de DeviceOrientation → aviso de fallback y captura disponible', async () => {
    setDeviceOrientation('ninguno');
    render(<CameraCapture guiaTipo="plato_hondo" onCapture={vi.fn()} />);
    await esperarCamaraLista();

    expect(screen.getByText(/No pudimos leer el ángulo del celular/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Capturar foto/ })).toBeEnabled();
  });

  it('iOS: pide permiso con un gesto; concedido → engancha el sensor', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    setDeviceOrientation('ios', requestPermission);
    render(<CameraCapture guiaTipo="plato_playo" onCapture={vi.fn()} />);
    await esperarCamaraLista();

    const btn = screen.getByRole('button', { name: 'Activar guía de ángulo' });
    await userEvent.click(btn);
    expect(requestPermission).toHaveBeenCalledTimes(1);

    // Concedido: el botón desaparece y queda enganchado el listener.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Activar guía de ángulo' })).not.toBeInTheDocument(),
    );

    act(() => emitirBeta(56));
    expect(await screen.findByText('Ángulo correcto ✓')).toBeInTheDocument();
  });

  it('iOS: permiso denegado → aviso de fallback, sin romperse', async () => {
    setDeviceOrientation('ios', vi.fn().mockResolvedValue('denied'));
    render(<CameraCapture guiaTipo="plato_playo" onCapture={vi.fn()} />);
    await esperarCamaraLista();

    await userEvent.click(screen.getByRole('button', { name: 'Activar guía de ángulo' }));

    expect(await screen.findByText(/No pudimos leer el ángulo del celular/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Capturar foto/ })).toBeEnabled();
  });
});
