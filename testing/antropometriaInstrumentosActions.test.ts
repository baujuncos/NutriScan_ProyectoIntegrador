/**
 * NUT-246/NUT-240 — Acciones: instrumentos (opcionales, texto libre), "investigador que midió" y "Mis instrumentos".
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

import {
  finalizarMedicionAction,
  guardarBorradorAction,
  guardarMisInstrumentosAction,
} from '@/app/(researcher)/antropometrias/actions';

const PACIENTE_ID = '11111111-1111-4111-8111-111111111111';
const MEDICION_ID = '22222222-2222-4222-8222-222222222222';
const NUEVA_ID = '33333333-3333-4333-8333-333333333333';
const CREADOR_ID = '44444444-4444-4444-8444-444444444444';
const LUCIA_ID = '55555555-5555-4555-8555-555555555555';
const MARTIN_ID = '66666666-6666-4666-8666-666666666666';

const MANUAL = {
  id: PACIENTE_ID,
  nombre: 'Julieta',
  apellido: 'Marchetti',
  fecha_nacimiento: '2002-04-05',
  sexo: 'F',
  masa_osea_referencia: null,
  creado_por: CREADOR_ID,
  creado_en: '2026-10-01T00:00:00Z',
};

const base = {
  origen: 'manual',
  pacienteId: PACIENTE_ID,
  fechaMedicion: '2026-10-24',
  nivelActividad: 'moderada',
  deporte: 'voleibol',
  series: SERIES_JULIETA,
};

function comoRol(role: string | null) {
  getUserMock.mockResolvedValue({ data: { user: { id: CREADOR_ID } } });
  sb.mockTable('profiles', { data: role ? { role } : null, error: null });
}

/** La consulta que valida que quien midió sea investigador/administrador (la devuelve o no). */
function medidorValido(valido: boolean, id = LUCIA_ID) {
  sb.mockTable('profiles', { data: valido ? { user_id: id } : null, error: null });
}

function medicion(over: Record<string, unknown> = {}) {
  return {
    id: MEDICION_ID,
    user_id: null,
    paciente_manual_id: PACIENTE_ID,
    fecha_medicion: '2026-09-10',
    investigador_id: CREADOR_ID,
    medido_por: null,
    instrumento_balanza: null,
    instrumento_calibres: null,
    instrumento_plicometro: null,
    instrumento_cinta: null,
    nivel_actividad: 'moderada',
    deporte: null,
    series: SERIES_JULIETA,
    estado: 'vigente',
    creado_en: '2026-09-10T00:00:00Z',
    actualizado_en: '2026-09-10T00:00:00Z',
    actualizado_por: CREADOR_ID,
    ...over,
  };
}

function conPacienteManual(mediciones: unknown[] = []) {
  sb.mockTable('antropometria_pacientes_manuales', { data: MANUAL, error: null });
  sb.mockTable('antropometria_mediciones', { data: mediciones, error: null });
}

const actualizaciones = (tabla: string) => sb.filtrosLlamados().filter((f) => f.tabla === tabla && f.metodo === 'update');
const consultasAPerfiles = () => sb.tablasLlamadas().filter((t) => t === 'profiles').length;

beforeEach(() => {
  sb.reset();
  getUserMock.mockReset();
  revalidatePathMock.mockReset();
});

describe('permisos', () => {
  const acciones = [guardarBorradorAction, finalizarMedicionAction, guardarMisInstrumentosAction];
  const conInstrumentos = { ...base, medidoPor: LUCIA_ID, instrumentos: { balanza: 'Tanita' } };

  it('sin sesión → No autenticado y no escribe', async () => {
    for (const accion of acciones) {
      getUserMock.mockResolvedValue({ data: { user: null } });
      expect(await accion(conInstrumentos)).toEqual({ error: 'No autenticado' });
    }
    expect(sb.insertsLlamados()).toHaveLength(0);
  });

  it.each(['deportista_ucc', 'particular', null])('rol %s → Acceso denegado y no escribe', async (rol) => {
    for (const accion of acciones) {
      comoRol(rol);
      expect(await accion(conInstrumentos)).toEqual({ error: 'Acceso denegado' });
    }
    expect(sb.insertsLlamados()).toHaveLength(0);
  });
});

describe('guardarBorradorAction — instrumentos y quién midió', () => {
  it('crea el borrador con medido_por y los 4 instrumentos recortados; los vacíos van como null', async () => {
    comoRol('investigador');
    medidorValido(true);
    conPacienteManual();
    sb.mockTable('antropometria_mediciones', { data: { id: NUEVA_ID }, error: null });

    const r = await guardarBorradorAction({
      ...base,
      medidoPor: LUCIA_ID,
      instrumentos: { balanza: '  Tanita BC-601  ', calibres: '', plicometro: 'Harpenden', cinta: '   ' },
    });

    expect(r).toEqual({ ok: true, id: NUEVA_ID });
    expect(sb.insertsLlamados()[0].payload).toMatchObject({
      estado: 'borrador',
      medido_por: LUCIA_ID,
      instrumento_balanza: 'Tanita BC-601',
      instrumento_calibres: null,
      instrumento_plicometro: 'Harpenden',
      instrumento_cinta: null,
    });
  });

  it('todo es opcional: sin quién midió ni instrumentos guarda igual y no manda esas columnas', async () => {
    comoRol('investigador');
    conPacienteManual();
    sb.mockTable('antropometria_mediciones', { data: { id: NUEVA_ID }, error: null });

    expect(await guardarBorradorAction(base)).toEqual({ ok: true, id: NUEVA_ID });
    const payload = sb.insertsLlamados()[0].payload as Record<string, unknown>;
    expect(Object.keys(payload).some((k) => k === 'medido_por' || k.startsWith('instrumento_'))).toBe(false);
    expect(consultasAPerfiles()).toBe(1); // solo el chequeo de rol
  });

  it('un "medidoPor" vacío se guarda como null (= quien carga la medición) sin validar nada', async () => {
    comoRol('investigador');
    conPacienteManual();
    sb.mockTable('antropometria_mediciones', { data: { id: NUEVA_ID }, error: null });

    await guardarBorradorAction({ ...base, medidoPor: '' });

    expect(sb.insertsLlamados()[0].payload).toMatchObject({ medido_por: null });
    expect(consultasAPerfiles()).toBe(1);
  });

  it('rechaza a alguien que no es investigador ni administrador y no escribe', async () => {
    comoRol('investigador');
    medidorValido(false, MARTIN_ID);
    conPacienteManual();

    const r = await guardarBorradorAction({ ...base, medidoPor: MARTIN_ID });

    expect(r).toEqual({ error: expect.stringMatching(/investigador o administrador/) });
    expect(sb.insertsLlamados()).toHaveLength(0);
    expect(actualizaciones('antropometria_mediciones')).toHaveLength(0);
  });

  it('un id de investigador con formato inválido se rechaza antes de consultar', async () => {
    comoRol('investigador');
    expect(await guardarBorradorAction({ ...base, medidoPor: 'cualquiera' })).toEqual({ error: expect.stringMatching(/inválido/i) });
    expect(consultasAPerfiles()).toBe(1);
  });

  it('un instrumento de más de 120 caracteres se rechaza con mensaje claro; uno de 120 pasa', async () => {
    comoRol('investigador');
    expect(await guardarBorradorAction({ ...base, instrumentos: { balanza: 'x'.repeat(121) } })).toEqual({
      error: 'Cada instrumento admite hasta 120 caracteres.',
    });
    expect(sb.insertsLlamados()).toHaveLength(0);

    comoRol('investigador');
    conPacienteManual();
    sb.mockTable('antropometria_mediciones', { data: { id: NUEVA_ID }, error: null });
    expect(await guardarBorradorAction({ ...base, instrumentos: { balanza: 'x'.repeat(120) } })).toEqual({ ok: true, id: NUEVA_ID });
  });

  it('al actualizar un borrador, los instrumentos que no llegan no se tocan', async () => {
    comoRol('investigador');
    conPacienteManual([medicion({ estado: 'borrador', instrumento_balanza: 'Tanita' })]);

    await guardarBorradorAction({ ...base, medicionId: MEDICION_ID });

    const [act] = actualizaciones('antropometria_mediciones');
    expect(Object.keys(act.args[0] as object).some((k) => k.startsWith('instrumento_') || k === 'medido_por')).toBe(false);
  });
});

describe('finalizarMedicionAction — instrumentos y quién midió', () => {
  it('persiste medido_por e instrumentos al generar el informe', async () => {
    comoRol('investigador');
    medidorValido(true);
    conPacienteManual();
    sb.mockTable('antropometria_mediciones', { data: { id: NUEVA_ID }, error: null });

    const r = await finalizarMedicionAction({
      ...base,
      medidoPor: LUCIA_ID,
      instrumentos: { balanza: 'Tanita', calibres: 'Rosscraft', plicometro: '', cinta: 'Lufkin' },
    });

    expect(r).toEqual({ ok: true, id: NUEVA_ID });
    expect(sb.insertsLlamados()[0].payload).toMatchObject({
      estado: 'vigente',
      medido_por: LUCIA_ID,
      instrumento_balanza: 'Tanita',
      instrumento_calibres: 'Rosscraft',
      instrumento_plicometro: null,
      instrumento_cinta: 'Lufkin',
    });
  });

  it('los instrumentos vacíos nunca bloquean el informe', async () => {
    comoRol('investigador');
    conPacienteManual();
    sb.mockTable('antropometria_mediciones', { data: { id: NUEVA_ID }, error: null });

    expect(await finalizarMedicionAction({ ...base, instrumentos: { balanza: '', calibres: '', plicometro: '', cinta: '' } })).toEqual({
      ok: true,
      id: NUEVA_ID,
    });
  });

  it('un responsable inválido no deja generar el informe (sin escribir)', async () => {
    comoRol('investigador');
    medidorValido(false, MARTIN_ID);
    conPacienteManual();
    expect(await finalizarMedicionAction({ ...base, medidoPor: MARTIN_ID })).toEqual({ error: expect.stringMatching(/investigador o administrador/) });
    expect(sb.insertsLlamados()).toHaveLength(0);
  });

  it('al editar, cambiar quién midió se valida y se guarda; investigador_id (quien cargó) nunca se manda', async () => {
    comoRol('investigador');
    medidorValido(true, MARTIN_ID);
    conPacienteManual([medicion({ medido_por: LUCIA_ID })]);

    const r = await finalizarMedicionAction({ ...base, medicionId: MEDICION_ID, fechaMedicion: '2026-09-10', medidoPor: MARTIN_ID });

    expect(r).toEqual({ ok: true, id: MEDICION_ID });
    const [act] = actualizaciones('antropometria_mediciones');
    expect(act.args[0]).toMatchObject({ medido_por: MARTIN_ID });
    expect(act.args[0]).not.toHaveProperty('investigador_id');
  });

  it('al editar, si quien midió no cambia no se vuelve a validar (aunque haya perdido el rol)', async () => {
    comoRol('investigador');
    conPacienteManual([medicion({ medido_por: LUCIA_ID })]);

    const r = await finalizarMedicionAction({ ...base, medicionId: MEDICION_ID, fechaMedicion: '2026-09-10', medidoPor: LUCIA_ID });

    expect(r).toEqual({ ok: true, id: MEDICION_ID });
    expect(consultasAPerfiles()).toBe(1);
  });

  it('una medición vieja (medido_por null) que reenvía a quien la cargó no escribe medido_por ni valida', async () => {
    comoRol('investigador');
    conPacienteManual([medicion()]);

    const r = await finalizarMedicionAction({ ...base, medicionId: MEDICION_ID, fechaMedicion: '2026-09-10', medidoPor: CREADOR_ID });

    expect(r).toEqual({ ok: true, id: MEDICION_ID });
    expect(consultasAPerfiles()).toBe(1);
    const [act] = actualizaciones('antropometria_mediciones');
    expect(act.args[0]).not.toHaveProperty('medido_por');
  });

  it('al editar sin mandar instrumentos, la medición conserva los que tenía', async () => {
    comoRol('investigador');
    conPacienteManual([medicion({ instrumento_balanza: 'Tanita' })]);

    await finalizarMedicionAction({ ...base, medicionId: MEDICION_ID, fechaMedicion: '2026-09-10' });

    const [act] = actualizaciones('antropometria_mediciones');
    expect(Object.keys(act.args[0] as object).some((k) => k.startsWith('instrumento_'))).toBe(false);
  });
});

describe('guardarMisInstrumentosAction', () => {
  it('guarda la fila propia (upsert) con los textos recortados y los vacíos como null', async () => {
    comoRol('investigador');

    const r = await guardarMisInstrumentosAction({ balanza: ' Tanita BC-601 ', calibres: '', plicometro: 'Harpenden', cinta: '' });

    expect(r).toEqual({ ok: true });
    const [insert] = sb.insertsLlamados();
    expect(insert.tabla).toBe('antropometria_instrumentos_investigador');
    expect(insert.payload).toMatchObject({
      investigador_id: CREADOR_ID,
      instrumento_balanza: 'Tanita BC-601',
      instrumento_calibres: null,
      instrumento_plicometro: 'Harpenden',
      instrumento_cinta: null,
    });
    expect(typeof (insert.payload as { actualizado_en: string }).actualizado_en).toBe('string');
    expect(revalidatePathMock).toHaveBeenCalledWith('/antropometrias/configuracion');
  });

  it('todos vacíos también se guarda (limpia el catálogo)', async () => {
    comoRol('investigador');
    expect(await guardarMisInstrumentosAction({})).toEqual({ ok: true });
    expect(sb.insertsLlamados()[0].payload).toMatchObject({
      instrumento_balanza: null,
      instrumento_calibres: null,
      instrumento_plicometro: null,
      instrumento_cinta: null,
    });
  });

  it('el administrador también puede', async () => {
    comoRol('administrador');
    expect(await guardarMisInstrumentosAction({ balanza: 'Seca' })).toEqual({ ok: true });
  });

  it('más de 120 caracteres → error y no escribe', async () => {
    comoRol('investigador');
    expect(await guardarMisInstrumentosAction({ cinta: 'y'.repeat(121) })).toEqual({ error: 'Cada instrumento admite hasta 120 caracteres.' });
    expect(sb.insertsLlamados()).toHaveLength(0);
  });

  it('si la base rechaza, devuelve un mensaje claro', async () => {
    comoRol('investigador');
    sb.mockTable('antropometria_instrumentos_investigador', { data: null, error: { message: 'boom' } });
    expect(await guardarMisInstrumentosAction({ balanza: 'Seca' })).toEqual({ error: expect.stringMatching(/No se pudieron guardar/) });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
