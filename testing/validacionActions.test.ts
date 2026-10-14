/**
 * NUT-119 — Acciones del investigador (`/validacion`): re-verificación de rol,
 * validación de argumentos, armado de las RPCs `pendiente_*` y mapeo de sus
 * errores. La lógica transaccional (recálculo, descartar sin borrar) vive en
 * SQL y se prueba contra Postgres, no acá.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';
import type { Composicion, ComponenteComposicion } from '@/lib/composicion';

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
  verificarAlimentoPropioAction,
  validarComoPropioAction,
  retirarAlimentoPropioAction,
  buscarAlimentosPropiosAction,
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
        args: { p_id: 7, p_nombre: 'Tarta de acelga', p_categoria: null, p_kcal: 180, p_prot: null, p_grasas: 9, p_carbs: 18, p_observaciones: 'ok', p_composicion: null },
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
          p_observaciones: 'ok', p_id_alimento_existente: null, p_composicion: null,
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
  it('validar un alimento nuevo (sin vínculo): la RPC no devuelve id de catálogo (no se agrega a `alimentos`)', async () => {
    comoRol('investigador');
    sb.mockRpc('pendiente_validar', { data: { id_alimento: null, items_afectados: 3 }, error: null });
    expect(await validarPendienteAction(FORM)).toEqual({ ok: true, idAlimento: null, itemsAfectados: 3 });
  });

  it('ya no existe DUPLICADO_EN_CATALOGO: un código desconocido es un error genérico, sin ofrecer vincular', async () => {
    comoRol('investigador');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sb.mockRpc('pendiente_validar', { data: null, error: { message: 'DUPLICADO_EN_CATALOGO', details: '1234' } });
    const r = await validarPendienteAction(FORM);
    expect(r).toEqual({ error: 'No se pudo completar la acción. Probá de nuevo.' });
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

describe('composición del catálogo', () => {
  const ACEITE: ComponenteComposicion = {
    origen: 'catalogo', id: 31, nombre: 'Aceite de oliva', fuente: 'SARA2', gramos: 15,
    kcal_100g: 800, proteinas_100g: 0, grasas_100g: 90, carbs_100g: 0,
  };
  const COMPOSICION: Composicion = { modo: 'catalogo', id_guardado_item: 412, gramos_foto: 20, componentes: [ACEITE] };
  const args = () => sb.rpcLlamadas()[0].args as Record<string, unknown>;

  it('modificar pasa la composición a la RPC', async () => {
    comoRol('investigador');
    expect(await modificarPendienteAction({ ...FORM, composicion: COMPOSICION })).toEqual({ ok: true });
    expect(args().p_composicion).toEqual(COMPOSICION);
  });

  it('validar en modo catálogo no exige los 4 valores (los calcula el servidor)', async () => {
    comoRol('investigador');
    sb.mockRpc('pendiente_validar', { data: { id_alimento: 31, items_afectados: 2 }, error: null });
    const r = await validarPendienteAction({
      ...FORM, kcal: null, proteinas: null, grasas: null, carbs: null, composicion: COMPOSICION,
    });
    expect(r).toEqual({ ok: true, idAlimento: 31, itemsAfectados: 2 });
    expect(args().p_composicion).toEqual(COMPOSICION);
    expect(args().p_kcal).toBeNull();
  });

  it('validar en modo ia o manual sigue exigiendo los 4 valores', async () => {
    comoRol('investigador');
    const manual: Composicion = { modo: 'manual', id_guardado_item: null, gramos_foto: null, componentes: [] };
    const r = await validarPendienteAction({ ...FORM, kcal: null, composicion: manual });
    expect('error' in r).toBe(true);
    expect(sb.rpcLlamadas()).toHaveLength(0);
  });

  it.each([
    ['gramos 0', { ...COMPOSICION, componentes: [{ ...ACEITE, gramos: 0 }] }],
    ['gramos sobre el tope', { ...COMPOSICION, componentes: [{ ...ACEITE, gramos: 1001 }] }],
    ['macro negativo', { ...COMPOSICION, componentes: [{ ...ACEITE, kcal_100g: -1 }] }],
    ['modo inválido', { ...COMPOSICION, modo: 'otro' }],
  ])('composición inválida (%s) no llama a la RPC', async (_caso, composicion) => {
    comoRol('investigador');
    expect('error' in (await modificarPendienteAction({ ...FORM, composicion: composicion as never }))).toBe(true);
    expect('error' in (await validarPendienteAction({ ...FORM, composicion: composicion as never }))).toBe(true);
    expect(sb.rpcLlamadas()).toHaveLength(0);
  });

  it('COMPOSICION_INVALIDA muestra el motivo que da el servidor', async () => {
    comoRol('investigador');
    sb.mockRpc('pendiente_validar', {
      data: null,
      error: { message: 'COMPOSICION_INVALIDA', details: 'La foto de referencia no corresponde a este alimento.' },
    });
    expect(await validarPendienteAction({ ...FORM, composicion: COMPOSICION })).toEqual({
      error: 'La composición no es válida: La foto de referencia no corresponde a este alimento.',
    });
  });

  it('COMPOSICION_INVALIDA sin detalle → mensaje corto', async () => {
    comoRol('investigador');
    sb.mockRpc('pendiente_modificar', { data: null, error: { message: 'COMPOSICION_INVALIDA', details: null } });
    expect(await modificarPendienteAction({ ...FORM, composicion: COMPOSICION })).toEqual({
      error: 'La composición no es válida',
    });
  });
});

describe('alimentos propios', () => {
  const PROPIO = {
    fuenteDato: 'etiqueta_producto' as const,
    justificacion: 'Etiqueta del envase, por 100 g.',
    confirmaciones: { reviseFuente: true as const, valoresPor100g: true as const, busqueExistente: true as const },
  };
  const FORM_PROPIO = { id: 7, nombre: 'Pan casero', categoria: 'panes', observaciones: null, kcal: 250, proteinas: 8, grasas: 3, carbs: 48, propio: PROPIO };
  const args = () => sb.rpcLlamadas()[0].args as Record<string, unknown>;

  it.each(['deportista_ucc', 'particular', null])('rol %s → acceso denegado sin llamar a ninguna RPC', async (rol) => {
    const inputs: Array<() => Promise<unknown>> = [
      () => verificarAlimentoPropioAction({ nombre: 'X', kcal: 1, proteinas: 1, grasas: 1, carbs: 1 }),
      () => validarComoPropioAction(FORM_PROPIO),
      () => retirarAlimentoPropioAction({ id: 3, motivo: 'motivo suficiente largo' }),
    ];
    for (const accion of inputs) {
      comoRol(rol);
      expect(await accion()).toEqual({ error: 'Acceso denegado' });
    }
    comoRol(rol);
    expect(await buscarAlimentosPropiosAction('pan')).toEqual([]);
    expect(sb.rpcLlamadas()).toHaveLength(0);
    expect(sb.tablasLlamadas().filter((t) => t !== 'profiles')).toHaveLength(0);
  });

  it('verificar llama a propio_verificar y devuelve bloqueos y advertencias', async () => {
    comoRol('investigador');
    const verificacion = {
      bloqueos: [{ codigo: 'DUPLICADO', existente: { origen: 'catalogo', id: 5, nombre: 'Huevo', fuente: 'ANMAT' } }],
      advertencias: [{ codigo: 'KCAL_INCOHERENTE' }],
    };
    sb.mockRpc('propio_verificar', { data: verificacion, error: null });
    const r = await verificarAlimentoPropioAction({ nombre: 'Huevo', kcal: 450, proteinas: 6, grasas: 18, carbs: null });
    expect(r).toEqual({ ok: true, ...verificacion });
    expect(args()).toEqual({ p_nombre: 'Huevo', p_kcal: 450, p_prot: 6, p_grasas: 18, p_carbs: null });
  });

  it('validarComoPropio manda la evaluación en snake_case y devuelve el id del propio', async () => {
    comoRol('investigador');
    sb.mockRpc('pendiente_validar_como_propio', { data: { id_alimento_propio: 12, items_afectados: 3 }, error: null });
    const r = await validarComoPropioAction({ ...FORM_PROPIO, propio: { ...PROPIO, confirmaIncoherente: true } });
    expect(r).toEqual({ ok: true, idAlimentoPropio: 12, itemsAfectados: 3 });
    expect(sb.rpcLlamadas()[0].nombre).toBe('pendiente_validar_como_propio');
    expect(args()).toEqual({
      p_id: 7, p_nombre: 'Pan casero', p_categoria: 'panes', p_kcal: 250, p_prot: 8, p_grasas: 3, p_carbs: 48, p_observaciones: null,
      p_propio: {
        fuente_dato: 'etiqueta_producto',
        justificacion: 'Etiqueta del envase, por 100 g.',
        confirmaciones: { revise_fuente: true, valores_por_100g: true, busque_existente: true },
        confirma_incoherente: true,
        confirma_distinto: false,
      },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/validacion');
  });

  it.each([
    ['fuente inválida', { ...FORM_PROPIO, propio: { ...PROPIO, fuenteDato: 'cualquiera' } }],
    ['justificación corta', { ...FORM_PROPIO, propio: { ...PROPIO, justificacion: 'corta' } }],
    ['una confirmación sin marcar', { ...FORM_PROPIO, propio: { ...PROPIO, confirmaciones: { ...PROPIO.confirmaciones, busqueExistente: false } } }],
    ['valor negativo', { ...FORM_PROPIO, kcal: -1 }],
    ['valor faltante', { ...FORM_PROPIO, grasas: null }],
    ['sin propio', { ...FORM_PROPIO, propio: undefined }],
  ])('validarComoPropio con %s no llama a la RPC', async (_caso, input) => {
    comoRol('investigador');
    expect('error' in (await validarComoPropioAction(input as never))).toBe(true);
    expect(sb.rpcLlamadas()).toHaveLength(0);
  });

  it.each([
    ['PROPIO_BLOQUEADO', JSON.stringify([{ codigo: 'DUPLICADO', existente: { origen: 'catalogo', id: 5, nombre: 'Huevo', fuente: 'ANMAT' } }]),
      'Ya existe «Huevo» (ANMAT). Usalo desde "Del catálogo".'],
    ['PROPIO_BLOQUEADO', JSON.stringify([{ codigo: 'MACRO_MAYOR_100' }, { codigo: 'KCAL_MAYOR_900' }]),
      'Un macronutriente no puede superar los 100 g por cada 100 g de alimento. Las kcal no pueden superar las 900 por cada 100 g.'],
    ['PROPIO_ADVERTENCIA', 'SIMILAR', 'Falta confirmar: Hay alimentos con un nombre muy parecido. Confirmá que el tuyo es distinto.'],
    ['PROPIO_EVALUACION', 'confirmaciones', 'Marcá las tres confirmaciones.'],
    ['PROPIO_EVALUACION', 'motivo', 'Escribí el motivo (al menos 10 caracteres).'],
    ['PROPIO_DUPLICADO', null, 'Otro investigador acaba de crear un alimento con ese nombre. Usalo desde "Del catálogo".'],
    ['ALIMENTO_NO_ENCONTRADO', 'propio:9', 'Un alimento propio de la composición ya no está disponible (fue retirado). Quitalo de la lista.'],
  ])('%s (%s) se muestra como un mensaje entendible', async (message, details, esperado) => {
    comoRol('investigador');
    sb.mockRpc('pendiente_validar_como_propio', { data: null, error: { message, details } });
    expect(await validarComoPropioAction(FORM_PROPIO)).toEqual({ error: esperado });
  });

  it('retirar llama a propio_retirar y revalida; un motivo corto no llega a la RPC', async () => {
    comoRol('investigador');
    expect('error' in (await retirarAlimentoPropioAction({ id: 3, motivo: 'corto' }))).toBe(true);
    expect(sb.rpcLlamadas()).toHaveLength(0);

    comoRol('investigador');
    sb.mockRpc('propio_retirar', { data: null, error: null });
    expect(await retirarAlimentoPropioAction({ id: 3, motivo: 'Los valores estaban mal.' })).toEqual({ ok: true });
    expect(args()).toEqual({ p_id: 3, p_motivo: 'Los valores estaban mal.' });
    expect(revalidatePathMock).toHaveBeenCalledWith('/validacion');
  });

  it('buscarAlimentosPropios devuelve los activos con fuente PROPIO y el id del propio', async () => {
    comoRol('investigador');
    sb.mockTable('alimentos_propios', {
      data: [{ id_alimento_propio: 4, nombre: 'Pan casero', categoria: 'panes', kcal_100g: 250, proteinas_100g: 8, grasas_100g: 3, carbs_100g: 48 }],
      error: null,
    });
    expect(await buscarAlimentosPropiosAction('pan')).toEqual([
      { id_alimento: 4, nombre: 'Pan casero', categoria: 'panes', fuente: 'PROPIO', marca: null, denominacion: null, kcal_100g: 250, proteinas_100g: 8, grasas_100g: 3, carbs_100g: 48 },
    ]);
    expect(sb.filtrosLlamados()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tabla: 'alimentos_propios', metodo: 'ilike', args: ['nombre', '%pan%'] }),
      ]),
    );
  });

  it('buscarAlimentosPropios con menos de 2 letras no consulta nada', async () => {
    comoRol('investigador');
    expect(await buscarAlimentosPropiosAction('p')).toEqual([]);
    expect(sb.tablasLlamadas().filter((t) => t !== 'profiles')).toHaveLength(0);
  });

  it('el detalle de un pendiente que creó un propio trae la información del propio', async () => {
    comoRol('investigador');
    sb.mockTable('v_alimentos_pendientes', { data: { id_pendiente: 7, nombre_original: 'Pan', ocurrencias: 1, id_alimento_propio: 4 }, error: null });
    sb.mockTable('detecciones_guardados_items', { data: [], error: null });
    sb.mockTable('detecciones_guardados_items', { data: [], error: null });
    sb.mockTable('alimentos_propios', {
      data: { id_alimento_propio: 4, estado: 'activo', fuente_dato: 'etiqueta_producto', justificacion: 'Etiqueta.', motivo_retiro: null },
      error: null,
    });
    const r = await getPendienteDetalleAction(7);
    if (!('ok' in r)) throw new Error(r.error);
    expect(r.propio).toEqual({ id: 4, estado: 'activo', fuenteDato: 'etiqueta_producto', justificacion: 'Etiqueta.', motivoRetiro: null });
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
    sb.mockTable('detecciones_guardados_items', { data: [ocurrencia(1, 'u1', 'u1/a.jpg')], error: null }); // la primera (referencia)
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
      esReferencia: true,
    });
    expect(r.ocurrencias[1]).toMatchObject({ deportista: 'Juan Gómez', gramosIa: 180, fotoUrl: 'https://x/b', esReferencia: false });
    expect(r.ocurrencias[2]).toMatchObject({ nombreIa: null, bbox: null, gramosIa: null, fotoUrl: 'https://x/a' });
    expect(r.ocurrencias[3]).toMatchObject({ fotoUrl: null });
    // Las ocurrencias se piden filtradas por la fila y limitadas.
    expect(sb.filtrosLlamados()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tabla: 'detecciones_guardados_items', metodo: 'limit', args: [20] }),
        expect.objectContaining({ tabla: 'detecciones_guardados_items', metodo: 'limit', args: [1] }),
        expect.objectContaining({ tabla: 'profiles', metodo: 'in', args: ['user_id', ['u1', 'u2']] }),
      ]),
    );
  });

  it('la foto de referencia es la PRIMERA ocurrencia aunque no esté entre las 20 más recientes: se agrega al principio', async () => {
    comoRol('investigador');
    sb.mockTable('v_alimentos_pendientes', { data: { id_pendiente: 7, nombre_original: 'Tarta rara', ocurrencias: 40 }, error: null });
    const ocurrencia = (n: number) => ({
      id_guardado_item: n, name: `Tarta ${n}`, grams: n === 1 ? 20 : 200, ai_grams: null, answers: [],
      created_at: '2026-10-07T12:00:00Z',
      detecciones_guardados: { id_usuario: 'u1', detecciones_ia: { imagen_path: null } },
      detecciones_ia_items: null,
    });
    sb.mockTable('detecciones_guardados_items', { data: [ocurrencia(40), ocurrencia(39)], error: null }); // las más recientes
    sb.mockTable('detecciones_guardados_items', { data: [ocurrencia(1)], error: null }); // la primera
    sb.mockTable('profiles', { data: [{ user_id: 'u1', nombre: 'Ana', apellido: 'Pérez' }], error: null });

    const r = await getPendienteDetalleAction(7);

    if (!('ok' in r)) throw new Error(r.error);
    expect(r.ocurrencias.map((o) => [o.idGuardadoItem, o.esReferencia])).toEqual([[1, true], [40, false], [39, false]]);
    expect(r.ocurrencias[0].gramosFinal).toBe(20);
    expect(sb.filtrosLlamados()).toEqual(
      expect.arrayContaining([expect.objectContaining({ tabla: 'detecciones_guardados_items', metodo: 'order', args: ['id_guardado_item', { ascending: true }] })]),
    );
  });

  it('fila inexistente → error', async () => {
    comoRol('investigador');
    sb.mockTable('v_alimentos_pendientes', { data: null, error: { message: 'no rows' } });
    expect(await getPendienteDetalleAction(99)).toEqual({ error: 'El alimento pendiente no existe' });
  });
});
