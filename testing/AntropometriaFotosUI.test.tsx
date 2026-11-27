/**
 * NUT-251/NUT-240 — Fotos posturales en la pantalla: aviso al anular, sección del informe (en pantalla, no impresa),
 * asistente (revisión con y sin borrador guardado) y páginas con Supabase simulado.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';
import { SERIES_JULIETA } from './fixtures/antropometria';

const { getUserMock, guardarBorrador, anular } = vi.hoisted(() => ({ getUserMock: vi.fn(), guardarBorrador: vi.fn(), anular: vi.fn() }));
const sb = createSupabaseFromMock();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: sb.from, rpc: sb.rpc, storage: sb.storage }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/antropometrias',
}));
vi.mock('@/app/(researcher)/antropometrias/actions', () => ({
  anularMedicionAction: anular,
  guardarBorradorAction: guardarBorrador,
  finalizarMedicionAction: vi.fn(),
  registrarFotoAction: vi.fn(),
  quitarFotoAction: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ storage: { from: () => ({}) } }) }));

import AnularMedicion from '@/app/(researcher)/antropometrias/AnularMedicion';
import FichaPacientePage from '@/app/(researcher)/antropometrias/[origen]/[id]/page';
import MedicionWizard from '@/app/(researcher)/antropometrias/MedicionWizard';
import AccionesInforme from '@/app/(researcher)/antropometrias/medicion/[medicionId]/AccionesInforme';
import EditarMedicionPage from '@/app/(researcher)/antropometrias/medicion/[medicionId]/editar/page';
import FotosInforme from '@/app/(researcher)/antropometrias/medicion/[medicionId]/FotosInforme';
import InformePage from '@/app/(researcher)/antropometrias/medicion/[medicionId]/page';
import type { FotoMedicion } from '@/lib/researcher/antropometria/fotos';

const FRENTE: FotoMedicion = { id: 'f1', posicion: 'frente', url: 'https://storage.test/firmada/frente.jpg?token=t' };
const ESPALDA: FotoMedicion = { id: 'f3', posicion: 'espalda', url: 'https://storage.test/firmada/espalda.jpg?token=t' };

const AVISO_3 = 'También se van a borrar las 3 fotos posturales. Esta acción no se puede deshacer.';

beforeEach(() => {
  sb.reset();
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'inv-1' } } });
  guardarBorrador.mockReset().mockResolvedValue({ ok: true, id: 'nuevo-1' });
  anular.mockReset().mockResolvedValue({ ok: true, fichaHref: '/antropometrias/manual/p1' });
});

describe('AnularMedicion avisa que se borran las fotos', () => {
  it('con 3 fotos lo dice, con "no se puede deshacer", sin dejar de aclarar que la medición queda registrada', async () => {
    render(<AnularMedicion medicionId="m1" fecha="24/10/2026" destino="ficha" fotos={3} />);
    await userEvent.click(screen.getByRole('button', { name: 'Anular' }));

    const dialogo = screen.getByRole('dialog');
    expect(dialogo).toHaveTextContent(AVISO_3);
    expect(dialogo).toHaveTextContent('No se borra: queda registrada como anulada.');
  });

  it('con 1 foto usa el singular', async () => {
    render(<AnularMedicion medicionId="m1" fecha="24/10/2026" destino="ficha" fotos={1} />);
    await userEvent.click(screen.getByRole('button', { name: 'Anular' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('También se va a borrar la foto postural. Esta acción no se puede deshacer.');
  });

  it('también al descartar un borrador con fotos', async () => {
    render(<AnularMedicion medicionId="b1" fecha="28/10/2026" esBorrador destino="refrescar" fotos={2} />);
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('También se van a borrar las 2 fotos posturales.');
  });

  it('sin fotos (o sin el dato) no menciona fotos', async () => {
    const { unmount } = render(<AnularMedicion medicionId="m1" fecha="24/10/2026" destino="ficha" fotos={0} />);
    await userEvent.click(screen.getByRole('button', { name: 'Anular' }));
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/foto/i);
    unmount();

    render(<AnularMedicion medicionId="m1" fecha="24/10/2026" destino="ficha" />);
    await userEvent.click(screen.getByRole('button', { name: 'Anular' }));
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/foto/i);
  });

  it('si la baja falla por las fotos muestra el mensaje del servidor y deja el diálogo abierto', async () => {
    anular.mockResolvedValue({ error: 'No se pudieron borrar las fotos; la medición no se anuló. Probá de nuevo.' });
    render(<AnularMedicion medicionId="m1" fecha="24/10/2026" destino="ficha" fotos={3} />);
    await userEvent.click(screen.getByRole('button', { name: 'Anular' }));
    await userEvent.click(screen.getByRole('button', { name: 'Anular medición' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('la medición no se anuló');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('desde el informe, AccionesInforme pasa la cantidad de fotos al diálogo', async () => {
    render(<AccionesInforme medicionId="m1" fecha="24/10/2026" nombreArchivo="informe" hrefEditar="/editar" fotos={3} />);
    await userEvent.click(screen.getByRole('button', { name: 'Anular' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(AVISO_3);
  });
});

describe('FotosInforme (sección en pantalla)', () => {
  it('muestra las miniaturas con su posición, y se oculta al imprimir', () => {
    const { container } = render(<FotosInforme fotos={[FRENTE, ESPALDA]} />);

    const seccion = screen.getByRole('region', { name: 'Fotos posturales' });
    expect(within(seccion).getAllByRole('img').map((i) => i.getAttribute('src'))).toEqual([FRENTE.url, ESPALDA.url]);
    expect(within(seccion).getByText('Frente')).toBeInTheDocument();
    expect(within(seccion).getByText('Espalda')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('no-imprimir', 'print:hidden');
  });

  it('sin fotos no muestra nada', () => {
    const { container } = render(<FotosInforme fotos={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('una foto sin URL firmada lo avisa en vez de mostrar una imagen rota', () => {
    render(<FotosInforme fotos={[{ ...FRENTE, url: null }]} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('No se pudo mostrar la foto')).toBeInTheDocument();
  });
});

describe('asistente: fotos en la revisión', () => {
  const PACIENTE = {
    origen: 'manual' as const,
    id: 'p1',
    nombre: 'Julieta',
    apellido: 'Marchetti',
    fechaNacimiento: '2002-04-05',
    sexo: 'F' as const,
    masaOseaReferencia: null,
  };
  const INSTRUMENTOS = { balanza: '', calibres: '', plicometro: '', cinta: '' };
  const mostrar = (props: Partial<React.ComponentProps<typeof MedicionWizard>> = {}) =>
    render(
      <MedicionWizard
        paciente={PACIENTE}
        otrasVigentes={[]}
        hoy="2026-10-30"
        inicial={null}
        investigadores={[{ id: 'inv-1', nombre: 'Lucía Ferreyra' }]}
        miId="inv-1"
        misInstrumentos={INSTRUMENTOS}
        etmPorInvestigador={{}}
        {...props}
      />,
    );
  const irARevision = () => userEvent.click(screen.getByRole('button', { name: /5\. Revisión/ }));

  it('la revisión tiene la sección Fotos posturales, opcional y debajo de instrumentos', async () => {
    mostrar();
    await irARevision();
    expect(screen.getByRole('region', { name: 'Fotos posturales' })).toHaveTextContent('Opcional · hasta 3 por medición · 0 de 3 cargadas');
  });

  it('una medición nueva sin borrador guardado tiene los espacios deshabilitados', async () => {
    mostrar();
    await irARevision();
    expect(screen.getByText('Se habilitan cuando se guarda el borrador.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subir foto de frente' })).toBeDisabled();
  });

  it('cuando el autoguardado crea el borrador, los espacios se habilitan', async () => {
    mostrar();
    await userEvent.selectOptions(screen.getByLabelText('Nivel de actividad'), 'moderada'); // toca el formulario: dispara el autoguardado
    await waitFor(() => expect(guardarBorrador).toHaveBeenCalled(), { timeout: 4000 });
    await irARevision();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Subir foto de frente' })).toBeEnabled());
    expect(screen.queryByText(/Se habilitan cuando se guarda el borrador/)).not.toBeInTheDocument();
  });

  it('al retomar o editar una medición muestra las fotos ya cargadas y permite quitarlas', async () => {
    mostrar({
      inicial: {
        id: 'm1',
        estado: 'vigente',
        fechaMedicion: '2026-10-24',
        nivelActividad: 'moderada',
        deporte: null,
        series: SERIES_JULIETA,
        medidoPor: 'inv-1',
        instrumentos: INSTRUMENTOS,
      },
      fotosIniciales: [FRENTE, ESPALDA],
    });
    await irARevision();

    const seccion = screen.getByRole('region', { name: 'Fotos posturales' });
    expect(seccion).toHaveTextContent('2 de 3 cargadas');
    expect(within(seccion).getByRole('img', { name: 'Foto postural: frente' })).toHaveAttribute('src', FRENTE.url);
    expect(within(seccion).getByRole('button', { name: 'Quitar foto de espalda' })).toBeEnabled();
  });

  it('las fotos nunca bloquean guardar: "Guardar y generar informe" no depende de ellas', async () => {
    mostrar({
      inicial: {
        id: 'm1',
        estado: 'borrador',
        fechaMedicion: '2026-10-24',
        nivelActividad: 'moderada',
        deporte: null,
        series: SERIES_JULIETA,
        medidoPor: 'inv-1',
        instrumentos: INSTRUMENTOS,
      },
    });
    await irARevision();
    expect(screen.getByRole('button', { name: 'Guardar y generar informe' })).toBeEnabled();
  });
});

describe('páginas con fotos', () => {
  const PACIENTE_FILA = {
    id: 'p1',
    nombre: 'Julieta',
    apellido: 'Marchetti',
    fecha_nacimiento: '2002-04-05',
    sexo: 'F',
    masa_osea_referencia: 6.196,
    creado_por: 'inv-1',
    creado_en: '2026-10-01T00:00:00Z',
  };
  const INVESTIGADORA = { user_id: 'inv-1', nombre: 'Ana', apellido: 'Lopez' };

  function medicion(id: string, over: Record<string, unknown> = {}) {
    return {
      id,
      user_id: null,
      paciente_manual_id: 'p1',
      fecha_medicion: '2026-10-24',
      investigador_id: 'inv-1',
      medido_por: null,
      instrumento_balanza: null,
      instrumento_calibres: null,
      instrumento_plicometro: null,
      instrumento_cinta: null,
      nivel_actividad: 'moderada',
      deporte: 'voleibol',
      series: SERIES_JULIETA,
      estado: 'vigente',
      creado_en: '2026-10-24T12:00:00Z',
      actualizado_en: '2026-10-24T12:00:00Z',
      actualizado_por: 'inv-1',
      ...over,
    };
  }
  const filaFoto = (posicion: string, medicionId = 'm1') => ({
    id: `foto-${posicion}`,
    medicion_id: medicionId,
    posicion,
    path: `${medicionId}/${posicion}-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`,
    creado_por: 'inv-1',
    creado_en: '2026-10-24T12:00:00Z',
  });
  const firmar = (filas: ReturnType<typeof filaFoto>[]) =>
    sb.mockStorage('createSignedUrls', { data: filas.map((f) => ({ path: f.path, signedUrl: `https://storage.test/firmada/${f.path}` })), error: null });

  describe('informe', () => {
    function cargar(actual: Record<string, unknown>) {
      sb.mockTable('antropometria_mediciones', { data: actual, error: null });
      sb.mockTable('antropometria_pacientes_manuales', { data: PACIENTE_FILA, error: null });
      sb.mockTable('antropometria_mediciones', { data: [actual], error: null });
      sb.mockTable('profiles', { data: [INVESTIGADORA], error: null });
    }
    const abrir = async () => render(await InformePage({ params: Promise.resolve({ medicionId: 'm1' }) }));

    it('con fotos muestra la sección FUERA del informe imprimible, con signed URLs de corta duración', async () => {
      cargar(medicion('m1'));
      const filas = [filaFoto('frente'), filaFoto('espalda')];
      sb.mockTable('antropometria_fotos', { data: filas, error: null });
      firmar(filas);

      await abrir();

      const seccion = screen.getByRole('region', { name: 'Fotos posturales' });
      expect(within(seccion).getAllByRole('img')).toHaveLength(2);
      expect(within(seccion).getAllByRole('img')[0].getAttribute('src')).toContain('https://storage.test/firmada/m1/frente-');
      expect(document.getElementById('informe-imprimible')).not.toContainElement(seccion);
      expect(seccion.closest('.no-imprimir')).not.toBeNull();
      // la confirmación de anular conoce la cantidad
      await userEvent.click(screen.getByRole('button', { name: 'Anular' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('También se van a borrar las 2 fotos posturales.');
      expect(sb.storageLlamadas().find((l) => l.metodo === 'createSignedUrls')?.args[1]).toBe(600);
    });

    it('sin fotos no hay sección ni aviso en "Anular"', async () => {
      cargar(medicion('m1'));
      await abrir();

      expect(screen.queryByRole('region', { name: 'Fotos posturales' })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Anular' }));
      expect(screen.getByRole('dialog')).not.toHaveTextContent(/foto/i);
    });
  });

  describe('ficha', () => {
    it('cada medición avisa al anular cuántas fotos tiene (borradores incluidos)', async () => {
      sb.mockTable('antropometria_pacientes_manuales', { data: PACIENTE_FILA, error: null });
      sb.mockTable('antropometria_mediciones', {
        data: [medicion('m1'), medicion('b1', { estado: 'borrador', fecha_medicion: '2026-10-28', series: {} })],
        error: null,
      });
      sb.mockTable('profiles', { data: [INVESTIGADORA], error: null });
      sb.mockTable('antropometria_fotos', {
        data: [{ medicion_id: 'm1' }, { medicion_id: 'm1' }, { medicion_id: 'm1' }, { medicion_id: 'b1' }],
        error: null,
      });

      render(await FichaPacientePage({ params: Promise.resolve({ origen: 'manual', id: 'p1' }) }));

      await userEvent.click(within(screen.getByRole('row', { name: /24\/10\/2026/ })).getByRole('button', { name: 'Anular' }));
      expect(screen.getByRole('dialog')).toHaveTextContent(AVISO_3);
      await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

      await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('También se va a borrar la foto postural.');
    });
  });

  describe('editar', () => {
    it('carga las fotos de la medición y las pasa al asistente', async () => {
      sb.mockTable('antropometria_mediciones', { data: medicion('m1'), error: null });
      sb.mockTable('antropometria_pacientes_manuales', { data: PACIENTE_FILA, error: null });
      sb.mockTable('antropometria_mediciones', { data: [], error: null });
      sb.mockTable('profiles', { data: [INVESTIGADORA], error: null });
      const filas = [filaFoto('lateral')];
      sb.mockTable('antropometria_fotos', { data: filas, error: null });
      firmar(filas);

      render(await EditarMedicionPage({ params: Promise.resolve({ medicionId: 'm1' }) }));
      await userEvent.click(screen.getByRole('button', { name: /5\. Revisión/ }));

      const seccion = screen.getByRole('region', { name: 'Fotos posturales' });
      expect(seccion).toHaveTextContent('1 de 3 cargadas');
      expect(within(seccion).getByRole('img', { name: 'Foto postural: lateral' })).toBeInTheDocument();
    });
  });
});
