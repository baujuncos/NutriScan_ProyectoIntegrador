-- ============================================================
-- Script para correr en el SQL Editor de Supabase.
--
-- Es exactamente la sección "019" ya agregada al final de
-- supabase/schema_consolidado.sql (que sigue siendo la fuente de verdad del
-- esquema completo) — este archivo separado es sólo para pegarlo y correrlo
-- de una sin tener que ubicar la sección en el archivo grande.
--
-- Es seguro re-ejecutar: IF NOT EXISTS, DROP IF EXISTS + CREATE OR REPLACE.
-- ============================================================

-- ============================================================
-- 019 (NUT-119) — Alimentos propios (catálogo propio) — Fase B
--
-- Desde "A mano" el investigador puede crear un alimento reutilizable. Entra tras
-- una verificación automática de campos y una evaluación breve (fuente, justificación
-- y tres confirmaciones). Nadie escribe directo en la tabla: sólo estas RPC definer,
-- que repiten TODAS las verificaciones en el servidor. Crear un propio es la misma
-- transacción que validar el pendiente. Los propios NO entran al matching automático
-- de la IA (match_alimentos no se toca): se usan a mano y como ingredientes de una
-- composición (origen 'propio').
--
-- Errores: PROPIO_BLOQUEADO (detail = JSON de bloqueos), PROPIO_ADVERTENCIA
-- (detail = KCAL_INCOHERENTE | SIMILAR), PROPIO_EVALUACION (detail = fuente |
-- justificacion | confirmaciones | motivo), PROPIO_DUPLICADO (carrera entre dos altas);
-- además FORBIDDEN, NOT_FOUND, ESTADO_INVALIDO y los de la composición.
-- ============================================================

create table if not exists public.alimentos_propios (
  id_alimento_propio  bigserial primary key,
  nombre              text not null check (btrim(nombre) <> ''),
  nombre_normalizado  text generated always as (public.norm_alimento(nombre)) stored,
  categoria           text,
  kcal_100g           numeric(10,2) not null check (kcal_100g between 0 and 900),
  proteinas_100g      numeric(10,2) not null check (proteinas_100g between 0 and 100),
  grasas_100g         numeric(10,2) not null check (grasas_100g between 0 and 100),
  carbs_100g          numeric(10,2) not null check (carbs_100g between 0 and 100),
  fuente_dato         text not null check (fuente_dato in ('etiqueta_producto', 'tabla_composicion', 'calculo_propio', 'estimacion_ia_revisada', 'otra')),
  justificacion       text not null check (length(btrim(justificacion)) >= 10),
  composicion         jsonb,
  id_pendiente_origen bigint references public.alimentos_pendientes_validacion(id_pendiente),
  creado_por          uuid references auth.users(id) on delete set null,
  creado_at           timestamptz not null default now(),
  estado              text not null default 'activo' check (estado in ('activo', 'retirado')),
  retirado_por        uuid references auth.users(id) on delete set null,
  retirado_at         timestamptz,
  motivo_retiro       text,
  check (nombre_normalizado is not null),
  check (proteinas_100g + grasas_100g + carbs_100g <= 105),
  check ((estado = 'retirado') = (retirado_at is not null))
);

-- Un solo propio ACTIVO por nombre normalizado (un retirado libera el nombre).
create unique index if not exists uq_alimentos_propios_nombre_activo
  on public.alimentos_propios (nombre_normalizado) where estado = 'activo';
create index if not exists idx_alimentos_propios_trgm
  on public.alimentos_propios using gin (nombre_normalizado extensions.gin_trgm_ops) where estado = 'activo';

alter table public.alimentos_propios enable row level security;
revoke all on public.alimentos_propios from anon, authenticated;
grant select on public.alimentos_propios to authenticated;
revoke all on sequence public.alimentos_propios_id_alimento_propio_seq from anon, authenticated;

drop policy if exists "alimentos_propios: investigador read" on public.alimentos_propios;
create policy "alimentos_propios: investigador read"
  on public.alimentos_propios for select to authenticated
  using ((select public.get_my_role()) in ('investigador', 'administrador'));

alter table public.alimentos_pendientes_validacion
  add column if not exists id_alimento_propio bigint references public.alimentos_propios(id_alimento_propio);

-- Acciones nuevas de auditoría.
alter table public.alimentos_pendientes_auditoria
  drop constraint if exists alimentos_pendientes_auditoria_accion_check;
alter table public.alimentos_pendientes_auditoria
  add constraint alimentos_pendientes_auditoria_accion_check
  check (accion in ('modificar', 'validar', 'descartar', 'crear_propio', 'retirar_propio'));

-- ------------------------------------------------------------
-- Verificación (única fuente de verdad de las reglas de §6.2 en el servidor)
-- ------------------------------------------------------------
create or replace function public.propio_verificar(
  p_nombre text,
  p_kcal numeric,
  p_prot numeric,
  p_grasas numeric,
  p_carbs numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_norm      text := public.norm_alimento(p_nombre);
  v_bloqueos  jsonb := '[]'::jsonb;
  v_adv       jsonb := '[]'::jsonb;
  v_ex        jsonb;
  v_sim       jsonb;
begin
  if coalesce(public.get_my_role() in ('investigador', 'administrador'), false) is false then
    raise exception 'FORBIDDEN';
  end if;

  if v_norm is null or btrim(coalesce(p_nombre, '')) = '' then
    v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'NOMBRE_VACIO');
  end if;

  if num_nulls(p_kcal, p_prot, p_grasas, p_carbs) > 0 or least(p_kcal, p_prot, p_grasas, p_carbs) < 0 then
    v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'VALORES_INVALIDOS');
  else
    if greatest(p_prot, p_grasas, p_carbs) > 100 then
      v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'MACRO_MAYOR_100');
    end if;
    if p_prot + p_grasas + p_carbs > 105 then
      v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'SUMA_MACROS');
    end if;
    if p_kcal > 900 then
      v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'KCAL_MAYOR_900');
    end if;
    if abs(p_kcal - (4 * p_prot + 4 * p_carbs + 9 * p_grasas)) > greatest(25, 0.35 * p_kcal) then
      v_adv := v_adv || jsonb_build_object('codigo', 'KCAL_INCOHERENTE');
    end if;
  end if;

  if v_norm is not null then
    -- Duplicado exacto (normalizado) con alimentos (SARA2/ANMAT) o con un propio activo.
    select jsonb_build_object('origen', 'catalogo', 'id', a.id_alimento, 'nombre', a.nombre, 'fuente', a.fuente)
    into v_ex
    from public.alimentos a
    where a.nombre_normalizado = v_norm
    order by a.fuente desc, a.id_alimento
    limit 1;
    if v_ex is null then
      select jsonb_build_object('origen', 'propio', 'id', p.id_alimento_propio, 'nombre', p.nombre, 'fuente', 'PROPIO')
      into v_ex
      from public.alimentos_propios p
      where p.estado = 'activo' and p.nombre_normalizado = v_norm
      limit 1;
    end if;
    if v_ex is not null then
      v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'DUPLICADO', 'existente', v_ex);
    else
      -- Parecidos (trigram >= 0,85) a SARA2 o a propios activos.
      select coalesce(jsonb_agg(x order by (x ->> 'similitud')::numeric desc), '[]'::jsonb)
      into v_sim
      from (
        select jsonb_build_object('origen', 'catalogo', 'id', a.id_alimento, 'nombre', a.nombre, 'fuente', a.fuente,
                 'similitud', round(extensions.similarity(a.nombre_normalizado, v_norm)::numeric, 2)) as x
        from public.alimentos a
        where a.fuente = 'SARA2' and extensions.similarity(a.nombre_normalizado, v_norm) >= 0.85
        union all
        select jsonb_build_object('origen', 'propio', 'id', p.id_alimento_propio, 'nombre', p.nombre, 'fuente', 'PROPIO',
                 'similitud', round(extensions.similarity(p.nombre_normalizado, v_norm)::numeric, 2))
        from public.alimentos_propios p
        where p.estado = 'activo' and extensions.similarity(p.nombre_normalizado, v_norm) >= 0.85
        limit 5
      ) s;
      if jsonb_array_length(v_sim) > 0 then
        v_adv := v_adv || jsonb_build_object('codigo', 'SIMILAR', 'similares', v_sim);
      end if;
    end if;
  end if;

  return jsonb_build_object('bloqueos', v_bloqueos, 'advertencias', v_adv);
end;
$$;

revoke all on function public.propio_verificar(text, numeric, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.propio_verificar(text, numeric, numeric, numeric, numeric) to authenticated;

-- ------------------------------------------------------------
-- Validar un pendiente "A mano" Y crear el propio, en una sola transacción.
-- ------------------------------------------------------------
create or replace function public.pendiente_validar_como_propio(
  p_id bigint,
  p_nombre text,
  p_categoria text,
  p_kcal numeric,
  p_prot numeric,
  p_grasas numeric,
  p_carbs numeric,
  p_observaciones text,
  p_propio jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fuente  text := p_propio ->> 'fuente_dato';
  v_just    text := btrim(coalesce(p_propio ->> 'justificacion', ''));
  v_conf    jsonb := p_propio -> 'confirmaciones';
  v_ver     jsonb;
  v_res     jsonb;
  v_id      bigint;
  v_cola    public.alimentos_pendientes_validacion%rowtype;
begin
  if coalesce(public.get_my_role() in ('investigador', 'administrador'), false) is false then
    raise exception 'FORBIDDEN';
  end if;
  if jsonb_typeof(p_propio) is distinct from 'object' then
    raise exception 'PROPIO_EVALUACION' using detail = 'fuente';
  end if;

  -- Evaluación breve: fuente + justificación + las tres confirmaciones.
  if v_fuente is null or v_fuente not in ('etiqueta_producto', 'tabla_composicion', 'calculo_propio', 'estimacion_ia_revisada', 'otra') then
    raise exception 'PROPIO_EVALUACION' using detail = 'fuente';
  end if;
  if length(v_just) < 10 then
    raise exception 'PROPIO_EVALUACION' using detail = 'justificacion';
  end if;
  if jsonb_typeof(v_conf) is distinct from 'object'
     or v_conf -> 'revise_fuente' is distinct from 'true'::jsonb
     or v_conf -> 'valores_por_100g' is distinct from 'true'::jsonb
     or v_conf -> 'busque_existente' is distinct from 'true'::jsonb then
    raise exception 'PROPIO_EVALUACION' using detail = 'confirmaciones';
  end if;

  -- Verificación de campos: bloqueos y advertencias sin confirmar frenan todo.
  v_ver := public.propio_verificar(p_nombre, p_kcal, p_prot, p_grasas, p_carbs);
  if jsonb_array_length(v_ver -> 'bloqueos') > 0 then
    raise exception 'PROPIO_BLOQUEADO' using detail = (v_ver -> 'bloqueos')::text;
  end if;
  if exists (select 1 from jsonb_array_elements(v_ver -> 'advertencias') a where a ->> 'codigo' = 'KCAL_INCOHERENTE')
     and p_propio -> 'confirma_incoherente' is distinct from 'true'::jsonb then
    raise exception 'PROPIO_ADVERTENCIA' using detail = 'KCAL_INCOHERENTE';
  end if;
  if exists (select 1 from jsonb_array_elements(v_ver -> 'advertencias') a where a ->> 'codigo' = 'SIMILAR')
     and p_propio -> 'confirma_distinto' is distinct from 'true'::jsonb then
    raise exception 'PROPIO_ADVERTENCIA' using detail = 'SIMILAR';
  end if;

  -- Validar el pendiente (Fase A): bloquea la fila, chequea el estado y re-apunta los ítems.
  v_res := public.pendiente_validar(
    p_id, p_nombre, p_categoria, p_kcal, p_prot, p_grasas, p_carbs, p_observaciones, null,
    jsonb_build_object('modo', 'manual', 'id_guardado_item', null, 'gramos_foto', null, 'componentes', '[]'::jsonb)
  );

  begin
    insert into public.alimentos_propios (
      nombre, categoria, kcal_100g, proteinas_100g, grasas_100g, carbs_100g,
      fuente_dato, justificacion, id_pendiente_origen, creado_por
    )
    values (
      btrim(p_nombre), nullif(btrim(p_categoria), ''), p_kcal, p_prot, p_grasas, p_carbs,
      v_fuente, v_just, p_id, auth.uid()
    )
    returning id_alimento_propio into v_id;
  exception when unique_violation then
    raise exception 'PROPIO_DUPLICADO';
  end;

  update public.alimentos_pendientes_validacion c
  set id_alimento_propio = v_id
  where c.id_pendiente = p_id
  returning * into v_cola;

  insert into public.alimentos_pendientes_auditoria (id_pendiente, accion, id_usuario, antes, despues, items_afectados)
  values (
    p_id, 'crear_propio', auth.uid(), to_jsonb(v_cola),
    jsonb_build_object(
      'propio', (select to_jsonb(p) - 'nombre_normalizado' from public.alimentos_propios p where p.id_alimento_propio = v_id),
      'evaluacion', jsonb_build_object(
        'fuente_dato', v_fuente,
        'justificacion', v_just,
        'confirmaciones', v_conf,
        'confirma_incoherente', coalesce(p_propio -> 'confirma_incoherente', 'false'::jsonb),
        'confirma_distinto', coalesce(p_propio -> 'confirma_distinto', 'false'::jsonb),
        'advertencias', v_ver -> 'advertencias'
      )
    ),
    (v_res ->> 'items_afectados')::integer
  );

  return jsonb_build_object('id_alimento_propio', v_id, 'items_afectados', (v_res ->> 'items_afectados')::integer);
end;
$$;

revoke all on function public.pendiente_validar_como_propio(bigint, text, text, numeric, numeric, numeric, numeric, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.pendiente_validar_como_propio(bigint, text, text, numeric, numeric, numeric, numeric, text, jsonb)
  to authenticated;

-- ------------------------------------------------------------
-- Retirar un propio (motivo obligatorio, auditado). No toca ítems ya validados.
-- ------------------------------------------------------------
create or replace function public.propio_retirar(p_id bigint, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes   public.alimentos_propios%rowtype;
  v_despues public.alimentos_propios%rowtype;
  v_motivo  text := btrim(coalesce(p_motivo, ''));
begin
  if coalesce(public.get_my_role() in ('investigador', 'administrador'), false) is false then
    raise exception 'FORBIDDEN';
  end if;
  if length(v_motivo) < 10 then
    raise exception 'PROPIO_EVALUACION' using detail = 'motivo';
  end if;

  select * into v_antes from public.alimentos_propios p where p.id_alimento_propio = p_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_antes.estado <> 'activo' then
    raise exception 'ESTADO_INVALIDO';
  end if;

  update public.alimentos_propios p
  set estado = 'retirado', retirado_por = auth.uid(), retirado_at = now(), motivo_retiro = v_motivo
  where p.id_alimento_propio = p_id
  returning * into v_despues;

  insert into public.alimentos_pendientes_auditoria (id_pendiente, accion, id_usuario, antes, despues, items_afectados)
  values (v_antes.id_pendiente_origen, 'retirar_propio', auth.uid(), to_jsonb(v_antes) - 'nombre_normalizado', to_jsonb(v_despues) - 'nombre_normalizado', 0);
end;
$$;

revoke all on function public.propio_retirar(bigint, text) from public, anon, authenticated;
grant execute on function public.propio_retirar(bigint, text) to authenticated;

-- ------------------------------------------------------------
-- calcular_composicion: los ingredientes pueden ser del catálogo ('catalogo', por
-- defecto) o propios ('propio'). Un propio nunca es "vínculo puro" (no hay entrada en
-- `alimentos` a la que apuntar): se usan sus valores exactos y el ítem guarda el snapshot.
-- ------------------------------------------------------------
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
  v_origen text;
  v_id     bigint;
  v_g      numeric;
  v_nombre text;
  v_fuente text;
  v_k100   numeric;
  v_p100   numeric;
  v_g100   numeric;
  v_c100   numeric;
  v_k      numeric := 0;
  v_p      numeric := 0;
  v_gr     numeric := 0;
  v_c      numeric := 0;
  v_out    jsonb := '[]'::jsonb;
  v_n      integer := 0;
  v_vinc   integer := null;
  v_ult_k  numeric; v_ult_p numeric; v_ult_g numeric; v_ult_c numeric;
begin
  if jsonb_typeof(p_composicion) is distinct from 'object'
     or p_composicion ->> 'modo' is distinct from 'catalogo'
     or jsonb_typeof(v_comps) is distinct from 'array'
     or jsonb_array_length(v_comps) not between 1 and 30 then
    raise exception 'COMPOSICION_INVALIDA' using detail = 'Estructura inválida.';
  end if;

  -- Foto de referencia: la primera ocurrencia de ESTE pendiente; su peso sale de la base.
  select gi.id_guardado_item, gi.grams
  into v_ref, v_peso
  from public.detecciones_guardados_items gi
  where gi.id_pendiente = p_id_pendiente
  order by gi.id_guardado_item
  limit 1;
  if not found or v_peso is null or v_peso <= 0 then
    raise exception 'COMPOSICION_INVALIDA' using detail = 'El alimento no tiene una foto con peso para tomar de referencia.';
  end if;

  for v_el in select e from jsonb_array_elements(v_comps) as t(e) loop
    if jsonb_typeof(v_el -> 'id') is distinct from 'number'
       or jsonb_typeof(v_el -> 'gramos') is distinct from 'number' then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Ingrediente mal formado.';
    end if;
    v_origen := coalesce(v_el ->> 'origen', 'catalogo');
    if v_origen not in ('catalogo', 'propio') then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Ingrediente mal formado.';
    end if;
    begin
      v_id := (v_el ->> 'id')::bigint;
    exception when others then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Ingrediente mal formado.';
    end;
    v_g := (v_el ->> 'gramos')::numeric;
    if v_g <= 0 or v_g > 1000 then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Los gramos de cada ingrediente deben ser mayores a 0 y hasta 1000.';
    end if;

    if v_origen = 'propio' then
      select p.nombre, 'PROPIO', p.kcal_100g, p.proteinas_100g, p.grasas_100g, p.carbs_100g
      into v_nombre, v_fuente, v_k100, v_p100, v_g100, v_c100
      from public.alimentos_propios p
      where p.id_alimento_propio = v_id and p.estado = 'activo';
    else
      select a.nombre, a.fuente, a.kcal_100g, a.proteinas_100g, a.grasas_100g, a.carbs_100g
      into v_nombre, v_fuente, v_k100, v_p100, v_g100, v_c100
      from public.alimentos a
      where a.id_alimento = v_id;
    end if;
    if not found then
      raise exception 'ALIMENTO_NO_ENCONTRADO' using detail = v_origen || ':' || v_id::text;
    end if;
    if num_nulls(v_k100, v_p100, v_g100, v_c100) > 0 then
      raise exception 'COMPOSICION_INVALIDA' using detail = v_nombre || ' no tiene datos nutricionales en el catálogo.';
    end if;

    v_k  := v_k  + v_k100 * v_g;
    v_p  := v_p  + v_p100 * v_g;
    v_gr := v_gr + v_g100 * v_g;
    v_c  := v_c  + v_c100 * v_g;
    v_n  := v_n + 1;
    v_ult_k := v_k100; v_ult_p := v_p100; v_ult_g := v_g100; v_ult_c := v_c100;
    v_out := v_out || jsonb_build_object(
      'origen', v_origen, 'id', v_id, 'nombre', v_nombre, 'fuente', v_fuente,
      'gramos', v_g, 'kcal_100g', v_k100, 'proteinas_100g', v_p100,
      'grasas_100g', v_g100, 'carbs_100g', v_c100);
    if v_n = 1 and v_origen = 'catalogo' and abs(v_g - v_peso) <= 0.5 then
      v_vinc := v_id::integer;
    end if;
  end loop;

  -- Un solo ingrediente que iguala el peso de la foto: los valores son exactamente los de esa entrada.
  if v_n = 1 and abs((v_out -> 0 ->> 'gramos')::numeric - v_peso) <= 0.5 then
    return query select v_ult_k, v_ult_p, v_ult_g, v_ult_c, v_vinc,
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

-- ------------------------------------------------------------
-- Vistas (se recrean: p.* se expande al crear la vista y hay columna nueva)
-- ------------------------------------------------------------
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
  p.id_alimento_propio,
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

-- Propios con cuántas veces se usaron como ingrediente de un alimento validado.
drop view if exists public.v_alimentos_propios;
create view public.v_alimentos_propios
with (security_invoker = true)
as
select
  ap.*,
  (
    select count(*)
    from public.alimentos_pendientes_validacion q
    where q.estado = 'validado'
      and q.composicion -> 'componentes' @> jsonb_build_array(jsonb_build_object('origen', 'propio', 'id', ap.id_alimento_propio))
  ) as usos_como_ingrediente
from public.alimentos_propios ap;

revoke all on public.v_alimentos_propios from anon, authenticated;
grant select on public.v_alimentos_propios to authenticated;
