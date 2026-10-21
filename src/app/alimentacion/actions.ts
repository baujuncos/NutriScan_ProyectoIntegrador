'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { INGESTA_TIPOS, ITEM_TIPOS, MAX_CANTIDAD, isValidDateInput, toFixed2 } from '@/lib/nutrition';
import { estaEnRangoEditable } from '@/lib/date';
import { shouldHideNutritionInfo } from '@/lib/roles';
import { obtenerProductoPorEAN } from '@/lib/openFoodFacts';
import { CAMPOS_DEFAULT, aplicarFiltroSuplemento, buildMarcaDenominacionOr, idsRecientesUnicos, type CamposBusqueda } from './searchQuery';

export type AlimentoOption = {
  id_alimento: number;
  nombre: string;
  categoria: string | null;
  fuente: string;
  marca: string | null;
  denominacion: string | null;
  kcal_100g?: number | null;
  proteinas_100g?: number | null;
  grasas_100g?: number | null;
  carbs_100g?: number | null;
};

const SEL = 'id_alimento, nombre, categoria, fuente, marca, denominacion, kcal_100g, proteinas_100g, grasas_100g, carbs_100g' as const;

const CAP_RESULTADOS = 150;

/**
 * Orden dentro de cada tanda de resultados: SARA2, luego VALIDADO, luego el resto (ANMAT). La consulta
 * ordena `fuente` descendente (VALIDADO > SARA2 > ANMAT) para que el corte de 100 no se llene de ANMAT;
 * acá se reacomoda en memoria. `Array.prototype.sort` es estable: dentro de cada fuente queda el
 * orden por nombre de la base, y con solo SARA2/ANMAT el resultado es idéntico al de la consulta.
 */
const PESO_FUENTE: Record<string, number> = { SARA2: 0, VALIDADO: 1 };
function ordenarPorFuente(filas: AlimentoOption[]): AlimentoOption[] {
  return [...filas].sort((a, b) => (PESO_FUENTE[a.fuente] ?? 2) - (PESO_FUENTE[b.fuente] ?? 2));
}

/**
 * Estudio a ciegas (NUT-192): a un deportista_ucc no le llegan kcal/macros por 100 g del buscador,
 * ni siquiera en el payload (con ellos, el selector de cantidad le mostraba una vista previa con
 * números). El cálculo del ítem lo hace el trigger calculate_item_nutrients en el servidor.
 */
function sinMacros100g(a: AlimentoOption): AlimentoOption {
  const copia = { ...a };
  delete copia.kcal_100g;
  delete copia.proteinas_100g;
  delete copia.grasas_100g;
  delete copia.carbs_100g;
  return copia;
}

export async function searchAlimentosAction(
  query: string,
  tipoIngesta: string,
  campos: CamposBusqueda = CAMPOS_DEFAULT,
): Promise<AlimentoOption[]> {
  const q = query.trim().replace(/[*,\\]/g, '');
  if (q.length < 2) return [];
  if (!campos.nombre && !campos.marca && !campos.denominacion) return [];

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const isSuplemento = tipoIngesta === 'suplemento';
  // Los query builders de supabase-js son "thenables" (PromiseLike), no Promise
  // real — no tienen .catch/.finally — por eso el array se tipa como PromiseLike.
  const promises: Array<PromiseLike<{ data: AlimentoOption[] | null }>> = [];
  // SARA2 (genéricos, ~900) va primero y después ANMAT (marcas, ~38 mil): sólo ordenando por
  // nombre, el corte de 100 se llenaba con productos ANMAT ("Aderezo…", "Alfajor…") y el
  // filtro de fuente (del lado del cliente) no encontraba ningún SARA2. 'SARA2' > 'ANMAT'
  // alfabéticamente, por eso el orden de `fuente` es descendente.

  // Tier 1 (mayor relevancia): matches por nombre.
  if (campos.nombre) {
    let q1 = supabase.from('alimentos').select(SEL).ilike('nombre', `%${q}%`);
    q1 = aplicarFiltroSuplemento(q1, isSuplemento);
    promises.push(q1.order('fuente', { ascending: false }).order('nombre', { ascending: true }).limit(100));
  }

  // Tier 2: matches por marca/denominacion que no vinieron ya por nombre.
  const marcaDenomOr = buildMarcaDenominacionOr(campos, q);
  if (marcaDenomOr.length > 0) {
    let q2 = supabase.from('alimentos').select(SEL).or(marcaDenomOr);
    if (campos.nombre) q2 = q2.not('nombre', 'ilike', `%${q}%`);
    q2 = aplicarFiltroSuplemento(q2, isSuplemento);
    promises.push(q2.order('fuente', { ascending: false }).order('nombre', { ascending: true }).limit(100));
  }

  // El rol se consulta en paralelo con las búsquedas (sin sumar latencia). Si no se puede determinar,
  // se ocultan los macros: ante la duda, el estudio a ciegas manda.
  const [perfilRes, resultados] = await Promise.all([
    supabase.from('profiles').select('role').eq('user_id', user.id).single(),
    Promise.all(promises),
  ]);
  const filas = resultados.flatMap((r) => ordenarPorFuente((r.data ?? []) as AlimentoOption[])).slice(0, CAP_RESULTADOS);
  const role = (perfilRes?.data as { role?: string } | null)?.role;
  return role && !shouldHideNutritionInfo(role) ? filas : filas.map(sinMacros100g);
}

export async function getAlimentosRecientesAction(): Promise<AlimentoOption[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: itemRows } = await supabase
    .from('items')
    .select('id_alimento, created_at, ingestas!inner(id_usuario)')
    .eq('ingestas.id_usuario', user.id)
    .not('id_alimento', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!itemRows || itemRows.length === 0) return [];

  const idsEnOrden = idsRecientesUnicos(
    (itemRows as Array<{ id_alimento: number }>).map((r) => r.id_alimento),
    8,
  );
  if (idsEnOrden.length === 0) return [];

  const { data: alimentos } = await supabase.from('alimentos').select(SEL).in('id_alimento', idsEnOrden);
  if (!alimentos) return [];

  const porId = new Map((alimentos as AlimentoOption[]).map((a) => [a.id_alimento, a]));
  const recientes = idsEnOrden.map((id) => porId.get(id)).filter((a): a is AlimentoOption => a != null);

  // Estudio a ciegas (NUT-192): mismos macros fuera del payload que en la búsqueda; falla cerrado si no hay rol.
  const { data: perfil } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  const role = (perfil as { role?: string } | null)?.role;
  return role && !shouldHideNutritionInfo(role) ? recientes : recientes.map(sinMacros100g);
}

function getStringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

const EAN_REGEX = /^[0-9]{13}$/;

type ItemSource =
  | { kind: 'catalogo'; idAlimento: number }
  | { kind: 'barcode'; idAlimentoBarcode: number };

async function upsertIngestaAndInsertItem(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    userId: string;
    fecha: string;
    tipoIngesta: string;
    tipoItem: string;
    cantidad: number;
    source: ItemSource;
  },
): Promise<boolean> {
  const { userId, fecha, tipoIngesta, tipoItem, cantidad, source } = params;

  const { error: upsertError } = await supabase.from('ingestas').upsert(
    [{ id_usuario: userId, fecha, tipo: tipoIngesta }],
    { onConflict: 'id_usuario,fecha,tipo' },
  );
  if (upsertError) return false;

  const { data: ingesta, error: ingestaError } = await supabase
    .from('ingestas')
    .select('id_ingesta')
    .eq('id_usuario', userId)
    .eq('fecha', fecha)
    .eq('tipo', tipoIngesta)
    .single();
  if (ingestaError || !ingesta) return false;

  const itemFields =
    source.kind === 'catalogo'
      ? { id_alimento: source.idAlimento }
      : { id_alimento_barcode: source.idAlimentoBarcode };

  const { error: insertError } = await supabase.from('items').insert({
    id_ingesta: ingesta.id_ingesta,
    tipo_item: tipoItem,
    cantidad: toFixed2(cantidad),
    ...itemFields,
  });

  return !insertError;
}

export async function addItemAction(formData: FormData) {
  const fecha = getStringField(formData, 'fecha');
  const tipoIngesta = getStringField(formData, 'tipo_ingesta');
  const tipoItem = getStringField(formData, 'tipo_item');
  const alimentoIdRaw = getStringField(formData, 'id_alimento');
  const cantidadRaw = getStringField(formData, 'cantidad');

  if (!isValidDateInput(fecha)) redirect('/alimentacion');
  if (!estaEnRangoEditable(fecha)) redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  if (!INGESTA_TIPOS.includes(tipoIngesta as (typeof INGESTA_TIPOS)[number])) {
    redirect(`/alimentacion?fecha=${fecha}`);
  }
  if (!ITEM_TIPOS.includes(tipoItem as (typeof ITEM_TIPOS)[number])) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const idAlimento = Number.parseInt(alimentoIdRaw, 10);
  const cantidad = Number.parseFloat(cantidadRaw);

  if (
    !Number.isFinite(idAlimento) || idAlimento <= 0 ||
    !Number.isFinite(cantidad) || cantidad <= 0 || cantidad > MAX_CANTIDAD
  ) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: alimento, error: alimentoError } = await supabase
    .from('alimentos')
    .select('id_alimento')
    .eq('id_alimento', idAlimento)
    .single();

  if (alimentoError || !alimento) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const ok = await upsertIngestaAndInsertItem(supabase, {
    userId: user.id,
    fecha,
    tipoIngesta,
    tipoItem,
    cantidad,
    source: { kind: 'catalogo', idAlimento },
  });
  if (!ok) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  revalidatePath('/alimentacion');
  redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
}

const MAX_NOMBRE_MANUAL = 120;

const manualItemSchema = z.object({
  fecha: z.string().refine(isValidDateInput),
  tipo_ingesta: z.enum(INGESTA_TIPOS),
  tipo_item: z.enum(ITEM_TIPOS),
  nombre_manual: z.string().trim().min(1).max(MAX_NOMBRE_MANUAL),
  cantidad: z.coerce.number().positive().max(MAX_CANTIDAD),
});

// NUT-192: el alimento personalizado entra a la cola de validación por la RPC
// registrar_item_manual (service role, como registrar_guardado_deteccion): el
// ítem queda con origen_macros 'pendiente' (o el estado vigente de la cola) y
// nunca se le inventan macros en 0.
export async function addManualItemAction(formData: FormData) {
  const fecha = getStringField(formData, 'fecha');
  const tipoIngesta = getStringField(formData, 'tipo_ingesta');

  const parsed = manualItemSchema.safeParse({
    fecha,
    tipo_ingesta: tipoIngesta,
    tipo_item: getStringField(formData, 'tipo_item'),
    nombre_manual: getStringField(formData, 'nombre_manual'),
    cantidad: getStringField(formData, 'cantidad'),
  });
  if (!parsed.success) {
    if (!isValidDateInput(fecha)) redirect('/alimentacion');
    if (!INGESTA_TIPOS.includes(tipoIngesta as (typeof INGESTA_TIPOS)[number])) {
      redirect(`/alimentacion?fecha=${fecha}`);
    }
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }
  const datos = parsed.data;
  if (!estaEnRangoEditable(datos.fecha)) redirect(`/alimentacion?fecha=${datos.fecha}&tipo=${datos.tipo_ingesta}`);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { error } = await createAdminClient().rpc('registrar_item_manual', {
    p_user_id: user.id,
    p_fecha: datos.fecha,
    p_tipo: datos.tipo_ingesta,
    p_tipo_item: datos.tipo_item,
    p_nombre: datos.nombre_manual,
    p_cantidad: toFixed2(datos.cantidad),
  });
  if (error) {
    console.error('No se pudo registrar el alimento manual:', error);
    redirect(`/alimentacion?fecha=${datos.fecha}&tipo=${datos.tipo_ingesta}`);
  }

  revalidatePath('/alimentacion');
  redirect(`/alimentacion?fecha=${datos.fecha}&tipo=${datos.tipo_ingesta}`);
}

export async function addScannedItemAction(formData: FormData) {
  const fecha = getStringField(formData, 'fecha');
  const tipoIngesta = getStringField(formData, 'tipo_ingesta');
  const tipoItem = getStringField(formData, 'tipo_item');
  const ean = getStringField(formData, 'ean');
  const cantidadRaw = getStringField(formData, 'cantidad');

  if (!isValidDateInput(fecha)) redirect('/alimentacion');
  if (!estaEnRangoEditable(fecha)) redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  if (!INGESTA_TIPOS.includes(tipoIngesta as (typeof INGESTA_TIPOS)[number])) {
    redirect(`/alimentacion?fecha=${fecha}`);
  }
  if (!ITEM_TIPOS.includes(tipoItem as (typeof ITEM_TIPOS)[number])) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }
  if (!EAN_REGEX.test(ean)) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const cantidad = Number.parseFloat(cantidadRaw);
  if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > MAX_CANTIDAD) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  // Re-consulta a Open Food Facts del lado del servidor: nunca confiamos en
  // nombre/marca/macros que pueda mandar el cliente, solo en el EAN.
  const producto = await obtenerProductoPorEAN(ean);
  if (!producto.encontrado) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // El upsert va por el cliente admin (service role), no por `supabase`: la
  // tabla es de lectura pública y no tiene policy de insert/update para
  // usuarios autenticados, justamente para que la única vía de escritura sea
  // este server action (después de re-consultar OFF arriba), no un usuario
  // llamando a PostgREST directamente con la anon key.
  const admin = createAdminClient();
  const { data: alimentoBarcode, error: upsertError } = await admin
    .from('alimentos_barcode')
    .upsert(
      {
        codigo_ean: producto.ean,
        nombre: producto.nombre,
        categoria: producto.categoria,
        marca: producto.marca,
        porcion: producto.porcion,
        kcal_100g: producto.nutrientes100g.kcal,
        proteinas_100g: producto.nutrientes100g.proteinas,
        grasas_100g: producto.nutrientes100g.grasas,
        carbs_100g: producto.nutrientes100g.carbs,
        imagen_url: producto.imagenUrl,
        nutriscore_grade: producto.infoAmpliada.nutriscore,
        nova_group: producto.infoAmpliada.novaGroup,
        is_gluten_free: producto.infoAmpliada.sinGluten,
        is_vegan: producto.infoAmpliada.vegano,
        is_vegetarian: producto.infoAmpliada.vegetariano,
        serving_quantity_label: producto.porcionEtiqueta,
      },
      { onConflict: 'codigo_ean' },
    )
    .select('id_alimento_barcode')
    .single();

  if (upsertError || !alimentoBarcode) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const ok = await upsertIngestaAndInsertItem(supabase, {
    userId: user.id,
    fecha,
    tipoIngesta,
    tipoItem,
    cantidad,
    source: { kind: 'barcode', idAlimentoBarcode: alimentoBarcode.id_alimento_barcode },
  });
  if (!ok) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  revalidatePath('/alimentacion');
  redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
}

export async function deleteItemAction(formData: FormData) {
  const fecha = getStringField(formData, 'fecha');
  const tipoIngesta = getStringField(formData, 'tipo_ingesta');
  const idItemRaw = getStringField(formData, 'id_item');
  const idItem = Number.parseInt(idItemRaw, 10);

  if (!isValidDateInput(fecha) || !Number.isFinite(idItem) || idItem <= 0) {
    redirect('/alimentacion');
  }

  const tipoParam = INGESTA_TIPOS.includes(tipoIngesta as (typeof INGESTA_TIPOS)[number])
    ? `&tipo=${tipoIngesta}`
    : '';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: existingItem, error: existingItemError } = await supabase
    .from('items')
    .select('id_item')
    .eq('id_item', idItem)
    .single();

  if (existingItemError || !existingItem) {
    redirect(`/alimentacion?fecha=${fecha}${tipoParam}`);
  }

  const { error: deleteError } = await supabase.from('items').delete().eq('id_item', idItem);

  if (deleteError) {
    redirect(`/alimentacion?fecha=${fecha}${tipoParam}`);
  }

  revalidatePath('/alimentacion');
  redirect(`/alimentacion?fecha=${fecha}${tipoParam}`);
}

export async function updateItemAction(formData: FormData) {
  const fecha = getStringField(formData, 'fecha');
  const tipoIngesta = getStringField(formData, 'tipo_ingesta');
  const idItemRaw = getStringField(formData, 'id_item');
  const cantidadRaw = getStringField(formData, 'cantidad');

  if (!isValidDateInput(fecha)) redirect('/alimentacion');
  if (!estaEnRangoEditable(fecha)) redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  if (!INGESTA_TIPOS.includes(tipoIngesta as (typeof INGESTA_TIPOS)[number])) {
    redirect(`/alimentacion?fecha=${fecha}`);
  }

  const idItem = Number.parseInt(idItemRaw, 10);
  const cantidad = Number.parseFloat(cantidadRaw);

  if (
    !Number.isFinite(idItem) || idItem <= 0 ||
    !Number.isFinite(cantidad) || cantidad <= 0 || cantidad > MAX_CANTIDAD
  ) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Verify the item belongs to the authenticated user
  const { data: itemData, error: itemError } = await supabase
    .from('items')
    .select('id_item, id_ingesta')
    .eq('id_item', idItem)
    .single();

  if (itemError || !itemData) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const { data: ingestaData, error: ingestaError } = await supabase
    .from('ingestas')
    .select('id_ingesta')
    .eq('id_ingesta', itemData.id_ingesta)
    .eq('id_usuario', user.id)
    .single();

  if (ingestaError || !ingestaData) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const { error: updateError } = await supabase
    .from('items')
    .update({ cantidad: toFixed2(cantidad) })
    .eq('id_item', idItem);

  if (updateError) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  revalidatePath('/alimentacion');
  redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
}
