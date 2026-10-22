/**
 * NUT-151 — Pantalla /revision-ia/metricas: las cinco piezas, tabs, filtros y
 * casos con poco volumen. recharts no mide nada en jsdom: se reemplaza por contenedores.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

const replace = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn() }) }));

vi.mock('recharts', () => {
  const Vacio = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Vacio, ScatterChart: Vacio, Scatter: Vacio, BarChart: Vacio, Bar: Vacio, Cell: Vacio,
    XAxis: Vacio, YAxis: Vacio, CartesianGrid: Vacio, Tooltip: Vacio, ReferenceArea: Vacio, ReferenceLine: Vacio, LabelList: Vacio,
  };
});

import MetricasClient from '@/app/(researcher)/revision-ia/metricas/MetricasClient';
import {
  alimentosConVolumen,
  confianzaVsCorreccion,
  estadoCola,
  evolucionPorPrompt,
  noDetectados,
  rankingAlimentos,
  resumenEvolucion,
  type ItemMetrica,
} from '@/lib/metricasIa';
import { defaultsMetricas, type MetricasParams } from '@/lib/metricasIaQuery';

const it0 = (over: Partial<ItemMetrica>): ItemMetrica => ({
  alimento: 'Empanada',
  alimento_norm: 'empanada',
  confidence: 0.9,
  gramos_ia: 100,
  gramos_usuario: 100,
  motivos_revision: [],
  estado_revision: null,
  prompt_version: 'nut166-v1',
  created_at: '2026-10-01T10:00:00Z',
  ...over,
});

const ITEMS: ItemMetrica[] = [
  it0({ alimento: 'Yogur griego', alimento_norm: 'yogur griego', confidence: 0.9, motivos_revision: ['cambio_alimento'], estado_revision: 'pendiente' }),
  it0({ alimento: 'Yogur griego', alimento_norm: 'yogur griego', confidence: 0.88, motivos_revision: ['cambio_alimento'], estado_revision: 'confirmado' }),
  it0({ alimento: 'Arroz', alimento_norm: 'arroz', gramos_usuario: 150, motivos_revision: ['correccion_peso_grande'], estado_revision: 'corregido' }),
  it0({ alimento: 'Arroz', alimento_norm: 'arroz', prompt_version: 'nut166-v2', created_at: '2026-10-15T10:00:00Z', gramos_usuario: 110 }),
  it0({ alimento: 'Pan rallado', alimento_norm: 'pan rallado', confidence: 0.3, gramos_usuario: null, motivos_revision: ['item_quitado', 'confianza_baja'], estado_revision: 'pendiente' }),
];

function renderMetricas(items = ITEMS, over: Partial<React.ComponentProps<typeof MetricasClient>> = {}) {
  const evolucion = evolucionPorPrompt(items);
  return render(
    <MetricasClient
      params={defaultsMetricas()}
      versiones={['nut166-v2', 'nut166-v1']}
      ranking={rankingAlimentos(items)}
      puntos={confianzaVsCorreccion(items)}
      evolucion={evolucion}
      resumen={resumenEvolucion(evolucion)}
      alimentosEvolucion={alimentosConVolumen(items, 1)}
      noDetectados={noDetectados([
        { alimento: 'Puré de papa', alimento_norm: 'pure de papa', prompt_version: 'nut166-v1' },
        { alimento: 'Puré de papa', alimento_norm: 'pure de papa', prompt_version: 'nut166-v1' },
        { alimento: 'Aderezo', alimento_norm: 'aderezo', prompt_version: 'nut166-v1' },
      ])}
      cola={estadoCola(items)}
      totalItems={items.length}
      truncado={false}
      {...over}
    />,
  );
}

const tarjeta = (titulo: string) => screen.getByRole('heading', { name: titulo }).closest('div')!.parentElement!;

describe('MetricasClient', () => {
  it('muestra las cuatro tarjetas y el estado de la cola con links a la cola', () => {
    renderMetricas();
    for (const t of ['Alimentos más corregidos', 'Confianza vs. corrección', 'Evolución por versión de prompt', 'Alimentos no detectados']) {
      expect(screen.getByRole('heading', { name: t })).toBeInTheDocument();
    }
    const nav = screen.getByRole('navigation', { name: 'Estado de la cola de revisión' });
    expect(within(nav).getByRole('link', { name: /2\s*Pendientes/ })).toHaveAttribute('href', '/revision-ia?estado=pendiente');
    expect(within(nav).getByRole('link', { name: /1\s*Confirmados/ })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /1\s*Corregidos/ })).toBeInTheDocument();
  });

  it('las pestañas: Métricas activa y Cola de revisión linkea a /revision-ia', () => {
    renderMetricas();
    expect(screen.getByRole('tab', { name: 'Métricas' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Cola de revisión' })).toHaveAttribute('href', '/revision-ia');
  });

  it('el ranking tiene columnas separadas de nombre, peso y quitado', () => {
    renderMetricas();
    const t = within(tarjeta('Alimentos más corregidos'));
    for (const col of ['% corrección nombre', '% corrección peso', '% quitado', 'Detecciones']) {
      expect(t.getByRole('columnheader', { name: col })).toBeInTheDocument();
    }
    expect(t.getByRole('img', { name: 'Yogur griego, corrección de nombre: 100%' })).toBeInTheDocument();
    expect(t.getByRole('img', { name: 'Arroz, corrección de peso: 50%' })).toBeInTheDocument();
    expect(t.getByRole('img', { name: 'Pan rallado, quitado: 100%' })).toBeInTheDocument();
  });

  it('lista los alimentos del cuadrante "confiado y equivocado"', () => {
    renderMetricas();
    const t = within(tarjeta('Confianza vs. corrección'));
    // Yogur (89% / 100%) y Arroz (90% / 50%) superan ambos umbrales; Pan rallado (confianza 30%) no.
    expect(t.getByText('Confiado y equivocado (2)')).toBeInTheDocument();
    expect(t.getByText(/Yogur griego/).closest('li')).toHaveTextContent('confianza 89%, corregido 100% (2 detecciones)');
    expect(t.getByText(/Arroz/).closest('li')).toHaveTextContent('confianza 90%, corregido 50%');
    expect(t.queryByText(/Pan rallado/)).not.toBeInTheDocument();
  });

  it('con una sola versión de prompt muestra la barra y avisa que falta otra (no rompe)', () => {
    renderMetricas(ITEMS.filter((i) => i.prompt_version === 'nut166-v1'));
    const t = within(tarjeta('Evolución por versión de prompt'));
    expect(t.getByText(/una sola versión de prompt/)).toBeInTheDocument();
    expect(t.queryByText(/puntos de error/)).not.toBeInTheDocument();
  });

  it('con dos versiones resume el cambio de error de peso', () => {
    renderMetricas();
    const t = within(tarjeta('Evolución por versión de prompt'));
    expect(t.getByText(/puntos de error entre nut166-v1 y nut166-v2/)).toBeInTheDocument();
  });

  it('los no detectados van aparte y no aparecen en el ranking', () => {
    renderMetricas();
    const nd = within(tarjeta('Alimentos no detectados'));
    expect(nd.getByText('Puré de papa')).toBeInTheDocument();
    expect(nd.getByText('2 veces')).toBeInTheDocument();
    expect(nd.getByText('1 vez')).toBeInTheDocument();
    expect(within(tarjeta('Alimentos más corregidos')).queryByText('Puré de papa')).not.toBeInTheDocument();
  });

  it('tiene encabezado con ayuda y todos los filtros en una sola barra, sin botón "Filtrar"', () => {
    renderMetricas();
    expect(screen.getByRole('heading', { level: 1, name: 'Métricas de calidad' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ayuda sobre esta pantalla' })).toBeInTheDocument();
    const barra = screen.getByRole('search', { name: 'Filtros' });
    for (const l of ['Desde', 'Hasta', 'Vajilla', 'Versión de prompt']) expect(barra).toContainElement(screen.getByLabelText(l));
    expect(screen.getByLabelText('Versión de prompt')).toHaveValue('todas');
    expect(within(screen.getByLabelText('Versión de prompt')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Todas', 'nut166-v2', 'nut166-v1']);
    expect(screen.queryByRole('button', { name: /^(filtrar|ver)$/i })).not.toBeInTheDocument();
  });

  it('sin datos muestra mensajes vacíos en cada tarjeta', () => {
    renderMetricas([], { noDetectados: [] });
    expect(screen.getByText('No hay detecciones evaluadas en este período.')).toBeInTheDocument();
    expect(screen.getByText('Sin datos para graficar.')).toBeInTheDocument();
    expect(screen.getByText('Todavía no hay datos de peso para comparar versiones.')).toBeInTheDocument();
    expect(screen.getByText('Ningún alimento agregado a mano en este período.')).toBeInTheDocument();
  });

  it('con un solo alimento y una sola detección no rompe', () => {
    renderMetricas([it0({})]);
    expect(within(tarjeta('Alimentos más corregidos')).getByRole('rowheader', { name: 'Empanada' })).toBeInTheDocument();
    expect(within(tarjeta('Confianza vs. corrección')).getByText('Ningún alimento cae en este cuadrante.')).toBeInTheDocument();
  });

  it('avisa si los datos quedaron truncados', () => {
    renderMetricas(ITEMS, { truncado: true });
    expect(screen.getByRole('alert')).toHaveTextContent(/parciales/);
  });
});

describe('MetricasClient — los filtros se aplican al cambiar y se combinan', () => {
  const params = (over: Partial<MetricasParams> = {}): MetricasParams => ({ ...defaultsMetricas(), desde: '2026-10-01', hasta: '2026-10-15', ...over });
  beforeEach(() => replace.mockClear());

  it('la vajilla reescribe la URL conservando lo demás', () => {
    renderMetricas(ITEMS, { params: params() });
    fireEvent.change(screen.getByLabelText('Vajilla'), { target: { value: 'plato_hondo' } });
    expect(replace).toHaveBeenLastCalledWith('/revision-ia/metricas?desde=2026-10-01&hasta=2026-10-15&vajilla=plato_hondo', { scroll: false });
  });

  it('la versión de prompt se combina con la vajilla ya elegida', () => {
    renderMetricas(ITEMS, { params: params({ vajilla: 'plato_hondo' }) });
    fireEvent.change(screen.getByLabelText('Versión de prompt'), { target: { value: 'nut166-v2' } });
    expect(replace).toHaveBeenLastCalledWith('/revision-ia/metricas?desde=2026-10-01&hasta=2026-10-15&vajilla=plato_hondo&prompt=nut166-v2', { scroll: false });
  });

  it('una fecha válida se aplica al cambiar', () => {
    renderMetricas(ITEMS, { params: params() });
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-05' } });
    expect(replace).toHaveBeenCalledWith('/revision-ia/metricas?desde=2026-10-05&hasta=2026-10-15', { scroll: false });
  });

  it('Desde posterior a Hasta no consulta y avisa; una fecha a medio escribir tampoco', () => {
    renderMetricas(ITEMS, { params: params() });
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-20' } });
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText('Desde no puede ser posterior a Hasta.')).toBeInTheDocument();

    const hasta = screen.getByLabelText('Hasta');
    Object.defineProperty(hasta, 'validity', { value: { badInput: true }, configurable: true });
    fireEvent.change(hasta, { target: { value: '' } });
    expect(replace).not.toHaveBeenCalled();
  });

  it('el alimento de la evolución se aplica al cambiar (sin botón "Ver")', () => {
    renderMetricas(ITEMS, { params: params() });
    fireEvent.change(screen.getByLabelText(/Alimento \(con \d+\+ detecciones\)/), { target: { value: 'arroz' } });
    expect(replace).toHaveBeenCalledWith('/revision-ia/metricas?desde=2026-10-01&hasta=2026-10-15&alimento=arroz', { scroll: false });
  });

  it('"Limpiar" vuelve a los filtros de por defecto', () => {
    renderMetricas(ITEMS, { params: params({ vajilla: 'plato_hondo' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(replace).toHaveBeenCalledWith('/revision-ia/metricas', { scroll: false });
  });
});
