/**
 * NUT-236/237 — Alta de pacientes manuales: control de rol, menores, duplicados y persistencia.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock, revalidatePathMock } = vi.hoisted(() => ({ getUserMock: vi.fn(), revalidatePathMock: vi.fn() }));
const sb = createSupabaseFromMock();

vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: sb.from, rpc: sb.rpc, storage: sb.storage }),
}));

import { crearPacienteManualAction } from '@/app/(researcher)/antropometrias/actions';

const VALIDO = { nombre: 'Julieta', apellido: 'Marchetti', fechaNacimiento: '2002-04-05', sexo: 'F' };

function comoRol(role: string | null) {
  getUserMock.mockResolvedValue({ data: { user: { id: 'inv-1' } } });
  sb.mockTable('profiles', { data: role ? { role } : null, error: null });
}

/** Fuentes vacías que lee `cargarListado` (perfiles, auxiliares, manuales, mediciones). */
function listadoVacio() {
  sb.mockTable('profiles', { data: [], error: null });
  sb.mockTable('antropometria_deportistas_datos', { data: [], error: null });
  sb.mockTable('antropometria_pacientes_manuales', { data: [], error: null });
  sb.mockTable('antropometria_mediciones', { data: [], error: null });
}

beforeEach(() => {
  sb.reset();
  getUserMock.mockReset();
  revalidatePathMock.mockReset();
});

describe('crearPacienteManualAction — permisos', () => {
  it('sin sesión → No autenticado y no escribe', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect(await crearPacienteManualAction(VALIDO)).toEqual({ error: 'No autenticado' });
    expect(sb.insertsLlamados()).toHaveLength(0);
  });

  it.each(['deportista_ucc', 'particular', null])('rol %s → Acceso denegado y no escribe', async (rol) => {
    comoRol(rol);
    expect(await crearPacienteManualAction(VALIDO)).toEqual({ error: 'Acceso denegado' });
    expect(sb.insertsLlamados()).toHaveLength(0);
  });
});

describe('crearPacienteManualAction — validaciones', () => {
  it('rechaza a un menor de edad con un mensaje claro y no escribe', async () => {
    comoRol('investigador');
    const r = await crearPacienteManualAction({ ...VALIDO, fechaNacimiento: '2015-01-01' });
    expect(r).toEqual({ error: expect.stringMatching(/mayores de 18/) });
    expect(sb.insertsLlamados()).toHaveLength(0);
  });

  it.each([
    [{ ...VALIDO, nombre: '   ' }, /nombre/i],
    [{ ...VALIDO, apellido: '' }, /apellido/i],
    [{ ...VALIDO, fechaNacimiento: 'ayer' }, /fecha/i],
    [{ ...VALIDO, sexo: 'X' }, /sexo/i],
  ])('datos inválidos %#', async (input, mensaje) => {
    comoRol('administrador');
    expect(await crearPacienteManualAction(input)).toEqual({ error: expect.stringMatching(mensaje) });
    expect(sb.insertsLlamados()).toHaveLength(0);
  });
});

describe('crearPacienteManualAction — duplicados', () => {
  function conExistente() {
    sb.mockTable('profiles', { data: [], error: null });
    sb.mockTable('antropometria_deportistas_datos', { data: [], error: null });
    sb.mockTable('antropometria_pacientes_manuales', {
      data: [{ id: 'm9', nombre: 'julieta', apellido: 'MARCHETTI', fecha_nacimiento: '2002-04-05', sexo: 'F' }],
      error: null,
    });
    sb.mockTable('antropometria_mediciones', { data: [], error: null });
  }

  it('avisa del duplicado SIN guardar', async () => {
    comoRol('investigador');
    conExistente();
    const r = await crearPacienteManualAction(VALIDO);
    expect(r).toEqual({ duplicado: { id: 'm9', origen: 'manual', nombre: 'julieta', apellido: 'MARCHETTI' } });
    expect(sb.insertsLlamados()).toHaveLength(0);
  });

  it('con confirmación guarda igual (el aviso no bloquea)', async () => {
    comoRol('investigador');
    sb.mockTable('antropometria_pacientes_manuales', { data: { id: 'nuevo-1' }, error: null });
    const r = await crearPacienteManualAction(VALIDO, true);
    expect(r).toEqual({ ok: true, id: 'nuevo-1' });
    expect(sb.insertsLlamados()).toHaveLength(1);
  });
});

describe('crearPacienteManualAction — persistencia', () => {
  it('inserta con los datos limpios, sin `creado_por` (lo pone la base) y revalida el listado', async () => {
    comoRol('investigador');
    listadoVacio();
    sb.mockTable('antropometria_pacientes_manuales', { data: { id: 'nuevo-1' }, error: null });

    const r = await crearPacienteManualAction({ ...VALIDO, nombre: '  Julieta ', apellido: ' Marchetti ' });

    expect(r).toEqual({ ok: true, id: 'nuevo-1' });
    expect(sb.insertsLlamados()).toEqual([
      {
        tabla: 'antropometria_pacientes_manuales',
        payload: { nombre: 'Julieta', apellido: 'Marchetti', fecha_nacimiento: '2002-04-05', sexo: 'F' },
      },
    ]);
    expect(revalidatePathMock).toHaveBeenCalledWith('/antropometrias');
  });

  it('error de base → mensaje genérico, sin filtrar detalles', async () => {
    comoRol('investigador');
    listadoVacio();
    sb.mockTable('antropometria_pacientes_manuales', { data: null, error: { message: 'boom: violates check' } });
    expect(await crearPacienteManualAction(VALIDO)).toEqual({ error: 'No se pudo guardar el paciente. Probá de nuevo.' });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
