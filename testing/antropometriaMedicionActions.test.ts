/**
 * NUT-239/240 — Guardar borrador y "Guardar y generar informe": permisos, 25/25, límite de 12,
 * menores, masa ósea de referencia y datos faltantes del deportista.
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

import { finalizarMedicionAction, guardarBorradorAction } from '@/app/(researcher)/antropometrias/actions';

const PACIENTE_ID = '11111111-1111-4111-8111-111111111111';
const MEDICION_ID = '22222222-2222-4222-8222-222222222222';
const NUEVA_ID = '33333333-3333-4333-8333-333333333333';

const MANUAL = {
  id: PACIENTE_ID,
  nombre: 'Julieta',
  apellido: 'Marchetti',
  fecha_nacimiento: '2002-04-05',
  sexo: 'F',
  masa_osea_referencia: null,
  creado_por: 'inv-1',
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

/** Paciente manual + sus mediciones (borrador/vigente) tal como las lee `prepararMedicion`. */
function conPacienteManual(mediciones: unknown[] = [], paciente: Record<string, unknown> = {}) {
  sb.mockTable('antropometria_pacientes_manuales', { data: { ...MANUAL, ...paciente }, error: null });
  sb.mockTable('antropometria_mediciones', { data: mediciones, error: null });
}

const actualizaciones = (tabla: string) => sb.filtrosLlamados().filter((f) => f.tabla === tabla && f.metodo === 'update');

beforeEach(() => {
  sb.reset();
  getUserMock.mockReset();
  revalidatePathMock.mockReset();
});

describe('permisos', () => {
  const acciones = [guardarBorradorAction, finalizarMedicionAction];

  it('sin sesión → No autenticado y no escribe', async () => {
    for (const accion of acciones) {
      getUserMock.mockResolvedValue({ data: { user: null } });
      expect(await accion(base)).toEqual({ error: 'No autenticado' });
    }
    expect(sb.insertsLlamados()).toHaveLength(0);
  });

  it.each(['deportista_ucc', 'particular', null])('rol %s → Acceso denegado y no escribe', async (rol) => {
    for (const accion of acciones) {
      comoRol(rol);
      expect(await accion(base)).toEqual({ error: 'Acceso denegado' });
    }
    expect(sb.insertsLlamados()).toHaveLength(0);
  });
});

describe('guardarBorradorAction', () => {
  it('crea un borrador con las series saneadas y lo asocia al paciente manual', async () => {
    comoRol('investigador');
    conPacienteManual();
    sb.mockTable('antropometria_mediciones', { data: { id: NUEVA_ID }, error: null });

    const r = await guardarBorradorAction({ ...base, series: { peso: [53.1, 53], inventada: [1, 2] } });

    expect(r).toEqual({ ok: true, id: NUEVA_ID });
    expect(sb.insertsLlamados()).toEqual([
      {
        tabla: 'antropometria_mediciones',
        payload: {
          paciente_manual_id: PACIENTE_ID,
          fecha_medicion: '2026-10-24',
          nivel_actividad: 'moderada',
          deporte: 'voleibol',
          series: { peso: [53.1, 53] },
          estado: 'borrador',
        },
      },
    ]);
  });

  it('actualiza el borrador existente (no crea otra fila)', async () => {
    comoRol('investigador');
    conPacienteManual([medicion({ estado: 'borrador' })]);

    const r = await guardarBorradorAction({ ...base, medicionId: MEDICION_ID });

    expect(r).toEqual({ ok: true, id: MEDICION_ID });
    expect(sb.insertsLlamados()).toHaveLength(0);
    expect(actualizaciones('antropometria_mediciones')).toHaveLength(1);
  });

  it('nunca toca una medición ya generada', async () => {
    comoRol('investigador');
    conPacienteManual([medicion({ estado: 'vigente' })]);
    expect(await guardarBorradorAction({ ...base, medicionId: MEDICION_ID })).toEqual({ error: expect.stringMatching(/ya está generada/) });
    expect(actualizaciones('antropometria_mediciones')).toHaveLength(0);
  });

  it('con 12 mediciones vigentes no crea otro borrador', async () => {
    comoRol('investigador');
    conPacienteManual(Array.from({ length: 12 }, (_, i) => medicion({ id: `4444444${i.toString(16)}-4444-4444-8444-444444444444`, fecha_medicion: `2025-${String(i + 1).padStart(2, '0')}-10` })));
    expect(await guardarBorradorAction(base)).toEqual({ error: expect.stringMatching(/12 mediciones/) });
    expect(sb.insertsLlamados()).toHaveLength(0);
  });

  it('rechaza fecha futura y datos inválidos antes de escribir', async () => {
    comoRol('investigador');
    expect(await guardarBorradorAction({ ...base, fechaMedicion: '2999-01-01' })).toEqual({ error: expect.stringMatching(/futura/) });
    comoRol('investigador');
    expect(await guardarBorradorAction({ ...base, pacienteId: 'no-es-un-id' })).toEqual({ error: expect.stringMatching(/inválido/i) });
    expect(sb.insertsLlamados()).toHaveLength(0);
  });
});

describe('finalizarMedicionAction', () => {
  it('con las 25 variables crea la medición vigente y guarda la masa ósea de referencia (primera medición)', async () => {
    comoRol('investigador');
    conPacienteManual();
    sb.mockTable('antropometria_mediciones', { data: { id: NUEVA_ID }, error: null });

    const r = await finalizarMedicionAction(base);

    expect(r).toEqual({ ok: true, id: NUEVA_ID });
    const insert = sb.insertsLlamados()[0];
    expect(insert.tabla).toBe('antropometria_mediciones');
    expect(insert.payload).toMatchObject({ paciente_manual_id: PACIENTE_ID, estado: 'vigente', nivel_actividad: 'moderada', deporte: 'voleibol' });

    const [ref] = actualizaciones('antropometria_pacientes_manuales');
    expect((ref.args[0] as { masa_osea_referencia: number }).masa_osea_referencia).toBeCloseTo(6.196, 2);

    expect(revalidatePathMock).toHaveBeenCalledWith(`/antropometrias/medicion/${NUEVA_ID}`);
    expect(revalidatePathMock).toHaveBeenCalledWith(`/antropometrias/manual/${PACIENTE_ID}`);
  });

  it('con 24 de 25 variables NO genera el informe ni escribe', async () => {
    comoRol('investigador');
    conPacienteManual();
    const { pliegue_triceps: _omitida, ...incompletas } = SERIES_JULIETA;
    void _omitida;

    const r = await finalizarMedicionAction({ ...base, series: incompletas });

    expect(r).toEqual({ error: 'Faltan 1 de las 25 variables: no se puede generar el informe.' });
    expect(sb.insertsLlamados()).toHaveLength(0);
    expect(actualizaciones('antropometria_mediciones')).toHaveLength(0);
  });

  it('una sola serie en una variable cuenta como faltante (se necesitan 2 o 3)', async () => {
    comoRol('investigador');
    conPacienteManual();
    const r = await finalizarMedicionAction({ ...base, series: { ...SERIES_JULIETA, peso: [53.1] } });
    expect(r).toEqual({ error: expect.stringMatching(/Faltan 1 de las 25/) });
  });

  it('un menor a la fecha de medición se rechaza con mensaje claro', async () => {
    comoRol('investigador');
    conPacienteManual([], { fecha_nacimiento: '2015-01-01' });
    expect(await finalizarMedicionAction(base)).toEqual({ error: expect.stringMatching(/mayores de 18/) });
    expect(sb.insertsLlamados()).toHaveLength(0);
  });

  it('sin nivel de actividad no genera el informe', async () => {
    comoRol('investigador');
    conPacienteManual();
    expect(await finalizarMedicionAction({ ...base, nivelActividad: null })).toEqual({ error: 'Elegí el nivel de actividad.' });
  });

  it('un deporte que no es del sexo del paciente lo rechaza el motor, sin escribir', async () => {
    comoRol('investigador');
    conPacienteManual();
    const r = await finalizarMedicionAction({ ...base, deporte: 'deporte_inexistente' });
    expect('error' in r && r.error).toMatch(/deporte/i);
    expect(sb.insertsLlamados()).toHaveLength(0);
  });

  it('con 12 vigentes no se puede generar otra', async () => {
    comoRol('investigador');
    conPacienteManual(Array.from({ length: 12 }, (_, i) => medicion({ id: `5555555${i.toString(16)}-5555-4555-8555-555555555555`, fecha_medicion: `2025-${String(i + 1).padStart(2, '0')}-10` })));
    expect(await finalizarMedicionAction(base)).toEqual({ error: expect.stringMatching(/12 mediciones/) });
  });

  it('editar una vigente no cuenta contra el límite y actualiza la fila (sin insertar)', async () => {
    comoRol('investigador');
    // 12 vigentes en total, una es la que se edita.
    const filas = Array.from({ length: 12 }, (_, i) =>
      medicion({ id: i === 0 ? MEDICION_ID : `6666666${i.toString(16)}-6666-4666-8666-666666666666`, fecha_medicion: `2025-${String(i + 1).padStart(2, '0')}-10` }),
    );
    conPacienteManual(filas, { masa_osea_referencia: 6.1 });

    const r = await finalizarMedicionAction({ ...base, medicionId: MEDICION_ID, fechaMedicion: '2025-01-10' });

    expect(r).toEqual({ ok: true, id: MEDICION_ID });
    expect(sb.insertsLlamados()).toHaveLength(0);
    const [act] = actualizaciones('antropometria_mediciones');
    expect(act.args[0]).toMatchObject({ estado: 'vigente', fecha_medicion: '2025-01-10' });
  });

  it('una medición posterior reutiliza la referencia: no vuelve a escribirla', async () => {
    comoRol('investigador');
    conPacienteManual([medicion({ fecha_medicion: '2026-05-10' })], { masa_osea_referencia: 6.196 });
    sb.mockTable('antropometria_mediciones', { data: { id: NUEVA_ID }, error: null });

    expect(await finalizarMedicionAction(base)).toEqual({ ok: true, id: NUEVA_ID });
    expect(actualizaciones('antropometria_pacientes_manuales')).toHaveLength(0);
  });
});

describe('deportista sin physical_data', () => {
  it('pide sexo y fecha de nacimiento y los guarda en la tabla auxiliar (sin tocar physical_data)', async () => {
    comoRol('investigador');
    sb.mockTable('profiles', { data: { user_id: PACIENTE_ID, nombre: 'Lucía', apellido: 'Vega' }, error: null });
    sb.mockTable('physical_data', { data: null, error: null });
    sb.mockTable('antropometria_deportistas_datos', { data: null, error: null });
    sb.mockTable('antropometria_mediciones', { data: [], error: null });
    sb.mockTable('antropometria_mediciones', { data: { id: NUEVA_ID }, error: null });

    const r = await finalizarMedicionAction({
      ...base,
      origen: 'deportista',
      datosPaciente: { sexo: 'F', fechaNacimiento: '2002-04-05' },
    });

    expect(r).toEqual({ ok: true, id: NUEVA_ID });
    const escrituras = sb.insertsLlamados().map((i) => i.tabla);
    expect(escrituras).toContain('antropometria_deportistas_datos');
    expect(escrituras).not.toContain('physical_data');
    const datos = sb.insertsLlamados().find((i) => i.tabla === 'antropometria_deportistas_datos')!.payload as Record<string, unknown>;
    expect(datos).toMatchObject({ user_id: PACIENTE_ID, sexo: 'F', fecha_nacimiento: '2002-04-05' });
  });

  it('no pisa el sexo ni la fecha que ya vienen de physical_data', async () => {
    comoRol('investigador');
    sb.mockTable('profiles', { data: { user_id: PACIENTE_ID, nombre: 'Lucía', apellido: 'Vega' }, error: null });
    sb.mockTable('physical_data', { data: { fecha_nacimiento: '2002-04-05', sexo: 'F' }, error: null });
    sb.mockTable('antropometria_deportistas_datos', { data: null, error: null });
    sb.mockTable('antropometria_mediciones', { data: [], error: null });
    sb.mockTable('antropometria_mediciones', { data: { id: NUEVA_ID }, error: null });

    await finalizarMedicionAction({
      ...base,
      origen: 'deportista',
      datosPaciente: { sexo: 'M', fechaNacimiento: '1990-01-01' },
    });

    const aux = sb.insertsLlamados().filter((i) => i.tabla === 'antropometria_deportistas_datos');
    // Solo se escribe la masa ósea de referencia; el sexo y la fecha mandados se ignoran.
    expect(aux).toHaveLength(1);
    expect(Object.keys(aux[0].payload as object).sort()).toEqual(['masa_osea_referencia', 'user_id']);
  });
});
