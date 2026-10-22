/** NUT-192 — «Recientes» no manda kcal/macros por 100 g a deportista_ucc (igual que la búsqueda); el resto de los roles, lo de siempre. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));
const supabaseFromMock = createSupabaseFromMock();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: supabaseFromMock.from }),
}));

import { getAlimentosRecientesAction } from '@/app/alimentacion/actions';

const FILAS = () => [
  { id_alimento: 1, nombre: 'Arroz blanco', categoria: 'Cereales', fuente: 'SARA2', marca: null, denominacion: null, kcal_100g: 130, proteinas_100g: 2.7, grasas_100g: 0.3, carbs_100g: 28 },
  { id_alimento: 2000001, nombre: 'Tarta casera', categoria: null, fuente: 'VALIDADO', marca: null, denominacion: null, kcal_100g: 210, proteinas_100g: 8, grasas_100g: 9, carbs_100g: 25 },
];

async function recientesComo(role: string | null) {
  supabaseFromMock.mockTable('items', { data: [{ id_alimento: 2000001 }, { id_alimento: 1 }], error: null });
  supabaseFromMock.mockTable('alimentos', { data: FILAS(), error: null });
  supabaseFromMock.mockTable('profiles', { data: role ? { role } : null, error: role ? null : { message: 'sin perfil' } });
  return getAlimentosRecientesAction();
}

describe('getAlimentosRecientesAction y el estudio a ciegas', () => {
  beforeEach(() => {
    supabaseFromMock.reset();
    getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('deportista_ucc: ninguna fila lleva kcal/macros por 100 g, VALIDADO incluido; el resto queda intacto y en orden', async () => {
    const res = await recientesComo('deportista_ucc');
    expect(res.map((a) => a.nombre)).toEqual(['Tarta casera', 'Arroz blanco']);
    expect(JSON.stringify(res)).not.toMatch(/kcal_100g|proteinas_100g|grasas_100g|carbs_100g/);
    expect(res[0]).toMatchObject({ id_alimento: 2000001, fuente: 'VALIDADO' });
  });

  it.each(['particular', 'investigador', 'administrador'])('%s: recibe exactamente lo de siempre, con macros', async (role) => {
    const res = await recientesComo(role);
    const [a, b] = FILAS();
    expect(res).toEqual([b, a]);
  });

  it('si no se puede determinar el rol, se ocultan los macros', async () => {
    const res = await recientesComo(null);
    expect(res).toHaveLength(2);
    expect(JSON.stringify(res)).not.toMatch(/kcal_100g/);
  });

  it('sin historial (o sin sesión) no consulta el rol', async () => {
    supabaseFromMock.mockTable('items', { data: [], error: null });
    expect(await getAlimentosRecientesAction()).toEqual([]);
    expect(supabaseFromMock.tablasLlamadas()).not.toContain('profiles');
  });
});
