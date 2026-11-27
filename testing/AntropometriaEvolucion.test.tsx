/**
 * Pantalla de Evolución (NUT-244) con Supabase simulado y la paciente ficticia "Julieta Marchetti":
 * tarjetas, gráficos, trayectoria en la somatocarta, comparador A/B y estados vacíos.
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

import EvolucionPage from '@/app/(researcher)/antropometrias/[origen]/[id]/evolucion/page';
import FichaPacientePage from '@/app/(researcher)/antropometrias/[origen]/[id]/page';
import { Somatocarta } from '@/app/(researcher)/antropometrias/medicion/[medicionId]/GraficosInforme';

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

/** La segunda medición se deriva de la de Julieta: 1,55 kg menos y el tríceps más chico. */
const M1 = medicion('m1');
const M2 = medicion('m2', {
  fecha_medicion: '2027-01-10',
  series: { ...SERIES_JULIETA, peso: [51.5, 51.5], pliegue_triceps: [10, 10] },
});

beforeEach(() => sb.reset());

function cargar(mediciones: Record<string, unknown>[], paciente: Record<string, unknown> = PACIENTE) {
  sb.mockTable('antropometria_pacientes_manuales', { data: paciente, error: null });
  sb.mockTable('antropometria_mediciones', { data: mediciones, error: null });
}

const abrir = async (query: { a?: string; b?: string } = {}, origen = 'manual') =>
  render(await EvolucionPage({ params: Promise.resolve({ origen, id: 'p1' }), searchParams: Promise.resolve(query) }));

describe('página de evolución', () => {
  it('muestra las tarjetas con el último valor y la diferencia contra la medición Nº 1', async () => {
    cargar([M1, M2]);
    await abrir();

    expect(screen.getByRole('heading', { level: 1, name: /Evolución · Marchetti, Julieta/ })).toBeInTheDocument();
    const resumen = screen.getByRole('list', { name: 'Resumen de la última medición' });
    const peso = within(resumen).getByText('Peso').closest('li')!;
    expect(within(peso).getByText('51,5')).toBeInTheDocument();
    expect(within(peso).getByText('−1,55 kg desde la medición Nº 1')).toBeInTheDocument();
    const suma = within(resumen).getByText('Suma de 6 pliegues').closest('li')!;
    expect(within(suma).getByText(/^−\d+,\d{2} mm desde la medición Nº 1$/)).toBeInTheDocument();
    expect(within(resumen).getByText('Masa adiposa')).toBeInTheDocument();
    expect(within(resumen).getByText('Masa muscular')).toBeInTheDocument();
  });

  it('dibuja los tres gráficos de líneas y la somatocarta, cada uno con su título y su tabla de datos', async () => {
    cargar([M1, M2]);
    await abrir();

    expect(screen.getByRole('img', { name: 'Masas corporales (kg)' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Peso (kg)' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Suma de 6 pliegues (mm)' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Somatocarta\. Nº 1 · 24\/10\/2026: X .*Nº 2 · 10\/01\/2027/ })).toBeInTheDocument();

    const tablaPeso = screen.getByRole('table', { name: 'Peso: valores de cada medición' });
    expect(within(tablaPeso).getByRole('row', { name: /Nº 2 10\/01\/2027 51,5/ })).toBeInTheDocument();
    const tablaMasas = screen.getByRole('table', { name: 'Masas corporales: valores de cada medición' });
    expect(within(tablaMasas).getAllByRole('columnheader')).toHaveLength(2 + 5);
  });

  it('el eje tiene 12 meses desde el de la primera medición y muestra el año al cambiar', async () => {
    cargar([M1, M2]);
    const { container } = await abrir();

    const eje = container.querySelector('svg[aria-labelledby="grafico-peso-titulo"]')!;
    const etiquetas = [...eje.querySelectorAll('text')].map((t) => t.textContent);
    expect(['oct', 'nov', 'dic', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep'].every((m) => etiquetas.includes(m))).toBe(true);
    expect(etiquetas).toContain('2026');
    expect(etiquetas).toContain('2027');
  });

  it('la somatocarta une las mediciones con una línea y numera los puntos; marca el deporte de referencia', async () => {
    cargar([M1, M2]);
    const { container } = await abrir();

    const carta = container.querySelector('svg[aria-label^="Somatocarta"]')!;
    expect(carta.querySelectorAll('polyline')).toHaveLength(1);
    expect([...carta.querySelectorAll('text')].map((t) => t.textContent)).toEqual(expect.arrayContaining(['1', '2']));
    expect(screen.getByText(/Referencia: /)).toBeInTheDocument();
  });

  it('comparador: por defecto A es la primera y B la última, con diferencia B − A y signo', async () => {
    cargar([M1, M2]);
    await abrir();

    expect(screen.getByLabelText('Medición A')).toHaveValue('m1');
    expect(screen.getByLabelText('Medición B')).toHaveValue('m2');
    expect(within(screen.getByLabelText('Medición A')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Nº 1 · 24/10/2026',
      'Nº 2 · 10/01/2027',
    ]);

    const tabla = screen.getByRole('table', { name: /Comparación entre la medición Nº 1 · 24\/10\/2026 y la Nº 2 · 10\/01\/2027/ });
    expect(within(tabla).getByRole('columnheader', { name: /Nº 1/ })).toBeInTheDocument();
    const peso = within(tabla).getByRole('row', { name: /Peso bruto/ });
    expect(within(peso).getAllByRole('cell').map((c) => c.textContent)).toEqual(['53,05', '51,50', '−1,55']);
    const tricepsFila = within(tabla).getByRole('row', { name: /Tríceps/ });
    expect(within(tricepsFila).getAllByRole('cell').map((c) => c.textContent)).toEqual(['12,50', '10,00', '−2,50']);
    // Las 25 variables, IMC, Σ6, 5 masas y 3 componentes del somatotipo, agrupadas.
    expect(within(tabla).getAllByRole('rowgroup').length).toBeGreaterThanOrEqual(7);
    for (const titulo of ['Datos básicos', 'Índices', 'Masas corporales (Kerr)', 'Somatotipo', 'Diámetros', 'Perímetros', 'Pliegues']) {
      expect(within(tabla).getByRole('columnheader', { name: titulo })).toBeInTheDocument();
    }
    for (const fila of ['IMC', 'Suma de 6 pliegues', 'Masa adiposa', 'Masa muscular', 'Masa ósea', 'Masa residual', 'Masa de la piel', 'Endomorfia', 'Mesomorfia', 'Ectomorfia', 'Talla corporal']) {
      expect(within(tabla).getByRole('row', { name: new RegExp(fila) })).toBeInTheDocument();
    }
  });

  it('la selección viene de la URL: invertir A y B invierte el signo', async () => {
    cargar([M1, M2]);
    await abrir({ a: 'm2', b: 'm1' });

    expect(screen.getByLabelText('Medición A')).toHaveValue('m2');
    const peso = screen.getByRole('row', { name: /Peso bruto/ });
    expect(within(peso).getAllByRole('cell').map((c) => c.textContent)).toEqual(['51,50', '53,05', '+1,55']);
  });

  it('un id desconocido en la URL vuelve a los valores por defecto', async () => {
    cargar([M1, M2]);
    await abrir({ a: 'otra-persona', b: 'tampoco' });
    expect(screen.getByLabelText('Medición A')).toHaveValue('m1');
    expect(screen.getByLabelText('Medición B')).toHaveValue('m2');
  });

  it('A igual a B muestra una indicación y no la tabla de diferencias', async () => {
    cargar([M1, M2]);
    await abrir({ a: 'm2', b: 'm2' });

    expect(screen.getByText(/Elegiste la misma medición en A y en B/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /Comparación entre/ })).not.toBeInTheDocument();
  });

  it('el formulario es un GET con los campos a y b (la elección se puede compartir por URL)', async () => {
    cargar([M1, M2]);
    await abrir();
    expect(screen.getByLabelText('Medición A')).toHaveAttribute('name', 'a');
    expect(screen.getByLabelText('Medición B')).toHaveAttribute('name', 'b');
    expect(screen.getByRole('button', { name: 'Comparar' }).closest('form')).toHaveAttribute('method', 'get');
  });

  it('borradores y anuladas no aparecen: ni en los gráficos ni en el comparador', async () => {
    cargar([M1, medicion('b1', { estado: 'borrador', fecha_medicion: '2026-11-02' }), medicion('x1', { estado: 'anulada', fecha_medicion: '2026-11-03' }), M2]);
    await abrir();

    expect(within(screen.getByLabelText('Medición A')).getAllByRole('option')).toHaveLength(2);
    const tablaPeso = screen.getByRole('table', { name: 'Peso: valores de cada medición' });
    expect(within(tablaPeso).getAllByRole('row')).toHaveLength(1 + 2);
  });

  it('las mediciones se numeran por fecha aunque lleguen desordenadas', async () => {
    cargar([M2, M1]);
    await abrir();
    expect(screen.getByLabelText('Medición A')).toHaveValue('m1');
    expect(screen.getByLabelText('Medición B')).toHaveValue('m2');
  });

  it('al editar una medición los gráficos y las tarjetas reflejan los valores recalculados', async () => {
    cargar([M1, M2]);
    const { unmount } = await abrir();
    expect(screen.getByText('−1,55 kg desde la medición Nº 1')).toBeInTheDocument();
    unmount();

    // La Nº 2 se editó: ahora pesa 50 kg.
    sb.reset();
    cargar([M1, { ...M2, series: { ...M2.series, peso: [50, 50] } }]);
    await abrir();
    expect(screen.queryByText('−1,55 kg desde la medición Nº 1')).not.toBeInTheDocument();
    expect(screen.getByText('−3,05 kg desde la medición Nº 1')).toBeInTheDocument();
    const tablaPeso = screen.getByRole('table', { name: 'Peso: valores de cada medición' });
    expect(within(tablaPeso).getByRole('row', { name: /Nº 2 10\/01\/2027 50,0/ })).toBeInTheDocument();
  });

  it('muestra el aviso fijo sobre el recálculo al editar una medición anterior', async () => {
    cargar([M1, M2]);
    await abrir();
    expect(
      screen.getByText(
        'Si se edita una medición anterior, sus valores se recalculan: en los gráficos sus puntos pueden quedar más arriba o más abajo, o más a la izquierda o a la derecha, y las diferencias con las demás cambian.',
      ),
    ).toBeInTheDocument();
  });

  it('tiene las pestañas Historial y Evolución y vuelve a la ficha', async () => {
    cargar([M1, M2]);
    await abrir();
    expect(screen.getByRole('tab', { name: 'Historial' })).toHaveAttribute('href', '/antropometrias/manual/p1');
    expect(screen.getByRole('tab', { name: 'Evolución' })).toHaveAttribute('href', '/antropometrias/manual/p1/evolucion');
    expect(screen.getByRole('tab', { name: 'Evolución' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('link', { name: /← Marchetti, Julieta/ })).toHaveAttribute('href', '/antropometrias/manual/p1');
  });

  it('con una sola medición: gráficos con un punto, sin diferencias y comparador deshabilitado con explicación', async () => {
    cargar([M1]);
    await abrir();

    expect(screen.getAllByText('Primera medición')).toHaveLength(4);
    expect(screen.getByRole('img', { name: 'Peso (kg)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Medición A')).toBeDisabled();
    expect(screen.getByLabelText('Medición B')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Comparar' })).toBeDisabled();
    expect(screen.getByText(/hacen falta al menos dos mediciones/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /Comparación entre/ })).not.toBeInTheDocument();
  });

  it('sin mediciones vigentes: estado vacío con el enlace a una nueva medición', async () => {
    cargar([medicion('b1', { estado: 'borrador' })]);
    await abrir();

    expect(screen.getByText('Todavía no hay mediciones para mostrar')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nueva medición' })).toHaveAttribute('href', '/antropometrias/manual/p1/medicion/nueva');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Medición A')).not.toBeInTheDocument();
  });

  it('una paciente menor no ofrece cargar mediciones y se explica por qué', async () => {
    cargar([], { ...PACIENTE, fecha_nacimiento: '2015-01-01' });
    await abrir();
    expect(screen.queryByRole('link', { name: 'Nueva medición' })).not.toBeInTheDocument();
    expect(screen.getByText(/mayores de 18/)).toBeInTheDocument();
  });

  it('si una vigente no se puede calcular, lo avisa y grafica el resto', async () => {
    cargar([M1, medicion('m3', { fecha_medicion: '2027-02-01', nivel_actividad: null })]);
    await abrir();
    expect(screen.getByText(/1 medición vigente no se pudo calcular/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Peso (kg)' })).toBeInTheDocument();
  });

  it('un origen inválido o un paciente inexistente → 404', async () => {
    await expect(EvolucionPage({ params: Promise.resolve({ origen: 'otro', id: 'p1' }), searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    sb.mockTable('antropometria_pacientes_manuales', { data: null, error: null });
    await expect(EvolucionPage({ params: Promise.resolve({ origen: 'manual', id: 'nadie' }), searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('la ficha enlaza a la evolución', () => {
  it('muestra las pestañas con Historial activa', async () => {
    sb.mockTable('antropometria_pacientes_manuales', { data: PACIENTE, error: null });
    sb.mockTable('antropometria_mediciones', { data: [M1], error: null });
    sb.mockTable('profiles', { data: [{ user_id: 'inv-1', nombre: 'Ana', apellido: 'Lopez' }], error: null });
    render(await FichaPacientePage({ params: Promise.resolve({ origen: 'manual', id: 'p1' }) }));

    expect(screen.getByRole('tab', { name: 'Historial' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Evolución' })).toHaveAttribute('href', '/antropometrias/manual/p1/evolucion');
  });
});

describe('Somatocarta con trayectoria', () => {
  it('sin puntos de trayectoria dibuja igual que antes: sin línea ni números', () => {
    const { container } = render(
      <Somatocarta
        puntos={[
          { etiqueta: 'Medición actual', x: 1, y: 2, tipo: 'actual' },
          { etiqueta: 'Medición anterior', x: 0, y: 1, tipo: 'anterior' },
        ]}
      />,
    );
    expect(container.querySelector('polyline')).toBeNull();
    expect(container.querySelectorAll('svg text')).toHaveLength(9 + 8 + 2);
  });

  it('marca distinto la primera y la última y no dibuja línea con un solo punto', () => {
    const { container, rerender } = render(
      <Somatocarta
        puntos={[
          { etiqueta: 'Nº 1', x: 0, y: 0, tipo: 'trayectoria', numero: 1, extremo: 'primera' },
          { etiqueta: 'Nº 2', x: 1, y: 1, tipo: 'trayectoria', numero: 2 },
          { etiqueta: 'Nº 3', x: 2, y: 2, tipo: 'trayectoria', numero: 3, extremo: 'ultima' },
        ]}
      />,
    );
    const circulos = [...container.querySelectorAll('circle')];
    expect(circulos.map((c) => c.getAttribute('fill'))).toEqual(['#fff', '#dbeafe', '#2563eb']);
    expect(container.querySelector('polyline')!.getAttribute('points')!.split(' ')).toHaveLength(3);

    rerender(<Somatocarta puntos={[{ etiqueta: 'Nº 1', x: 0, y: 0, tipo: 'trayectoria', numero: 1, extremo: 'unica' }]} />);
    expect(container.querySelector('polyline')).toBeNull();
  });
});
