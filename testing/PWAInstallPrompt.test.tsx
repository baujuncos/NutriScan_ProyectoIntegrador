/**
 * PWAInstallPrompt — banner "Instalar NutriScan". Se muestra solo si el navegador dispara
 * `beforeinstallprompt`, la app no está ya instalada y el usuario no lo descartó hace menos de 7 días.
 * Tabla de decisión:
 *   instalada (standalone) | descartado hace… | evento beforeinstallprompt | banner
 *   sí                     | —                | sí                        | no
 *   no                     | < 7 días         | sí                        | no
 *   no                     | ≥ 7 días / nunca | sí                        | sí
 *   no                     | nunca            | no                        | no
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';

const KEY = 'nutriscan-pwa-install-dismissed-at';
const DIA = 24 * 60 * 60 * 1000;

function matchMediaStandalone(standalone: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: standalone && q.includes('standalone'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as never;
}
function dispararInstalacion(userChoice: Promise<{ outcome: string }> = Promise.resolve({ outcome: 'accepted' })) {
  const evento = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn().mockResolvedValue(undefined), userChoice });
  act(() => {
    window.dispatchEvent(evento);
  });
  return evento;
}

beforeEach(() => {
  localStorage.clear();
  matchMediaStandalone(false);
});
afterEach(() => vi.restoreAllMocks());

describe('PWAInstallPrompt', () => {
  it('no muestra nada hasta que el navegador ofrece instalar', () => {
    render(<PWAInstallPrompt />);
    expect(screen.queryByText('Instalar NutriScan')).not.toBeInTheDocument();
  });

  it('cuando el navegador ofrece instalar, muestra el banner y frena el aviso nativo', () => {
    render(<PWAInstallPrompt />);
    const evento = dispararInstalacion();
    expect(screen.getByText('Instalar NutriScan')).toBeInTheDocument();
    expect(evento.defaultPrevented).toBe(true);
  });

  it('"Instalar" lanza el diálogo del navegador y oculta el banner', async () => {
    render(<PWAInstallPrompt />);
    const evento = dispararInstalacion();
    fireEvent.click(screen.getByRole('button', { name: /Instalar$/ }));
    await waitFor(() => expect(screen.queryByText('Instalar NutriScan')).not.toBeInTheDocument());
    expect(evento.prompt).toHaveBeenCalled();
  });

  it('descartar guarda la fecha y oculta el banner', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    render(<PWAInstallPrompt />);
    dispararInstalacion();
    fireEvent.click(screen.getByRole('button', { name: /Ahora no|Cerrar|Descartar/i }));
    expect(localStorage.getItem(KEY)).toBe('1700000000000');
    expect(screen.queryByText('Instalar NutriScan')).not.toBeInTheDocument();
  });

  it('si la app ya está instalada (standalone) no ofrece instalar', () => {
    matchMediaStandalone(true);
    render(<PWAInstallPrompt />);
    dispararInstalacion();
    expect(screen.queryByText('Instalar NutriScan')).not.toBeInTheDocument();
  });

  it('valor límite: descartado hace 6 días 23 h → no se muestra; hace 7 días → se muestra', () => {
    const ahora = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(ahora);

    localStorage.setItem(KEY, String(ahora - 7 * DIA + 60 * 60 * 1000));
    const a = render(<PWAInstallPrompt />);
    dispararInstalacion();
    expect(screen.queryByText('Instalar NutriScan')).not.toBeInTheDocument();
    a.unmount();

    localStorage.setItem(KEY, String(ahora - 7 * DIA));
    render(<PWAInstallPrompt />);
    dispararInstalacion();
    expect(screen.getByText('Instalar NutriScan')).toBeInTheDocument();
  });
});
