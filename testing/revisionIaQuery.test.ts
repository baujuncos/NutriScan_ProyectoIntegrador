/**
 * NUT-149 — Filtros de la cola de revisión: parseo de la querystring y
 * predicados que se arman contra la vista `v_revision_ia`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';
import { PAGE_SIZE, buildRevisionQuery, consultarRevisiones, parseRevisionParams } from '@/lib/revisionIaQuery';

const sb = createSupabaseFromMock();
beforeEach(() => sb.reset());

describe('parseRevisionParams', () => {
  it('sin querystring usa los defaults (pendientes, todos los motivos)', () => {
    expect(parseRevisionParams({})).toEqual({
      estado: 'pendiente',
      motivo: 'todos',
      desde: '',
      hasta: '',
      q: '',
      orden: 'fecha',
      page: 1,
    });
  });

  it('lee estado, motivo, fechas, búsqueda, orden y página', () => {
    expect(
      parseRevisionParams({ estado: 'corregido', motivo: 'item_quitado', desde: '2026-10-01', hasta: '2026-10-15', q: ' flan ', orden: 'confianza', page: '3' }),
    ).toEqual({ estado: 'corregido', motivo: 'item_quitado', desde: '2026-10-01', hasta: '2026-10-15', q: 'flan', orden: 'confianza', page: 3 });
  });

  it('lo inválido cae al default', () => {
    const p = parseRevisionParams({ estado: 'x', motivo: 'y', desde: 'ayer', hasta: '2026-13', orden: 'z', page: '-4' });
    expect(p).toMatchObject({ estado: 'pendiente', motivo: 'todos', desde: '', hasta: '', orden: 'fecha', page: 1 });
  });
});

describe('buildRevisionQuery', () => {
  it('omite lo que vale el default y conserva el resto', () => {
    const base = parseRevisionParams({});
    expect(buildRevisionQuery(base)).toBe('');
    expect(buildRevisionQuery({ ...base, motivo: 'confianza_baja', page: 2 })).toBe('?motivo=confianza_baja&page=2');
  });
});

describe('consultarRevisiones', () => {
  const filtros = () => sb.filtrosLlamados().map((f) => [f.metodo, ...f.args]);

  it('por defecto filtra estado pendiente sobre v_revision_ia y pagina', async () => {
    sb.mockTable('v_revision_ia', { data: [{ id_deteccion_item: 1 }], error: null });
    const r = await consultarRevisiones(sb, parseRevisionParams({}));
    expect(sb.tablasLlamadas()).toEqual(['v_revision_ia']);
    expect(r.rows).toHaveLength(1);
    expect(filtros()).toContainEqual(['range', 0, PAGE_SIZE - 1]);
  });

  it('aplica motivo (contains), rango de fechas y búsqueda por nombre', async () => {
    sb.mockTable('v_revision_ia', { data: [], error: null });
    await consultarRevisiones(
      sb,
      parseRevisionParams({ estado: 'todos', motivo: 'item_quitado', desde: '2026-10-01', hasta: '2026-10-15', q: 'milanesa' }),
    );
    const f = filtros();
    expect(f).toContainEqual(['contains', 'motivos_revision', ['item_quitado']]);
    expect(f).toContainEqual(['gte', 'created_at', '2026-10-01T00:00:00-03:00']);
    expect(f).toContainEqual(['lte', 'created_at', '2026-10-15T23:59:59.999-03:00']);
    expect(f.find((x) => x[0] === 'or')?.[1]).toContain('alimento_ia.ilike.%milanesa%');
  });

  it('ordena por confianza ascendente cuando se pide', async () => {
    sb.mockTable('v_revision_ia', { data: [], error: null });
    await consultarRevisiones(sb, parseRevisionParams({ orden: 'confianza' }));
    expect(filtros()[0]).toEqual(['order', 'confidence', { ascending: true }]);
  });

  it('saca de la búsqueda los caracteres que rompen la sintaxis de .or()', async () => {
    sb.mockTable('v_revision_ia', { data: [], error: null });
    await consultarRevisiones(sb, parseRevisionParams({ q: 'a,b)c' }));
    const or = sb.filtrosLlamados().find((f) => f.metodo === 'or')!.args[0] as string;
    expect(or).not.toMatch(/a,b\)c/);
  });

  it('un error de PostgREST se propaga', async () => {
    sb.mockTable('v_revision_ia', { data: null, error: { message: 'boom', code: 'X' } });
    await expect(consultarRevisiones(sb, parseRevisionParams({}))).rejects.toThrow(/cola de revisión/);
  });
});
