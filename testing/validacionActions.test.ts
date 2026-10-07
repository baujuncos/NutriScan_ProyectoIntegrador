/**
 * NUT-119 — Acciones del investigador (`/validacion`): re-verificación de rol,
 * validación de argumentos, armado de las RPCs `pendiente_*` y mapeo de sus
 * errores. La lógica transaccional (recálculo, descartar sin borrar) vive en
 * SQL y se prueba contra Postgres, no acá.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock, revalidatePathMock } = vi.hoisted(() => ({ getUserMock: vi.fn(), revalidatePathMock: vi.fn() }));
const sb = createSupabaseFromMock();

vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: sb.from, rpc: sb.rpc, storage: sb.storage }),
}));

import {
  modificarPendienteAction,
  validarPendienteAction,
  descartarPendienteAction,
  getPendienteDetalleAction,
} from '@/app/(researcher)/validacion/actions';

const FORM = { id: 7, nombre: 'Tarta de acelga', categoria: 'tarta', kcal: 180, proteinas: 6, grasas: 9, carbs: 18, observaciones: 'ok' };

function comoRol(role: string | null) {
  getUserMock.mockResolvedValue({ data: { user: { id: 'inv-1' } } });
  sb.mockTable('profiles', { data: role ? { role } : null, error: null });
}

beforeEach(() => {
  sb.reset();
  getUserMock.mockReset();
  revalidatePathMock.mockReset();
});

describe('re-verificación de rol', () => {
  const acciones = [
    () => modificarPendienteAction(FORM),
    () => validarPendienteAction(FORM),
    () => descartarPendienteAction({ id: 7, observaciones: null }),
    () => getPendienteDetalleAction(7),
  ];

  it('sin sesión → error y no llama a ninguna RPC', async () => {
    for (const accion of acciones) {
      getUserMock.mockResolvedValue({ data: { user: null } });
      expect(await accion()).toEqual({ error: 'No autenticado' });
    }
    expect(sb.rpcLlamadas()).toHaveLength(0);
  });

  it.each(['deportista_ucc', 'particular', null])('rol %s → Acceso denegado sin llamar a la RPC', async (rol) => {
    for (const accion of acciones) {
      comoRol(rol);
      expect(await accion()).toEqual({ error: 'Acceso denegado' });
    }
    expect(sb.rpcLlamadas()).toHaveLength(0);
    expect(sb.storageLlamadas()).toHaveLength(0);
    expect(sb.tablasLlamadas().filter((t) => t !== 'profiles')).toHaveLength(0);
  });
});

describe('acciones con rol permitido', () => {
  it.each(['investigador', 'administrador'])('%s: modificar llama a pendiente_modificar con los args', async (rol) => {
    comoRol(rol);
    expect(await modificarPendienteAction({ ...FORM, proteinas: null, categoria: '  ' })).toEqual({ ok: true });
    expect(sb.rpcLlamadas()).toEqual([
      {
        nombre: 'pendiente_modificar',
        args: { p_id: 7, p_nombre: 'Tarta de acelga', p_categoria: null, p_kcal: 180, p_prot: null, p_grasas: 9, p_carbs: 18, p_observaciones: 'ok' },
      },
    ]);
    expect(revalidatePathMock).toHaveBeenCalledWith('/validacion');
  });

  it.each(['investigador', 'administrador'])('%s: validar llama a pendiente_validar', async (rol) => {
    comoRol(rol);
    sb.mockRpc('pendiente_validar', { data: { id_alimento: 2000001, items_afectados: 3 }, error: null });
    expect(await validarPendienteAction(FORM)).toEqual({ ok: true, idAlimento: 2000001, itemsAfectados: 3 });
    expect(sb.rpcLlamadas()).toEqual([
      {
        nombre: 'pendiente_validar',
        args: {
          p_id: 7, p_nombre: 'Tarta de acelga', p_categoria: 'tarta', p_kcal: 180, p_prot: 6, p_grasas: 9, p_carbs: 18,
          p_observaciones: 'ok', p_id_alimento_existente: null,
        },
      },
    ]);
    expect(revalidatePathMock).toHaveBeenCalledWith('/validacion');
  });

  it('validar con idAlimentoExistente lo pasa a la RPC', async () => {
    comoRol('investigador');
    sb.mockRpc('pendiente_validar', { data: { id_alimento: 15, items_afectados: 1 }, error: null });
    expect(await validarPendienteAction({ ...FORM, idAlimentoExistente: 15 })).toEqual({ ok: true, idAlimento: 15, itemsAfectados: 1 });
    expect((sb.rpcLlamadas()[0].args as Record<string, unknown>).p_id_alimento_existente).toBe(15);
  });

  it.each(['investigador', 'administrador'])('%s: descartar llama a pendiente_descartar y nunca borra items', async (rol) => {
    comoRol(rol);
    sb.mockRpc('pendiente_descartar', { data: { items_afectados: 4 }, error: null });
    expect(await descartarPendienteAction({ id: 7, observaciones: 'no es comida' })).toEqual({ ok: true, itemsAfectados: 4 });
    expect(sb.rpcLlamadas()).toEqual([{ nombre: 'pendiente_descartar', args: { p_id: 7, p_observaciones: 'no es comida' } }]);
    expect(sb.tablasLlamadas()).not.toContain('items');
    expect(sb.filtrosLlamados().some((f) => f.metodo === 'delete')).toBe(false);
  });
});

describe('errores de la RPC', () => {
  it('DUPLICADO_EN_CATALOGO → { error, idAlimentoExistente } leído de details', async () => {
    comoRol('investigador');
    sb.mockRpc('pendiente_validar', { data: null, error: { message: 'DUPLICADO_EN_CATALOGO', details: '1234' } });
    const r = await validarPendienteAction(FORM);
    expect(r).toMatchObject({ idAlimentoExistente: 1234 });
    expect('error' in r && r.error).toBeTruthy();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('ESTADO_INVALIDO → "ya fue resuelto por otro investigador"', async () => {
    comoRol('investigador');
    sb.mockRpc('pendiente_validar', { data: null, error: { message: 'ESTADO_INVALIDO', details: null } });
    sb.mockRpc('pendiente_descartar', { data: null, error: { message: 'ESTADO_INVALIDO', details: null } });
    expect(await validarPendienteAction(FORM)).toEqual({ error: 'Este alimento ya fue resuelto por otro investigador' });
    comoRol('investigador');
    expect(await descartarPendienteAction({ id: 7 })).toEqual({ error: 'Este alimento ya fue resuelto por otro investigador' });
  });

  it('FORBIDDEN de la RPC → Acceso denegado', async () => {
    comoRol('investigador');
    sb.mockRpc('pendiente_modificar', { data: null, error: { message: 'FORBIDDEN', details: null } });
    expect(await modificarPendienteAction(FORM)).toEqual({ error: 'Acceso denegado' });
  });
});

describe('argumentos inválidos no llaman a la RPC', () => {
  it.each([
    ['nombre vacío', { ...FORM, nombre: '   ' }],
    ['kcal negativa', { ...FORM, kcal: -1 }],
    ['NaN', { ...FORM, grasas: Number.NaN }],
    ['Infinity', { ...FORM, carbs: Number.POSITIVE_INFINITY }],
    ['valor faltante', { ...FORM, proteinas: null }],
    ['id no entero', { ...FORM, id: 1.5 }],
    ['idAlimentoExistente inválido', { ...FORM, idAlimentoExistente: -3 }],
  ])('validar: %s', async (_caso, input) => {
    comoRol('investigador');
    const r = await validarPendienteAction(input as never);
    expect('error' in r).toBe(true);
    expect(sb.rpcLlamadas()).toHaveLength(0);
  });

  it('modificar con negativo y descartar con id inválido', async () => {
    comoRol('investigador');
    expect('error' in (await modificarPendienteAction({ ...FORM, kcal: -5 }))).toBe(true);
    expect('error' in (await descartarPendienteAction({ id: 0 }))).toBe(true);
    expect(sb.rpcLlamadas()).toHaveLength(0);
  });
});

describe('getPendienteDetalleAction', () => {
  it('arma las ocurrencias y firma todas las fotos en UNA llamada', async () => {
    comoRol('investigador');
    sb.mockTable('v_alimentos_pendientes', { data: { id_pendiente: 7, nombre_original: 'Tarta rara', ocurrencias: 25 }, error: null });
    const ocurrencia = (n: number, uid: string, path: string | null) => ({
      id_guardado_item: n,
      name: `Tarta ${n}`,
      grams: 200,
      ai_grams: n === 1 ? 150 : null,
      answers: [{ question: '¿De qué?', answer: 'acelga' }],
      created_at: '2026-10-07T12:00:00Z',
      detecciones_guardados: { id_usuario: uid, detecciones_ia: { imagen_path: path } },
      detecciones_ia_items:
        n === 3 ? null : { ingredient: 'Tarta', estimated_weight_grams: 180, bbox_x: 0.1, bbox_y: 0.2, bbox_width: 0.3, bbox_height: 0.4 },
    });
    sb.mockTable('detecciones_guardados_items', {
      data: [ocurrencia(1, 'u1', 'u1/a.jpg'), ocurrencia(2, 'u2', 'u2/b.jpg'), ocurrencia(3, 'u1', 'u1/a.jpg'), ocurrencia(4, 'u2', null)],
      error: null,
    });
    sb.mockTable('profiles', { data: [{ user_id: 'u1', nombre: 'Ana', apellido: 'Pérez' }, { user_id: 'u2', nombre: 'Juan', apellido: 'Gómez' }], error: null });
    sb.mockStorage('createSignedUrls', {
      data: [{ path: 'u1/a.jpg', signedUrl: 'https://x/a' }, { path: 'u2/b.jpg', signedUrl: 'https://x/b' }],
      error: null,
    });

    const r = await getPendienteDetalleAction(7);

    const firmas = sb.storageLlamadas().filter((l) => l.metodo === 'createSignedUrls');
    expect(firmas).toHaveLength(1);
    expect(firmas[0].args[0]).toEqual(['u1/a.jpg', 'u2/b.jpg']);
    expect(sb.rpcLlamadas()).toHaveLength(0);
    if (!('ok' in r)) throw new Error(r.error);
    expect(r.totalOcurrencias).toBe(25);
    expect(r.ocurrencias).toHaveLength(4);
    expect(r.ocurrencias[0]).toEqual({
      idGuardadoItem: 1,
      fecha: '2026-10-07T12:00:00Z',
      deportista: 'Ana Pérez',
      nombreIa: 'Tarta',
      nombreFinal: 'Tarta 1',
      gramosIa: 150,
      gramosFinal: 200,
      respuestas: [{ question: '¿De qué?', answer: 'acelga' }],
      bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      fotoUrl: 'https://x/a',
    });
    expect(r.ocurrencias[1]).toMatchObject({ deportista: 'Juan Gómez', gramosIa: 180, fotoUrl: 'https://x/b' });
    expect(r.ocurrencias[2]).toMatchObject({ nombreIa: null, bbox: null, gramosIa: null, fotoUrl: 'https://x/a' });
    expect(r.ocurrencias[3]).toMatchObject({ fotoUrl: null });
    // Las ocurrencias se piden filtradas por la fila y limitadas.
    expect(sb.filtrosLlamados()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tabla: 'detecciones_guardados_items', metodo: 'limit', args: [20] }),
        expect.objectContaining({ tabla: 'profiles', metodo: 'in', args: ['user_id', ['u1', 'u2']] }),
      ]),
    );
  });

  it('fila inexistente → error', async () => {
    comoRol('investigador');
    sb.mockTable('v_alimentos_pendientes', { data: null, error: { message: 'no rows' } });
    expect(await getPendienteDetalleAction(99)).toEqual({ error: 'El alimento pendiente no existe' });
  });
});
