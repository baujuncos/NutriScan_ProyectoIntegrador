'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { INGESTA_TIPOS, ITEM_TIPOS, isValidDateInput, toFixed2 } from '@/lib/nutrition';
import { todayAR, daysAgoAR } from '@/lib/date';

export type AlimentoOption = {
  id_alimento: number;
  nombre: string;
  categoria: string | null;
  fuente: string;
  marca: string | null;
  denominacion: string | null;
};

const SEL = 'id_alimento, nombre, categoria, fuente, marca, denominacion' as const;

export async function searchAlimentosAction(query: string, tipoIngesta: string): Promise<AlimentoOption[]> {
  const q = query.trim().replace(/[*,\\]/g, '');
  if (q.length < 2) return [];

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const isSuplemento = tipoIngesta === 'suplemento';

  // Two parallel queries for relevance ordering:
  // 1. nombre matches (most relevant) — come first
  // 2. marca/denominacion-only matches — come after, deduplicated via NOT nombre match
  // ponytail: two round-trips; replace with one RPC + ORDER BY rank if latency matters
  const q1 = supabase.from('alimentos').select(SEL)
    .ilike('nombre', `%${q}%`)
    .order('nombre', { ascending: true })
    .limit(60);
  const q2 = supabase.from('alimentos').select(SEL)
    .or(`marca.ilike.*${q}*,denominacion.ilike.*${q}*`)
    .not('nombre', 'ilike', `%${q}%`)
    .order('nombre', { ascending: true })
    .limit(40);

  const [r1, r2] = await Promise.all([
    isSuplemento ? q1.ilike('categoria', '%suplemento%') : q1.not('categoria', 'ilike', '%suplemento%'),
    isSuplemento ? q2.ilike('categoria', '%suplemento%') : q2.not('categoria', 'ilike', '%suplemento%'),
  ]);

  return [...(r1.data ?? []), ...(r2.data ?? [])].slice(0, 80) as AlimentoOption[];
}

function isWithinEditableRange(fecha: string): boolean {
  return fecha >= daysAgoAR(7) && fecha <= todayAR();
}

const MAX_CANTIDAD = 2000;

function getStringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export async function addItemAction(formData: FormData) {
  const fecha = getStringField(formData, 'fecha');
  const tipoIngesta = getStringField(formData, 'tipo_ingesta');
  const tipoItem = getStringField(formData, 'tipo_item');
  const alimentoIdRaw = getStringField(formData, 'id_alimento');
  const cantidadRaw = getStringField(formData, 'cantidad');

  if (!isValidDateInput(fecha)) redirect('/alimentacion');
  if (!isWithinEditableRange(fecha)) redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
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

  const { error: upsertError } = await supabase.from('ingestas').upsert(
    [
      {
        id_usuario: user.id,
        fecha,
        tipo: tipoIngesta,
      },
    ],
    { onConflict: 'id_usuario,fecha,tipo' },
  );

  if (upsertError) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const { data: ingesta, error: ingestaError } = await supabase
    .from('ingestas')
    .select('id_ingesta')
    .eq('id_usuario', user.id)
    .eq('fecha', fecha)
    .eq('tipo', tipoIngesta)
    .single();

  if (ingestaError || !ingesta) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const { error: insertError } = await supabase.from('items').insert({
    id_ingesta: ingesta.id_ingesta,
    id_alimento: idAlimento,
    tipo_item: tipoItem,
    cantidad: toFixed2(cantidad),
  });

  if (insertError) {
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
  if (!isWithinEditableRange(fecha)) redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
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

  const { error: upsertError } = await supabase.from('ingestas').upsert(
    [
      {
        id_usuario: user.id,
        fecha,
        tipo: tipoIngesta,
      },
    ],
    { onConflict: 'id_usuario,fecha,tipo' },
  );

  if (upsertError) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const { data: ingesta, error: ingestaError } = await supabase
    .from('ingestas')
    .select('id_ingesta')
    .eq('id_usuario', user.id)
    .eq('fecha', fecha)
    .eq('tipo', tipoIngesta)
    .single();

  if (ingestaError || !ingesta) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const { error: insertError } = await supabase.from('items').insert({
    id_ingesta: ingesta.id_ingesta,
    id_alimento: null,
    nombre_manual: nombreManual,
    tipo_item: tipoItem,
    cantidad: toFixed2(cantidad),
  });

  if (insertError) {
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
  if (!isWithinEditableRange(fecha)) redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
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
