/**
 * updateHidratacion(delta) — suma/resta mililitros al total del día del usuario.
 *
 * DEF-008 — la Server Action confiaba en el `delta` que manda el navegador: cualquiera podía llamarla
 * con NaN, Infinity o 1e12 y dejar un total absurdo en `hidratacion` (dato de un estudio científico).
 * La UI limita a 5000 ml por carga y a 10000 ml por día; el servidor tiene que imponer los mismos topes.
 *
 * Particiones de `delta`: entero válido (|delta| <= 10000) / 0 / no finito (NaN, ±Infinity) / no entero (250.5) / fuera de rango (> 10000).
 * Valores límite: 10000 (válido), 10001 (inválido), -10000 (válido). Total del día: 0 ≤ total ≤ 10000.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock, revalidateMock } = vi.hoisted(() => ({ getUserMock: vi.fn(), revalidateMock: vi.fn() }));
const db = createSupabaseFromMock();

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: db.from }),
}));

import { updateHidratacion } from '@/app/home/actions';

const guardado = () => db.insertsLlamados().find((i) => i.tabla === 'hidratacion')?.payload as { ml_total: number; id_usuario: string } | undefined;

beforeEach(() => {
  db.reset();
  revalidateMock.mockClear();
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u-1' } } });
});

describe('updateHidratacion — camino normal', () => {
  it('suma el delta al total del día y revalida /home', async () => {
    // Arrange
    db.mockTable('hidratacion', { data: { ml_total: 500 }, error: null }); // lectura actual
    db.mockTable('hidratacion', { data: null, error: null }); // upsert
    // Act
    const r = await updateHidratacion(250);
    // Assert
    expect(r).toEqual({ ml: 750 });
    expect(guardado()).toMatchObject({ id_usuario: 'u-1', ml_total: 750 });
    expect(revalidateMock).toHaveBeenCalledWith('/home');
  });

  it('el primer registro del día parte de 0', async () => {
    db.mockTable('hidratacion', { data: null, error: { message: 'no rows' } });
    expect(await updateHidratacion(250)).toEqual({ ml: 250 });
  });

  it('restar más de lo que hay deja el total en 0 (nunca negativo)', async () => {
    db.mockTable('hidratacion', { data: { ml_total: 100 }, error: null });
    expect(await updateHidratacion(-250)).toEqual({ ml: 0 });
  });

  it('sin sesión devuelve error y no toca la base', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect(await updateHidratacion(250)).toEqual({ error: 'No autenticado' });
    expect(db.tablasLlamadas()).toEqual([]);
  });

  it('si falla el guardado devuelve el error de la base', async () => {
    db.mockTable('hidratacion', { data: { ml_total: 0 }, error: null });
    db.mockTable('hidratacion', { data: null, error: { message: 'violates RLS' } });
    expect(await updateHidratacion(250)).toEqual({ error: 'violates RLS' });
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});

describe('updateHidratacion — validación del lado del servidor (DEF-008)', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['no entero', 250.5],
    ['fuera de rango (10001)', 10_001],
    ['fuera de rango negativo (-10001)', -10_001],
    ['absurdo (1e12)', 1e12],
  ])('delta %s → error y no guarda nada', async (_caso, delta) => {
    db.mockTable('hidratacion', { data: { ml_total: 500 }, error: null });
    const r = await updateHidratacion(delta);
    expect(r).toHaveProperty('error');
    expect(guardado()).toBeUndefined();
  });

  it('valor límite: delta 10000 es válido', async () => {
    db.mockTable('hidratacion', { data: null, error: null });
    expect(await updateHidratacion(10_000)).toEqual({ ml: 10_000 });
  });

  it('valor límite: delta -10000 es válido', async () => {
    db.mockTable('hidratacion', { data: { ml_total: 10_000 }, error: null });
    expect(await updateHidratacion(-10_000)).toEqual({ ml: 0 });
  });

  it('el total del día no puede superar 10000 ml aunque cada delta sea válido', async () => {
    db.mockTable('hidratacion', { data: { ml_total: 9_900 }, error: null });
    const r = await updateHidratacion(5_000);
    expect(r).toEqual({ ml: 10_000 });
    expect(guardado()?.ml_total).toBe(10_000);
  });
});
