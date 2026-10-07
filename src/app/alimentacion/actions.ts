'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { INGESTA_TIPOS, ITEM_TIPOS, MAX_CANTIDAD, isValidDateInput, toFixed2 } from '@/lib/nutrition';
import { estaEnRangoEditable } from '@/lib/date';
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

  // Tier 1 (mayor relevancia): matches por nombre.
  if (campos.nombre) {
    let q1 = supabase.from('alimentos').select(SEL).ilike('nombre', `%${q}%`);
    q1 = aplicarFiltroSuplemento(q1, isSuplemento);
    promises.push(q1.order('nombre', { ascending: true }).limit(100));
  }

  // Tier 2: matches por marca/denominacion que no vinieron ya por nombre.
  const marcaDenomOr = buildMarcaDenominacionOr(campos, q);
  if (marcaDenomOr.length > 0) {
    let q2 = supabase.from('alimentos').select(SEL).or(marcaDenomOr);
    if (campos.nombre) q2 = q2.not('nombre', 'ilike', `%${q}%`);
    q2 = aplicarFiltroSuplemento(q2, isSuplemento);
    promises.push(q2.order('nombre', { ascending: true }).limit(100));
  }

  const resultados = await Promise.all(promises);
  return resultados.flatMap((r) => r.data ?? []).slice(0, CAP_RESULTADOS) as AlimentoOption[];
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
  return idsEnOrden.map((id) => porId.get(id)).filter((a): a is AlimentoOption => a != null);
}

function getStringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

const EAN_REGEX = /^[0-9]{13}$/;

type ItemSource =
  | { kind: 'catalogo'; idAlimento: number }
  | { kind: 'manual'; nombreManual: string }
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
      : source.kind === 'manual'
        ? { id_alimento: null, nombre_manual: source.nombreManual }
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

export async function addManualItemAction(formData: FormData) {
  const fecha = getStringField(formData, 'fecha');
  const tipoIngesta = getStringField(formData, 'tipo_ingesta');
  const tipoItem = getStringField(formData, 'tipo_item');
  const nombreManual = getStringField(formData, 'nombre_manual').slice(0, MAX_NOMBRE_MANUAL);
  const cantidadRaw = getStringField(formData, 'cantidad');

  if (!isValidDateInput(fecha)) redirect('/alimentacion');
  if (!estaEnRangoEditable(fecha)) redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  if (!INGESTA_TIPOS.includes(tipoIngesta as (typeof INGESTA_TIPOS)[number])) {
    redirect(`/alimentacion?fecha=${fecha}`);
  }
  if (!ITEM_TIPOS.includes(tipoItem as (typeof ITEM_TIPOS)[number])) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const cantidad = Number.parseFloat(cantidadRaw);

  if (
    !nombreManual ||
    !Number.isFinite(cantidad) || cantidad <= 0 || cantidad > MAX_CANTIDAD
  ) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const ok = await upsertIngestaAndInsertItem(supabase, {
    userId: user.id,
    fecha,
    tipoIngesta,
    tipoItem,
    cantidad,
    source: { kind: 'manual', nombreManual },
  });
  if (!ok) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  revalidatePath('/alimentacion');
  redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
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
