/**
 * Capa de datos del panel de investigadores (src/lib/researcher/athletes.ts).
 * Regla crítica: un investigador NUNCA ve usuarios `particular`; solo `deportista_ucc`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock, redirectMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
const db = createSupabaseFromMock();

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: db.from }),
}));

import { ATHLETE_ROLE, getAthleteData, getAuthenticatedResearcher } from '@/lib/researcher/athletes';

// Miércoles 7 de octubre de 2026 (hora Argentina): semana del lunes 5 → 3 días transcurridos.
const AHORA = new Date('2026-10-07T15:00:00Z');

beforeEach(() => {
  db.reset();
  getUserMock.mockReset();
  redirectMock.mockClear();
});

describe('getAuthenticatedResearcher', () => {
  it('sin sesión → redirige a /login', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    await expect(getAuthenticatedResearcher()).rejects.toThrow('REDIRECT:/login');
  });

  it('con sesión pero sin perfil → redirige a /login', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    db.mockTable('profiles', { data: null, error: null });
    await expect(getAuthenticatedResearcher()).rejects.toThrow('REDIRECT:/login');
  });

  it.each([['particular'], ['deportista_ucc']])('rol %s → redirige a /home (no es investigador)', async (role) => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    db.mockTable('profiles', { data: { user_id: 'u1', role }, error: null });
    await expect(getAuthenticatedResearcher()).rejects.toThrow('REDIRECT:/home');
  });

  it.each([['investigador'], ['administrador']])('rol %s → devuelve el perfil', async (role) => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    db.mockTable('profiles', { data: { user_id: 'u1', role }, error: null });
    await expect(getAuthenticatedResearcher()).resolves.toMatchObject({ role });
  });
});

describe('getAthleteData', () => {
  const perfiles = [
    { user_id: 'a1', nombre: 'Ana', apellido: 'Paz', email: 'ana@ucc.edu.ar', created_at: '2026-09-01' },
    { user_id: 'a2', nombre: 'Beto', apellido: 'Gil', email: 'beto@ucc.edu.ar', created_at: '2026-08-01' },
  ];

  it('filtra por rol deportista_ucc (nunca trae particulares)', async () => {
    db.mockTable('profiles', { data: [], error: null });
    await getAthleteData(AHORA);
    expect(db.eqLlamados()).toContainEqual({ tabla: 'profiles', metodo: 'eq', args: ['role', ATHLETE_ROLE] });
  });

  it('sin deportistas devuelve lista vacía y no consulta las otras tablas', async () => {
    db.mockTable('profiles', { data: null, error: null });
    const r = await getAthleteData(AHORA);
    expect(r.athletes).toEqual([]);
    expect(db.tablasLlamadas()).toEqual(['profiles']);
  });

  it('une perfil, datos físicos, académicos y cumplimiento semanal de cada deportista', async () => {
    // Arrange: Ana cargó 6 de las 12 comidas esperadas (3 días × 4) → 50 %; Beto no tiene datos.
    db.mockTable('profiles', { data: perfiles, error: null });
    db.mockTable('physical_data', { data: [{ user_id: 'a1', sexo: 'F', get_kcal: 2300 }], error: null });
    db.mockTable('academic_data', {
      data: [{ user_id: 'a1', deporte: 'hockey', posicion: 'arquera', unidad_academica: 'Ingeniería', carrera: 'Sistemas', anio: 3 }],
      error: null,
    });
    db.mockTable('ingestas', {
      data: ['desayuno', 'almuerzo', 'cena'].flatMap((tipo) => [
        { id_usuario: 'a1', tipo, fecha: '2026-10-05' },
        { id_usuario: 'a1', tipo, fecha: '2026-10-06' },
      ]),
      error: null,
    });
    // Act
    const { athletes, week } = await getAthleteData(AHORA);
    // Assert
    expect(week).toEqual({ monday: '2026-10-05', today: '2026-10-07', daysElapsed: 3 });
    expect(athletes).toHaveLength(2);
    expect(athletes[0]).toMatchObject({
      user_id: 'a1', sexo: 'F', get_kcal: 2300, deporte: 'hockey', posicion: 'arquera',
      unidad_academica: 'Ingeniería', carrera: 'Sistemas', anio: 3, compliance: 50,
    });
    expect(athletes[1]).toMatchObject({ user_id: 'a2', sexo: null, deporte: null, get_kcal: null, anio: null, compliance: 0 });
  });

  it('consulta las ingestas solo de la ventana lunes → hoy', async () => {
    db.mockTable('profiles', { data: perfiles, error: null });
    await getAthleteData(AHORA);
    const filtros = db.filtrosLlamados().filter((f) => f.tabla === 'ingestas');
    expect(filtros).toContainEqual({ tabla: 'ingestas', metodo: 'gte', args: ['fecha', '2026-10-05'] });
    expect(filtros).toContainEqual({ tabla: 'ingestas', metodo: 'lte', args: ['fecha', '2026-10-07'] });
  });

  it('tolera que alguna tabla secundaria no devuelva datos', async () => {
    db.mockTable('profiles', { data: perfiles, error: null });
    db.mockTable('physical_data', { data: null, error: { message: 'x' } });
    db.mockTable('academic_data', { data: null, error: { message: 'x' } });
    db.mockTable('ingestas', { data: null, error: { message: 'x' } });
    const { athletes } = await getAthleteData(AHORA);
    expect(athletes.map((a) => a.compliance)).toEqual([0, 0]);
  });
});
