import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getUserMock, rpcMock, fromMock, revalidateMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
  revalidateMock: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
// redirect() de Next lanza para cortar la ejecución; el test lee a dónde iba.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: fromMock }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
}));

import { addManualItemAction } from '@/app/alimentacion/actions';
import { todayAR } from '@/lib/date';

const HOY = todayAR();

function form(campos: Record<string, string>): FormData {
  const fd = new FormData();
  const base = {
    fecha: HOY,
    tipo_ingesta: 'almuerzo',
    tipo_item: 'solido',
    nombre_manual: 'Tarta casera de verduras',
    cantidad: '150',
  };
  for (const [k, v] of Object.entries({ ...base, ...campos })) fd.set(k, v);
  return fd;
}

async function ejecutar(fd: FormData): Promise<string> {
  try {
    await addManualItemAction(fd);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith('REDIRECT:')) return msg.slice('REDIRECT:'.length);
    throw e;
  }
  throw new Error('la acción no redirigió');
}

describe('addManualItemAction (NUT-192/NUT-193)', () => {
  beforeEach(() => {
    getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } } });
    rpcMock.mockReset().mockResolvedValue({ data: { id_item: 1, id_pendiente: 7, origen_macros: 'pendiente' }, error: null });
    fromMock.mockReset();
    revalidateMock.mockReset();
  });

  it('carga válida: llama a registrar_item_manual con el id del usuario autenticado y vuelve a la comida', async () => {
    const destino = await ejecutar(form({}));

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('registrar_item_manual', {
      p_user_id: 'user-1',
      p_fecha: HOY,
      p_tipo: 'almuerzo',
      p_tipo_item: 'solido',
      p_nombre: 'Tarta casera de verduras',
      p_cantidad: 150,
    });
    expect(revalidateMock).toHaveBeenCalledWith('/alimentacion');
    expect(destino).toBe(`/alimentacion?fecha=${HOY}&tipo=almuerzo`);
  });

  it('no escribe ítems con el cliente del usuario (la única vía de escritura es la RPC)', async () => {
    await ejecutar(form({}));
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('recorta espacios del nombre antes de mandarlo', async () => {
    await ejecutar(form({ nombre_manual: '   Tarta casera   ' }));
    expect(rpcMock.mock.calls[0][1].p_nombre).toBe('Tarta casera');
  });

  it('el user id sale de la sesión, no del formulario', async () => {
    await ejecutar(form({ p_user_id: 'otro-usuario', id_usuario: 'otro-usuario' }));
    expect(rpcMock.mock.calls[0][1].p_user_id).toBe('user-1');
  });

  it.each([
    ['nombre vacío', { nombre_manual: '   ' }],
    ['nombre de más de 120 caracteres', { nombre_manual: 'a'.repeat(121) }],
    ['cantidad 0', { cantidad: '0' }],
    ['cantidad negativa', { cantidad: '-5' }],
    ['cantidad que no es número', { cantidad: 'abc' }],
    ['cantidad por encima del máximo', { cantidad: '2001' }],
    ['tipo de ítem inválido', { tipo_item: 'gas' }],
  ])('%s: no llama a la RPC y vuelve a la comida', async (_nombre, campos) => {
    const destino = await ejecutar(form(campos));
    expect(rpcMock).not.toHaveBeenCalled();
    expect(destino).toBe(`/alimentacion?fecha=${HOY}&tipo=almuerzo`);
  });

  it('acepta el nombre de exactamente 120 caracteres y la cantidad máxima', async () => {
    await ejecutar(form({ nombre_manual: 'a'.repeat(120), cantidad: '2000' }));
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('fecha inválida: no llama a la RPC y vuelve a /alimentacion', async () => {
    const destino = await ejecutar(form({ fecha: 'no-es-fecha' }));
    expect(rpcMock).not.toHaveBeenCalled();
    expect(destino).toBe('/alimentacion');
  });

  it('tipo de ingesta inválido: no llama a la RPC', async () => {
    const destino = await ejecutar(form({ tipo_ingesta: 'brunch' }));
    expect(rpcMock).not.toHaveBeenCalled();
    expect(destino).toBe(`/alimentacion?fecha=${HOY}`);
  });

  it('fecha fuera del rango editable: no llama a la RPC', async () => {
    const destino = await ejecutar(form({ fecha: '2020-01-01' }));
    expect(rpcMock).not.toHaveBeenCalled();
    expect(destino).toBe('/alimentacion?fecha=2020-01-01&tipo=almuerzo');
  });

  it('sin sesión: manda a /login y no llama a la RPC', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const destino = await ejecutar(form({}));
    expect(destino).toBe('/login');
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('error de la RPC: lo loguea, no revalida y vuelve a la comida', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpcMock.mockResolvedValue({ data: null, error: { message: 'INVALID' } });

    const destino = await ejecutar(form({}));

    expect(consola).toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
    expect(destino).toBe(`/alimentacion?fecha=${HOY}&tipo=almuerzo`);
    consola.mockRestore();
  });
});
