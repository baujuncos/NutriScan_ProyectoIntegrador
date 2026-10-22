/**
 * NUT-225 — validarPendienteAction con idAlimentoExistente (vínculo directo con un alimento ya
 * existente): sin los 4 valores ni composición, con el alimento releído en el servidor y bloqueado si no
 * existe o le falta algún valor (NULL ≠ 0). Los demás caminos validan igual que antes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock, revalidatePathMock } = vi.hoisted(() => ({ getUserMock: vi.fn(), revalidatePathMock: vi.fn() }));
const sb = createSupabaseFromMock();

vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: sb.from, rpc: sb.rpc, storage: sb.storage }),
}));

import { validarPendienteAction } from '@/app/(researcher)/validacion/actions';

const VINCULO = { id: 7, nombre: 'Barra kinder', idAlimentoExistente: 15 };
const ALIMENTO = { id_alimento: 15, kcal_100g: 560, proteinas_100g: 8.7, grasas_100g: 35, carbs_100g: 53 };
const rpcArgs = () => sb.rpcLlamadas()[0]?.args as Record<string, unknown>;

function comoRol(role: string | null) {
  getUserMock.mockResolvedValue({ data: { user: { id: 'inv-1' } } });
  sb.mockTable('profiles', { data: role ? { role } : null, error: null });
}
function alimento(fila: Record<string, unknown> | null, error: unknown = null) {
  sb.mockTable('alimentos', { data: fila, error });
}

beforeEach(() => {
  sb.reset();
  getUserMock.mockReset();
  revalidatePathMock.mockReset();
});

describe('vínculo directo con un alimento existente', () => {
  it.each(['investigador', 'administrador'])('%s: acepta idAlimentoExistente SIN valores ni composición y llama a la RPC con p_composicion NULL', async (role) => {
    comoRol(role);
    alimento(ALIMENTO);
    sb.mockRpc('pendiente_validar', { data: { id_alimento: 15, items_afectados: 0 }, error: null });

    const r = await validarPendienteAction(VINCULO);

    expect(r).toEqual({ ok: true, idAlimento: 15, itemsAfectados: 0 });
    expect(rpcArgs()).toMatchObject({
      p_id: 7,
      p_nombre: 'Barra kinder',
      p_id_alimento_existente: 15,
      p_composicion: null,
      p_kcal: null,
      p_prot: null,
      p_grasas: null,
      p_carbs: null,
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/validacion');
    expect(revalidatePathMock).toHaveBeenCalledWith('/alimentacion');
  });

  it('relee el alimento en el servidor (por su id) antes de llamar a la RPC', async () => {
    comoRol('investigador');
    alimento(ALIMENTO);
    sb.mockRpc('pendiente_validar', { data: { id_alimento: 15, items_afectados: 0 }, error: null });
    await validarPendienteAction(VINCULO);
    expect(sb.tablasLlamadas()).toEqual(['profiles', 'alimentos']);
    expect(sb.eqLlamados()).toEqual(expect.arrayContaining([expect.objectContaining({ tabla: 'alimentos', args: ['id_alimento', 15] })]));
  });

  describe('rol', () => {
    it.each([['particular'], ['deportista_ucc'], [null]])('rol %s: rechazado, sin leer alimentos ni llamar a la RPC', async (role) => {
      comoRol(role);
      expect(await validarPendienteAction(VINCULO)).toEqual({ error: 'Acceso denegado' });
      expect(sb.rpcLlamadas()).toHaveLength(0);
      expect(sb.tablasLlamadas()).not.toContain('alimentos');
    });

    it('sin sesión: rechazado', async () => {
      getUserMock.mockResolvedValue({ data: { user: null } });
      expect(await validarPendienteAction(VINCULO)).toEqual({ error: 'No autenticado' });
      expect(sb.rpcLlamadas()).toHaveLength(0);
    });
  });

  describe('el alimento elegido', () => {
    it('inexistente: error claro y no llama a la RPC', async () => {
      comoRol('investigador');
      alimento(null, { code: 'PGRST116', message: 'no rows' });
      expect(await validarPendienteAction(VINCULO)).toEqual({ error: 'El alimento elegido no existe' });
      expect(sb.rpcLlamadas()).toHaveLength(0);
    });

    it('error de la base distinto de "no existe": no lo confunde con inexistente y no llama a la RPC', async () => {
      comoRol('investigador');
      const consola = vi.spyOn(console, 'error').mockImplementation(() => {});
      alimento(null, { code: '57014', message: 'timeout' });
      const r = await validarPendienteAction(VINCULO);
      expect(r).toEqual({ error: 'No se pudo comprobar el alimento elegido. Probá de nuevo.' });
      expect(sb.rpcLlamadas()).toHaveLength(0);
      consola.mockRestore();
    });

    it.each(['kcal_100g', 'proteinas_100g', 'grasas_100g', 'carbs_100g'])('con %s NULL: rechazado, no llama a la RPC', async (campo) => {
      comoRol('investigador');
      alimento({ ...ALIMENTO, [campo]: null });
      const r = await validarPendienteAction(VINCULO);
      expect(r).toEqual({ error: expect.stringContaining('no tiene sus 4 valores nutricionales') });
      expect(sb.rpcLlamadas()).toHaveLength(0);
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });

    it('con todos los valores NULL: rechazado', async () => {
      comoRol('investigador');
      alimento({ id_alimento: 15, kcal_100g: null, proteinas_100g: null, grasas_100g: null, carbs_100g: null });
      expect('error' in (await validarPendienteAction(VINCULO))).toBe(true);
      expect(sb.rpcLlamadas()).toHaveLength(0);
    });

    it('un 0 legítimo es válido (agua: todo en 0; grasas 0 en un alimento común)', async () => {
      comoRol('investigador');
      alimento({ id_alimento: 15, kcal_100g: 0, proteinas_100g: 0, grasas_100g: 0, carbs_100g: 0 });
      sb.mockRpc('pendiente_validar', { data: { id_alimento: 15, items_afectados: 0 }, error: null });
      expect(await validarPendienteAction(VINCULO)).toMatchObject({ ok: true });

      sb.reset();
      comoRol('investigador');
      alimento({ ...ALIMENTO, grasas_100g: 0 });
      sb.mockRpc('pendiente_validar', { data: { id_alimento: 15, items_afectados: 0 }, error: null });
      expect(await validarPendienteAction(VINCULO)).toMatchObject({ ok: true });
    });

    it('acepta valores numéricos en texto (así llega `numeric`) y rechaza texto vacío o no numérico', async () => {
      comoRol('investigador');
      alimento({ id_alimento: 15, kcal_100g: '560.00', proteinas_100g: '0.00', grasas_100g: '35.00', carbs_100g: '53.00' });
      sb.mockRpc('pendiente_validar', { data: { id_alimento: 15, items_afectados: 0 }, error: null });
      expect(await validarPendienteAction(VINCULO)).toMatchObject({ ok: true });

      for (const malo of ['', '  ', 'abc', Number.NaN, {}, true]) {
        sb.reset();
        comoRol('investigador');
        alimento({ ...ALIMENTO, carbs_100g: malo });
        expect('error' in (await validarPendienteAction(VINCULO))).toBe(true);
        expect(sb.rpcLlamadas()).toHaveLength(0);
      }
    });

    it('lo que mande el cliente no cuenta: con valores propios igual relee y bloquea un alimento incompleto', async () => {
      comoRol('investigador');
      alimento({ ...ALIMENTO, kcal_100g: null });
      const r = await validarPendienteAction({ ...VINCULO, kcal: 100, proteinas: 5, grasas: 3, carbs: 10 });
      expect('error' in r).toBe(true);
      expect(sb.rpcLlamadas()).toHaveLength(0);
    });
  });

  it('errores de la RPC en el vínculo directo se traducen como siempre', async () => {
    comoRol('investigador');
    alimento(ALIMENTO);
    sb.mockRpc('pendiente_validar', { data: null, error: { message: 'ESTADO_INVALIDO' } });
    expect(await validarPendienteAction(VINCULO)).toEqual({ error: 'Este alimento ya fue resuelto por otro investigador' });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe('los demás caminos de validarPendienteAction no cambian', () => {
  const VALORES = { id: 7, nombre: 'Tarta', categoria: 'tarta', kcal: 180, proteinas: 6, grasas: 9, carbs: 18, observaciones: 'ok' };

  it('valores manuales: valida igual y NO lee la tabla alimentos', async () => {
    comoRol('investigador');
    sb.mockRpc('pendiente_validar', { data: { id_alimento: null, items_afectados: 2 }, error: null });
    expect(await validarPendienteAction(VALORES)).toEqual({ ok: true, idAlimento: null, itemsAfectados: 2 });
    expect(sb.tablasLlamadas()).not.toContain('alimentos');
    expect(rpcArgs()).toMatchObject({ p_kcal: 180, p_id_alimento_existente: null, p_composicion: null });
  });

  it('composición del catálogo sin valores: valida igual y NO lee alimentos', async () => {
    comoRol('investigador');
    sb.mockRpc('pendiente_validar', { data: { id_alimento: null, items_afectados: 1 }, error: null });
    const composicion = { modo: 'catalogo' as const, id_guardado_item: 1, gramos_foto: 100, componentes: [] };
    const r = await validarPendienteAction({ id: 7, nombre: 'Mezcla', composicion });
    expect(r).toMatchObject({ ok: true });
    expect(sb.tablasLlamadas()).not.toContain('alimentos');
  });

  it('idAlimentoExistente CON composición no es vínculo directo: no relee (la RPC lo ignora) y exige lo de siempre', async () => {
    comoRol('investigador');
    sb.mockRpc('pendiente_validar', { data: { id_alimento: null, items_afectados: 1 }, error: null });
    const composicion = { modo: 'catalogo' as const, id_guardado_item: 1, gramos_foto: 100, componentes: [] };
    expect(await validarPendienteAction({ id: 7, nombre: 'Mezcla', idAlimentoExistente: 15, composicion })).toMatchObject({ ok: true });
    expect(sb.tablasLlamadas()).not.toContain('alimentos');

    sb.reset();
    comoRol('investigador');
    const manual = { modo: 'manual' as const, id_guardado_item: null, gramos_foto: null, componentes: [] };
    // modo manual con idAlimentoExistente y sin valores: sigue siendo inválido (no es vínculo directo)
    expect(await validarPendienteAction({ id: 7, nombre: 'X', idAlimentoExistente: 15, composicion: manual })).toEqual({
      error: expect.stringContaining('Datos inválidos'),
    });
    expect(sb.rpcLlamadas()).toHaveLength(0);
  });

  it.each([
    ['sin valores ni composición ni alimento', { id: 7, nombre: 'X' }],
    ['faltan valores y no hay alimento', { id: 7, nombre: 'X', kcal: 1, proteinas: 1 }],
    ['nombre vacío aun con vínculo', { id: 7, nombre: '   ', idAlimentoExistente: 15 }],
    ['idAlimentoExistente 0', { id: 7, nombre: 'X', idAlimentoExistente: 0 }],
    ['idAlimentoExistente negativo', { id: 7, nombre: 'X', idAlimentoExistente: -3 }],
    ['idAlimentoExistente decimal', { id: 7, nombre: 'X', idAlimentoExistente: 1.5 }],
  ])('sigue siendo inválido: %s', async (_nombre, input) => {
    comoRol('investigador');
    const r = await validarPendienteAction(input as never);
    expect('error' in r).toBe(true);
    expect(sb.rpcLlamadas()).toHaveLength(0);
    expect(sb.tablasLlamadas()).not.toContain('alimentos');
  });
});
