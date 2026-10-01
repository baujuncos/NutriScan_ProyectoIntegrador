import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));
const supabaseFromMock = createSupabaseFromMock();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: supabaseFromMock.from }),
}));

import { searchAlimentosAction, getAlimentosRecientesAction } from '@/app/alimentacion/actions';

describe('searchAlimentosAction', () => {
  beforeEach(() => {
    supabaseFromMock.reset();
    getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('con los 3 campos tildados (default), hace 2 consultas a "alimentos" y las concatena', async () => {
    supabaseFromMock.mockTable('alimentos', { data: [{ id_alimento: 1, nombre: 'Pollo asado' }], error: null });
    supabaseFromMock.mockTable('alimentos', { data: [{ id_alimento: 2, nombre: 'Suprema' }], error: null });

    const resultado = await searchAlimentosAction('pollo', 'almuerzo');

    expect(resultado).toEqual([
      { id_alimento: 1, nombre: 'Pollo asado' },
      { id_alimento: 2, nombre: 'Suprema' },
    ]);
    expect(supabaseFromMock.tablasLlamadas().filter((t) => t === 'alimentos')).toHaveLength(2);
  });

  it('con solo "Nombre" tildado, hace 1 sola consulta a "alimentos"', async () => {
    supabaseFromMock.mockTable('alimentos', { data: [{ id_alimento: 1, nombre: 'Pollo asado' }], error: null });

    const resultado = await searchAlimentosAction('pollo', 'almuerzo', { nombre: true, marca: false, denominacion: false });

    expect(resultado).toEqual([{ id_alimento: 1, nombre: 'Pollo asado' }]);
    expect(supabaseFromMock.tablasLlamadas().filter((t) => t === 'alimentos')).toHaveLength(1);
  });

  it('sin ningún campo tildado, no consulta la base y devuelve vacío', async () => {
    const resultado = await searchAlimentosAction('pollo', 'almuerzo', { nombre: false, marca: false, denominacion: false });

    expect(resultado).toEqual([]);
    expect(supabaseFromMock.tablasLlamadas()).toHaveLength(0);
  });

  it('corta el resultado combinado en 150 elementos', async () => {
    const tandaA = Array.from({ length: 100 }, (_, i) => ({ id_alimento: i + 1, nombre: `A${i}` }));
    const tandaB = Array.from({ length: 100 }, (_, i) => ({ id_alimento: 1000 + i, nombre: `B${i}` }));
    supabaseFromMock.mockTable('alimentos', { data: tandaA, error: null });
    supabaseFromMock.mockTable('alimentos', { data: tandaB, error: null });

    const resultado = await searchAlimentosAction('ab', 'almuerzo');

    expect(resultado).toHaveLength(150);
  });

  it('aplica el filtro de categoría, nombre O denominación "suplemento" en las consultas reales cuando tipoIngesta es suplemento', async () => {
    supabaseFromMock.mockTable('alimentos', { data: [], error: null });
    supabaseFromMock.mockTable('alimentos', { data: [], error: null });

    await searchAlimentosAction('whey', 'suplemento');

    const ors = supabaseFromMock.filtrosLlamados().filter((f) => f.tabla === 'alimentos' && f.metodo === 'or');
    expect(ors.some((f) => f.args[0] === 'categoria.ilike.%suplemento%,nombre.ilike.%suplemento%,denominacion.ilike.%suplemento%')).toBe(true);
  });

  it('excluye por categoría, nombre Y denominación "suplemento" en las consultas reales cuando tipoIngesta no es suplemento', async () => {
    supabaseFromMock.mockTable('alimentos', { data: [], error: null });
    supabaseFromMock.mockTable('alimentos', { data: [], error: null });

    await searchAlimentosAction('arroz', 'almuerzo');

    const nots = supabaseFromMock.filtrosLlamados().filter((f) => f.tabla === 'alimentos' && f.metodo === 'not');
    expect(nots.some((f) => f.args[0] === 'categoria' && f.args[1] === 'ilike' && f.args[2] === '%suplemento%')).toBe(true);
    expect(nots.some((f) => f.args[0] === 'nombre' && f.args[1] === 'ilike' && f.args[2] === '%suplemento%')).toBe(true);
    expect(nots.some((f) => f.args[0] === 'denominacion' && f.args[1] === 'ilike' && f.args[2] === '%suplemento%')).toBe(true);
  });
});

describe('getAlimentosRecientesAction', () => {
  beforeEach(() => {
    supabaseFromMock.reset();
    getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('dedupea por id_alimento preservando el más reciente y limita a 8', async () => {
    supabaseFromMock.mockTable('items', {
      data: [
        { id_alimento: 1 }, { id_alimento: 2 }, { id_alimento: 1 },
        { id_alimento: 3 }, { id_alimento: 4 }, { id_alimento: 5 },
        { id_alimento: 6 }, { id_alimento: 7 }, { id_alimento: 8 }, { id_alimento: 9 },
      ],
      error: null,
    });
    supabaseFromMock.mockTable('alimentos', {
      data: [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id_alimento: id, nombre: `Alimento ${id}` })),
      error: null,
    });

    const resultado = await getAlimentosRecientesAction();

    expect(resultado.map((a) => a.id_alimento)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('devuelve vacío si el usuario no tiene items previos', async () => {
    supabaseFromMock.mockTable('items', { data: [], error: null });

    const resultado = await getAlimentosRecientesAction();

    expect(resultado).toEqual([]);
  });
});
