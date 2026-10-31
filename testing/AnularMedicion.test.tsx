import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { push, refresh, anular } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), anular: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }), usePathname: () => '/antropometrias' }));
vi.mock('@/app/(researcher)/antropometrias/actions', () => ({ anularMedicionAction: anular }));

import AnularMedicion from '@/app/(researcher)/antropometrias/AnularMedicion';

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  anular.mockReset().mockResolvedValue({ ok: true, fichaHref: '/antropometrias/manual/p1' });
});

describe('AnularMedicion', () => {
  it('pide confirmación y nombra la medición; cancelar no anula', async () => {
    render(<AnularMedicion medicionId="m1" fecha="24/10/2026" destino="ficha" />);
    await userEvent.click(screen.getByRole('button', { name: 'Anular' }));

    const dialogo = screen.getByRole('dialog');
    expect(dialogo).toHaveTextContent('La medición del 24/10/2026 deja de verse');
    expect(dialogo).toHaveTextContent('No se borra');

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(anular).not.toHaveBeenCalled();
  });

  it('al confirmar anula y vuelve a la ficha (desde el informe)', async () => {
    render(<AnularMedicion medicionId="m1" fecha="24/10/2026" destino="ficha" />);
    await userEvent.click(screen.getByRole('button', { name: 'Anular' }));
    await userEvent.click(screen.getByRole('button', { name: 'Anular medición' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/antropometrias/manual/p1'));
    expect(anular).toHaveBeenCalledWith('m1');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('desde la ficha refresca la lista en vez de navegar', async () => {
    render(<AnularMedicion medicionId="m1" fecha="24/10/2026" destino="refrescar" />);
    await userEvent.click(screen.getByRole('button', { name: 'Anular' }));
    await userEvent.click(screen.getByRole('button', { name: 'Anular medición' }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
  });

  it('si el servidor falla muestra el error, deja el modal abierto y no navega', async () => {
    anular.mockResolvedValue({ error: 'No se pudo anular la medición. Probá de nuevo.' });
    render(<AnularMedicion medicionId="m1" fecha="24/10/2026" destino="ficha" />);
    await userEvent.click(screen.getByRole('button', { name: 'Anular' }));
    await userEvent.click(screen.getByRole('button', { name: 'Anular medición' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo anular');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('un borrador se "descarta"', async () => {
    render(<AnularMedicion medicionId="b1" fecha="28/10/2026" esBorrador destino="refrescar" />);
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('El borrador del 28/10/2026 deja de verse');
    expect(screen.getByRole('button', { name: 'Descartar borrador' })).toBeInTheDocument();
  });
});
