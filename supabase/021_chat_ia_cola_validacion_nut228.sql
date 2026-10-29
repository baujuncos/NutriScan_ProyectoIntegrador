-- ============================================================
-- Script para correr en el SQL Editor de Supabase (NUT-228).
--
-- Es exactamente la sección "021 (NUT-228/230/231/232)" agregada al final de
-- supabase/schema_consolidado.sql (que sigue siendo la fuente de verdad del
-- esquema completo); este archivo separado es sólo para pegarlo y correrlo.
--
-- Requiere 001–020 aplicadas (en particular 012 NUT-191 y 020 NUT-192).
-- Es seguro re-ejecutar: IF NOT EXISTS / DROP ... IF EXISTS / CREATE OR REPLACE.
-- ============================================================

-- ============================================================
-- 021 (NUT-228/NUT-230/NUT-231/NUT-232) — Los alimentos que el chat con IA estima
-- sin catálogo entran a la MISMA cola de validación que la foto y la carga manual.
--
-- Qué hace (todo aditivo; no edita ninguna función de la cola ni de 013–020):
--   * alimentos_pendientes_validacion.origen admite 'chat' (cómo se CREÓ la entrada).
--   * Qué entra a la cola desde el chat (NUT-230): SOLO los ítems que el chat
--     estimó sin match en el catálogo (macro_source = 'estimado_ia', origin
--     'ai'/'edited', sin id_alimento, destino 'diario'), de cualquier rol que no sea
--     investigador/administrador (como la carga manual). NO entran: los que
--     matchean SARA2 (ya tienen datos validados), el agua, los quitados ni los
--     agregados a mano dentro del chat (added_manually: no son una predicción del chat).
--   * Mismo tratamiento que registrar_guardado_deteccion (013) con un ítem de foto
--     pendiente: una entrada por nombre normalizado; validada → el ítem toma los
--     valores finales; descartada → queda 'descartado'; pendiente → queda con la
--     ESTIMACIÓN de la IA visible, marcada origen_macros = 'pendiente', y la cola guarda
--     los valores de IA (gemini_*) si no los tenía. Ver chat_encolar_item.
--   * Vínculo: se reutiliza items.id_pendiente, así que el trigger diferido de la 020
--     (pendiente_resolver_items_manuales) completa o descarta los ítems del chat al
--     validar/descartar SIN modificarse (NUT-232). Para distinguir chat de manual se
--     agregan chat_ia_registros_items.id_pendiente e id_item (no se toca `items`).
--   * v_alimentos_pendientes: `ocurrencias_manuales` pasa a excluir los ítems de chat y
--     se agrega `ocurrencias_chat` al final. Sin ítems de chat devuelve lo mismo que antes.
--   * confirmar_chat_ia_registro (012): CREATE OR REPLACE ADITIVO. El cuerpo es idéntico
--     salvo (1) dos variables, (2) `returning id_registro_item` del insert de auditoría,
--     (3) la llamada a chat_encolar_item para los ítems estimado_ia del diario y (4) la
--     llamada a chat_guardar_conversacion antes del return. Sin ítems encolables ni
--     conversación se comporta y devuelve exactamente igual. Es la ÚNICA función
--     existente que cambia.
--
-- DATO NUEVO (privacidad): chat_ia_registros.conversacion (jsonb) guarda los mensajes
-- {role, content} de la conversación, SOLO cuando al menos un ítem del registro entra a la cola,
-- con tope de 20 mensajes / 2000 caracteres c/u / 12000 en total, y sin ningún otro dato. Sirve
-- para que el investigador vea qué escribió la persona y qué aclaró. La RLS es la de la
-- tabla: sólo el dueño y investigador/administrador la leen. Los usuarios no pueden escribirla
-- (la escribe chat_guardar_conversacion; un trigger lo impide por PostgREST).
--
-- La estimación de la IA NO se reemplaza por "no disponible": igual que la foto, el usuario
-- sigue viendo la estimación, marcada como pendiente, hasta que el investigador valida o descarta.
--
-- Numeración: 020 es la última en main; esta es la 021.
-- ============================================================

-- ------------------------------------------------------------
-- Cola: origen 'chat'
-- ------------------------------------------------------------

-- El check de la 020 era en línea (nombre autogenerado): se busca por definición y se recrea con nombre.
do $$
declare
  v_con name;
begin
  for v_con in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.alimentos_pendientes_validacion'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~ '^CHECK \(\(?origen '
  loop
    execute format('alter table public.alimentos_pendientes_validacion drop constraint %I', v_con);
  end loop;
end
$$;

alter table public.alimentos_pendientes_validacion
  add constraint alimentos_pendientes_validacion_origen_check
  check (origen in ('ia', 'manual', 'chat'));

-- ------------------------------------------------------------
-- Auditoría del chat: vínculo con la cola y con el ítem del diario, y conversación
-- ------------------------------------------------------------

alter table public.chat_ia_registros_items
  add column if not exists id_pendiente bigint,
  add column if not exists id_item bigint;

alter table public.chat_ia_registros_items
  drop constraint if exists chat_ia_registros_items_id_pendiente_fkey,
  drop constraint if exists chat_ia_registros_items_id_item_fkey;
alter table public.chat_ia_registros_items
  add constraint chat_ia_registros_items_id_pendiente_fkey
    foreign key (id_pendiente) references public.alimentos_pendientes_validacion(id_pendiente) on delete set null,
  add constraint chat_ia_registros_items_id_item_fkey
    foreign key (id_item) references public.items(id_item) on delete set null;

create index if not exists idx_chat_ia_registros_items_pendiente
  on public.chat_ia_registros_items (id_pendiente) where id_pendiente is not null;
create unique index if not exists idx_chat_ia_registros_items_item
  on public.chat_ia_registros_items (id_item) where id_item is not null;

alter table public.chat_ia_registros
  add column if not exists conversacion jsonb;

-- Estas columnas sólo las escribe el servidor (funciones security definer de abajo): por
-- PostgREST (authenticated/anon) un usuario podría marcar su ítem como "de chat" o inflar el
-- contador de otra entrada de la cola, o guardar texto libre sin pasar por el tope.
create or replace function public.chat_ia_registros_items_proteger_vinculo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and (new.id_pendiente is not null or new.id_item is not null) then
    raise exception 'COLUMNA_PROTEGIDA'
      using detail = 'id_pendiente e id_item de chat_ia_registros_items sólo se escriben desde el servidor.';
  end if;
  return new;
end;
$$;

drop trigger if exists chat_ia_registros_items_proteger_vinculo on public.chat_ia_registros_items;
create trigger chat_ia_registros_items_proteger_vinculo
  before insert on public.chat_ia_registros_items
  for each row execute function public.chat_ia_registros_items_proteger_vinculo();

create or replace function public.chat_ia_registros_proteger_conversacion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and new.conversacion is not null then
    raise exception 'COLUMNA_PROTEGIDA'
      using detail = 'chat_ia_registros.conversacion sólo se escribe desde el servidor.';
  end if;
  return new;
end;
$$;

drop trigger if exists chat_ia_registros_proteger_conversacion on public.chat_ia_registros;
create trigger chat_ia_registros_proteger_conversacion
  before insert on public.chat_ia_registros
  for each row execute function public.chat_ia_registros_proteger_conversacion();

-- ------------------------------------------------------------
-- chat_encolar_item: anota en la cola un ítem del chat estimado por la IA (NUT-230)
--
-- security definer + search_path fijo. Sólo `authenticated`. Valida que el ítem de
-- auditoría y el ítem del diario sean de auth.uid() (si no, NO_AUTORIZADO).
-- Devuelve el id_pendiente, o null si el ítem no corresponde encolarlo (no es estimado_ia,
-- rol investigador/administrador, nombre no normalizable, ya vinculado...): casos esperados que
-- NUNCA hacen fallar el registro del usuario. Cualquier error inesperado dentro del encolado
-- se registra como WARNING y se devuelve null: el registro del usuario no se pierde.
--
-- Semántica sobre la cola, IDÉNTICA a la de la foto (registrar_guardado_deteccion, 013) con
-- un ítem pendiente: insert ... on conflict (nombre_normalizado) do nothing + select for
-- update; validado → origen_macros 'validado' y valores finales; descartado → 'descartado' y
-- sin valores; pendiente → 'pendiente' con los valores de IA de la cola (se completan si
-- la fila los tenía vacíos). Los valores de IA son los por 100 g del ítem estimado.
-- Si cambia registrar_guardado_deteccion / registrar_item_manual, revisar esta.
-- ------------------------------------------------------------

create or replace function public.chat_encolar_item(p_id_registro_item bigint, p_id_item bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_ri      public.chat_ia_registros_items%rowtype;
  v_reg     public.chat_ia_registros%rowtype;
  v_item    public.items%rowtype;
  v_rol     text;
  v_nombre  text;
  v_norm    text;
  v_ia_k numeric; v_ia_p numeric; v_ia_g numeric; v_ia_c numeric;
  v_k numeric; v_p numeric; v_g numeric; v_c numeric;
  v_cola    public.alimentos_pendientes_validacion%rowtype;
  v_origen  text;
  v_id_alim integer := null;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select r.* into v_reg
  from public.chat_ia_registros r
  join public.chat_ia_registros_items i on i.id_registro = r.id_registro
  where i.id_registro_item = p_id_registro_item and r.id_usuario = v_uid;
  if not found then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', detail = 'registro';
  end if;

  select ri.* into v_ri from public.chat_ia_registros_items ri where ri.id_registro_item = p_id_registro_item;

  select it.* into v_item
  from public.items it
  join public.ingestas g on g.id_ingesta = it.id_ingesta
  where it.id_item = p_id_item and g.id_usuario = v_uid;
  if not found then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', detail = 'item';
  end if;

  -- Sólo lo que el chat estimó sin catálogo y fue al diario; ni SARA2, ni agua, ni a mano, ni quitados.
  if v_ri.macro_source is distinct from 'estimado_ia'
     or v_ri.origin not in ('ai', 'edited')
     or v_ri.destino <> 'diario'
     or v_ri.id_alimento is not null
     or v_item.id_alimento is not null
     or v_item.id_alimento_barcode is not null
     or v_item.id_pendiente is not null
     or v_item.origen_macros is not null
     or v_ri.id_pendiente is not null
     or v_ri.id_item is not null
     or v_item.nombre_manual is distinct from left(v_ri.ingrediente, 120)
     or num_nulls(v_ri.gramos_ia, v_ri.kcal_ia, v_ri.proteinas_ia_g, v_ri.carbs_ia_g, v_ri.grasas_ia_g) > 0
     or v_ri.gramos_ia <= 0 then
    return null;
  end if;

  select p.role into v_rol from public.profiles p where p.user_id = v_uid;
  if v_rol is null or v_rol in ('investigador', 'administrador') then
    return null;
  end if;

  v_nombre := nullif(btrim(v_ri.ingrediente), '');
  v_norm := public.norm_alimento(v_ri.ingrediente);
  if v_nombre is null or v_norm is null or length(v_nombre) > 200 then
    return null;
  end if;

  -- Todo lo que sigue va en un sub-bloque: un error inesperado no pierde el registro del usuario.
  begin
    v_ia_k := round(v_ri.kcal_ia * 100 / v_ri.gramos_ia, 2);
    v_ia_p := round(v_ri.proteinas_ia_g * 100 / v_ri.gramos_ia, 2);
    v_ia_g := round(v_ri.grasas_ia_g * 100 / v_ri.gramos_ia, 2);
    v_ia_c := round(v_ri.carbs_ia_g * 100 / v_ri.gramos_ia, 2);

    insert into public.alimentos_pendientes_validacion (
      nombre_original, nombre_normalizado, origen, categoria_ia,
      gemini_kcal_100g, gemini_proteinas_100g, gemini_grasas_100g, gemini_carbs_100g,
      gemini_modelo, gemini_prompt_version
    )
    values (
      v_nombre, v_norm, 'chat', v_ri.tipo,
      v_ia_k, v_ia_p, v_ia_g, v_ia_c,
      v_reg.modelo, v_reg.prompt_version
    )
    on conflict (nombre_normalizado) do nothing;

    select * into v_cola
    from public.alimentos_pendientes_validacion c
    where c.nombre_normalizado = v_norm
    for update;

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
      -- Completa los valores de IA si la fila los tenía vacíos (como la foto).
      if num_nonnulls(v_cola.gemini_kcal_100g, v_cola.gemini_proteinas_100g,
                      v_cola.gemini_grasas_100g, v_cola.gemini_carbs_100g) = 0 then
        update public.alimentos_pendientes_validacion c
        set gemini_kcal_100g = v_ia_k,
            gemini_proteinas_100g = v_ia_p,
            gemini_grasas_100g = v_ia_g,
            gemini_carbs_100g = v_ia_c,
            gemini_modelo = coalesce(c.gemini_modelo, v_reg.modelo),
            gemini_prompt_version = coalesce(c.gemini_prompt_version, v_reg.prompt_version)
        where c.id_pendiente = v_cola.id_pendiente
        returning * into v_cola;
      end if;
      -- Todas las ocurrencias de un nombre usan los valores de la cola.
      v_k := v_cola.gemini_kcal_100g;
      v_p := v_cola.gemini_proteinas_100g;
      v_g := v_cola.gemini_grasas_100g;
      v_c := v_cola.gemini_carbs_100g;
    end if;

    if v_id_alim is not null then
      select a.kcal_100g, a.proteinas_100g, a.grasas_100g, a.carbs_100g
      into v_k, v_p, v_g, v_c
      from public.alimentos a
      where a.id_alimento = v_id_alim;
      if not found then
        raise exception 'INVALID' using detail = 'alimento vinculado inexistente';
      end if;
    end if;

    -- El trigger de items recalcula los macros y el de ingestas ajusta los totales
    -- (la lista "update of" incluye el snapshot, origen_macros e id_alimento).
    update public.items it
    set id_alimento = v_id_alim,
        kcal_100g = case when v_id_alim is null then v_k end,
        proteinas_100g = case when v_id_alim is null then v_p end,
        grasas_100g = case when v_id_alim is null then v_g end,
        carbs_100g = case when v_id_alim is null then v_c end,
        origen_macros = v_origen,
        id_pendiente = v_cola.id_pendiente
    where it.id_item = p_id_item;

    update public.chat_ia_registros_items ri
    set id_pendiente = v_cola.id_pendiente, id_item = p_id_item
    where ri.id_registro_item = p_id_registro_item;

    return v_cola.id_pendiente;
  exception when others then
    raise warning '[chat_encolar_item] no se encoló el ítem % (%): %', p_id_item, sqlstate, sqlerrm;
    return null;
  end;
end;
$$;

revoke all on function public.chat_encolar_item(bigint, bigint) from public, anon;
grant execute on function public.chat_encolar_item(bigint, bigint) to authenticated;

comment on function public.chat_encolar_item(bigint, bigint) is
  'NUT-230. Encola un ítem del chat estimado por la IA sin catálogo. Comparte la semántica sobre alimentos_pendientes_validacion con registrar_guardado_deteccion (013) y registrar_item_manual (020). Si cambia una, revisar las otras.';

-- ------------------------------------------------------------
-- chat_guardar_conversacion: guarda la conversación del registro (NUT-231)
--
-- security definer + search_path fijo; sólo `authenticated`; valida que el registro sea de
-- auth.uid() (si no, NO_AUTORIZADO). Se escribe UNA vez y sólo si algún ítem del registro entró
-- a la cola. Se guardan únicamente {role, content}; si la forma o los topes no se cumplen no se
-- guarda nada y devuelve false (nunca falla el registro por esto).
-- ------------------------------------------------------------

create or replace function public.chat_guardar_conversacion(p_id_registro bigint, p_conversacion jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_reg   public.chat_ia_registros%rowtype;
  v_total integer;
  v_limpia jsonb;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select r.* into v_reg
  from public.chat_ia_registros r
  where r.id_registro = p_id_registro and r.id_usuario = v_uid;
  if not found then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', detail = 'registro';
  end if;

  if v_reg.conversacion is not null then
    return false;
  end if;
  if not exists (
    select 1 from public.chat_ia_registros_items i
    where i.id_registro = p_id_registro and i.id_pendiente is not null
  ) then
    return false;
  end if;

  if jsonb_typeof(p_conversacion) is distinct from 'array'
     or jsonb_array_length(p_conversacion) not between 1 and 20 then
    return false;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_conversacion) e
    where jsonb_typeof(e) <> 'object'
       or e->>'role' is null or e->>'role' not in ('user', 'assistant')
       or jsonb_typeof(e->'content') <> 'string'
       or char_length(e->>'content') > 2000
  ) then
    return false;
  end if;

  select coalesce(sum(char_length(e->>'content')), 0) into v_total from jsonb_array_elements(p_conversacion) e;
  if v_total > 12000 then
    return false;
  end if;

  select jsonb_agg(jsonb_build_object('role', e.value->>'role', 'content', e.value->>'content') order by e.ord)
  into v_limpia
  from jsonb_array_elements(p_conversacion) with ordinality as e(value, ord);

  update public.chat_ia_registros set conversacion = v_limpia where id_registro = p_id_registro;
  return true;
end;
$$;

revoke all on function public.chat_guardar_conversacion(bigint, jsonb) from public, anon;
grant execute on function public.chat_guardar_conversacion(bigint, jsonb) to authenticated;


-- ------------------------------------------------------------
-- confirmar_chat_ia_registro (012, NUT-191): CREATE OR REPLACE aditivo
--
-- Cuerpo idéntico al vigente salvo: variables v_ri_id / v_encolados; `returning
-- id_registro_item` del insert de auditoría; la llamada a chat_encolar_item para los
-- ítems estimado_ia del diario (NUT-230); y la llamada a chat_guardar_conversacion antes
-- del return (NUT-231). Sigue siendo security invoker. Sin ítems encolables y sin
-- conversación hace y devuelve exactamente lo mismo que antes.
-- ------------------------------------------------------------

create or replace function public.confirmar_chat_ia_registro(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user         uuid := auth.uid();
  v_request_id   uuid := (p_payload->>'requestId')::uuid;
  v_fecha        date := (p_payload->>'fecha')::date;
  v_tipo         text := p_payload->>'tipoIngesta';
  v_registro     bigint;
  v_ingesta      bigint;
  v_item         jsonb;
  v_item_id      bigint;
  v_agua_ml      numeric := 0;
  v_diario_items integer := 0;
  v_ri_id        bigint;
  v_encolados    integer := 0;
begin
  if v_user is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  -- Idempotencia: la confirmación ya se guardó (reintento del cliente).
  select r.id_registro into v_registro
  from public.chat_ia_registros r
  where r.id_usuario = v_user and r.request_id = v_request_id;
  if found then
    return jsonb_build_object('idRegistro', v_registro, 'yaGuardado', true);
  end if;

  -- La ingesta solo se crea si algún ítem va al diario (si es todo agua, no).
  if exists (select 1 from jsonb_array_elements(p_payload->'items') e where e->>'destino' = 'diario') then
    insert into public.ingestas (id_usuario, fecha, tipo)
    values (v_user, v_fecha, v_tipo)
    on conflict (id_usuario, fecha, tipo) do nothing;

    select i.id_ingesta into v_ingesta
    from public.ingestas i
    where i.id_usuario = v_user and i.fecha = v_fecha and i.tipo = v_tipo;
  end if;

  insert into public.chat_ia_registros (
    id_usuario, request_id, fecha, tipo_ingesta, modelo, prompt_version,
    kcal_total, proteinas_total_g, carbs_total_g, grasas_total_g, gramos_total
  ) values (
    v_user, v_request_id, v_fecha, v_tipo, p_payload->>'modelo', p_payload->>'promptVersion',
    (p_payload#>>'{totales,kcal}')::numeric,
    (p_payload#>>'{totales,proteinas_g}')::numeric,
    (p_payload#>>'{totales,carbs_g}')::numeric,
    (p_payload#>>'{totales,grasas_g}')::numeric,
    (p_payload#>>'{totales,gramos}')::numeric
  ) returning id_registro into v_registro;

  for v_item in select value from jsonb_array_elements(p_payload->'items') loop
    if v_item->>'destino' = 'diario' then
      -- Un ítem sin catálogo se guarda con nombre_manual (lo exige items_alimento_or_manual_check).
      insert into public.items (id_ingesta, id_alimento, nombre_manual, tipo_item, cantidad)
      values (
        v_ingesta,
        (v_item->>'idAlimento')::integer,
        case when v_item->>'idAlimento' is null then left(v_item->>'ingrediente', 120) end,
        case when v_item->>'unidad' = 'ml' then 'liquido' else 'solido' end,
        (v_item#>>'{final,gramos}')::numeric
      ) returning id_item into v_item_id;

      -- Sin catálogo el trigger dejó las macros en 0: se corrigen SOLO en esta fila
      -- (la que acabamos de insertar) y SOLO esas 4 columnas, para no volver a
      -- disparar calculate_item_nutrients (que escucha id_alimento/barcode/cantidad).
      if v_item->>'idAlimento' is null then
        update public.items
        set kcal        = (v_item#>>'{final,kcal}')::numeric,
            proteinas_g = (v_item#>>'{final,proteinas_g}')::numeric,
            grasas_g    = (v_item#>>'{final,grasas_g}')::numeric,
            carbs_g     = (v_item#>>'{final,carbs_g}')::numeric
        where id_item = v_item_id;
      end if;

      v_diario_items := v_diario_items + 1;
    elsif v_item->>'destino' = 'hidratacion' then
      v_agua_ml := v_agua_ml + (v_item#>>'{final,gramos}')::numeric;
    end if;

    insert into public.chat_ia_registros_items (
      id_registro, ingrediente, tipo, unidad, origin, destino,
      gramos_ia, kcal_ia, proteinas_ia_g, carbs_ia_g, grasas_ia_g,
      gramos_final, kcal_final, proteinas_final_g, carbs_final_g, grasas_final_g,
      confidence, macro_source, id_alimento
    ) values (
      v_registro, v_item->>'ingrediente', v_item->>'tipo', v_item->>'unidad', v_item->>'origin', v_item->>'destino',
      (v_item#>>'{ia,gramos}')::numeric, (v_item#>>'{ia,kcal}')::numeric, (v_item#>>'{ia,proteinas_g}')::numeric,
      (v_item#>>'{ia,carbs_g}')::numeric, (v_item#>>'{ia,grasas_g}')::numeric,
      (v_item#>>'{final,gramos}')::numeric, (v_item#>>'{final,kcal}')::numeric, (v_item#>>'{final,proteinas_g}')::numeric,
      (v_item#>>'{final,carbs_g}')::numeric, (v_item#>>'{final,grasas_g}')::numeric,
      (v_item->>'confidence')::numeric, v_item->>'macroSource', (v_item->>'idAlimento')::integer
    ) returning id_registro_item into v_ri_id;

    -- NUT-230: lo que el chat estimó sin catálogo entra a la cola de validación (como la foto).
    if v_item->>'destino' = 'diario' and v_item->>'macroSource' = 'estimado_ia' and v_item->>'idAlimento' is null then
      if public.chat_encolar_item(v_ri_id, v_item_id) is not null then
        v_encolados := v_encolados + 1;
      end if;
    end if;
  end loop;

  -- Hidratación: suma atómica al día (el módulo guarda ml_total por usuario y día;
  -- los "vasos" son solo visualización, 250 ml).
  if v_agua_ml > 0 then
    insert into public.hidratacion (id_usuario, fecha, ml_total)
    values (v_user, v_fecha, round(v_agua_ml)::integer)
    on conflict (id_usuario, fecha)
    do update set ml_total = hidratacion.ml_total + excluded.ml_total, updated_at = now();
  end if;

  -- NUT-231: la conversación se guarda solo si algún ítem entró a la cola.
  if v_encolados > 0 and jsonb_typeof(p_payload->'conversacion') = 'array' then
    perform public.chat_guardar_conversacion(v_registro, p_payload->'conversacion');
  end if;

  return jsonb_build_object(
    'idRegistro', v_registro,
    'idIngesta', v_ingesta,
    'itemsDiario', v_diario_items,
    'mlAgua', round(v_agua_ml),
    'yaGuardado', false
  );
end;
$$;

REVOKE ALL ON FUNCTION public.confirmar_chat_ia_registro(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirmar_chat_ia_registro(jsonb) TO authenticated;

-- ------------------------------------------------------------
-- Vista para /validacion
--
-- Mismas columnas, mismo orden y tipos que en la 020; `ocurrencias_chat` va al final.
-- Cambia SOLO la definición de `ocurrencias_manuales`: ya no cuenta los ítems que
-- vienen del chat (los que tienen fila en chat_ia_registros_items.id_item). Sin ítems de
-- chat devuelve exactamente lo mismo que antes. `ultima_ocurrencia` y `usuarios_distintos`
-- siguen contando todos los ítems vinculados por items.id_pendiente (manuales y de chat).
-- security_invoker: la RLS del que consulta aplica a cada tabla base.
-- ------------------------------------------------------------

create or replace view public.v_alimentos_pendientes
with (security_invoker = true)
as
select
  p.id_pendiente, p.nombre_original, p.nombre_normalizado, p.categoria_ia,
  p.gemini_kcal_100g, p.gemini_proteinas_100g, p.gemini_grasas_100g, p.gemini_carbs_100g,
  p.gemini_modelo, p.gemini_prompt_version,
  p.nombre_final, p.categoria_final,
  p.final_kcal_100g, p.final_proteinas_100g, p.final_grasas_100g, p.final_carbs_100g,
  p.id_alimento_vinculado, p.estado, p.observaciones, p.resuelto_por, p.resuelto_at,
  p.created_at, p.updated_at, p.composicion, p.id_alimento_propio,
  o.ocurrencias,
  greatest(o.ultima_ia, m.ultima_manual) as ultima_ocurrencia,
  m.ocurrencias_manuales,
  u.usuarios_distintos,
  p.origen,
  m.ocurrencias_chat
from public.alimentos_pendientes_validacion p
cross join lateral (
  select count(*) as ocurrencias, max(gi.created_at) as ultima_ia
  from public.detecciones_guardados_items gi
  where gi.id_pendiente = p.id_pendiente
) o
cross join lateral (
  select count(*) filter (where ci.id_registro_item is null) as ocurrencias_manuales,
         count(*) filter (where ci.id_registro_item is not null) as ocurrencias_chat,
         max(it.created_at) as ultima_manual
  from public.items it
  left join public.chat_ia_registros_items ci on ci.id_item = it.id_item
  where it.id_pendiente = p.id_pendiente
) m
cross join lateral (
  select count(*) as usuarios_distintos
  from (
    select g.id_usuario
    from public.detecciones_guardados_items gi
    join public.detecciones_guardados g on g.id_guardado = gi.id_guardado
    where gi.id_pendiente = p.id_pendiente
    union
    select ing.id_usuario
    from public.items it
    join public.ingestas ing on ing.id_ingesta = it.id_ingesta
    where it.id_pendiente = p.id_pendiente
  ) x
) u;

revoke all on public.v_alimentos_pendientes from anon, authenticated;
grant select on public.v_alimentos_pendientes to authenticated;
