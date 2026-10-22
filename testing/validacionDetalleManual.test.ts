/**
 * NUT-192 — getPendienteDetalleAction con cargas manuales (items.id_pendiente) y el aviso de
 * nombre ya existente en SARA2/ANMAT. La parte transaccional (trigger que completa los ítems)
 * se prueba contra Postgres en supabase/tests, no acá.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));
const sb = createSupabaseFromMock();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: sb.from, rpc: sb.rpc, storage: sb.storage }),
}));

import { getPendienteDetalleAction } from '@/app/(researcher)/validacion/actions';

const pendiente = (over: Record<string, unknown> = {}) => ({
  id_pendiente: 7,
  nombre_original: 'Tarta casera',
  nombre_normalizado: 'tarta casera',
  estado: 'pendiente',
  ocurrencias: 0,
  ocurrencias_manuales: 25,
  usuarios_distintos: 4,
  origen: 'manual',
  ...over,
});

const manual = (n: number, uid: string, nombre = 'Tarta casera') => ({
  id_item: n,
  nombre_manual: nombre,
  cantidad: '150.00',
  created_at: '2026-10-07T12:00:00Z',
  ingestas: { fecha: '2026-10-06', id_usuario: uid },
});

beforeEach(() => {
  sb.reset();
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'inv-1' } } });
  sb.mockTable('profiles', { data: { role: 'investigador' }, error: null }); // re-verificación de rol
});

describe('getPendienteDetalleAction — cargas manuales', () => {
  it('devuelve las solicitudes manuales (quién, cuándo, lo que escribió y los gramos) y el total real', async () => {
    sb.mockTable('v_alimentos_pendientes', { data: pendiente(), error: null });
    sb.mockTable('detecciones_guardados_items', { data: [], error: null });
    sb.mockTable('detecciones_guardados_items', { data: [], error: null });
    sb.mockTable('items', { data: [manual(1, 'u1'), manual(2, 'u2', 'tarta de verduras')], error: null });
    sb.mockTable('profiles', { data: [{ user_id: 'u1', nombre: 'Ana', apellido: 'Pérez' }, { user_id: 'u2', nombre: 'Juan', apellido: 'Gómez' }], error: null });

    const r = await getPendienteDetalleAction(7);

    if (!('ok' in r)) throw new Error(r.error);
    expect(r.ocurrencias).toEqual([]);
    expect(r.totalOcurrencias).toBe(0);
    expect(r.totalSolicitudesManuales).toBe(25);
    expect(r.solicitudesManuales).toEqual([
      { idItem: 1, fecha: '2026-10-06', deportista: 'Ana Pérez', nombre: 'Tarta casera', gramos: 150 },
      { idItem: 2, fecha: '2026-10-06', deportista: 'Juan Gómez', nombre: 'tarta de verduras', gramos: 150 },
    ]);
    // Se piden filtradas por la entrada y limitadas; los nombres se traen en UNA consulta junto con los de las fotos.
    expect(sb.filtrosLlamados()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tabla: 'items', metodo: 'limit', args: [20] }),
        expect.objectContaining({ tabla: 'profiles', metodo: 'in', args: ['user_id', ['u1', 'u2']] }),
      ]),
    );
  });

  it('en una entrada mixta junta los usuarios de las fotos y de las cargas manuales en una sola consulta de perfiles', async () => {
    sb.mockTable('v_alimentos_pendientes', { data: pendiente({ ocurrencias: 1, origen: 'ia', ocurrencias_manuales: 1 }), error: null });
    const ocu = {
      id_guardado_item: 1, name: 'Tarta', grams: 120, ai_grams: 100, answers: [], created_at: '2026-10-07T12:00:00Z',
      detecciones_guardados: { id_usuario: 'u3', detecciones_ia: { imagen_path: null } }, detecciones_ia_items: null,
    };
    sb.mockTable('detecciones_guardados_items', { data: [ocu], error: null });
    sb.mockTable('detecciones_guardados_items', { data: [ocu], error: null });
    sb.mockTable('items', { data: [manual(9, 'u1')], error: null });
    sb.mockTable('profiles', { data: [], error: null });

    const r = await getPendienteDetalleAction(7);

    if (!('ok' in r)) throw new Error(r.error);
    expect(r.ocurrencias).toHaveLength(1);
    expect(r.solicitudesManuales).toHaveLength(1);
    const consultasPerfiles = sb.filtrosLlamados().filter((f) => f.tabla === 'profiles' && f.metodo === 'in');
    expect(consultasPerfiles).toHaveLength(1);
    expect((consultasPerfiles[0].args[1] as string[]).sort()).toEqual(['u1', 'u3']);
  });

  it('una entrada de IA sin cargas manuales devuelve listas vacías', async () => {
    sb.mockTable('v_alimentos_pendientes', { data: pendiente({ origen: 'ia', ocurrencias: 0, ocurrencias_manuales: 0 }), error: null });
    sb.mockTable('detecciones_guardados_items', { data: [], error: null });
    sb.mockTable('detecciones_guardados_items', { data: [], error: null });
    sb.mockTable('items', { data: [], error: null });

    const r = await getPendienteDetalleAction(7);

    if (!('ok' in r)) throw new Error(r.error);
    expect(r.solicitudesManuales).toEqual([]);
    expect(r.totalSolicitudesManuales).toBe(0);
  });
});

describe('getPendienteDetalleAction — aviso de nombre existente en el catálogo', () => {
  it('busca SARA2/ANMAT por el nombre normalizado de la cola (no reimplementa la normalización en TS) y los devuelve', async () => {
    sb.mockTable('v_alimentos_pendientes', { data: pendiente(), error: null });
    sb.mockTable('detecciones_guardados_items', { data: [], error: null });
    sb.mockTable('detecciones_guardados_items', { data: [], error: null });
    sb.mockTable('items', { data: [], error: null });
    sb.mockTable('alimentos', { data: [{ id_alimento: 10, nombre: 'Tarta de verdura', fuente: 'SARA2' }], error: null });

    const r = await getPendienteDetalleAction(7);

    if (!('ok' in r)) throw new Error(r.error);
    expect(r.existentesCatalogo).toEqual([{ origen: 'catalogo', id: 10, nombre: 'Tarta de verdura', fuente: 'SARA2' }]);
    expect(sb.filtrosLlamados()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tabla: 'alimentos', metodo: 'in', args: ['fuente', ['SARA2', 'ANMAT']] }),
        expect.objectContaining({ tabla: 'alimentos', metodo: 'limit', args: [3] }),
      ]),
    );
    expect(sb.rpcLlamadas()).toHaveLength(0);
  });

  it('en una entrada ya resuelta no consulta el catálogo', async () => {
    sb.mockTable('v_alimentos_pendientes', { data: pendiente({ estado: 'validado' }), error: null });
    sb.mockTable('detecciones_guardados_items', { data: [], error: null });
    sb.mockTable('detecciones_guardados_items', { data: [], error: null });
    sb.mockTable('items', { data: [], error: null });

    const r = await getPendienteDetalleAction(7);

    if (!('ok' in r)) throw new Error(r.error);
    expect(r.existentesCatalogo).toEqual([]);
    expect(sb.tablasLlamadas()).not.toContain('alimentos');
  });
});
