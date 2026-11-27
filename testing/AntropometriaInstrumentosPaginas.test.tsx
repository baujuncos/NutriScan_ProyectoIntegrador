/**
 * NUT-246/NUT-240 — Páginas con Supabase simulado: pie del informe (quién midió, instrumentos, ETM),
 * columna "Investigador" de la ficha y pantalla "Instrumentos y error técnico".
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';
import { SERIES_JULIETA } from './fixtures/antropometria';
import { calcularErrorTecnico } from '@/lib/antropometria';
import { fmtFijo } from '@/lib/researcher/antropometria/formato';

const { getUserMock, guardarMisInstrumentos } = vi.hoisted(() => ({ getUserMock: vi.fn(), guardarMisInstrumentos: vi.fn() }));
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
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/antropometrias',
}));
vi.mock('@/app/(researcher)/antropometrias/actions', () => ({
  guardarMisInstrumentosAction: guardarMisInstrumentos,
  anularMedicionAction: vi.fn(),
}));

import FichaPacientePage from '@/app/(researcher)/antropometrias/[origen]/[id]/page';
import ConfiguracionPage from '@/app/(researcher)/antropometrias/configuracion/page';
import EditarMedicionPage from '@/app/(researcher)/antropometrias/medicion/[medicionId]/editar/page';
import InformePage from '@/app/(researcher)/antropometrias/medicion/[medicionId]/page';
import NuevaMedicionPage from '@/app/(researcher)/antropometrias/[origen]/[id]/medicion/nueva/page';

const PACIENTE = {
  id: 'p1',
  nombre: 'Julieta',
  apellido: 'Marchetti',
  fecha_nacimiento: '2002-04-05',
  sexo: 'F',
  masa_osea_referencia: 6.196,
  creado_por: 'inv-1',
  creado_en: '2026-10-01T00:00:00Z',
};

const LUCIA = { user_id: 'inv-1', nombre: 'Lucía', apellido: 'Ferreyra' };
const MARTIN = { user_id: 'inv-2', nombre: 'Martín', apellido: 'Sosa' };

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

beforeEach(() => {
  sb.reset();
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'inv-1' } } });
  guardarMisInstrumentos.mockReset().mockResolvedValue({ ok: true });
});

describe('informe — pie con responsable, instrumentos y error técnico', () => {
  /** `vigentes` = lo que lee la consulta del error técnico (todas las vigentes de todos los pacientes). */
  function cargar(actual: Record<string, unknown>, vigentes: Record<string, unknown>[] = [actual]) {
    sb.mockTable('antropometria_mediciones', { data: actual, error: null });
    sb.mockTable('antropometria_pacientes_manuales', { data: PACIENTE, error: null });
    sb.mockTable('antropometria_mediciones', { data: [actual], error: null });
    sb.mockTable('profiles', { data: [LUCIA, MARTIN], error: null });
    sb.mockTable('antropometria_mediciones', { data: vigentes, error: null });
  }
  const abrir = async (id: string) => render(await InformePage({ params: Promise.resolve({ medicionId: id }) }));

  it('muestra "Medido por" con quien midió (no con quien cargó), los instrumentos informados y el ETM de ese investigador', async () => {
    const actual = medicion('m1', {
      medido_por: 'inv-2',
      instrumento_balanza: 'Tanita BC-601',
      instrumento_plicometro: 'Harpenden',
    });
    cargar(actual, [
      actual,
      medicion('m2', { medido_por: 'inv-2', series: { ...SERIES_JULIETA, pliegue_triceps: [14, 12] } }),
      medicion('m3', { medido_por: null, investigador_id: 'inv-1' }), // de otro investigador: no cuenta
    ]);

    await abrir('m1');

    const pie = screen.getByRole('contentinfo', { name: 'Responsable e instrumentos' });
    expect(within(pie).getByText('Medido por: Martín Sosa')).toBeInTheDocument();
    expect(within(pie).getByText('Balanza')).toBeInTheDocument();
    expect(within(pie).getByText('Tanita BC-601')).toBeInTheDocument();
    expect(within(pie).getByText('Plicómetro')).toBeInTheDocument();
    expect(within(pie).getByText('Harpenden')).toBeInTheDocument();
    // Los no informados se omiten.
    expect(within(pie).queryByText('Calibres y segmómetro')).not.toBeInTheDocument();
    expect(within(pie).queryByText('Cinta antropométrica')).not.toBeInTheDocument();

    const esperado = calcularErrorTecnico([actual.series, { ...SERIES_JULIETA, pliegue_triceps: [14, 12] }] as never);
    expect(within(pie).getByText('% ETM pliegues').nextElementSibling).toHaveTextContent(`${fmtFijo(esperado.resumen.pliegues, 2)} %`);
    expect(within(pie).getByText('% ETM otras variables').nextElementSibling).toHaveTextContent(`${fmtFijo(esperado.resumen.otras, 2)} %`);
    expect(within(pie).getByText(/sobre 2 mediciones vigentes/)).toBeInTheDocument();
    // El encabezado también dice quién midió.
    expect(screen.getByText('Martín Sosa')).toBeInTheDocument();
  });

  it('sin quién midió registrado (medición anterior a esta función) usa a quien la cargó', async () => {
    cargar(medicion('m1'));
    await abrir('m1');
    expect(screen.getByText('Medido por: Lucía Ferreyra')).toBeInTheDocument();
  });

  it('sin ningún instrumento el bloque de instrumentos se omite, pero queda el responsable y el ETM', async () => {
    cargar(medicion('m1'));
    await abrir('m1');
    const pie = screen.getByRole('contentinfo', { name: 'Responsable e instrumentos' });
    expect(within(pie).queryByRole('heading', { name: 'Instrumentos' })).not.toBeInTheDocument();
    expect(within(pie).getByRole('heading', { name: 'Error técnico de medición' })).toBeInTheDocument();
  });

  it('el pie muestra los instrumentos GUARDADOS en la medición, no el catálogo actual del investigador', async () => {
    cargar(medicion('m1', { instrumento_cinta: 'Cescorf' }));
    await abrir('m1');
    const pie = screen.getByRole('contentinfo', { name: 'Responsable e instrumentos' });
    expect(within(pie).getByText('Cescorf')).toBeInTheDocument();
    // (el informe nunca consulta "mis instrumentos")
    expect(sb.tablasLlamadas()).not.toContain('antropometria_instrumentos_investigador');
  });
});

describe('ficha — columna "Investigador"', () => {
  it('muestra quien midió y, si no hay, quien cargó la medición', async () => {
    sb.mockTable('antropometria_pacientes_manuales', { data: PACIENTE, error: null });
    sb.mockTable('antropometria_mediciones', {
      data: [medicion('m1', { medido_por: 'inv-2', fecha_medicion: '2026-10-24' }), medicion('m2', { fecha_medicion: '2026-09-10' })],
      error: null,
    });
    sb.mockTable('profiles', { data: [LUCIA, MARTIN], error: null });

    render(await FichaPacientePage({ params: Promise.resolve({ origen: 'manual', id: 'p1' }) }));

    expect(within(screen.getByRole('row', { name: /24\/10\/2026/ })).getByText('Martín Sosa')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /10\/09\/2026/ })).getByText('Lucía Ferreyra')).toBeInTheDocument();
  });
});

describe('pantalla "Instrumentos y error técnico"', () => {
  function cargar(opciones: { mias?: Record<string, unknown> | null; vigentes?: Record<string, unknown>[] } = {}) {
    sb.mockTable('profiles', { data: [LUCIA, MARTIN], error: null });
    sb.mockTable('antropometria_mediciones', {
      data: opciones.vigentes ?? [
        medicion('m1', { series: { peso: [50, 52], pliegue_triceps: [10, 12] } }),
        medicion('m2', { series: { peso: [60, 59], pliegue_triceps: [11, 11] } }),
      ],
      error: null,
    });
    sb.mockTable('antropometria_instrumentos_investigador', { data: opciones.mias ?? null, error: null });
  }
  const abrir = async (investigador?: string) =>
    render(await ConfiguracionPage({ searchParams: Promise.resolve(investigador ? { investigador } : {}) }));

  it('arma el formulario con "Mis instrumentos" guardados y las 4 etiquetas', async () => {
    cargar({ mias: { instrumento_balanza: 'Tanita BC-601', instrumento_calibres: null, instrumento_plicometro: 'Harpenden', instrumento_cinta: null } });
    await abrir();

    expect(screen.getByRole('heading', { level: 1, name: 'Instrumentos y error técnico' })).toBeInTheDocument();
    expect(screen.getByLabelText('Balanza')).toHaveValue('Tanita BC-601');
    expect(screen.getByLabelText('Calibres y segmómetro')).toHaveValue('');
    expect(screen.getByLabelText('Plicómetro')).toHaveValue('Harpenden');
    expect(screen.getByLabelText('Cinta antropométrica')).toHaveValue('');
    expect(screen.getByLabelText('Balanza')).toHaveAttribute('placeholder', 'Modelo o marca');
    expect(screen.getByRole('link', { name: '← Antropometrías' })).toHaveAttribute('href', '/antropometrias');
  });

  it('guarda lo escrito y confirma; si falla, muestra el error', async () => {
    cargar();
    await abrir();

    await userEvent.type(screen.getByLabelText('Cinta antropométrica'), 'Lufkin');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar instrumentos' }));
    expect(guardarMisInstrumentos).toHaveBeenCalledWith({ balanza: '', calibres: '', plicometro: '', cinta: 'Lufkin' });
    expect(await screen.findByRole('status')).toHaveTextContent('Instrumentos guardados.');

    guardarMisInstrumentos.mockResolvedValue({ error: 'Cada instrumento admite hasta 120 caracteres.' });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar instrumentos' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('hasta 120 caracteres');
  });

  it('un instrumento vacío no impide guardar (todo opcional)', async () => {
    cargar();
    await abrir();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar instrumentos' }));
    expect(guardarMisInstrumentos).toHaveBeenCalledWith({ balanza: '', calibres: '', plicometro: '', cinta: '' });
  });

  it('el ETM de cada investigador arranca en el propio y lista las 25 variables agrupadas, con es-AR', async () => {
    cargar();
    await abrir();

    expect(screen.getByLabelText('Investigador')).toHaveValue('inv-1');
    const tabla = screen.getByRole('table', { name: /Error técnico de medición de Lucía Ferreyra/ });
    for (const grupo of ['Básicos', 'Diámetros', 'Perímetros', 'Pliegues']) {
      expect(within(tabla).getByText(grupo)).toBeInTheDocument();
    }
    expect(tabla.querySelectorAll('th[scope="row"]')).toHaveLength(25);

    // Peso: (50;52) y (60;59) → ETM √(5/4) = 1,12 kg; % = 2,02; n = 2.
    const peso = within(tabla).getByRole('row', { name: /Peso bruto/ });
    expect(within(peso).getByText('1,12 kg')).toBeInTheDocument();
    expect(within(peso).getByText('2,02 %')).toBeInTheDocument();
    expect(within(peso).getByText('2')).toBeInTheDocument();
    // Una variable sin datos queda en blanco con n = 0.
    expect(within(within(tabla).getByRole('row', { name: /Talla corporal/ })).getByText('0')).toBeInTheDocument();
  });

  it('se puede ver el de otro investigador; si no tiene mediciones vigentes lo explica', async () => {
    cargar();
    await abrir();

    await userEvent.selectOptions(screen.getByLabelText('Investigador'), 'inv-2');

    expect(screen.getByText('Todavía no hay mediciones vigentes de este investigador para calcularlo.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('?investigador=<id> abre el de ese investigador (el link de la revisión); un id desconocido cae en el propio', async () => {
    cargar({ vigentes: [medicion('m1', { medido_por: 'inv-2', series: { peso: [50, 52] } })] });
    await abrir('inv-2');
    expect(screen.getByLabelText('Investigador')).toHaveValue('inv-2');
    expect(screen.getByRole('table', { name: /Martín Sosa/ })).toBeInTheDocument();

    document.body.innerHTML = '';
    cargar();
    await abrir('no-existe');
    expect(screen.getByLabelText('Investigador')).toHaveValue('inv-1');
  });
});

describe('asistente — datos que llegan desde el servidor', () => {
  const irARevision = () => userEvent.click(screen.getByRole('button', { name: /5\. Revisión/ }));

  it('una medición nueva arranca con "Mis instrumentos" y con el usuario como quien midió', async () => {
    sb.mockTable('antropometria_pacientes_manuales', { data: PACIENTE, error: null });
    sb.mockTable('antropometria_mediciones', { data: [], error: null });
    sb.mockTable('profiles', { data: [LUCIA, MARTIN], error: null });
    sb.mockTable('antropometria_mediciones', { data: [medicion('m1', { medido_por: 'inv-1' })], error: null });
    sb.mockTable('antropometria_instrumentos_investigador', {
      data: { instrumento_balanza: 'Tanita BC-601', instrumento_calibres: null, instrumento_plicometro: null, instrumento_cinta: 'Lufkin' },
      error: null,
    });

    render(await NuevaMedicionPage({ params: Promise.resolve({ origen: 'manual', id: 'p1' }) }));
    await irARevision();

    expect(screen.getByLabelText('Balanza')).toHaveValue('Tanita BC-601');
    expect(screen.getByLabelText('Cinta antropométrica')).toHaveValue('Lufkin');
    expect(screen.getByLabelText('Investigador que midió')).toHaveValue('inv-1');
    expect(within(screen.getByRole('group', { name: /Error técnico de medición de Lucía Ferreyra/ })).getByText(/Basado en 1 medición\./)).toBeInTheDocument();
  });

  it('al editar muestra lo guardado en la medición (no "Mis instrumentos") y a quien midió, aunque ya no figure en la lista', async () => {
    const guardada = medicion('m1', { medido_por: 'ex-inv', instrumento_balanza: 'Seca 877' });
    sb.mockTable('antropometria_mediciones', { data: guardada, error: null });
    sb.mockTable('antropometria_pacientes_manuales', { data: PACIENTE, error: null });
    sb.mockTable('antropometria_mediciones', { data: [guardada], error: null });
    sb.mockTable('profiles', { data: [LUCIA, MARTIN], error: null });
    sb.mockTable('antropometria_mediciones', { data: [guardada], error: null });
    sb.mockTable('profiles', { data: [{ user_id: 'ex-inv', nombre: 'Ana', apellido: 'Paz' }], error: null });

    render(await EditarMedicionPage({ params: Promise.resolve({ medicionId: 'm1' }) }));
    await irARevision();

    expect(screen.getByLabelText('Balanza')).toHaveValue('Seca 877');
    expect(screen.getByLabelText('Plicómetro')).toHaveValue('');
    expect(screen.getByLabelText('Investigador que midió')).toHaveValue('ex-inv');
    expect(within(screen.getByLabelText('Investigador que midió')).getByRole('option', { name: 'Ana Paz' })).toBeInTheDocument();
    expect(sb.tablasLlamadas()).not.toContain('antropometria_instrumentos_investigador');
  });
});
