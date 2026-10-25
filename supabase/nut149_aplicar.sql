-- NUT-149 — Aplicar en Supabase (SQL Editor). Pegar y correr TODO junto.
-- Va en una transacción: si algo falla, no se aplica nada.
-- Parte 1: columnas, trigger de protección, vista y RPCs de revisión (re-ejecutable).
-- Parte 2: registrar_guardado_deteccion con p_revisiones (reemplaza la firma anterior).

begin;

-- ============================================================
-- NUT-149 — Cola de revisión de predicciones IA (equipo de nutrición)
--
-- Los campos viven en detecciones_ia_items (una fila por ítem que predijo
-- Gemini): es la única tabla que cubre también a los ítems QUITADOS por el
-- usuario, que no tienen fila en detecciones_guardados_items.
--
-- Los valores de Gemini (ingredient, estimated_weight_grams, confidence) y los
-- del usuario (detecciones_guardados_items) NO se tocan nunca: el nutricionista
-- escribe en nutricionista_alimento / nutricionista_gramos.
--
-- Alimentos agregados a mano (falsos negativos) NO entran a la cola. Para la
-- métrica de "no detectados" (NUT-151):
--   select count(*) from detecciones_guardados_items where origin = 'added_manually';
-- ============================================================

alter table public.detecciones_ia_items
  add column if not exists necesita_revision      boolean,
  add column if not exists motivos_revision       text[] not null default '{}',
  add column if not exists estado_revision        text,
  add column if not exists revisado_por           uuid references auth.users(id) on delete set null,
  add column if not exists revisado_en            timestamptz,
  add column if not exists nutricionista_alimento text,
  add column if not exists nutricionista_gramos   numeric(10,2),
  add column if not exists candidato_ejemplo      boolean not null default false;

alter table public.detecciones_ia_items
  drop constraint if exists detecciones_ia_items_estado_revision_check,
  drop constraint if exists detecciones_ia_items_motivos_revision_check,
  drop constraint if exists detecciones_ia_items_nutricionista_gramos_check;

alter table public.detecciones_ia_items
  add constraint detecciones_ia_items_estado_revision_check
    check (estado_revision in ('pendiente', 'confirmado', 'corregido')),
  add constraint detecciones_ia_items_motivos_revision_check
    check (motivos_revision <@ array['item_quitado', 'cambio_alimento', 'correccion_peso_grande', 'confianza_baja']),
  add constraint detecciones_ia_items_nutricionista_gramos_check
    check (nutricionista_gramos is null or nutricionista_gramos > 0);

create index if not exists idx_detecciones_ia_items_revision
  on public.detecciones_ia_items (estado_revision, id_deteccion_item desc) where necesita_revision;

-- Las columnas de revisión sólo se escriben desde el servidor (RPC de guardado
-- con service_role, RPCs revision_ia_* security definer). El insert de
-- /api/food-recognition usa el cliente del usuario y las deja en su default.
create or replace function public.detecciones_ia_items_proteger_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.necesita_revision is not null or new.estado_revision is not null
       or new.revisado_por is not null or new.revisado_en is not null
       or new.nutricionista_alimento is not null or new.nutricionista_gramos is not null
       or new.candidato_ejemplo or cardinality(new.motivos_revision) > 0 then
      raise exception 'COLUMNA_PROTEGIDA'
        using detail = 'Las columnas de revisión de detecciones_ia_items sólo se escriben desde el servidor.';
    end if;
  elsif (new.necesita_revision, new.motivos_revision, new.estado_revision, new.revisado_por, new.revisado_en,
         new.nutricionista_alimento, new.nutricionista_gramos, new.candidato_ejemplo)
        is distinct from
        (old.necesita_revision, old.motivos_revision, old.estado_revision, old.revisado_por, old.revisado_en,
         old.nutricionista_alimento, old.nutricionista_gramos, old.candidato_ejemplo) then
    raise exception 'COLUMNA_PROTEGIDA'
      using detail = 'Las columnas de revisión de detecciones_ia_items sólo se escriben desde el servidor.';
  end if;
  return new;
end;
$$;

drop trigger if exists detecciones_ia_items_proteger_revision on public.detecciones_ia_items;
create trigger detecciones_ia_items_proteger_revision
  before insert or update on public.detecciones_ia_items
  for each row execute function public.detecciones_ia_items_proteger_revision();

-- Vista de la cola: predicción de Gemini + valor final del usuario + contexto de captura.
-- security_invoker: aplican las RLS del que consulta (un deportista ve sólo lo suyo; la
-- pantalla /revision-ia es sólo para investigadores). No expone la URL de la foto.
create or replace view public.v_revision_ia
with (security_invoker = true)
as
select
  di.id_deteccion_item,
  di.id_deteccion,
  di.item_uuid,
  di.ingredient             as alimento_ia,
  di.estimated_weight_grams as gramos_ia,
  di.confidence,
  di.necesita_revision,
  di.motivos_revision,
  ('item_quitado' = any (di.motivos_revision)) as item_quitado,
  di.estado_revision,
  di.revisado_por,
  di.revisado_en,
  di.nutricionista_alimento,
  di.nutricionista_gramos,
  di.candidato_ejemplo,
  d.created_at,
  d.id_usuario,
  d.imagen_path,
  d.vajilla_tipo,
  d.vajilla_diametro_cm,
  d.angulo_captura_grados,
  d.angulo_aproximado,
  gi.name                   as alimento_usuario,
  gi.grams                  as gramos_usuario,
  gi.origin                 as origen_usuario
from public.detecciones_ia_items di
join public.detecciones_ia d on d.id_deteccion = di.id_deteccion
left join lateral (
  select g.name, g.grams, g.origin
  from public.detecciones_guardados_items g
  where g.source_item_uuid = di.item_uuid
  order by g.id_guardado_item
  limit 1
) gi on true
where di.necesita_revision;

revoke all on public.v_revision_ia from anon, authenticated;
grant select on public.v_revision_ia to authenticated;

-- Acciones del nutricionista. security definer + rol chequeado adentro (patrón pendiente_*).
-- Errores (message): FORBIDDEN, NOT_FOUND, ESTADO_INVALIDO, INVALID.
create or replace function public.revision_ia_confirmar(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado text;
begin
  if coalesce((select public.get_my_role()), '') not in ('investigador', 'administrador') then
    raise exception 'FORBIDDEN';
  end if;

  select estado_revision into v_estado
  from public.detecciones_ia_items where id_deteccion_item = p_id and necesita_revision for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_estado <> 'pendiente' then raise exception 'ESTADO_INVALIDO'; end if;

  update public.detecciones_ia_items
  set estado_revision = 'confirmado', revisado_por = auth.uid(), revisado_en = now()
  where id_deteccion_item = p_id;
end;
$$;

create or replace function public.revision_ia_corregir(p_id bigint, p_alimento text, p_gramos numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado text;
  v_alimento text := nullif(btrim(p_alimento), '');
begin
  if coalesce((select public.get_my_role()), '') not in ('investigador', 'administrador') then
    raise exception 'FORBIDDEN';
  end if;
  if v_alimento is null and p_gramos is null then raise exception 'INVALID'; end if;
  if p_gramos is not null and p_gramos <= 0 then raise exception 'INVALID'; end if;

  select estado_revision into v_estado
  from public.detecciones_ia_items where id_deteccion_item = p_id and necesita_revision for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_estado <> 'pendiente' then raise exception 'ESTADO_INVALIDO'; end if;

  update public.detecciones_ia_items
  set estado_revision = 'corregido', revisado_por = auth.uid(), revisado_en = now(),
      nutricionista_alimento = v_alimento, nutricionista_gramos = p_gramos
  where id_deteccion_item = p_id;
end;
$$;

-- Independiente del estado: sólo toca candidato_ejemplo.
create or replace function public.revision_ia_marcar_candidato(p_id bigint, p_valor boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select public.get_my_role()), '') not in ('investigador', 'administrador') then
    raise exception 'FORBIDDEN';
  end if;
  if p_valor is null then raise exception 'INVALID'; end if;

  update public.detecciones_ia_items set candidato_ejemplo = p_valor
  where id_deteccion_item = p_id and necesita_revision;
  if not found then raise exception 'NOT_FOUND'; end if;
end;
$$;

revoke all on function public.revision_ia_confirmar(bigint) from public, anon;
revoke all on function public.revision_ia_corregir(bigint, text, numeric) from public, anon;
revoke all on function public.revision_ia_marcar_candidato(bigint, boolean) from public, anon;
grant execute on function public.revision_ia_confirmar(bigint) to authenticated;
grant execute on function public.revision_ia_corregir(bigint, text, numeric) to authenticated;
grant execute on function public.revision_ia_marcar_candidato(bigint, boolean) to authenticated;

-- NUT-149: la firma ganó p_revisiones; se descarta la anterior para no dejar un overload.
drop function if exists public.registrar_guardado_deteccion(uuid, bigint, date, text, uuid[], jsonb, text, text);

create or replace function public.registrar_guardado_deteccion(
  p_user_id uuid,
  p_id_deteccion bigint,
  p_fecha date,
  p_tipo text,
  p_removed uuid[],
  p_items jsonb,
  p_modelo_nutricion text,
  p_nutrition_prompt_version text,
  p_revisiones jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rol          text;
  v_id_guardado  bigint;
  v_id_ingesta   bigint;
  v_item         jsonb;
  v_name         text;
  v_norm         text;
  v_grams        numeric;
  v_id_alim      integer;
  v_origen       text;
  v_id_pendiente bigint;
  v_ia           boolean;
  v_ia_k         numeric;
  v_ia_p         numeric;
  v_ia_g         numeric;
  v_ia_c         numeric;
  v_k            numeric;
  v_p            numeric;
  v_g            numeric;
  v_c            numeric;
  v_id_gi        bigint;
  v_cola         public.alimentos_pendientes_validacion%rowtype;
  v_registrados  integer := 0;
  v_sin_datos    integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID' using detail = 'p_items debe ser un array jsonb.';
  end if;

  select p.role into v_rol from public.profiles p where p.user_id = p_user_id;

  -- Serializa guardados concurrentes de la misma predicción.
  perform 1
  from public.detecciones_ia d
  where d.id_deteccion = p_id_deteccion and d.id_usuario = p_user_id
  for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if exists (select 1 from public.detecciones_guardados g where g.id_deteccion = p_id_deteccion) then
    raise exception 'ALREADY_SAVED';
  end if;

  insert into public.detecciones_guardados (id_usuario, id_deteccion, tipo_comida, removed_item_uuids)
  values (p_user_id, p_id_deteccion, p_tipo, coalesce(p_removed, '{}'))
  returning id_guardado into v_id_guardado;

  insert into public.ingestas (id_usuario, fecha, tipo)
  values (p_user_id, p_fecha, p_tipo)
  on conflict (id_usuario, fecha, tipo) do nothing;

  select i.id_ingesta into v_id_ingesta
  from public.ingestas i
  where i.id_usuario = p_user_id and i.fecha = p_fecha and i.tipo = p_tipo;

  -- Orden por nombre normalizado: los locks de la cola se toman siempre en el
  -- mismo orden (sin deadlocks entre guardados concurrentes).
  for v_item in
    select e.value
    from jsonb_array_elements(p_items) with ordinality as e(value, ord)
    order by public.norm_alimento(e.value ->> 'name') nulls last, e.ord
  loop
    v_name := v_item ->> 'name';
    v_norm := public.norm_alimento(v_name);
    v_grams := (v_item ->> 'grams')::numeric;
    v_id_alim := (v_item ->> 'id_alimento')::integer;
    v_id_pendiente := null;

    -- Valores de IA: todo o nada.
    v_ia_k := (v_item -> 'ia' ->> 'kcal_100g')::numeric;
    v_ia_p := (v_item -> 'ia' ->> 'proteinas_100g')::numeric;
    v_ia_g := (v_item -> 'ia' ->> 'grasas_100g')::numeric;
    v_ia_c := (v_item -> 'ia' ->> 'carbs_100g')::numeric;
    v_ia := num_nulls(v_ia_k, v_ia_p, v_ia_g, v_ia_c) = 0;
    if not v_ia then
      v_ia_k := null; v_ia_p := null; v_ia_g := null; v_ia_c := null;
    end if;

    if v_id_alim is not null then
      v_origen := 'catalogo';

    elsif v_rol = 'deportista_ucc' and v_norm is not null then
      insert into public.alimentos_pendientes_validacion (
        nombre_original, nombre_normalizado, categoria_ia,
        gemini_kcal_100g, gemini_proteinas_100g, gemini_grasas_100g, gemini_carbs_100g,
        gemini_modelo, gemini_prompt_version
      )
      values (
        v_name, v_norm, v_item ->> 'category',
        v_ia_k, v_ia_p, v_ia_g, v_ia_c,
        case when v_ia then p_modelo_nutricion end,
        case when v_ia then p_nutrition_prompt_version end
      )
      on conflict (nombre_normalizado) do nothing;

      select * into v_cola
      from public.alimentos_pendientes_validacion c
      where c.nombre_normalizado = v_norm
      for update;

      v_id_pendiente := v_cola.id_pendiente;

      if v_cola.estado = 'validado' then
        v_origen := 'validado';
        v_id_alim := v_cola.id_alimento_vinculado;
        v_k := v_cola.final_kcal_100g;
        v_p := v_cola.final_proteinas_100g;
        v_g := v_cola.final_grasas_100g;
        v_c := v_cola.final_carbs_100g;
      elsif v_cola.estado = 'descartado' then
        v_origen := 'descartado';
        v_k := null; v_p := null; v_g := null; v_c := null;
      else
        v_origen := 'pendiente';
        -- Completa los valores de Gemini si la fila los tenía vacíos.
        if v_ia and num_nonnulls(v_cola.gemini_kcal_100g, v_cola.gemini_proteinas_100g,
                                 v_cola.gemini_grasas_100g, v_cola.gemini_carbs_100g) = 0 then
          update public.alimentos_pendientes_validacion c
          set gemini_kcal_100g = v_ia_k,
              gemini_proteinas_100g = v_ia_p,
              gemini_grasas_100g = v_ia_g,
              gemini_carbs_100g = v_ia_c,
              gemini_modelo = coalesce(c.gemini_modelo, p_modelo_nutricion),
              gemini_prompt_version = coalesce(c.gemini_prompt_version, p_nutrition_prompt_version)
          where c.id_pendiente = v_cola.id_pendiente
          returning * into v_cola;
        end if;
        -- Todas las ocurrencias de un nombre usan los valores de la cola.
        v_k := v_cola.gemini_kcal_100g;
        v_p := v_cola.gemini_proteinas_100g;
        v_g := v_cola.gemini_grasas_100g;
        v_c := v_cola.gemini_carbs_100g;
      end if;

    else
      -- particular, investigador, administrador (D12) o nombre no normalizable.
      v_origen := case when v_ia then 'estimado_ia' else 'sin_datos' end;
      v_k := v_ia_k; v_p := v_ia_p; v_g := v_ia_g; v_c := v_ia_c;
    end if;

    -- Con id_alimento, el snapshot es el del catálogo: así el log coincide con
    -- lo que calcula el trigger de items.
    if v_id_alim is not null then
      select a.kcal_100g, a.proteinas_100g, a.grasas_100g, a.carbs_100g
      into v_k, v_p, v_g, v_c
      from public.alimentos a
      where a.id_alimento = v_id_alim;
      if not found then
        raise exception 'FOOD_REF_INVALIDO' using detail = v_id_alim::text;
      end if;
    end if;

    insert into public.detecciones_guardados_items (
      id_guardado, source_item_uuid, name, category, grams, ai_grams, origin, answers, food_ref,
      id_alimento, metodo_match, score_match, origen_macros,
      kcal_100g, proteinas_100g, grasas_100g, carbs_100g,
      kcal, proteinas_g, grasas_g, carbs_g,
      modelo_nutricion, nutrition_prompt_version, id_pendiente
    )
    values (
      v_id_guardado,
      (v_item ->> 'source_item_uuid')::uuid,
      v_name,
      v_item ->> 'category',
      v_grams,
      (v_item ->> 'ai_grams')::numeric,
      v_item ->> 'origin',
      coalesce(nullif(v_item -> 'answers', 'null'::jsonb), '[]'::jsonb),
      v_item ->> 'food_ref',
      v_id_alim,
      v_item ->> 'metodo_match',
      (v_item ->> 'score_match')::real,
      v_origen,
      v_k, v_p, v_g, v_c,
      round(v_k * v_grams / 100, 2),
      round(v_p * v_grams / 100, 2),
      round(v_g * v_grams / 100, 2),
      round(v_c * v_grams / 100, 2),
      case when v_ia then p_modelo_nutricion end,
      case when v_ia then p_nutrition_prompt_version end,
      v_id_pendiente
    )
    returning id_guardado_item into v_id_gi;

    -- D10: sin dato de estado físico → 'solido'. Sin id_alimento, el nombre va
    -- a nombre_manual (items_alimento_or_manual_check). kcal/macros los calcula
    -- el trigger calculate_item_nutrients.
    insert into public.items (
      id_ingesta, id_alimento, nombre_manual, tipo_item, cantidad,
      kcal_100g, proteinas_100g, grasas_100g, carbs_100g,
      origen_macros, id_guardado_item
    )
    values (
      v_id_ingesta,
      v_id_alim,
      case when v_origen = 'catalogo' then null else v_name end,
      'solido',
      v_grams,
      case when v_origen = 'catalogo' then null else v_k end,
      case when v_origen = 'catalogo' then null else v_p end,
      case when v_origen = 'catalogo' then null else v_g end,
      case when v_origen = 'catalogo' then null else v_c end,
      v_origen,
      v_id_gi
    );

    v_registrados := v_registrados + 1;
    if v_k is null then
      v_sin_datos := v_sin_datos + 1;
    end if;
  end loop;

  -- NUT-149: cola de revisión. Sólo ítems de ESTA detección; motivos vacíos = no entra.
  if p_revisiones is not null and jsonb_typeof(p_revisiones) = 'array' then
    update public.detecciones_ia_items di
    set necesita_revision = coalesce(array_length(r.motivos, 1), 0) > 0,
        motivos_revision  = r.motivos,
        estado_revision   = case when coalesce(array_length(r.motivos, 1), 0) > 0 then 'pendiente' end
    from (
      select (e.value ->> 'item_uuid')::uuid as item_uuid,
             coalesce(array(select jsonb_array_elements_text(e.value -> 'motivos')), '{}') as motivos
      from jsonb_array_elements(p_revisiones) as e(value)
    ) r
    where di.item_uuid = r.item_uuid
      and di.id_deteccion = p_id_deteccion;
  end if;

  return jsonb_build_object(
    'id_guardado', v_id_guardado,
    'items_registrados', v_registrados,
    'sin_datos', v_sin_datos
  );
end;
$$;

revoke all on function public.registrar_guardado_deteccion(uuid, bigint, date, text, uuid[], jsonb, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.registrar_guardado_deteccion(uuid, bigint, date, text, uuid[], jsonb, text, text, jsonb)
  to service_role;

commit;
