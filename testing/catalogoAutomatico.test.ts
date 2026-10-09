/**
 * NUT-119 — Carga (paginada y cacheada) del catálogo automático: sólo SARA2 (ni ANMAT ni VALIDADO).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cargarCatalogoAutomatico, limpiarCacheCatalogo, preseleccionarCandidatos } from '@/lib/catalogoAutomatico';
import { createSupabaseFromMock } from './supabaseMock';

const filas = (desde: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id_alimento: desde + i, nombre: `Alimento ${desde + i}` }));

beforeEach(() => limpiarCacheCatalogo());

describe('cargarCatalogoAutomatico', () => {
  it('pide sólo SARA2 (ni ANMAT ni VALIDADO), ordenado por id', async () => {
    const mock = createSupabaseFromMock();
    mock.mockTable('alimentos', { data: filas(1, 3), error: null });
    const r = await cargarCatalogoAutomatico(mock);
    expect(r).toEqual([
      { id: 1, nombre: 'Alimento 1' },
      { id: 2, nombre: 'Alimento 2' },
      { id: 3, nombre: 'Alimento 3' },
    ]);
    const f = mock.filtrosLlamados();
    expect(f.find((x) => x.metodo === 'in')?.args).toEqual(['fuente', ['SARA2']]);
    expect(f.find((x) => x.metodo === 'order')?.args).toEqual(['id_alimento']);
  });

  it('pagina de a 1000 (límite de PostgREST) hasta que una página viene incompleta', async () => {
    const mock = createSupabaseFromMock();
    mock.mockTable('alimentos', { data: filas(1, 1000), error: null });
    mock.mockTable('alimentos', { data: filas(1001, 250), error: null });
    const r = await cargarCatalogoAutomatico(mock);
    expect(r).toHaveLength(1250);
    const rangos = mock.filtrosLlamados().filter((x) => x.metodo === 'range').map((x) => x.args);
    expect(rangos).toEqual([[0, 999], [1000, 1999]]);
  });

  it('cachea en memoria: la segunda carga no consulta la base; vence a los 5 minutos', async () => {
    const mock = createSupabaseFromMock();
    mock.mockTable('alimentos', { data: filas(1, 2), error: null });
    mock.mockTable('alimentos', { data: filas(1, 4), error: null });
    const t0 = 1_000_000;
    expect(await cargarCatalogoAutomatico(mock, t0)).toHaveLength(2);
    expect(await cargarCatalogoAutomatico(mock, t0 + 4 * 60_000)).toHaveLength(2);
    expect(mock.tablasLlamadas()).toHaveLength(1);
    expect(await cargarCatalogoAutomatico(mock, t0 + 6 * 60_000)).toHaveLength(4);
    expect(mock.tablasLlamadas()).toHaveLength(2);
  });

  it('lanza si la consulta falla (y no cachea el error)', async () => {
    const mock = createSupabaseFromMock();
    mock.mockTable('alimentos', { data: null, error: { message: 'boom' } });
    await expect(cargarCatalogoAutomatico(mock)).rejects.toThrow(/boom/);
    mock.mockTable('alimentos', { data: filas(1, 1), error: null });
    expect(await cargarCatalogoAutomatico(mock)).toHaveLength(1);
  });
});

describe('preseleccionarCandidatos — manda sólo lo que se parece a lo detectado (menos tokens)', () => {
  const CAT = [
    { id: 82, nombre: 'Huevo de chocolate tipo Kinder' },
    { id: 560, nombre: 'Fideos frescos, al huevo, crudos' },
    { id: 885, nombre: 'Huevo de gallina, entero, crudo' },
    { id: 886, nombre: 'Huevo de gallina, entero, hervido' },
    { id: 425, nombre: 'Arroz blanco, crudo' },
    { id: 432, nombre: 'Arroz integral, hervido' },
    { id: 700, nombre: 'Tomate' },
    { id: 701, nombre: 'Pan francés' },
    { id: 702, nombre: 'Palta' },
  ];
  const ids = (nombres: string[]) => preseleccionarCandidatos(nombres, CAT).map((e) => e.id);

  it('devuelve las entradas que comparten una palabra con el nombre, ignorando mayúsculas, tildes y artículos', () => {
    expect(ids(['Huevo'])).toEqual([82, 560, 885, 886]);
    expect(ids(['ARROZ blanco'])).toEqual([425, 432]);
    expect(ids(['Pan francés'])).toEqual([701]);
  });

  it('acepta plurales/singulares y prefijos ("tomates" → Tomate)', () => {
    expect(ids(['tomates'])).toEqual([700]);
  });

  it('une los candidatos de todos los alimentos del plato, sin repetir y en el orden del catálogo', () => {
    expect(ids(['Tomate', 'Huevo', 'Tomate'])).toEqual([82, 560, 885, 886, 700]);
  });

  it('si algún alimento no comparte ninguna palabra (sinónimos: aguacate/palta) manda la lista entera', () => {
    expect(ids(['Huevo', 'Aguacate'])).toHaveLength(CAT.length);
    expect(ids(['de la'])).toHaveLength(CAT.length); // sólo palabras vacías
  });

  it('catálogo vacío → vacío', () => {
    expect(preseleccionarCandidatos(['Huevo'], [])).toEqual([]);
  });
});
