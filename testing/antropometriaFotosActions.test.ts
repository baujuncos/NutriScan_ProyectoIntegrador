/**
 * NUT-251/NUT-240 — Fotos posturales: acciones (registrar, reemplazar, quitar, listar), validación del path
 * y borrado de los archivos al anular la medición.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';
import { SERIES_JULIETA } from './fixtures/antropometria';

const { getUserMock, revalidatePathMock } = vi.hoisted(() => ({ getUserMock: vi.fn(), revalidatePathMock: vi.fn() }));
const sb = createSupabaseFromMock();
/** Orden en que se tocan Storage y las tablas (para probar "primero los archivos, después la baja"). */
const orden: string[] = [];

vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    rpc: sb.rpc,
    storage: {
      from: (bucket: string) => {
        const bucketMock = sb.storage.from(bucket);
        return { ...bucketMock, remove: (...args: unknown[]) => (orden.push('storage.remove'), bucketMock.remove(...(args as [string[]]))) };
      },
    },
    from: (tabla: string) =>
      new Proxy(sb.from(tabla) as Record<string, unknown>, {
        get(chain, prop: string) {
          if (prop === 'update' || prop === 'delete' || prop === 'insert') orden.push(`${tabla}.${prop}`);
          return chain[prop];
        },
      }),
  }),
}));

import {
  anularMedicionAction,
  listarFotosAction,
  quitarFotoAction,
  registrarFotoAction,
} from '@/app/(researcher)/antropometrias/actions';
import {
  BUCKET_FOTOS_ANTROPOMETRIA,
  MAX_BYTES_FOTO,
  MAX_FOTOS_POR_MEDICION,
  pathCorresponde,
  pathFoto,
  validarArchivoFoto,
} from '@/lib/researcher/antropometria/fotos';
import { POSICIONES_FOTO } from '@/types/antropometria';

const PACIENTE_ID = '11111111-1111-4111-8111-111111111111';
const MEDICION_ID = '22222222-2222-4222-8222-222222222222';
const OTRA_MEDICION_ID = '33333333-3333-4333-8333-333333333333';
const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PATH_NUEVO = `${MEDICION_ID}/frente-${UUID_A}.jpg`;
const PATH_VIEJO = `${MEDICION_ID}/frente-${UUID_B}.jpg`;

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

const fila = (posicion: string, path: string, id = `foto-${posicion}`) => ({
  id,
  medicion_id: MEDICION_ID,
  posicion,
  path,
  creado_por: 'inv-1',
  creado_en: '2026-10-24T12:00:00Z',
});

const escrituras = (tabla: string, metodo: string) => orden.filter((o) => o === `${tabla}.${metodo}`);
const llamadasStorage = (metodo: string) => sb.storageLlamadas().filter((l) => l.metodo === metodo);

/** Deja listo el "estado actual" que lee `cargarFotos` al final de cada acción. */
function fotosFinales(filas: ReturnType<typeof fila>[]) {
  sb.mockTable('antropometria_fotos', { data: filas, error: null });
  sb.mockStorage('createSignedUrls', {
    data: filas.map((f) => ({ path: f.path, signedUrl: `https://storage.test/firmada/${f.path}?token=t` })),
    error: null,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  sb.reset();
  orden.length = 0;
  getUserMock.mockReset();
  revalidatePathMock.mockReset();
});

describe('helpers de fotos posturales', () => {
  it('son 3 posiciones fijas: el máximo por medición es 3', () => {
    expect(POSICIONES_FOTO).toEqual(['frente', 'lateral', 'espalda']);
    expect(MAX_FOTOS_POR_MEDICION).toBe(3);
  });

  it('el path es {medicion}/{posicion}-{uuid}.jpg y solo ese path corresponde', () => {
    const path = pathFoto(MEDICION_ID, 'lateral');
    expect(path).toMatch(new RegExp(`^${MEDICION_ID}/lateral-[0-9a-f-]{36}\\.jpg$`));
    expect(pathCorresponde(path, MEDICION_ID, 'lateral')).toBe(true);
    expect(pathCorresponde(path, MEDICION_ID, 'frente')).toBe(false); // otra posición
    expect(pathCorresponde(path, OTRA_MEDICION_ID, 'lateral')).toBe(false); // otra medición
    expect(pathCorresponde(`${MEDICION_ID}/../${OTRA_MEDICION_ID}/frente-${UUID_A}.jpg`, MEDICION_ID, 'frente')).toBe(false);
    expect(pathCorresponde(`${MEDICION_ID}/frente-${UUID_A}.jpg/otro`, MEDICION_ID, 'frente')).toBe(false);
    expect(pathCorresponde(`${MEDICION_ID}/frente-no-es-uuid.jpg`, MEDICION_ID, 'frente')).toBe(false);
    expect(pathCorresponde(42, MEDICION_ID, 'frente')).toBe(false);
  });

  it('valida tipo (JPG, PNG, WebP) y tamaño (3 MB) del archivo', () => {
    expect(validarArchivoFoto({ type: 'image/jpeg', size: 400_000 })).toBeNull();
    expect(validarArchivoFoto({ type: 'image/webp', size: MAX_BYTES_FOTO })).toBeNull();
    expect(validarArchivoFoto({ type: 'image/gif', size: 1000 })).toMatch(/JPG, PNG o WebP/);
    expect(validarArchivoFoto({ type: 'application/pdf', size: 1000 })).toMatch(/JPG, PNG o WebP/);
    expect(validarArchivoFoto({ type: 'image/jpeg', size: MAX_BYTES_FOTO + 1 })).toMatch(/3 MB/);
  });
});

describe('permisos: cada acción de fotos arranca con clienteInvestigador()', () => {
  const acciones: Array<[string, () => Promise<unknown>]> = [
    ['registrarFotoAction', () => registrarFotoAction(MEDICION_ID, 'frente', PATH_NUEVO)],
    ['quitarFotoAction', () => quitarFotoAction(MEDICION_ID, 'frente')],
    ['listarFotosAction', () => listarFotosAction(MEDICION_ID)],
    ['anularMedicionAction', () => anularMedicionAction(MEDICION_ID)],
  ];

  it.each(acciones)('%s: sin sesión → "No autenticado"', async (_nombre, accion) => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect(await accion()).toEqual({ error: 'No autenticado' });
  });

  it.each(acciones)('%s: deportista, particular o sin perfil → "Acceso denegado" y no toca Storage ni la base', async (_nombre, accion) => {
    for (const rol of ['deportista_ucc', 'particular', null]) {
      comoRol(rol);
      expect(await accion()).toEqual({ error: 'Acceso denegado' });
    }
    expect(sb.storageLlamadas()).toHaveLength(0);
    expect(orden).toHaveLength(0);
    expect(sb.tablasLlamadas().filter((t) => t !== 'profiles')).toHaveLength(0);
  });
});

describe('registrarFotoAction', () => {
  function preparar({ existentes = [] as ReturnType<typeof fila>[], estado = 'vigente', objeto = true } = {}) {
    comoRol('investigador');
    sb.mockTable('antropometria_mediciones', { data: medicion({ estado }), error: null });
    sb.mockStorage('list', { data: objeto ? [{ name: PATH_NUEVO.split('/')[1] }] : [], error: null });
    sb.mockTable('antropometria_fotos', { data: existentes, error: null }); // filas actuales
  }

  it('registra la foto de una posición vacía y devuelve las fotos con signed URL', async () => {
    preparar();
    sb.mockTable('antropometria_fotos', { data: null, error: null }); // resultado del insert
    fotosFinales([fila('frente', PATH_NUEVO)]);

    const r = await registrarFotoAction(MEDICION_ID, 'frente', PATH_NUEVO);

    expect(r).toEqual({ ok: true, fotos: [{ id: 'foto-frente', posicion: 'frente', url: `https://storage.test/firmada/${PATH_NUEVO}?token=t` }] });
    expect(sb.insertsLlamados().find((i) => i.tabla === 'antropometria_fotos')?.payload).toEqual({
      medicion_id: MEDICION_ID,
      posicion: 'frente',
      path: PATH_NUEVO,
    });
    // Verifica que el archivo existe en el bucket privado, en la carpeta de la medición.
    expect(llamadasStorage('list')[0]).toMatchObject({ bucket: BUCKET_FOTOS_ANTROPOMETRIA, args: [MEDICION_ID, { search: `frente-${UUID_A}.jpg` }] });
    expect(llamadasStorage('remove')).toHaveLength(0);
    expect(revalidatePathMock).toHaveBeenCalledWith(`/antropometrias/medicion/${MEDICION_ID}`);
  });

  it('las signed URLs son de corta duración (10 min) y del bucket de antropometría', async () => {
    preparar();
    sb.mockTable('antropometria_fotos', { data: null, error: null });
    fotosFinales([fila('frente', PATH_NUEVO)]);
    await registrarFotoAction(MEDICION_ID, 'frente', PATH_NUEVO);
    expect(llamadasStorage('createSignedUrls')[0]).toMatchObject({ bucket: BUCKET_FOTOS_ANTROPOMETRIA, args: [[PATH_NUEVO], 600] });
  });

  it('reemplaza la foto de una posición ocupada: cambia el path de la fila y borra el archivo anterior', async () => {
    preparar({ existentes: [fila('frente', PATH_VIEJO, 'f1'), fila('lateral', `${MEDICION_ID}/lateral-${UUID_A}.jpg`)] });
    sb.mockTable('antropometria_fotos', { data: null, error: null }); // resultado del update
    sb.mockStorage('remove', { data: [], error: null });
    fotosFinales([fila('frente', PATH_NUEVO, 'f1')]);

    const r = await registrarFotoAction(MEDICION_ID, 'frente', PATH_NUEVO);

    expect(r).toMatchObject({ ok: true });
    expect(escrituras('antropometria_fotos', 'insert')).toHaveLength(0);
    const update = sb.filtrosLlamados().find((f) => f.tabla === 'antropometria_fotos' && f.metodo === 'update');
    expect(update?.args[0]).toMatchObject({ path: PATH_NUEVO });
    expect(sb.eqLlamados().some((e) => e.tabla === 'antropometria_fotos' && e.args[0] === 'id' && e.args[1] === 'f1')).toBe(true);
    expect(llamadasStorage('remove')).toHaveLength(1);
    expect(llamadasStorage('remove')[0].args[0]).toEqual([PATH_VIEJO]);
    // primero se cambia la fila, después se borra el archivo viejo
    expect(orden.indexOf('antropometria_fotos.update')).toBeLessThan(orden.indexOf('storage.remove'));
  });

  it('si el reemplazo falla en la base borra el archivo recién subido y conserva el anterior', async () => {
    preparar({ existentes: [fila('frente', PATH_VIEJO, 'f1')] });
    sb.mockTable('antropometria_fotos', { data: null, error: { message: 'rls' } });
    sb.mockStorage('remove', { data: [], error: null });

    expect(await registrarFotoAction(MEDICION_ID, 'frente', PATH_NUEVO)).toEqual({ error: 'No se pudo guardar la foto. Probá de nuevo.' });
    expect(llamadasStorage('remove')).toHaveLength(1);
    expect(llamadasStorage('remove')[0].args[0]).toEqual([PATH_NUEVO]);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('el límite de 3 lo garantiza la base: una carga que choca con otra de la misma posición se rechaza y limpia su archivo', async () => {
    preparar();
    sb.mockTable('antropometria_fotos', { data: null, error: { code: '23505', message: 'duplicate key (medicion_id, posicion)' } });
    sb.mockStorage('remove', { data: [], error: null });

    expect(await registrarFotoAction(MEDICION_ID, 'frente', PATH_NUEVO)).toEqual({ error: 'No se pudo guardar la foto. Probá de nuevo.' });
    expect(llamadasStorage('remove')[0].args[0]).toEqual([PATH_NUEVO]);
  });

  it('rechaza posición inválida, id inválido y un path que no es de esta medición y posición, sin tocar Storage', async () => {
    comoRol('investigador');
    expect(await registrarFotoAction(MEDICION_ID, 'costado', PATH_NUEVO)).toEqual({ error: 'La posición de la foto no es válida.' });

    comoRol('investigador');
    expect(await registrarFotoAction('x', 'frente', PATH_NUEVO)).toEqual({ error: 'Identificador inválido.' });

    for (const path of [
      `${OTRA_MEDICION_ID}/frente-${UUID_A}.jpg`, // carpeta de otra medición
      `${MEDICION_ID}/lateral-${UUID_A}.jpg`, // otra posición
      `${MEDICION_ID}/frente-${UUID_A}.png`,
      `../${MEDICION_ID}/frente-${UUID_A}.jpg`,
      'cualquier-cosa',
      null,
    ]) {
      comoRol('investigador');
      sb.mockTable('antropometria_mediciones', { data: medicion(), error: null });
      expect(await registrarFotoAction(MEDICION_ID, 'frente', path)).toEqual({ error: 'La foto no corresponde a esta medición.' });
    }
    expect(sb.storageLlamadas()).toHaveLength(0);
    expect(escrituras('antropometria_fotos', 'insert')).toHaveLength(0);
  });

  it('una medición anulada o inexistente no admite fotos', async () => {
    preparar({ estado: 'anulada' });
    expect(await registrarFotoAction(MEDICION_ID, 'frente', PATH_NUEVO)).toEqual({ error: 'La medición está anulada: no admite fotos.' });

    comoRol('investigador');
    sb.mockTable('antropometria_mediciones', { data: null, error: null });
    expect(await registrarFotoAction(MEDICION_ID, 'frente', PATH_NUEVO)).toEqual({ error: 'No se encontró la medición.' });
    expect(escrituras('antropometria_fotos', 'insert')).toHaveLength(0);
  });

  it('si el archivo no está en el bucket no registra nada', async () => {
    preparar({ objeto: false });
    expect(await registrarFotoAction(MEDICION_ID, 'frente', PATH_NUEVO)).toEqual({ error: 'No se encontró la foto subida. Probá de nuevo.' });
    expect(escrituras('antropometria_fotos', 'insert')).toHaveLength(0);
  });
});

describe('quitarFotoAction', () => {
  it('borra el archivo y después la fila de esa posición', async () => {
    comoRol('investigador');
    sb.mockTable('antropometria_mediciones', { data: medicion(), error: null });
    sb.mockTable('antropometria_fotos', { data: [fila('frente', PATH_VIEJO, 'f1'), fila('lateral', `${MEDICION_ID}/lateral-${UUID_A}.jpg`, 'f2')], error: null });
    sb.mockStorage('remove', { data: [], error: null });
    sb.mockTable('antropometria_fotos', { data: null, error: null }); // resultado del delete
    fotosFinales([fila('lateral', `${MEDICION_ID}/lateral-${UUID_A}.jpg`, 'f2')]);

    const r = await quitarFotoAction(MEDICION_ID, 'frente');

    expect(r).toMatchObject({ ok: true, fotos: [{ id: 'f2', posicion: 'lateral' }] });
    expect(llamadasStorage('remove')[0]).toMatchObject({ bucket: BUCKET_FOTOS_ANTROPOMETRIA, args: [[PATH_VIEJO]] });
    expect(orden.indexOf('storage.remove')).toBeLessThan(orden.indexOf('antropometria_fotos.delete'));
    expect(sb.eqLlamados().some((e) => e.tabla === 'antropometria_fotos' && e.args[0] === 'id' && e.args[1] === 'f1')).toBe(true);
    expect(revalidatePathMock).toHaveBeenCalledWith(`/antropometrias/medicion/${MEDICION_ID}`);
  });

  it('si Storage falla no borra la fila (la foto sigue y se puede reintentar)', async () => {
    comoRol('investigador');
    sb.mockTable('antropometria_mediciones', { data: medicion(), error: null });
    sb.mockTable('antropometria_fotos', { data: [fila('frente', PATH_VIEJO, 'f1')], error: null });
    sb.mockStorage('remove', { data: null, error: { message: 'storage caído' } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await quitarFotoAction(MEDICION_ID, 'frente')).toEqual({ error: 'No se pudo quitar la foto. Probá de nuevo.' });
    expect(escrituras('antropometria_fotos', 'delete')).toHaveLength(0);
  });

  it('una posición sin foto no rompe; posición inválida y medición anulada se rechazan', async () => {
    comoRol('investigador');
    sb.mockTable('antropometria_mediciones', { data: medicion(), error: null });
    sb.mockTable('antropometria_fotos', { data: [], error: null });
    expect(await quitarFotoAction(MEDICION_ID, 'espalda')).toEqual({ ok: true, fotos: [] });
    expect(llamadasStorage('remove')).toHaveLength(0);

    comoRol('investigador');
    expect(await quitarFotoAction(MEDICION_ID, 'techo')).toEqual({ error: 'La posición de la foto no es válida.' });

    comoRol('investigador');
    sb.mockTable('antropometria_mediciones', { data: medicion({ estado: 'anulada' }), error: null });
    expect(await quitarFotoAction(MEDICION_ID, 'frente')).toEqual({ error: 'La medición está anulada: no admite fotos.' });
  });
});

describe('listarFotosAction', () => {
  it('devuelve las fotos en el orden frente, lateral, espalda con sus signed URLs', async () => {
    comoRol('investigador');
    sb.mockTable('antropometria_mediciones', { data: medicion(), error: null });
    const espalda = fila('espalda', `${MEDICION_ID}/espalda-${UUID_A}.jpg`);
    const frente = fila('frente', PATH_NUEVO);
    fotosFinales([espalda, frente]);

    const r = await listarFotosAction(MEDICION_ID);

    expect(r).toMatchObject({ ok: true });
    expect('fotos' in r && r.fotos.map((f) => f.posicion)).toEqual(['frente', 'espalda']);
    // nunca se expone el path ni quién la subió
    expect(JSON.stringify(r)).not.toContain('creado_por');
    expect(JSON.stringify(r)).not.toContain(`"path"`);
  });

  it('una foto cuya URL no se pudo firmar queda con url null (la pantalla lo avisa)', async () => {
    comoRol('investigador');
    sb.mockTable('antropometria_mediciones', { data: medicion(), error: null });
    sb.mockTable('antropometria_fotos', { data: [fila('frente', PATH_NUEVO)], error: null });
    sb.mockStorage('createSignedUrls', { data: null, error: { message: 'x' } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await listarFotosAction(MEDICION_ID)).toEqual({ ok: true, fotos: [{ id: 'foto-frente', posicion: 'frente', url: null }] });
  });

  it('una medición anulada o con id inválido no lista nada', async () => {
    comoRol('investigador');
    sb.mockTable('antropometria_mediciones', { data: medicion({ estado: 'anulada' }), error: null });
    expect(await listarFotosAction(MEDICION_ID)).toEqual({ error: 'La medición está anulada: no admite fotos.' });
    comoRol('investigador');
    expect(await listarFotosAction('x')).toEqual({ error: 'Identificador inválido.' });
  });
});

describe('anularMedicionAction con fotos posturales (NUT-251)', () => {
  const PATH_LATERAL = `${MEDICION_ID}/lateral-${UUID_A}.jpg`;

  function conFotos() {
    comoRol('investigador');
    sb.mockTable('antropometria_mediciones', { data: medicion(), error: null });
    sb.mockTable('antropometria_fotos', { data: [fila('frente', PATH_NUEVO), fila('lateral', PATH_LATERAL)], error: null });
  }

  it('borra los archivos del bucket y las filas ANTES de pasar la medición a anulada', async () => {
    conFotos();
    sb.mockStorage('remove', { data: [], error: null });

    const r = await anularMedicionAction(MEDICION_ID);

    expect(r).toEqual({ ok: true, fichaHref: `/antropometrias/manual/${PACIENTE_ID}` });
    expect(llamadasStorage('remove')[0]).toMatchObject({ bucket: BUCKET_FOTOS_ANTROPOMETRIA, args: [[PATH_NUEVO, PATH_LATERAL]] });
    expect(orden).toEqual(['storage.remove', 'antropometria_fotos.delete', 'antropometria_mediciones.update']);
    expect(sb.eqLlamados().some((e) => e.tabla === 'antropometria_fotos' && e.args[0] === 'medicion_id' && e.args[1] === MEDICION_ID)).toBe(true);
    expect(sb.filtrosLlamados().find((f) => f.tabla === 'antropometria_mediciones' && f.metodo === 'update')?.args[0]).toEqual({ estado: 'anulada' });
  });

  it('si Storage falla NO anula: devuelve el error y no toca filas ni estado', async () => {
    conFotos();
    sb.mockStorage('remove', { data: null, error: { message: 'storage caído' } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const r = await anularMedicionAction(MEDICION_ID);

    expect(r).toEqual({ error: 'No se pudieron borrar las fotos; la medición no se anuló. Probá de nuevo.' });
    expect(orden).toEqual(['storage.remove']);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('si no se pueden borrar las filas tampoco anula', async () => {
    conFotos();
    sb.mockStorage('remove', { data: [], error: null });
    sb.mockTable('antropometria_fotos', { data: null, error: { message: 'rls' } });

    expect(await anularMedicionAction(MEDICION_ID)).toEqual({ error: 'No se pudieron borrar las fotos; la medición no se anuló. Probá de nuevo.' });
    expect(orden).toEqual(['storage.remove', 'antropometria_fotos.delete']);
  });

  it('sin fotos no llama a Storage y anula igual', async () => {
    comoRol('investigador');
    sb.mockTable('antropometria_mediciones', { data: medicion(), error: null });

    expect(await anularMedicionAction(MEDICION_ID)).toMatchObject({ ok: true });
    expect(sb.storageLlamadas()).toHaveLength(0);
    expect(orden).toEqual(['antropometria_mediciones.update']);
  });
});
