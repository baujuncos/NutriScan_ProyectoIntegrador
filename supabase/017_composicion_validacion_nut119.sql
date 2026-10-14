-- ============================================================
-- Script para correr en el SQL Editor de Supabase.
--
-- Es exactamente la sección "017" ya agregada al final de
-- supabase/schema_consolidado.sql (que sigue siendo la fuente de verdad del
-- esquema completo) — este archivo separado es sólo para pegarlo y correrlo
-- de una sin tener que ubicar la sección en el archivo grande.
--
-- Es seguro re-ejecutar: ADD COLUMN IF NOT EXISTS, DROP IF EXISTS + CREATE OR REPLACE.
-- ============================================================

-- ============================================================
-- 017 (NUT-119) — Composición de un alimento pendiente desde el catálogo
--
-- El investigador describe lo que hay en la foto con los GRAMOS REALES de cada
-- alimento del catálogo (nunca proporciones). La composición se guarda en la
-- cola (`composicion`, borrador y validación) y el servidor recalcula los
-- valores por 100 g leyendo el catálogo y el peso real de la ocurrencia de
-- referencia (`detecciones_guardados_items.grams`): lo que mande el cliente
-- (valores, gramos_foto, nombre del ingrediente) se descarta.
--
-- Valor por 100 g del alimento = Σ(valor_i por 100 g × gramos_i) / peso de la foto.
-- Vínculo puro: un solo ingrediente cuyos gramos igualan el peso de la foto
-- (±0,5 g) = ese mismo alimento del catálogo (id_alimento_vinculado).
--
-- Errores nuevos: COMPOSICION_INVALIDA (detail = motivo). Se mantienen
-- FORBIDDEN, NOT_FOUND, ESTADO_INVALIDO, INVALID y ALIMENTO_NO_ENCONTRADO.
-- ============================================================

alter table public.alimentos_pendientes_validacion
  add column if not exists composicion jsonb;

-- Cálculo interno (sólo la invocan las RPC de abajo, que son security definer).
create or replace function public.calcular_composicion(p_id_pendiente bigint, p_composicion jsonb)
returns table (
  kcal numeric,
  prot numeric,
  grasas numeric,
  carbs numeric,
  id_vinculo integer,
  composicion_normalizada jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref    bigint;
  v_peso   numeric;
  v_comps  jsonb := p_composicion -> 'componentes';
  v_el     jsonb;
  v_id     integer;
  v_g      numeric;
  v_a      public.alimentos%rowtype;
  v_k      numeric := 0;
  v_p      numeric := 0;
  v_gr     numeric := 0;
  v_c      numeric := 0;
  v_out    jsonb := '[]'::jsonb;
  v_n      integer := 0;
  v_vinc   integer := null;
begin
  if jsonb_typeof(p_composicion) is distinct from 'object'
     or p_composicion ->> 'modo' is distinct from 'catalogo'
     or jsonb_typeof(v_comps) is distinct from 'array'
     or jsonb_array_length(v_comps) not between 1 and 30
     or jsonb_typeof(p_composicion -> 'id_guardado_item') is distinct from 'number' then
    raise exception 'COMPOSICION_INVALIDA' using detail = 'Estructura inválida.';
  end if;

  -- La ocurrencia de referencia debe ser de ESTE alimento pendiente; su peso sale de la base.
  select gi.id_guardado_item, gi.grams
  into v_ref, v_peso
  from public.detecciones_guardados_items gi
  where gi.id_pendiente = p_id_pendiente
    and gi.id_guardado_item = (p_composicion ->> 'id_guardado_item')::numeric;
  if not found or v_peso is null or v_peso <= 0 then
    raise exception 'COMPOSICION_INVALIDA' using detail = 'La foto de referencia no corresponde a este alimento.';
  end if;

  for v_el in select e from jsonb_array_elements(v_comps) as t(e) loop
    if jsonb_typeof(v_el -> 'id') is distinct from 'number'
       or jsonb_typeof(v_el -> 'gramos') is distinct from 'number' then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Ingrediente mal formado.';
    end if;
    begin
      v_id := (v_el ->> 'id')::integer;
    exception when others then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Ingrediente mal formado.';
    end;
    v_g := (v_el ->> 'gramos')::numeric;
    if v_g <= 0 or v_g > 1000 then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Los gramos de cada ingrediente deben ser mayores a 0 y hasta 1000.';
    end if;

    select * into v_a from public.alimentos a where a.id_alimento = v_id;
    if not found then
      raise exception 'ALIMENTO_NO_ENCONTRADO' using detail = v_id::text;
    end if;
    if num_nulls(v_a.kcal_100g, v_a.proteinas_100g, v_a.grasas_100g, v_a.carbs_100g) > 0 then
      raise exception 'COMPOSICION_INVALIDA' using detail = v_a.nombre || ' no tiene datos nutricionales en el catálogo.';
    end if;

    v_k  := v_k  + v_a.kcal_100g      * v_g;
    v_p  := v_p  + v_a.proteinas_100g * v_g;
    v_gr := v_gr + v_a.grasas_100g    * v_g;
    v_c  := v_c  + v_a.carbs_100g     * v_g;
    v_n  := v_n + 1;
    v_out := v_out || jsonb_build_object(
      'origen', 'catalogo', 'id', v_a.id_alimento, 'nombre', v_a.nombre, 'fuente', v_a.fuente,
      'gramos', v_g, 'kcal_100g', v_a.kcal_100g, 'proteinas_100g', v_a.proteinas_100g,
      'grasas_100g', v_a.grasas_100g, 'carbs_100g', v_a.carbs_100g);
    if v_n = 1 and abs(v_g - v_peso) <= 0.5 then
      v_vinc := v_a.id_alimento;
    end if;
  end loop;

  -- Vínculo puro: los valores son exactamente los del catálogo (sin redondeos de la cuenta).
  if v_n = 1 and v_vinc is not null then
    return query select v_a.kcal_100g, v_a.proteinas_100g, v_a.grasas_100g, v_a.carbs_100g, v_vinc,
      jsonb_build_object('modo', 'catalogo', 'id_guardado_item', v_ref, 'gramos_foto', v_peso, 'componentes', v_out);
    return;
  end if;

  return query select
    round(v_k / v_peso, 2), round(v_p / v_peso, 2), round(v_gr / v_peso, 2), round(v_c / v_peso, 2),
    null::integer,
    jsonb_build_object('modo', 'catalogo', 'id_guardado_item', v_ref, 'gramos_foto', v_peso, 'componentes', v_out);
end;
$$;

revoke all on function public.calcular_composicion(bigint, jsonb) from public, anon, authenticated;

-- Borrador: guarda final_*, observaciones y la composición sin cambiar el estado.
-- Con modo 'catalogo' e ingredientes, los 4 valores se recalculan en el servidor.
-- Con modo 'catalogo' sin ingredientes (recién elegida la pestaña), con 'ia' o 'manual':
-- se guardan los valores que manda el cliente. Sin p_composicion se conserva la anterior.
drop function if exists public.pendiente_modificar(bigint, text, text, numeric, numeric, numeric, numeric, text);

create or replace function public.pendiente_modificar(
  p_id bigint,
  p_nombre text,
  p_categoria text,
  p_kcal numeric,
  p_prot numeric,
  p_grasas numeric,
  p_carbs numeric,
  p_observaciones text,
  p_composicion jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes   public.alimentos_pendientes_validacion%rowtype;
  v_despues public.alimentos_pendientes_validacion%rowtype;
  v_modo    text := p_composicion ->> 'modo';
  v_k       numeric := p_kcal;
  v_p       numeric := p_prot;
  v_g       numeric := p_grasas;
  v_c       numeric := p_carbs;
  v_comp    jsonb := null;
  v_ref     bigint;
begin
  if coalesce(public.get_my_role() in ('investigador', 'administrador'), false) is false then
    raise exception 'FORBIDDEN';
  end if;

  if p_composicion is not null
     and (jsonb_typeof(p_composicion) is distinct from 'object' or v_modo is null or v_modo not in ('ia', 'catalogo', 'manual')) then
    raise exception 'COMPOSICION_INVALIDA' using detail = 'Modo inválido.';
  end if;

  select * into v_antes
  from public.alimentos_pendientes_validacion c
  where c.id_pendiente = p_id
  for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_antes.estado <> 'pendiente' then
    raise exception 'ESTADO_INVALIDO';
  end if;

  if p_composicion is not null then
    if v_modo = 'catalogo' and jsonb_typeof(p_composicion -> 'componentes') = 'array'
       and jsonb_array_length(p_composicion -> 'componentes') > 0 then
      select r.kcal, r.prot, r.grasas, r.carbs, r.composicion_normalizada
      into v_k, v_p, v_g, v_c, v_comp
      from public.calcular_composicion(p_id, p_composicion) r;
    else
      if v_modo = 'catalogo' and jsonb_typeof(p_composicion -> 'id_guardado_item') = 'number' then
        select gi.id_guardado_item into v_ref
        from public.detecciones_guardados_items gi
        where gi.id_pendiente = p_id
          and gi.id_guardado_item = (p_composicion ->> 'id_guardado_item')::numeric;
      end if;
      v_comp := jsonb_build_object('modo', v_modo, 'id_guardado_item', v_ref, 'gramos_foto', null, 'componentes', '[]'::jsonb);
    end if;
  end if;

  update public.alimentos_pendientes_validacion c
  set nombre_final = nullif(btrim(p_nombre), ''),
      categoria_final = nullif(btrim(p_categoria), ''),
      final_kcal_100g = v_k,
      final_proteinas_100g = v_p,
      final_grasas_100g = v_g,
      final_carbs_100g = v_c,
      observaciones = p_observaciones,
      composicion = coalesce(v_comp, c.composicion)
  where c.id_pendiente = p_id
  returning * into v_despues;

  insert into public.alimentos_pendientes_auditoria (id_pendiente, accion, id_usuario, antes, despues, items_afectados)
  values (p_id, 'modificar', auth.uid(), to_jsonb(v_antes), to_jsonb(v_despues), 0);
end;
$$;

revoke all on function public.pendiente_modificar(bigint, text, text, numeric, numeric, numeric, numeric, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.pendiente_modificar(bigint, text, text, numeric, numeric, numeric, numeric, text, jsonb)
  to authenticated;

-- Validar. Con p_composicion (modo 'catalogo', ≥1 ingrediente) los valores salen del
-- cálculo del servidor; si es vínculo puro se vincula a esa entrada del catálogo. Con
-- modo 'ia' o 'manual' se exigen los 4 valores. p_id_alimento_existente sólo se usa
-- cuando no hay p_composicion (compatibilidad). Sigue sin insertar en `alimentos`.
drop function if exists public.pendiente_validar(bigint, text, text, numeric, numeric, numeric, numeric, text, int);

create or replace function public.pendiente_validar(
  p_id bigint,
  p_nombre text,
  p_categoria text,
  p_kcal numeric,
  p_prot numeric,
  p_grasas numeric,
  p_carbs numeric,
  p_observaciones text,
  p_id_alimento_existente int default null,
  p_composicion jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes   public.alimentos_pendientes_validacion%rowtype;
  v_despues public.alimentos_pendientes_validacion%rowtype;
  v_nombre  text := nullif(btrim(p_nombre), '');
  v_norm    text := public.norm_alimento(p_nombre);
  v_modo    text := p_composicion ->> 'modo';
  v_existente int := case when p_composicion is null then p_id_alimento_existente end;
  v_id      integer;
  v_k       numeric;
  v_p       numeric;
  v_g       numeric;
  v_c       numeric;
  v_comp    jsonb := null;
  v_n       integer;
begin
  if coalesce(public.get_my_role() in ('investigador', 'administrador'), false) is false then
    raise exception 'FORBIDDEN';
  end if;

  if v_nombre is null or v_norm is null then
    raise exception 'INVALID' using detail = 'p_nombre';
  end if;
  if p_composicion is not null
     and (jsonb_typeof(p_composicion) is distinct from 'object' or v_modo is null or v_modo not in ('ia', 'catalogo', 'manual')) then
    raise exception 'COMPOSICION_INVALIDA' using detail = 'Modo inválido.';
  end if;
  if v_existente is null and v_modo is distinct from 'catalogo'
     and (num_nulls(p_kcal, p_prot, p_grasas, p_carbs) > 0 or least(p_kcal, p_prot, p_grasas, p_carbs) < 0) then
    raise exception 'INVALID' using detail = 'Los 4 valores por 100 g son obligatorios y >= 0.';
  end if;

  select * into v_antes
  from public.alimentos_pendientes_validacion c
  where c.id_pendiente = p_id
  for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_antes.estado <> 'pendiente' then
    raise exception 'ESTADO_INVALIDO';
  end if;

  if v_modo = 'catalogo' then
    if jsonb_typeof(p_composicion -> 'componentes') is distinct from 'array'
       or jsonb_array_length(p_composicion -> 'componentes') = 0 then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Elegí al menos un alimento del catálogo.';
    end if;
    select r.kcal, r.prot, r.grasas, r.carbs, r.id_vinculo, r.composicion_normalizada
    into v_k, v_p, v_g, v_c, v_id, v_comp
    from public.calcular_composicion(p_id, p_composicion) r;
  elsif v_modo is not null then
    -- 'ia' o 'manual': los valores los carga el investigador; no se guardan ingredientes.
    v_id := null;
    v_k := p_kcal; v_p := p_prot; v_g := p_grasas; v_c := p_carbs;
    v_comp := jsonb_build_object('modo', v_modo, 'id_guardado_item', null, 'gramos_foto', null, 'componentes', '[]'::jsonb);
  elsif v_existente is not null then
    -- Vinculado a una entrada existente del catálogo: los valores son los del catálogo.
    select a.id_alimento, a.kcal_100g, a.proteinas_100g, a.grasas_100g, a.carbs_100g
    into v_id, v_k, v_p, v_g, v_c
    from public.alimentos a
    where a.id_alimento = v_existente;
    if not found then
      raise exception 'ALIMENTO_NO_ENCONTRADO' using detail = v_existente::text;
    end if;
  else
    -- Alimento nuevo sin composición (compatibilidad): NO se inserta en `alimentos`.
    v_id := null;
    v_k := p_kcal; v_p := p_prot; v_g := p_grasas; v_c := p_carbs;
  end if;

  update public.alimentos_pendientes_validacion c
  set estado = 'validado',
      nombre_final = v_nombre,
      categoria_final = nullif(btrim(p_categoria), ''),
      final_kcal_100g = v_k,
      final_proteinas_100g = v_p,
      final_grasas_100g = v_g,
      final_carbs_100g = v_c,
      id_alimento_vinculado = v_id,
      observaciones = p_observaciones,
      composicion = coalesce(v_comp, c.composicion),
      resuelto_por = auth.uid(),
      resuelto_at = now()
  where c.id_pendiente = p_id
  returning * into v_despues;

  -- Locks en orden: fila de cola → ítems → ingestas (igual que descartar / registrar).
  -- nombre_manual se conserva (trazabilidad: el nombre que cargó el deportista).
  perform 1 from public.items it
  where it.id_guardado_item in (select gi.id_guardado_item from public.detecciones_guardados_items gi where gi.id_pendiente = p_id)
  order by it.id_item
  for update;
  perform 1 from public.ingestas g
  where g.id_ingesta in (
    select it.id_ingesta from public.items it
    where it.id_guardado_item in (select gi.id_guardado_item from public.detecciones_guardados_items gi where gi.id_pendiente = p_id)
  )
  order by g.id_ingesta
  for update;

  -- El trigger recalcula cada ítem con SU cantidad (desde el catálogo si hay id_alimento,
  -- desde el snapshot si no) y el de ingestas ajusta los totales.
  update public.items it
  set id_alimento = v_id,
      kcal_100g = v_k,
      proteinas_100g = v_p,
      grasas_100g = v_g,
      carbs_100g = v_c,
      origen_macros = 'validado'
  where it.id_guardado_item in (select gi.id_guardado_item from public.detecciones_guardados_items gi where gi.id_pendiente = p_id);
  get diagnostics v_n = row_count;

  insert into public.alimentos_pendientes_auditoria (id_pendiente, accion, id_usuario, antes, despues, items_afectados)
  values (p_id, 'validar', auth.uid(), to_jsonb(v_antes), to_jsonb(v_despues), v_n);

  return jsonb_build_object('id_alimento', v_id, 'items_afectados', v_n);
end;
$$;

revoke all on function public.pendiente_validar(bigint, text, text, numeric, numeric, numeric, numeric, text, int, jsonb)
  from public, anon, authenticated;
grant execute on function public.pendiente_validar(bigint, text, text, numeric, numeric, numeric, numeric, text, int, jsonb)
  to authenticated;

-- Las vistas se recrean para exponer `composicion` (p.* se expande al crear la vista).
drop view if exists public.v_alimentos_pendientes;
create view public.v_alimentos_pendientes
with (security_invoker = true)
as
select p.*, o.ocurrencias, o.ultima_ocurrencia
from public.alimentos_pendientes_validacion p
cross join lateral (
  select count(*) as ocurrencias, max(gi.created_at) as ultima_ocurrencia
  from public.detecciones_guardados_items gi
  where gi.id_pendiente = p.id_pendiente
) o;

revoke all on public.v_alimentos_pendientes from anon, authenticated;
grant select on public.v_alimentos_pendientes to authenticated;

drop view if exists public.v_alimentos_validados;
create view public.v_alimentos_validados
with (security_invoker = true)
as
select
  p.id_pendiente,
  p.nombre_final,
  p.categoria_final,
  p.final_kcal_100g,
  p.final_proteinas_100g,
  p.final_grasas_100g,
  p.final_carbs_100g,
  p.id_alimento_vinculado,
  p.observaciones,
  p.resuelto_por,
  p.resuelto_at,
  p.composicion,
  o.ocurrencias
from public.alimentos_pendientes_validacion p
cross join lateral (
  select count(*) as ocurrencias
  from public.detecciones_guardados_items gi
  where gi.id_pendiente = p.id_pendiente
) o
where p.estado = 'validado';

revoke all on public.v_alimentos_validados from anon, authenticated;
grant select on public.v_alimentos_validados to authenticated;
