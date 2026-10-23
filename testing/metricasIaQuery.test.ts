/**
 * NUT-151 — Filtros del dashboard de métricas: parseo de la querystring, filtros
 * combinados aplicados a AMBAS vistas, carga en bloques y filtro por versión de prompt.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';
import { daysAgoAR, todayAR } from '@/lib/date';
import {
  BLOQUE,
  MAX_FILAS,
  buildMetricasQuery,
  cargarMetricas,
  defaultsMetricas,
  filtrarPorPrompt,
  parseMetricasParams,
  versionesDePrompt,
} from '@/lib/metricasIaQuery';

const sb = createSupabaseFromMock();
beforeEach(() => sb.reset());

describe('parseMetricasParams', () => {
  it('sin querystring: últimos 30 días, todas las vajillas y versiones', () => {
    expect(parseMetricasParams({})).toEqual({
      desde: daysAgoAR(30),
      hasta: todayAR(),
      vajilla: 'todas',
      prompt: 'todas',
      alimento: '',
    });
  });

  it('lee fecha, vajilla, prompt y alimento', () => {
    expect(
      parseMetricasParams({ desde: '2026-10-01', hasta: '2026-10-15', vajilla: 'plato_hondo', prompt: 'nut166-v2', alimento: 'milanesa' }),
    ).toEqual({ desde: '2026-10-01', hasta: '2026-10-15', vajilla: 'plato_hondo', prompt: 'nut166-v2', alimento: 'milanesa' });
  });

  it('una fecha vacía = sin límite; una inválida cae al default; vajilla inválida a "todas"', () => {
    const p = parseMetricasParams({ desde: '', hasta: 'ayer', vajilla: 'x' });
    expect(p.desde).toBe('');
    expect(p.hasta).toBe(todayAR());
    expect(p.vajilla).toBe('todas');
  });
});

describe('buildMetricasQuery', () => {
  it('omite lo que vale el default y conserva el resto', () => {
    const base = defaultsMetricas();
    expect(buildMetricasQuery(base)).toBe('');
    expect(buildMetricasQuery(base, { vajilla: 'plato_postre', prompt: 'nut166-v1' })).toBe('?vajilla=plato_postre&prompt=nut166-v1');
    expect(buildMetricasQuery(base, { desde: '' })).toBe('?desde=');
  });
});

describe('cargarMetricas — filtros combinados', () => {
  const params = { ...defaultsMetricas(), desde: '2026-10-01', hasta: '2026-10-15', vajilla: 'plato_hondo' as const };

  it('aplica fecha + vajilla juntos a las DOS vistas', async () => {
    sb.mockTable('v_metricas_ia_items', { data: [], error: null });
    sb.mockTable('v_metricas_ia_no_detectados', { data: [], error: null });
    await cargarMetricas(sb, params);

    for (const vista of ['v_metricas_ia_items', 'v_metricas_ia_no_detectados']) {
      const f = sb.filtrosLlamados().filter((x) => x.tabla === vista).map((x) => [x.metodo, ...x.args]);
      expect(f).toContainEqual(['gte', 'created_at', '2026-10-01T00:00:00-03:00']);
      expect(f).toContainEqual(['lte', 'created_at', '2026-10-15T23:59:59.999-03:00']);
      expect(f).toContainEqual(['range', 0, BLOQUE - 1]);
      expect(sb.eqLlamados().filter((x) => x.tabla === vista).map((x) => x.args)).toContainEqual(['vajilla_tipo', 'plato_hondo']);
    }
  });

  it('sin vajilla ni fechas no agrega ningún predicado', async () => {
    sb.mockTable('v_metricas_ia_items', { data: [], error: null });
    sb.mockTable('v_metricas_ia_no_detectados', { data: [], error: null });
    await cargarMetricas(sb, { ...defaultsMetricas(), desde: '', hasta: '' });
    expect(sb.filtrosLlamados().map((x) => x.metodo)).not.toContain('gte');
    expect(sb.eqLlamados()).toHaveLength(0);
  });

  it('trae en bloques: pide el siguiente mientras el bloque venga lleno', async () => {
    const fila = { alimento: 'X', alimento_norm: 'x', confidence: '0.9', gramos_ia: '100', gramos_usuario: null };
    sb.mockTable('v_metricas_ia_items', { data: Array(BLOQUE).fill(fila), error: null });
    sb.mockTable('v_metricas_ia_items', { data: Array(5).fill(fila), error: null });
    sb.mockTable('v_metricas_ia_no_detectados', { data: [], error: null });
    const r = await cargarMetricas(sb, params);
    expect(r.items).toHaveLength(BLOQUE + 5);
    expect(r.truncado).toBe(false);
    const rangos = sb.filtrosLlamados().filter((x) => x.tabla === 'v_metricas_ia_items' && x.metodo === 'range').map((x) => x.args);
    expect(rangos).toEqual([[0, BLOQUE - 1], [BLOQUE, 2 * BLOQUE - 1]]);
  });

  it('si la vista todavía no tiene las columnas nuevas (SQL sin aplicar) reintenta con las básicas y el dashboard sigue andando', async () => {
    sb.mockTable('v_metricas_ia_items', { data: null, error: { message: 'column v_metricas_ia_items.alimento_usuario does not exist', code: '42703' } });
    sb.mockTable('v_metricas_ia_items', { data: [{ alimento: 'X', confidence: '0.9', gramos_ia: '100', gramos_usuario: null }], error: null });
    sb.mockTable('v_metricas_ia_no_detectados', { data: [], error: null });
    const r = await cargarMetricas(sb, params);
    expect(r.items).toHaveLength(1);
    expect(sb.tablasLlamadas().filter((t) => t === 'v_metricas_ia_items')).toHaveLength(2);
  });

  it('un error que no es de columna inexistente no se reintenta', async () => {
    sb.mockTable('v_metricas_ia_items', { data: null, error: { message: 'permiso denegado', code: '42501' } });
    sb.mockTable('v_metricas_ia_no_detectados', { data: [], error: null });
    await expect(cargarMetricas(sb, params)).rejects.toThrow(/permiso denegado/);
    expect(sb.tablasLlamadas().filter((t) => t === 'v_metricas_ia_items')).toHaveLength(1);
  });

  it('normaliza los numeric que llegan como texto', async () => {
    sb.mockTable('v_metricas_ia_items', { data: [{ alimento: 'X', confidence: '0.850', gramos_ia: '120.00', gramos_usuario: '90.50' }], error: null });
    sb.mockTable('v_metricas_ia_no_detectados', { data: [], error: null });
    const r = await cargarMetricas(sb, params);
    expect(r.items[0]).toMatchObject({ confidence: 0.85, gramos_ia: 120, gramos_usuario: 90.5 });
  });

  it('avisa (truncado) si se alcanza el tope de seguridad', async () => {
    for (let i = 0; i < MAX_FILAS / BLOQUE; i++) {
      sb.mockTable('v_metricas_ia_items', { data: Array(BLOQUE).fill({ confidence: 1, gramos_ia: 1, gramos_usuario: null }), error: null });
    }
    sb.mockTable('v_metricas_ia_no_detectados', { data: [], error: null });
    expect((await cargarMetricas(sb, params)).truncado).toBe(true);
  });

  it('un error de PostgREST se propaga', async () => {
    sb.mockTable('v_metricas_ia_items', { data: null, error: { message: 'boom' } });
    await expect(cargarMetricas(sb, params)).rejects.toThrow(/métricas/);
  });
});

describe('versión de prompt (en memoria, combinable con fecha y vajilla)', () => {
  const filas = [
    { prompt_version: 'nut166-v1', created_at: '2026-10-01T10:00:00Z' },
    { prompt_version: 'nut166-v2', created_at: '2026-10-15T10:00:00Z' },
    { prompt_version: 'nut166-v1', created_at: '2026-10-03T10:00:00Z' },
  ];

  it('versionesDePrompt lista las versiones presentes, la más reciente primero', () => {
    expect(versionesDePrompt(filas)).toEqual(['nut166-v2', 'nut166-v1']);
  });

  it('filtrarPorPrompt deja sólo esa versión, y "todas" no filtra', () => {
    expect(filtrarPorPrompt(filas, 'nut166-v1')).toHaveLength(2);
    expect(filtrarPorPrompt(filas, 'todas')).toHaveLength(3);
  });
});
