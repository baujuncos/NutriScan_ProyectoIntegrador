/**
 * NUT-252 — Permisos del rol investigador en Antropometrías: TODA acción del módulo exige sesión y
 * `profiles.role` ∈ investigador/administrador, y un rol sin permiso no toca la base (ni insert, update,
 * delete, rpc ni storage). Tabla única: si se agrega una acción nueva, el test de cobertura obliga a sumarla acá.
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

import * as acciones from '@/app/(researcher)/antropometrias/actions';

const PACIENTE_ID = '11111111-1111-4111-8111-111111111111';
const MEDICION_ID = '22222222-2222-4222-8222-222222222222';

/** Entradas válidas: el chequeo de rol ocurre antes que cualquier validación, así que el rol denegado nunca llega a usarlas. */
const medicionValida = {
  origen: 'manual',
  pacienteId: PACIENTE_ID,
  fechaMedicion: '2026-10-24',
  nivelActividad: 'moderada',
  deporte: 'voleibol',
  series: SERIES_JULIETA,
};

interface CasoAccion {
  nombre: string;
  ejecutar: () => Promise<unknown>;
  /** Entrada inválida a propósito: con un rol permitido la acción pasa el chequeo de rol y corta en la validación, sin tocar la base. */
  ejecutarConEntradaInvalida: () => Promise<unknown>;
}

const ACCIONES: CasoAccion[] = [
  {
    nombre: 'crearPacienteManualAction',
    ejecutar: () =>
      acciones.crearPacienteManualAction({ nombre: 'Julieta', apellido: 'Marchetti', fechaNacimiento: '2002-04-05', sexo: 'F' }),
    ejecutarConEntradaInvalida: () => acciones.crearPacienteManualAction({}),
  },
  {
    nombre: 'guardarBorradorAction',
    ejecutar: () => acciones.guardarBorradorAction(medicionValida),
    ejecutarConEntradaInvalida: () => acciones.guardarBorradorAction({}),
  },
  {
    nombre: 'finalizarMedicionAction',
    ejecutar: () => acciones.finalizarMedicionAction(medicionValida),
    ejecutarConEntradaInvalida: () => acciones.finalizarMedicionAction({}),
  },
  {
    nombre: 'anularMedicionAction',
    ejecutar: () => acciones.anularMedicionAction(MEDICION_ID),
    ejecutarConEntradaInvalida: () => acciones.anularMedicionAction('no-es-un-id'),
  },
  {
    nombre: 'guardarMisInstrumentosAction',
    ejecutar: () => acciones.guardarMisInstrumentosAction({}),
    ejecutarConEntradaInvalida: () => acciones.guardarMisInstrumentosAction(null),
  },
];

function conSesion(role: string | null) {
  getUserMock.mockResolvedValue({ data: { user: { id: 'u-1' } } });
  sb.mockTable('profiles', { data: role ? { role } : null, error: null });
}

/** Cualquier llamada de escritura o de canal alternativo (rpc, storage) a la base. */
function escrituras() {
  return [
    ...sb.insertsLlamados(),
    ...sb.filtrosLlamados().filter((f) => ['update', 'delete', 'upsert'].includes(f.metodo)),
    ...sb.rpcLlamadas(),
    ...sb.storageLlamadas(),
  ];
}

beforeEach(() => {
  sb.reset();
  getUserMock.mockReset();
  revalidatePathMock.mockReset();
});

describe('cobertura de permisos', () => {
  it('la tabla incluye todas las acciones exportadas por actions.ts', () => {
    const exportadas = Object.keys(acciones).filter((k) => typeof (acciones as Record<string, unknown>)[k] === 'function');
    expect(ACCIONES.map((a) => a.nombre).sort()).toEqual(exportadas.sort());
  });
});

describe.each(ACCIONES)('$nombre — permisos', ({ ejecutar, ejecutarConEntradaInvalida }) => {
  it('sin sesión → No autenticado, sin consultar el perfil ni escribir', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    expect(await ejecutar()).toEqual({ error: 'No autenticado' });

    expect(sb.tablasLlamadas()).toEqual([]);
    expect(escrituras()).toHaveLength(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it.each(['deportista_ucc', 'particular', null])('rol %s → Acceso denegado, solo lee el perfil y no escribe', async (rol) => {
    conSesion(rol);

    expect(await ejecutar()).toEqual({ error: 'Acceso denegado' });

    expect(sb.tablasLlamadas()).toEqual(['profiles']);
    expect(escrituras()).toHaveLength(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it.each(['investigador', 'administrador'])('rol %s → pasa el chequeo de rol (corta recién en la validación)', async (rol) => {
    conSesion(rol);

    const resultado = await ejecutarConEntradaInvalida();

    expect(resultado).toEqual({ error: expect.any(String) });
    expect(resultado).not.toEqual({ error: 'No autenticado' });
    expect(resultado).not.toEqual({ error: 'Acceso denegado' });
    expect(escrituras()).toHaveLength(0);
  });
});
