/**
 * Server Actions del diario (alimentacion/actions.ts): alta desde el catálogo, alta por código de barras,
 * edición y borrado de ítems. Todas terminan en `redirect()`, que en Next lanza una excepción especial;
 * el doble de `redirect` lanza `REDIRECT:<url>` para poder leer el destino.
 *
 * Particiones de equivalencia de los campos (alta desde catálogo):
 *   fecha: formato válido dentro del rango editable (hoy … 7 días atrás) / formato inválido / futura / de hace 8 días
 *   tipo_ingesta: uno de los 6 válidos / otro
 *   tipo_item: solido, liquido, en polvo / otro
 *   id_alimento: entero > 0 / 0, negativo, no numérico
 *   cantidad: 0 < c <= 2000 (válida) / 0 / negativa / 2000.01 / no numérica   ← valores límite 0, 0.01, 2000, 2000.01
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';
import { daysAgoAR, todayAR } from '@/lib/date';

const { getUserMock, redirectMock, revalidateMock, rpcMock, obtenerProductoMock, adminHolder } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  revalidateMock: vi.fn(),
  rpcMock: vi.fn(),
  obtenerProductoMock: vi.fn(),
  adminHolder: { from: (_t: string): unknown => undefined },
}));
const db = createSupabaseFromMock();
const admin = createSupabaseFromMock();
adminHolder.from = admin.from;

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/lib/openFoodFacts', () => ({ obtenerProductoPorEAN: obtenerProductoMock }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: db.from }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (t: string) => adminHolder.from(t), rpc: rpcMock }),
}));

import { addItemAction, addScannedItemAction, deleteItemAction, updateItemAction } from '@/app/alimentacion/actions';

const HOY = todayAR();
const form = (campos: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
};
/** Ejecuta la action y devuelve a dónde redirigió. */
async function destino(accion: (fd: FormData) => Promise<unknown>, campos: Record<string, string>) {
  try {
    await accion(form(campos));
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec((e as Error).message);
    if (m) return m[1];
    throw e;
  }
  return null;
}

const base = { fecha: HOY, tipo_ingesta: 'almuerzo', tipo_item: 'solido', id_alimento: '12', cantidad: '150' };
const volver = `/alimentacion?fecha=${HOY}&tipo=almuerzo`;

beforeEach(() => {
  db.reset();
  admin.reset();
  redirectMock.mockClear();
  revalidateMock.mockClear();
  rpcMock.mockReset();
  obtenerProductoMock.mockReset();
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u-1' } } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/** Encola las respuestas del camino feliz de upsertIngestaAndInsertItem. */
function ingestaOk() {
  db.mockTable('ingestas', { data: null, error: null }); // upsert
  db.mockTable('ingestas', { data: { id_ingesta: 99 }, error: null }); // select().single()
  db.mockTable('items', { data: null, error: null }); // insert
}

describe('addItemAction — validación de entradas (no toca la base)', () => {
  it.each([
    ['fecha con formato inválido', { fecha: '10/10/2026' }, '/alimentacion'],
    ['fecha futura', { fecha: '2999-01-01' }, '/alimentacion?fecha=2999-01-01&tipo=almuerzo'],
    ['fecha de hace 8 días (fuera de la ventana editable)', { fecha: daysAgoAR(8) }, `/alimentacion?fecha=${daysAgoAR(8)}&tipo=almuerzo`],
    ['tipo de ingesta inválido', { tipo_ingesta: 'brunch' }, `/alimentacion?fecha=${HOY}`],
    ['tipo de ítem inválido', { tipo_item: 'gas' }, volver],
    ['id de alimento 0', { id_alimento: '0' }, volver],
    ['id de alimento negativo', { id_alimento: '-3' }, volver],
    ['id de alimento no numérico', { id_alimento: 'abc' }, volver],
    ['cantidad 0', { cantidad: '0' }, volver],
    ['cantidad negativa', { cantidad: '-5' }, volver],
    ['cantidad no numérica', { cantidad: 'mucho' }, volver],
    ['cantidad 2000.01 (límite + 0.01)', { cantidad: '2000.01' }, volver],
  ])('%s → redirige y no consulta la base', async (_caso, cambio, esperado) => {
    expect(await destino(addItemAction, { ...base, ...cambio })).toBe(esperado);
    expect(db.tablasLlamadas()).toEqual([]);
  });

  it.each([['0.01'], ['2000']])('valor límite: cantidad %s es válida', async (cantidad) => {
    db.mockTable('alimentos', { data: { id_alimento: 12 }, error: null });
    ingestaOk();
    expect(await destino(addItemAction, { ...base, cantidad })).toBe(volver);
    expect(db.insertsLlamados().some((i) => i.tabla === 'items')).toBe(true);
  });

  it('el límite de fecha: hoy y hace 7 días son válidos', async () => {
    for (const fecha of [HOY, daysAgoAR(7)]) {
      db.mockTable('alimentos', { data: { id_alimento: 12 }, error: null });
      ingestaOk();
      await destino(addItemAction, { ...base, fecha });
    }
    expect(db.insertsLlamados().filter((i) => i.tabla === 'items')).toHaveLength(2);
  });
});

describe('addItemAction — flujo con la base', () => {
  it('sin sesión → /login', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect(await destino(addItemAction, base)).toBe('/login');
  });

  it('alimento inexistente → vuelve sin insertar', async () => {
    db.mockTable('alimentos', { data: null, error: { message: 'not found' } });
    expect(await destino(addItemAction, base)).toBe(volver);
    expect(db.insertsLlamados()).toEqual([]);
  });

  it('camino feliz: crea la ingesta del día, inserta el ítem y revalida', async () => {
    db.mockTable('alimentos', { data: { id_alimento: 12 }, error: null });
    ingestaOk();
    expect(await destino(addItemAction, base)).toBe(volver);
    const items = db.insertsLlamados().find((i) => i.tabla === 'items');
    expect(items?.payload).toEqual({ id_ingesta: 99, tipo_item: 'solido', cantidad: 150, id_alimento: 12 });
    expect(db.insertsLlamados()[0]).toEqual({ tabla: 'ingestas', payload: [{ id_usuario: 'u-1', fecha: HOY, tipo: 'almuerzo' }] });
    expect(revalidateMock).toHaveBeenCalledWith('/alimentacion');
  });

  it('redondea la cantidad a 2 decimales', async () => {
    db.mockTable('alimentos', { data: { id_alimento: 12 }, error: null });
    ingestaOk();
    await destino(addItemAction, { ...base, cantidad: '10.456' });
    expect((db.insertsLlamados().find((i) => i.tabla === 'items')?.payload as { cantidad: number }).cantidad).toBe(10.46);
  });

  it.each([
    ['falla el upsert de la ingesta', () => db.mockTable('ingestas', { data: null, error: { message: 'x' } })],
    ['no se puede leer la ingesta creada', () => {
      db.mockTable('ingestas', { data: null, error: null });
      db.mockTable('ingestas', { data: null, error: { message: 'x' } });
    }],
    ['falla el insert del ítem', () => {
      db.mockTable('ingestas', { data: null, error: null });
      db.mockTable('ingestas', { data: { id_ingesta: 99 }, error: null });
      db.mockTable('items', { data: null, error: { message: 'x' } });
    }],
  ])('%s → vuelve al diario sin revalidar', async (_caso, preparar) => {
    db.mockTable('alimentos', { data: { id_alimento: 12 }, error: null });
    preparar();
    expect(await destino(addItemAction, base)).toBe(volver);
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});

describe('addScannedItemAction (código de barras)', () => {
  const EAN = '7790070411180';
  const escaneo = { fecha: HOY, tipo_ingesta: 'almuerzo', tipo_item: 'solido', ean: EAN, cantidad: '50' };
  const producto = {
    encontrado: true, ean: EAN, nombre: 'Galletitas', categoria: 'Snacks', marca: 'Marca', porcion: 30,
    nutrientes100g: { kcal: 480, proteinas: 7, grasas: 20, carbs: 68 }, imagenUrl: null,
    infoAmpliada: { nutriscore: 'd', novaGroup: 4, sinGluten: false, vegano: false, vegetariano: true }, porcionEtiqueta: '30 g',
  };

  it.each([
    ['EAN de 12 dígitos', { ean: '779007041118' }],
    ['EAN con letras', { ean: '77900704111AB' }],
    ['EAN de 14 dígitos', { ean: '77900704111800' }],
    ['cantidad 0', { cantidad: '0' }],
    ['cantidad 2001', { cantidad: '2001' }],
    ['tipo de ítem inválido', { tipo_item: 'x' }],
    ['tipo de ingesta inválido', { tipo_ingesta: 'x' }],
    ['fecha inválida', { fecha: 'hoy' }],
  ])('%s → redirige sin consultar OpenFoodFacts ni la base', async (_caso, cambio) => {
    await destino(addScannedItemAction, { ...escaneo, ...cambio });
    expect(obtenerProductoMock).not.toHaveBeenCalled();
    expect(db.tablasLlamadas()).toEqual([]);
  });

  it('producto no encontrado en OpenFoodFacts → vuelve sin escribir', async () => {
    obtenerProductoMock.mockResolvedValue({ encontrado: false, ean: EAN });
    expect(await destino(addScannedItemAction, escaneo)).toBe(volver);
    expect(admin.tablasLlamadas()).toEqual([]);
  });

  it('sin sesión → /login', async () => {
    obtenerProductoMock.mockResolvedValue(producto);
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect(await destino(addScannedItemAction, escaneo)).toBe('/login');
  });

  it('camino feliz: guarda el producto con el cliente admin (nunca con datos del cliente) y el ítem con el del usuario', async () => {
    obtenerProductoMock.mockResolvedValue(producto);
    admin.mockTable('alimentos_barcode', { data: { id_alimento_barcode: 5 }, error: null });
    ingestaOk();
    expect(await destino(addScannedItemAction, escaneo)).toBe(volver);
    expect(obtenerProductoMock).toHaveBeenCalledWith(EAN);
    expect(admin.insertsLlamados()[0]).toMatchObject({ tabla: 'alimentos_barcode', payload: { codigo_ean: EAN, nombre: 'Galletitas', kcal_100g: 480 } });
    expect(db.insertsLlamados().find((i) => i.tabla === 'items')?.payload).toMatchObject({ id_alimento_barcode: 5, cantidad: 50 });
  });

  it('si falla el upsert del producto → vuelve sin crear el ítem', async () => {
    obtenerProductoMock.mockResolvedValue(producto);
    admin.mockTable('alimentos_barcode', { data: null, error: { message: 'x' } });
    expect(await destino(addScannedItemAction, escaneo)).toBe(volver);
    expect(db.insertsLlamados()).toEqual([]);
  });

  it('si falla la creación del ítem → vuelve sin revalidar', async () => {
    obtenerProductoMock.mockResolvedValue(producto);
    admin.mockTable('alimentos_barcode', { data: { id_alimento_barcode: 5 }, error: null });
    db.mockTable('ingestas', { data: null, error: { message: 'x' } });
    await destino(addScannedItemAction, escaneo);
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});

describe('deleteItemAction', () => {
  const borrar = { fecha: HOY, tipo_ingesta: 'almuerzo', id_item: '7' };

  it.each([
    ['fecha inválida', { fecha: 'x' }],
    ['id 0', { id_item: '0' }],
    ['id no numérico', { id_item: 'abc' }],
  ])('%s → /alimentacion sin consultar la base', async (_caso, cambio) => {
    expect(await destino(deleteItemAction, { ...borrar, ...cambio })).toBe('/alimentacion');
    expect(db.tablasLlamadas()).toEqual([]);
  });

  it('sin sesión → /login', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect(await destino(deleteItemAction, borrar)).toBe('/login');
  });

  it('un ítem que no existe o que RLS no deja ver no se borra', async () => {
    db.mockTable('items', { data: null, error: { message: 'no rows' } });
    expect(await destino(deleteItemAction, borrar)).toBe(volver);
    expect(db.eqLlamados().filter((e) => e.args[0] === 'id_item')).toHaveLength(1); // solo el select, no el delete
  });

  it('camino feliz: borra por id y revalida', async () => {
    db.mockTable('items', { data: { id_item: 7 }, error: null }); // select
    db.mockTable('items', { data: null, error: null }); // delete
    expect(await destino(deleteItemAction, borrar)).toBe(volver);
    expect(revalidateMock).toHaveBeenCalledWith('/alimentacion');
  });

  it('error al borrar → vuelve sin revalidar', async () => {
    db.mockTable('items', { data: { id_item: 7 }, error: null });
    db.mockTable('items', { data: null, error: { message: 'x' } });
    await destino(deleteItemAction, borrar);
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('con un tipo de ingesta inválido igual borra, pero vuelve sin el parámetro "tipo"', async () => {
    db.mockTable('items', { data: { id_item: 7 }, error: null });
    db.mockTable('items', { data: null, error: null });
    expect(await destino(deleteItemAction, { ...borrar, tipo_ingesta: 'x' })).toBe(`/alimentacion?fecha=${HOY}`);
  });
});

describe('updateItemAction', () => {
  const editar = { fecha: HOY, tipo_ingesta: 'almuerzo', id_item: '7', cantidad: '200' };

  it.each([
    ['fecha inválida', { fecha: 'x' }, '/alimentacion'],
    ['fecha fuera de la ventana editable', { fecha: daysAgoAR(8) }, `/alimentacion?fecha=${daysAgoAR(8)}&tipo=almuerzo`],
    ['tipo de ingesta inválido', { tipo_ingesta: 'x' }, `/alimentacion?fecha=${HOY}`],
    ['id inválido', { id_item: '-1' }, volver],
    ['cantidad 0', { cantidad: '0' }, volver],
    ['cantidad 2000.01', { cantidad: '2000.01' }, volver],
  ])('%s → redirige sin consultar la base', async (_caso, cambio, esperado) => {
    expect(await destino(updateItemAction, { ...editar, ...cambio })).toBe(esperado);
    expect(db.tablasLlamadas()).toEqual([]);
  });

  it('sin sesión → /login', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect(await destino(updateItemAction, editar)).toBe('/login');
  });

  it('ítem inexistente → vuelve sin actualizar', async () => {
    db.mockTable('items', { data: null, error: { message: 'x' } });
    expect(await destino(updateItemAction, editar)).toBe(volver);
  });

  it('un ítem cuya ingesta es de otro usuario no se actualiza (verifica propiedad)', async () => {
    db.mockTable('items', { data: { id_item: 7, id_ingesta: 99 }, error: null });
    db.mockTable('ingestas', { data: null, error: { message: 'no rows' } });
    await destino(updateItemAction, editar);
    expect(revalidateMock).not.toHaveBeenCalled();
    expect(db.eqLlamados()).toContainEqual({ tabla: 'ingestas', metodo: 'eq', args: ['id_usuario', 'u-1'] });
  });

  it('camino feliz: actualiza la cantidad (redondeada) y revalida', async () => {
    db.mockTable('items', { data: { id_item: 7, id_ingesta: 99 }, error: null });
    db.mockTable('ingestas', { data: { id_ingesta: 99 }, error: null });
    db.mockTable('items', { data: null, error: null });
    expect(await destino(updateItemAction, { ...editar, cantidad: '120.555' })).toBe(volver);
    expect(revalidateMock).toHaveBeenCalledWith('/alimentacion');
  });

  it('error al actualizar → vuelve sin revalidar', async () => {
    db.mockTable('items', { data: { id_item: 7, id_ingesta: 99 }, error: null });
    db.mockTable('ingestas', { data: { id_ingesta: 99 }, error: null });
    db.mockTable('items', { data: null, error: { message: 'x' } });
    await destino(updateItemAction, editar);
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});
