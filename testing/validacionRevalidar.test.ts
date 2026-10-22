/** NUT-192 — Al validar o descartar también se revalida /alimentacion (el diario cambia); guardar un borrador, no. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock, revalidatePathMock } = vi.hoisted(() => ({ getUserMock: vi.fn(), revalidatePathMock: vi.fn() }));
const sb = createSupabaseFromMock();

vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: sb.from, rpc: sb.rpc, storage: sb.storage }),
}));

import { descartarPendienteAction, modificarPendienteAction, validarComoPropioAction, validarPendienteAction } from '@/app/(researcher)/validacion/actions';

const FORM = { id: 7, nombre: 'Tarta', categoria: null, kcal: 180, proteinas: 6, grasas: 9, carbs: 18, observaciones: null };

beforeEach(() => {
  sb.reset();
  revalidatePathMock.mockReset();
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'inv-1' } } });
  sb.mockTable('profiles', { data: { role: 'investigador' }, error: null });
});

describe('revalidatePath de /alimentacion', () => {
  it('validar revalida /validacion y /alimentacion', async () => {
    sb.mockRpc('pendiente_validar', { data: { id_alimento: null, items_afectados: 0 }, error: null });
    await validarPendienteAction({ ...FORM, composicion: null });
    expect(revalidatePathMock).toHaveBeenCalledWith('/validacion');
    expect(revalidatePathMock).toHaveBeenCalledWith('/alimentacion');
  });

  it('descartar revalida /validacion y /alimentacion', async () => {
    sb.mockRpc('pendiente_descartar', { data: { items_afectados: 0 }, error: null });
    await descartarPendienteAction({ id: 7, observaciones: 'no es comida' });
    expect(revalidatePathMock).toHaveBeenCalledWith('/validacion');
    expect(revalidatePathMock).toHaveBeenCalledWith('/alimentacion');
  });

  it('validar como propio revalida /validacion y /alimentacion', async () => {
    sb.mockRpc('pendiente_validar_como_propio', { data: { id_alimento_propio: 3, items_afectados: 0 }, error: null });
    await validarComoPropioAction({
      ...FORM,
      propio: { fuenteDato: 'etiqueta_producto', justificacion: 'Etiqueta del fabricante', confirmaciones: { reviseFuente: true, valoresPor100g: true, busqueExistente: true } },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/validacion');
    expect(revalidatePathMock).toHaveBeenCalledWith('/alimentacion');
  });

  it('guardar un borrador NO revalida /alimentacion (no cambia ningún ítem)', async () => {
    sb.mockRpc('pendiente_modificar', { data: null, error: null });
    await modificarPendienteAction({ ...FORM, composicion: null });
    expect(revalidatePathMock).toHaveBeenCalledWith('/validacion');
    expect(revalidatePathMock).not.toHaveBeenCalledWith('/alimentacion');
  });

  it('si la RPC falla no revalida nada', async () => {
    sb.mockRpc('pendiente_validar', { data: null, error: { message: 'ESTADO_INVALIDO' } });
    await validarPendienteAction({ ...FORM, composicion: null });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
