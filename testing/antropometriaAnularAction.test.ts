/**
 * NUT-245 — Anular una medición: baja lógica (cambia el estado, nunca borra).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';
import { SERIES_JULIETA } from './fixtures/antropometria';

const { getUserMock, revalidatePathMock } = vi.hoisted(() => ({ getUserMock: vi.fn(), revalidatePathMock: vi.fn() }));
const sb = createSupabaseFromMock();

vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: sb.from, rpc: sb.rpc, storage: sb.storage }),
}));

import { anularMedicionAction } from '@/app/(researcher)/antropometrias/actions';

const PACIENTE_ID = '11111111-1111-4111-8111-111111111111';
const MEDICION_ID = '22222222-2222-4222-8222-222222222222';

function comoRol(role: string | null) {
  getUserMock.mockResolvedValue({ data: { user: { id: 'inv-1' } } });
  sb.mockTable('profiles', { data: role ? { role } : null, error: null });
}

function medicion(over: Record<string, unknown> = {}) {
  return {
    id: MEDICION_ID,
    user_id: null,
    paciente_manual_id: PACIENTE_ID,
    fecha_medicion: '2026-09-10',
    investigador_id: 'inv-1',
    nivel_actividad: 'moderada',
    deporte: null,
    series: SERIES_JULIETA,
    estado: 'vigente',
    creado_en: '2026-09-10T00:00:00Z',
    actualizado_en: '2026-09-10T00:00:00Z',
    actualizado_por: 'inv-1',
    ...over,
  };
}

const actualizaciones = () => sb.filtrosLlamados().filter((f) => f.tabla === 'antropometria_mediciones' && f.metodo === 'update');

beforeEach(() => {
  sb.reset();
  getUserMock.mockReset();
  revalidatePathMock.mockReset();
});

describe('anularMedicionAction', () => {
  it('sin sesión o con otro rol: no anula', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect(await anularMedicionAction(MEDICION_ID)).toEqual({ error: 'No autenticado' });
    for (const rol of ['deportista_ucc', 'particular', null]) {
      comoRol(rol);
      expect(await anularMedicionAction(MEDICION_ID)).toEqual({ error: 'Acceso denegado' });
    }
    expect(actualizaciones()).toHaveLength(0);
  });

  it('cambia el estado a anulada, nunca borra, y revalida listado, ficha e informe', async () => {
    comoRol('investigador');
    sb.mockTable('antropometria_mediciones', { data: medicion(), error: null });

    const r = await anularMedicionAction(MEDICION_ID);

    expect(r).toEqual({ ok: true, fichaHref: `/antropometrias/manual/${PACIENTE_ID}` });
    expect(actualizaciones()[0].args[0]).toEqual({ estado: 'anulada' });
    expect(sb.filtrosLlamados().some((f) => f.metodo === 'delete')).toBe(false);
    expect(revalidatePathMock).toHaveBeenCalledWith('/antropometrias');
    expect(revalidatePathMock).toHaveBeenCalledWith(`/antropometrias/manual/${PACIENTE_ID}`);
    expect(revalidatePathMock).toHaveBeenCalledWith(`/antropometrias/medicion/${MEDICION_ID}`);
  });

  it('la ficha de un deportista registrado se arma con su user_id', async () => {
    comoRol('investigador');
    sb.mockTable('antropometria_mediciones', { data: medicion({ user_id: PACIENTE_ID, paciente_manual_id: null }), error: null });
    expect(await anularMedicionAction(MEDICION_ID)).toEqual({ ok: true, fichaHref: `/antropometrias/deportista/${PACIENTE_ID}` });
  });

  it('también descarta un borrador', async () => {
    comoRol('investigador');
    sb.mockTable('antropometria_mediciones', { data: medicion({ estado: 'borrador' }), error: null });
    expect(await anularMedicionAction(MEDICION_ID)).toMatchObject({ ok: true });
  });

  it('una ya anulada, una inexistente o un id inválido no escriben', async () => {
    comoRol('investigador');
    sb.mockTable('antropometria_mediciones', { data: medicion({ estado: 'anulada' }), error: null });
    expect(await anularMedicionAction(MEDICION_ID)).toEqual({ error: 'La medición ya estaba anulada.' });

    comoRol('investigador');
    sb.mockTable('antropometria_mediciones', { data: null, error: null });
    expect(await anularMedicionAction(MEDICION_ID)).toEqual({ error: 'No se encontró la medición.' });

    comoRol('investigador');
    expect(await anularMedicionAction('x')).toEqual({ error: 'Identificador inválido.' });
    expect(actualizaciones()).toHaveLength(0);
  });

  it('si la base falla devuelve un error genérico y no revalida', async () => {
    comoRol('investigador');
    sb.mockTable('antropometria_mediciones', { data: medicion(), error: null });
    sb.mockTable('antropometria_mediciones', { data: null, error: { message: 'rls' } });
    expect(await anularMedicionAction(MEDICION_ID)).toEqual({ error: 'No se pudo anular la medición. Probá de nuevo.' });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
