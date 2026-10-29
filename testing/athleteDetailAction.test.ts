/**
 * getAthleteDetailAction — detalle de un deportista para el modal del investigador.
 * Particiones: sin sesión / rol sin permiso / deportista inexistente (o no deportista) / éxito.
 * Dentro del éxito: encuesta completa vs vacía (puntaje null), días de la semana, ingestas con y sin macros.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));
const db = createSupabaseFromMock();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: db.from }),
}));

import { getAthleteDetailAction } from '@/app/(researcher)/deportistas/actions';

const ATLETA = { user_id: 'dep-1', nombre: 'Ana', apellido: 'Paz', email: 'ana@ucc.edu.ar', role: 'deportista_ucc' };

beforeEach(() => {
  db.reset();
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'inv-1' } } });
  // Miércoles 7 de octubre de 2026, 12:00 en Argentina.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T15:00:00Z'));
});
afterEach(() => vi.useRealTimers());

const comoInvestigador = (role = 'investigador') => db.mockTable('profiles', { data: { role }, error: null });

describe('getAthleteDetailAction — autorización', () => {
  it('sin sesión → No autenticado', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect(await getAthleteDetailAction('dep-1')).toEqual({ error: 'No autenticado' });
  });

  it.each([['particular'], ['deportista_ucc']])('rol %s → Acceso denegado', async (role) => {
    comoInvestigador(role);
    expect(await getAthleteDetailAction('dep-1')).toEqual({ error: 'Acceso denegado' });
  });

  it('sin perfil propio → Acceso denegado', async () => {
    db.mockTable('profiles', { data: null, error: null });
    expect(await getAthleteDetailAction('dep-1')).toEqual({ error: 'Acceso denegado' });
  });

  it('administrador también puede', async () => {
    comoInvestigador('administrador');
    db.mockTable('profiles', { data: ATLETA, error: null });
    expect(await getAthleteDetailAction('dep-1')).toMatchObject({ user_id: 'dep-1' });
  });

  it('un id que no es de un deportista (p. ej. un particular) → Deportista no encontrado, y la consulta filtra por rol', async () => {
    comoInvestigador();
    db.mockTable('profiles', { data: null, error: { message: 'no rows' } });
    expect(await getAthleteDetailAction('particular-1')).toEqual({ error: 'Deportista no encontrado' });
    expect(db.eqLlamados()).toContainEqual({ tabla: 'profiles', metodo: 'eq', args: ['role', 'deportista_ucc'] });
  });
});

describe('getAthleteDetailAction — datos', () => {
  function cargar(overrides: { survey?: unknown; semana?: unknown[]; recientes?: unknown[] } = {}) {
    comoInvestigador();
    db.mockTable('profiles', { data: ATLETA, error: null });
    db.mockTable('physical_data', { data: { peso_kg: 60, altura_cm: 165, sexo: 'F', get_kcal: 2300 }, error: null });
    db.mockTable('academic_data', { data: { deporte: 'hockey', carrera: 'Sistemas' }, error: null });
    db.mockTable('psychological_surveys', { data: overrides.survey === undefined ? { respuestas: Array.from({ length: 25 }, (_, i) => (i < 5 ? 5 : 1)) } : overrides.survey, error: null });
    db.mockTable('ingestas', { data: overrides.semana ?? [], error: null });
    db.mockTable('ingestas', { data: overrides.recientes ?? [], error: null });
  }

  it('arma las 5 dimensiones psicológicas (promedio de a 5) y el puntaje global ×20', async () => {
    cargar();
    const r = (await getAthleteDetailAction('dep-1')) as Exclude<Awaited<ReturnType<typeof getAthleteDetailAction>>, { error: string }>;
    expect(r.psychDimensions).toEqual([
      { dimension: 'Confianza', value: 5 },
      { dimension: 'Concentración', value: 1 },
      { dimension: 'Ansiedad', value: 1 },
      { dimension: 'Resiliencia', value: 1 },
      { dimension: 'Motivación', value: 1 },
    ]);
    // media = (25 + 20) / 25 = 1.8 → 36
    expect(r.psychScore).toBe(36);
  });

  it('sin encuesta: dimensiones en 0 y puntaje null', async () => {
    cargar({ survey: null });
    const r = (await getAthleteDetailAction('dep-1')) as { psychDimensions: { value: number }[]; psychScore: number | null };
    expect(r.psychDimensions.every((d) => d.value === 0)).toBe(true);
    expect(r.psychScore).toBeNull();
  });

  it('devuelve los 7 días de la semana (lunes→domingo) con la cantidad de comidas de cada uno', async () => {
    cargar({
      semana: [
        { tipo: 'desayuno', fecha: '2026-10-05' },
        { tipo: 'almuerzo', fecha: '2026-10-05' },
        { tipo: 'cena', fecha: '2026-10-07' },
      ],
    });
    const r = (await getAthleteDetailAction('dep-1')) as { weeklyMeals: { day: string; fecha: string; count: number }[] };
    expect(r.weeklyMeals.map((d) => d.day)).toEqual(['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']);
    expect(r.weeklyMeals.map((d) => d.count)).toEqual([2, 0, 1, 0, 0, 0, 0]);
    expect(r.weeklyMeals[0].fecha).toBe('2026-10-05');
  });

  it('las ingestas recientes muestran el nombre según el origen del ítem y ocultan macros sin dato', async () => {
    const item = (extra: Record<string, unknown>) => ({
      id_item: 1, id_alimento: null, id_alimento_barcode: null, origen_macros: 'catalogo', kcal_100g: 50,
      cantidad: '100', kcal: 52, proteinas_g: 0.3, grasas_g: 0.2, carbs_g: 13.8, nombre_manual: null,
      alimentos: null, alimentos_barcode: null, ...extra,
    });
    cargar({
      recientes: [
        {
          id_ingesta: 9, tipo: 'almuerzo', fecha: '2026-10-07', kcal_total: '300',
          items: [
            item({ id_alimento: 1, alimentos: { nombre: 'Manzana', fuente: 'SARA2' } }),
            item({ id_alimento_barcode: 2, alimentos_barcode: { nombre: 'Galletitas' }, origen_macros: 'barcode' }),
            item({ nombre_manual: 'Torta casera', origen_macros: 'sin_datos', kcal: 0, proteinas_g: 0, grasas_g: 0, carbs_g: 0 }),
            item({ origen_macros: null }),
          ],
        },
      ],
    });
    const r = (await getAthleteDetailAction('dep-1')) as { recentIngestas: { kcal_total: number; items: { nombre: string; cantidad: number; macros: unknown }[] }[] };
    const [ingesta] = r.recentIngestas;
    expect(ingesta.kcal_total).toBe(300);
    expect(ingesta.items.map((i) => i.nombre)).toEqual(['Manzana', 'Galletitas', 'Torta casera', 'Alimento desconocido']);
    expect(ingesta.items[0].cantidad).toBe(100);
    expect(ingesta.items[0].macros).toMatchObject({ kcal: 52 });
    expect(ingesta.items[2].macros).toBeNull(); // sin datos nutricionales: no se muestra un 0 falso
  });

  it('devuelve los datos físicos y académicos tal como están, o null si no existen', async () => {
    cargar();
    const r = (await getAthleteDetailAction('dep-1')) as { physical: unknown; academic: unknown; nombre: string };
    expect(r.physical).toMatchObject({ sexo: 'F' });
    expect(r.academic).toMatchObject({ deporte: 'hockey' });
    expect(r.nombre).toBe('Ana');

    db.reset();
    comoInvestigador();
    db.mockTable('profiles', { data: ATLETA, error: null });
    const vacio = (await getAthleteDetailAction('dep-1')) as { physical: unknown; academic: unknown; recentIngestas: unknown[] };
    expect(vacio.physical).toBeNull();
    expect(vacio.academic).toBeNull();
    expect(vacio.recentIngestas).toEqual([]);
  });

  it('consulta las ingestas recientes solo de hoy y ayer (hora Argentina)', async () => {
    cargar();
    await getAthleteDetailAction('dep-1');
    const inFiltro = db.filtrosLlamados().find((f) => f.metodo === 'in' && f.tabla === 'ingestas');
    expect(inFiltro?.args).toEqual(['fecha', ['2026-10-07', '2026-10-06']]);
  });
});
