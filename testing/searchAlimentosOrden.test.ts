/**
 * NUT-194 — Orden del buscador: SARA2, luego VALIDADO, luego ANMAT (dentro de cada tanda de
 * resultados). Con solo SARA2/ANMAT el resultado es idéntico al de la consulta (SARA2 antes que ANMAT).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));
const supabaseFromMock = createSupabaseFromMock();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: supabaseFromMock.from }),
}));

import { searchAlimentosAction } from '@/app/alimentacion/actions';

const f = (id: number, nombre: string, fuente: string) => ({ id_alimento: id, nombre, categoria: null, fuente, marca: null, denominacion: null });

async function buscar(tier1: unknown[], tier2: unknown[] = []) {
  supabaseFromMock.mockTable('profiles', { data: { role: 'particular' }, error: null });
  supabaseFromMock.mockTable('alimentos', { data: tier1, error: null });
  supabaseFromMock.mockTable('alimentos', { data: tier2, error: null });
  return (await searchAlimentosAction('arroz', 'almuerzo')).map((a) => a.nombre);
}

describe('searchAlimentosAction — orden por fuente', () => {
  beforeEach(() => {
    supabaseFromMock.reset();
    getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('la base devuelve VALIDADO, SARA2, ANMAT (fuente descendente): queda SARA2, VALIDADO, ANMAT', async () => {
    const res = await buscar([f(2000001, 'Arroz casero', 'VALIDADO'), f(1, 'Arroz blanco', 'SARA2'), f(1000001, 'Arroz con leche', 'ANMAT')]);
    expect(res).toEqual(['Arroz blanco', 'Arroz casero', 'Arroz con leche']);
  });

  it('solo SARA2 y ANMAT: idéntico al orden que devuelve la consulta (no se reordena nada)', async () => {
    const entrada = [f(1, 'Arroz blanco', 'SARA2'), f(2, 'Arroz integral', 'SARA2'), f(1000001, 'Arroz con leche', 'ANMAT'), f(1000002, 'Arroz yamaní', 'ANMAT')];
    expect(await buscar(entrada)).toEqual(entrada.map((a) => a.nombre));
  });

  it('solo VALIDADO, solo SARA2 o solo ANMAT también quedan como vienen', async () => {
    const v = [f(2000002, 'B', 'VALIDADO'), f(2000001, 'A', 'VALIDADO')];
    expect(await buscar(v)).toEqual(['B', 'A']);
  });

  it('es estable: dentro de una misma fuente se conserva el orden por nombre de la base', async () => {
    const res = await buscar([f(3, 'Zeta', 'VALIDADO'), f(2, 'Beta', 'SARA2'), f(1, 'Alfa', 'SARA2'), f(4, 'Gamma', 'ANMAT')]);
    expect(res).toEqual(['Beta', 'Alfa', 'Zeta', 'Gamma']);
  });

  it('cada tanda se ordena por separado (nombre primero, luego marca/denominación) y la primera sigue yendo primero', async () => {
    const res = await buscar(
      [f(1, 'Por nombre SARA2', 'SARA2'), f(2, 'Por nombre ANMAT', 'ANMAT')],
      [f(3, 'Por marca VALIDADO', 'VALIDADO'), f(4, 'Por marca ANMAT', 'ANMAT')],
    );
    expect(res).toEqual(['Por nombre SARA2', 'Por nombre ANMAT', 'Por marca VALIDADO', 'Por marca ANMAT']);
  });

  it('una fuente desconocida va al final, como ANMAT', async () => {
    expect(await buscar([f(5, 'Otra', 'NUEVA'), f(1, 'Sara', 'SARA2'), f(2, 'Val', 'VALIDADO')])).toEqual(['Sara', 'Val', 'Otra']);
  });

  it('el corte de 150 se aplica después de ordenar', async () => {
    const muchos = Array.from({ length: 100 }, (_, i) => f(1000 + i, `A${i}`, 'ANMAT'));
    supabaseFromMock.mockTable('profiles', { data: { role: 'particular' }, error: null });
    supabaseFromMock.mockTable('alimentos', { data: muchos, error: null });
    supabaseFromMock.mockTable('alimentos', { data: [f(1, 'S', 'SARA2'), ...Array.from({ length: 80 }, (_, i) => f(2000 + i, `B${i}`, 'ANMAT'))], error: null });
    const res = await searchAlimentosAction('ab', 'almuerzo');
    expect(res).toHaveLength(150);
    expect(res[100]).toMatchObject({ nombre: 'S' }); // el SARA2 de la 2.ª tanda abre su tanda
  });
});
