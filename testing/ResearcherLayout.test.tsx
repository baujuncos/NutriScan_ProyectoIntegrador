/**
 * NUT-252 — Las rutas de Antropometrías viven bajo el layout del panel de investigador, que es donde
 * está el guard de rol: sin sesión → /login; deportista_ucc y particular → /home; investigador y
 * administrador ven el contenido. Además, la entrada "Antropometrías" de la barra lateral.
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock, redirectMock, pathnameMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  pathnameMock: vi.fn(() => '/antropometrias'),
}));
const db = createSupabaseFromMock();

vi.mock('next/navigation', () => ({ redirect: redirectMock, usePathname: pathnameMock, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: db.from }),
}));
// Piezas del pie de la barra lateral que no interesan acá (usan el cliente de Supabase del navegador).
vi.mock('@/components/auth/LogoutButton', () => ({ default: () => null }));
vi.mock('@/components/ui/DeleteAccountAction', () => ({ default: () => null }));

import ResearcherLayout from '@/app/(researcher)/layout';
import Sidebar from '@/components/researcher/Sidebar';

function conPerfil(role: string | null) {
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
  db.mockTable('profiles', { data: role ? { user_id: 'u1', role, nombre: 'Ana', apellido: 'Lopez' } : null, error: null });
}

beforeEach(() => {
  db.reset();
  getUserMock.mockReset();
  redirectMock.mockClear();
  pathnameMock.mockReturnValue('/antropometrias');
});

describe('layout del panel de investigador (guard de Antropometrías)', () => {
  const hijos = <p>Contenido de Antropometrías</p>;

  it('sin sesión → redirige a /login y no renderiza el contenido', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    await expect(ResearcherLayout({ children: hijos })).rejects.toThrow('REDIRECT:/login');
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('con sesión pero sin perfil → redirige a /login', async () => {
    conPerfil(null);
    await expect(ResearcherLayout({ children: hijos })).rejects.toThrow('REDIRECT:/login');
  });

  it.each(['deportista_ucc', 'particular'])('rol %s → redirige a /home y no renderiza el contenido', async (rol) => {
    conPerfil(rol);
    await expect(ResearcherLayout({ children: hijos })).rejects.toThrow('REDIRECT:/home');
    expect(redirectMock).toHaveBeenCalledWith('/home');
  });

  it.each(['investigador', 'administrador'])('rol %s → renderiza el contenido dentro del panel', async (rol) => {
    conPerfil(rol);
    render(await ResearcherLayout({ children: hijos }));
    expect(screen.getByText('Contenido de Antropometrías')).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe('Sidebar — entrada Antropometrías', () => {
  // La barra se renderiza dos veces (escritorio y drawer móvil): se toma la del escritorio.
  function entrada() {
    render(<Sidebar nombre="Ana" apellido="Lopez" open={false} onClose={() => {}} />);
    const [navEscritorio] = screen.getAllByRole('navigation', { hidden: true });
    return within(navEscritorio).getByRole('link', { name: 'Antropometrías', hidden: true });
  }

  it('existe y apunta a /antropometrias', () => {
    expect(entrada()).toHaveAttribute('href', '/antropometrias');
  });

  it.each(['/antropometrias', '/antropometrias/nuevo', '/antropometrias/manual/abc', '/antropometrias/medicion/xyz/editar'])(
    'está marcada como activa en %s',
    (ruta) => {
      pathnameMock.mockReturnValue(ruta);
      expect(entrada()).toHaveAttribute('aria-current', 'page');
    },
  );

  it.each(['/dashboard', '/deportistas', '/antropometriasX'])('no está activa en %s', (ruta) => {
    pathnameMock.mockReturnValue(ruta);
    expect(entrada()).not.toHaveAttribute('aria-current');
  });
});
