/**
 * Páginas de servidor de Antropometrías (ficha e informe) con Supabase simulado:
 * qué mediciones se listan, cuál es la "anterior" y qué se bloquea.
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';
import { SERIES_JULIETA } from './fixtures/antropometria';

const sb = createSupabaseFromMock();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: sb.from, rpc: sb.rpc, storage: sb.storage }),
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

import FichaPacientePage from '@/app/(researcher)/antropometrias/[origen]/[id]/page';
import InformePage from '@/app/(researcher)/antropometrias/medicion/[medicionId]/page';

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

function medicion(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: null,
    paciente_manual_id: 'p1',
    fecha_medicion: '2026-10-24',
    investigador_id: 'inv-1',
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

const INVESTIGADORA = { user_id: 'inv-1', nombre: 'Ana', apellido: 'Lopez' };

beforeEach(() => sb.reset());

describe('página del informe', () => {
  function cargar(actual: Record<string, unknown>, todas: Record<string, unknown>[]) {
    sb.mockTable('antropometria_mediciones', { data: actual, error: null });
    sb.mockTable('antropometria_pacientes_manuales', { data: PACIENTE, error: null });
    sb.mockTable('antropometria_mediciones', { data: todas, error: null });
    sb.mockTable('profiles', { data: [INVESTIGADORA], error: null });
  }

  it('calcula el informe al vuelo y muestra los valores ancla', async () => {
    const actual = medicion('m2');
    cargar(actual, [actual]);

    render(await InformePage({ params: Promise.resolve({ medicionId: 'm2' }) }));

    expect(screen.getByRole('heading', { level: 1, name: 'Marchetti, Julieta' })).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Masa adiposa/ })).getByText('17,64')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Masa muscular/ })).getByText('21,26')).toBeInTheDocument();
    expect(within(screen.getByText('Endomorfia').closest('div')!).getByText('2,8')).toBeInTheDocument();
    expect(within(screen.getByText('IMC').closest('div')!).getByText('19,8 kg/m²')).toBeInTheDocument();
    expect(screen.getByText('Ana Lopez')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar PDF' })).toBeInTheDocument();
    // Sin medición anterior: no hay columnas de diferencias.
    expect(screen.queryByRole('columnheader', { name: 'Δ kg' })).not.toBeInTheDocument();
  });

  it('compara con la vigente inmediatamente anterior por fecha (no con la primera ni con una posterior)', async () => {
    const actual = medicion('m3', { fecha_medicion: '2026-10-24' });
    const anterior = medicion('m2', { fecha_medicion: '2026-09-20', series: { ...SERIES_JULIETA, peso: [54.1, 54.1] } });
    const primera = medicion('m1', { fecha_medicion: '2026-05-10' });
    const posterior = medicion('m4', { fecha_medicion: '2026-11-15' });
    cargar(actual, [primera, anterior, actual, posterior]);

    render(await InformePage({ params: Promise.resolve({ medicionId: 'm3' }) }));

    expect(screen.getByText(/medición del 20\/09\/2026/)).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Peso bruto/ })).getByText('−1,05')).toBeInTheDocument();
  });

  it('editar los datos crudos cambia el informe (se recalcula al vuelo) y muestra quién modificó', async () => {
    const editada = medicion('m2', { series: { ...SERIES_JULIETA, pliegue_triceps: [24, 26] }, actualizado_por: 'inv-2' });
    sb.mockTable('antropometria_mediciones', { data: editada, error: null });
    sb.mockTable('antropometria_pacientes_manuales', { data: PACIENTE, error: null });
    sb.mockTable('antropometria_mediciones', { data: [editada], error: null });
    sb.mockTable('profiles', { data: [INVESTIGADORA, { user_id: 'inv-2', nombre: 'Beto', apellido: 'Diaz' }], error: null });

    render(await InformePage({ params: Promise.resolve({ medicionId: 'm2' }) }));

    // Con el tríceps duplicado la masa adiposa ya no es la del valor ancla (17,64 kg).
    expect(within(screen.getByRole('row', { name: /Masa adiposa/ })).queryByText('17,64')).not.toBeInTheDocument();
    expect(screen.getByText(/Última modificación/)).toBeInTheDocument();
    expect(screen.getByText(/Beto Diaz/)).toBeInTheDocument();
  });

  it('una medición anulada no se abre', async () => {
    sb.mockTable('antropometria_mediciones', { data: medicion('m9', { estado: 'anulada' }), error: null });
    await expect(InformePage({ params: Promise.resolve({ medicionId: 'm9' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('un borrador no tiene informe: vuelve al asistente', async () => {
    sb.mockTable('antropometria_mediciones', { data: medicion('m8', { estado: 'borrador' }), error: null });
    await expect(InformePage({ params: Promise.resolve({ medicionId: 'm8' }) })).rejects.toThrow('NEXT_REDIRECT:/antropometrias/medicion/m8/editar');
  });

  it('si el motor no puede calcular, lo explica en vez de romper', async () => {
    const menor = medicion('m5');
    sb.mockTable('antropometria_mediciones', { data: menor, error: null });
    sb.mockTable('antropometria_pacientes_manuales', { data: { ...PACIENTE, fecha_nacimiento: '2015-01-01' }, error: null });
    sb.mockTable('antropometria_mediciones', { data: [menor], error: null });
    sb.mockTable('profiles', { data: [INVESTIGADORA], error: null });

    render(await InformePage({ params: Promise.resolve({ medicionId: 'm5' }) }));

    expect(screen.getByRole('alert')).toHaveTextContent(/No se pudo calcular el informe.*mayores de 18/);
    expect(screen.getByRole('link', { name: 'Editar la medición' })).toBeInTheDocument();
  });

  it('una medición inexistente → 404', async () => {
    sb.mockTable('antropometria_mediciones', { data: null, error: null });
    await expect(InformePage({ params: Promise.resolve({ medicionId: 'nada' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('página de la ficha', () => {
  function cargarFicha(mediciones: Record<string, unknown>[], paciente: Record<string, unknown> = PACIENTE) {
    sb.mockTable('antropometria_pacientes_manuales', { data: paciente, error: null });
    sb.mockTable('antropometria_mediciones', { data: mediciones, error: null });
    sb.mockTable('profiles', { data: [INVESTIGADORA], error: null });
  }
  const abrir = async (origen = 'manual') => render(await FichaPacientePage({ params: Promise.resolve({ origen, id: 'p1' }) }));

  it('lista las vigentes con investigador, peso y masas; los borradores van aparte con "Retomar"', async () => {
    cargarFicha([medicion('m1'), medicion('b1', { estado: 'borrador', fecha_medicion: '2026-10-28', series: {} })]);
    await abrir();

    const fila = screen.getByRole('row', { name: /24\/10\/2026/ });
    expect(within(fila).getByText('Ana Lopez')).toBeInTheDocument();
    expect(within(fila).getByText('17,64 kg')).toBeInTheDocument();
    expect(within(fila).getByRole('link', { name: 'Ver informe' })).toHaveAttribute('href', '/antropometrias/medicion/m1');
    expect(screen.getByText('Borrador')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Retomar' })).toHaveAttribute('href', '/antropometrias/medicion/b1/editar');
    expect(screen.getByRole('link', { name: 'Nueva medición' })).toHaveAttribute('href', '/antropometrias/manual/p1/medicion/nueva');
    expect(screen.getByText('1 de 12')).toBeInTheDocument();
  });

  it('cada medición ofrece Ver informe, Editar y Anular; el borrador, Retomar y Descartar', async () => {
    cargarFicha([medicion('m1'), medicion('b1', { estado: 'borrador', fecha_medicion: '2026-10-28', series: {} })]);
    await abrir();

    const fila = screen.getByRole('row', { name: /24\/10\/2026/ });
    expect(within(fila).getByRole('link', { name: 'Editar' })).toHaveAttribute('href', '/antropometrias/medicion/m1/editar');
    expect(within(fila).getByRole('button', { name: 'Anular' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument();
  });

  it('sin mediciones muestra el estado vacío', async () => {
    cargarFicha([]);
    await abrir();
    expect(screen.getByText('Todavía no tiene mediciones')).toBeInTheDocument();
  });

  it('con 12 mediciones vigentes "Nueva medición" queda deshabilitado con el motivo', async () => {
    cargarFicha(Array.from({ length: 12 }, (_, i) => medicion(`m${i}`, { fecha_medicion: `2025-${String(i + 1).padStart(2, '0')}-10` })));
    await abrir();
    expect(screen.getByRole('button', { name: 'Nueva medición' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/12 mediciones/);
    expect(screen.queryByRole('link', { name: 'Nueva medición' })).not.toBeInTheDocument();
  });

  it('un paciente menor no puede tener mediciones nuevas', async () => {
    cargarFicha([], { ...PACIENTE, fecha_nacimiento: '2015-01-01' });
    await abrir();
    expect(screen.getByRole('button', { name: 'Nueva medición' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/mayores de 18/);
  });

  it('un origen inválido o un paciente inexistente → 404', async () => {
    await expect(FichaPacientePage({ params: Promise.resolve({ origen: 'otro', id: 'p1' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    sb.mockTable('antropometria_pacientes_manuales', { data: null, error: null });
    await expect(FichaPacientePage({ params: Promise.resolve({ origen: 'manual', id: 'nadie' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
