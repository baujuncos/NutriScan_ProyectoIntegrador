/**
 * NUT-192 — Estudio a ciegas en el buscador: a deportista_ucc no le llegan kcal/macros por 100 g
 * (ni de SARA2, ni de ANMAT, ni de un alimento VALIDADO); el resto de los roles recibe lo mismo
 * que antes. El selector de cantidad calcula la vista previa solo si hay datos, y el ítem real lo
 * calcula el trigger calculate_item_nutrients en el servidor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));
const supabaseFromMock = createSupabaseFromMock();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: supabaseFromMock.from }),
}));

import { searchAlimentosAction } from '@/app/alimentacion/actions';

const FILAS = () => [
  { id_alimento: 1, nombre: 'Arroz blanco', categoria: 'Cereales', fuente: 'SARA2', marca: null, denominacion: null, kcal_100g: 130, proteinas_100g: 2.7, grasas_100g: 0.3, carbs_100g: 28 },
  { id_alimento: 2000001, nombre: 'Tarta casera', categoria: null, fuente: 'VALIDADO', marca: null, denominacion: null, kcal_100g: 210, proteinas_100g: 8, grasas_100g: 9, carbs_100g: 25 },
  { id_alimento: 1000005, nombre: 'Arroz con leche', categoria: 'Postres', fuente: 'ANMAT', marca: 'La Serenísima', denominacion: 'Postre lácteo', kcal_100g: 150, proteinas_100g: 3, grasas_100g: 4, carbs_100g: 24 },
];

const CAMPOS_MACROS = ['kcal_100g', 'proteinas_100g', 'grasas_100g', 'carbs_100g'];

async function buscarComo(role: string | null) {
  supabaseFromMock.mockTable('profiles', { data: role ? { role } : null, error: role ? null : { message: 'sin perfil' } });
  // Tier 1 (nombre) trae las filas; tier 2 (marca/denominación), nada.
  supabaseFromMock.mockTable('alimentos', { data: FILAS(), error: null });
  supabaseFromMock.mockTable('alimentos', { data: [], error: null });
  return searchAlimentosAction('arroz', 'almuerzo');
}

describe('searchAlimentosAction y el estudio a ciegas (NUT-192)', () => {
  beforeEach(() => {
    supabaseFromMock.reset();
    getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('deportista_ucc: ninguna fila (SARA2, VALIDADO ni ANMAT) lleva kcal/macros por 100 g', async () => {
    const res = await buscarComo('deportista_ucc');
    expect(res).toHaveLength(3);
    for (const fila of res) {
      for (const campo of CAMPOS_MACROS) expect(fila).not.toHaveProperty(campo);
    }
    // Ni siquiera como texto serializado (lo que viaja en el payload).
    expect(JSON.stringify(res)).not.toMatch(/kcal_100g|proteinas_100g|grasas_100g|carbs_100g/);
  });

  it('deportista_ucc: el resto de los datos de cada fila queda intacto (el VALIDADO se puede elegir)', async () => {
    const res = await buscarComo('deportista_ucc');
    expect(res.map((f) => [f.id_alimento, f.nombre, f.fuente, f.marca, f.categoria, f.denominacion])).toEqual(
      FILAS().map((f) => [f.id_alimento, f.nombre, f.fuente, f.marca, f.categoria, f.denominacion]),
    );
    expect(res[1]).toMatchObject({ id_alimento: 2000001, fuente: 'VALIDADO' });
  });

  it.each(['particular', 'investigador', 'administrador'])('%s: recibe exactamente las filas de siempre, con macros (VALIDADO incluido)', async (role) => {
    const res = await buscarComo(role);
    expect(res).toEqual(FILAS());
    expect(res.find((f) => f.fuente === 'VALIDADO')?.kcal_100g).toBe(210);
  });

  it('si no se puede determinar el rol, ante la duda se ocultan los macros', async () => {
    const res = await buscarComo(null);
    expect(res).toHaveLength(3);
    expect(JSON.stringify(res)).not.toMatch(/kcal_100g/);
  });

  it('el rol se consulta una sola vez por búsqueda, junto con las consultas a alimentos', async () => {
    await buscarComo('particular');
    expect(supabaseFromMock.tablasLlamadas().filter((t) => t === 'profiles')).toHaveLength(1);
    expect(supabaseFromMock.tablasLlamadas().filter((t) => t === 'alimentos')).toHaveLength(2);
  });

  it('una búsqueda que no consulta la base (menos de 2 letras) tampoco consulta el rol', async () => {
    expect(await searchAlimentosAction('a', 'almuerzo')).toEqual([]);
    expect(supabaseFromMock.tablasLlamadas()).toHaveLength(0);
  });
});
