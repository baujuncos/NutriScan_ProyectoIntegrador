/**
 * NUT-119 — Parseo de querystring y consulta paginada de la cola (/validacion).
 */
import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, buildQuery, consultarPendientes, parseParams } from '@/lib/validacionQuery';
import { createSupabaseFromMock } from './supabaseMock';

describe('parseParams', () => {
  it('por defecto: estado pendiente, sin búsqueda, orden por fecha, página 1', () => {
    expect(parseParams({})).toEqual({ estado: 'pendiente', q: '', orden: 'fecha', page: 1 });
  });

  it('acepta valores válidos y descarta los inválidos', () => {
    expect(parseParams({ estado: 'validado', q: ' flan ', orden: 'ocurrencias', page: '3' })).toEqual({
      estado: 'validado',
      q: 'flan',
      orden: 'ocurrencias',
      page: 3,
    });
    expect(parseParams({ estado: 'hackeado', orden: 'x', page: '-4' })).toEqual({
      estado: 'pendiente',
      q: '',
      orden: 'fecha',
      page: 1,
    });
    expect(parseParams({ page: 'abc' }).page).toBe(1);
  });

  it('toma el primer valor si viene repetido', () => {
    expect(parseParams({ estado: ['descartado', 'validado'] }).estado).toBe('descartado');
  });
});

describe('buildQuery', () => {
  const base = parseParams({});

  it('arma la querystring y omite el valor por defecto de cada filtro', () => {
    expect(buildQuery(base)).toBe('');
    expect(buildQuery({ ...base, estado: 'todos', q: 'flan', orden: 'ocurrencias', page: 2 })).toBe(
      '?estado=todos&q=flan&orden=ocurrencias&page=2',
    );
  });

  it('permite sobreescribir parámetros (links de paginación)', () => {
    expect(buildQuery({ ...base, q: 'flan' }, { page: 4 })).toBe('?q=flan&page=4');
  });
});

describe('consultarPendientes', () => {
  it('consulta la vista con el filtro de estado, la búsqueda, el orden y el rango de la página', async () => {
    const mock = createSupabaseFromMock();
    mock.mockTable('v_alimentos_pendientes', { data: [{ id_pendiente: 1 }], error: null, count: 45 } as never);

    const r = await consultarPendientes(mock, { estado: 'pendiente', q: 'flan', orden: 'ocurrencias', page: 2 });

    expect(r).toEqual({ rows: [{ id_pendiente: 1 }], total: 45 });
    expect(mock.tablasLlamadas()).toEqual(['v_alimentos_pendientes']);
    const f = mock.filtrosLlamados();
    expect(f.find((x) => x.metodo === 'ilike')?.args).toEqual(['nombre_original', '%flan%']);
    expect(f.filter((x) => x.metodo === 'order').map((x) => x.args[0])).toEqual(['ocurrencias', 'ultima_ocurrencia']);
    expect(f.find((x) => x.metodo === 'range')?.args).toEqual([PAGE_SIZE, PAGE_SIZE * 2 - 1]);
  });

  it('estado "todos" no filtra por estado; sin búsqueda no usa ilike', async () => {
    const mock = createSupabaseFromMock();
    mock.mockTable('v_alimentos_pendientes', { data: [], error: null, count: 0 } as never);
    await consultarPendientes(mock, { estado: 'todos', q: '', orden: 'fecha', page: 1 });
    expect(mock.filtrosLlamados().some((x) => x.metodo === 'ilike')).toBe(false);
  });

  it('lanza si la consulta falla', async () => {
    const mock = createSupabaseFromMock();
    mock.mockTable('v_alimentos_pendientes', { data: null, error: { message: 'boom' } });
    await expect(
      consultarPendientes(mock, { estado: 'pendiente', q: '', orden: 'fecha', page: 1 }),
    ).rejects.toThrow(/boom/);
  });
});
