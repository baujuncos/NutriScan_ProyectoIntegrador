-- ============================================================
-- Script para correr en el SQL Editor de Supabase (NUT-119).
--
-- Es exactamente la sección "013 (NUT-119)" ya agregada al final de
-- supabase/schema_consolidado.sql (que sigue siendo la fuente de verdad del
-- esquema completo) — este archivo separado es sólo para pegarlo y correrlo
-- de una sin tener que ubicar la sección en el archivo grande.
--
-- Requiere 001–012 aplicadas (alimentos, items, detecciones_* de 011,
-- public.get_my_role, public.handle_updated_at).
--
-- Es seguro re-ejecutar: todo usa IF NOT EXISTS / CREATE OR REPLACE /
-- DROP ... IF EXISTS / ON CONFLICT DO NOTHING. La primera corrida reescribe
-- public.alimentos (~39k filas) para la columna generada: correrla en un
-- momento de poco uso.
-- ============================================================

-- ============================================================
-- 013 (NUT-119) — Matching, macros, diario, foto y cola de validación
--
-- Spec: docs/superpowers/specs/2026-10-07-nut119-matching-macros-validacion-design.md
--
-- IMPORTANTE (reemplaza la regla de 011): 011 decía que las tablas
-- detecciones_* "NUNCA deben ser escritas por el mismo código que escribe en
-- ingestas/items". 013 la reemplaza explícitamente: ahora el guardado de una
-- detección y el diario se escriben JUNTOS, en una sola RPC transaccional
-- (registrar_guardado_deteccion), que es justamente el objetivo de NUT-119.
--
-- IMPORTANTE (rompe a propósito la nota de 008, D2 = sí): 008 decía "no se
-- modifica ni se inserta en public.alimentos (catálogo maestro)". Desde 013
-- los alimentos validados por investigadores se insertan en alimentos con
-- fuente = 'VALIDADO' e ids de alimentos_validados_seq (>= 2.000.000; ANMAT
-- ya usa 1.000.000 + id). Un re-seed que haga TRUNCATE de alimentos los
-- borraría y rompería las FKs de items.
--
-- Escritura de columnas "de sistema" (origen_macros, snapshot por 100 g,
-- id_guardado_item, columnas nuevas de detecciones_guardados_items): sólo
-- RPCs security definer y service role. Los roles authenticated/anon las
-- tienen bloqueadas por trigger (D14).
-- ============================================================

-- ------------------------------------------------------------
-- Extensiones y normalización
-- ------------------------------------------------------------

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Única fuente de verdad de la normalización de nombres de alimentos (la usan
-- la columna generada, el matching, la cola y el lookup; nunca reimplementar
-- en TS). El diccionario va calificado ('extensions.unaccent'::regdictionary):
-- es lo que permite declararla IMMUTABLE y usarla en una columna generada.
-- Si cambia, hay que recrear alimentos.nombre_normalizado (drop + add) y
-- re-normalizar la cola.
create or replace function public.norm_alimento(p text)
returns text
language sql immutable parallel safe strict
set search_path = ''
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          extensions.unaccent('extensions.unaccent'::regdictionary, lower(p)),
          '[^a-z0-9 ]+', ' ', 'g'
        ),
        ' +', ' ', 'g'
      )
    ),
    ''
  )
$$;

revoke all on function public.norm_alimento(text) from public, anon, authenticated;
grant execute on function public.norm_alimento(text) to authenticated, service_role;

-- ------------------------------------------------------------
-- alimentos (catálogo)
-- ------------------------------------------------------------

-- Reescribe la tabla (~39k filas) una sola vez; las re-ejecuciones no hacen nada.
alter table public.alimentos
  add column if not exists nombre_normalizado text
  generated always as (public.norm_alimento(nombre)) stored;

create index if not exists idx_alimentos_nombre_norm_trgm
  on public.alimentos using gin (nombre_normalizado extensions.gin_trgm_ops);
create index if not exists idx_alimentos_nombre_norm
  on public.alimentos (nombre_normalizado);

-- Ids de los alimentos VALIDADO (D2). Sólo la usan las RPCs definer.
create sequence if not exists public.alimentos_validados_seq start 2000000;
revoke all on sequence public.alimentos_validados_seq from public, anon, authenticated;

-- ------------------------------------------------------------
-- Cola de validación + auditoría
-- ------------------------------------------------------------

create table if not exists public.alimentos_pendientes_validacion (
  id_pendiente           bigserial primary key,
  nombre_original        text not null,                 -- primer nombre visto
  nombre_normalizado     text not null unique,          -- public.norm_alimento(nombre_original); clave de dedup
  categoria_ia           text,                          -- informativa, no mapea al catálogo
  gemini_kcal_100g       numeric(10,2) check (gemini_kcal_100g >= 0),
  gemini_proteinas_100g  numeric(10,2) check (gemini_proteinas_100g >= 0),
  gemini_grasas_100g     numeric(10,2) check (gemini_grasas_100g >= 0),
  gemini_carbs_100g      numeric(10,2) check (gemini_carbs_100g >= 0),
  gemini_modelo          text,
  gemini_prompt_version  text,
  nombre_final           text,
  categoria_final        text,
  final_kcal_100g        numeric(10,2) check (final_kcal_100g >= 0),
  final_proteinas_100g   numeric(10,2) check (final_proteinas_100g >= 0),
  final_grasas_100g      numeric(10,2) check (final_grasas_100g >= 0),
  final_carbs_100g       numeric(10,2) check (final_carbs_100g >= 0),
  id_alimento_vinculado  integer references public.alimentos(id_alimento),
  estado                 text not null default 'pendiente' check (estado in ('pendiente', 'validado', 'descartado')),
  observaciones          text,
  resuelto_por           uuid references auth.users(id) on delete set null,
  resuelto_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_pendientes_estado_fecha
  on public.alimentos_pendientes_validacion (estado, created_at desc);
create index if not exists idx_pendientes_alimento_vinculado
  on public.alimentos_pendientes_validacion (id_alimento_vinculado) where id_alimento_vinculado is not null;
create index if not exists idx_pendientes_resuelto_por
  on public.alimentos_pendientes_validacion (resuelto_por) where resuelto_por is not null;

-- Append-only: sólo la escriben las RPCs del investigador (Task 11).
create table if not exists public.alimentos_pendientes_auditoria (
  id_auditoria     bigserial primary key,
  id_pendiente     bigint not null references public.alimentos_pendientes_validacion(id_pendiente) on delete cascade,
  accion           text not null check (accion in ('modificar', 'validar', 'descartar')),
  id_usuario       uuid references auth.users(id) on delete set null,
  antes            jsonb not null,
  despues          jsonb not null,
  items_afectados  integer not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists idx_pendientes_auditoria_pendiente
  on public.alimentos_pendientes_auditoria (id_pendiente, created_at);
create index if not exists idx_pendientes_auditoria_usuario
  on public.alimentos_pendientes_auditoria (id_usuario) where id_usuario is not null;

-- Los valores de Gemini son de auditoría: una vez no-null no cambian. Pueden
-- llegar null y completarse en una ocurrencia posterior.
create or replace function public.pendientes_gemini_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.gemini_kcal_100g is not null and new.gemini_kcal_100g is distinct from old.gemini_kcal_100g)
     or (old.gemini_proteinas_100g is not null and new.gemini_proteinas_100g is distinct from old.gemini_proteinas_100g)
     or (old.gemini_grasas_100g is not null and new.gemini_grasas_100g is distinct from old.gemini_grasas_100g)
     or (old.gemini_carbs_100g is not null and new.gemini_carbs_100g is distinct from old.gemini_carbs_100g)
     or (old.gemini_modelo is not null and new.gemini_modelo is distinct from old.gemini_modelo)
     or (old.gemini_prompt_version is not null and new.gemini_prompt_version is distinct from old.gemini_prompt_version)
  then
    raise exception 'GEMINI_INMUTABLE'
      using detail = 'Los valores gemini_* de la cola no se modifican una vez cargados.';
  end if;
  return new;
end;
$$;

drop trigger if exists pendientes_gemini_inmutable on public.alimentos_pendientes_validacion;
create trigger pendientes_gemini_inmutable
  before update on public.alimentos_pendientes_validacion
  for each row execute function public.pendientes_gemini_inmutable();

drop trigger if exists pendientes_updated_at on public.alimentos_pendientes_validacion;
create trigger pendientes_updated_at
  before update on public.alimentos_pendientes_validacion
  for each row execute function public.handle_updated_at();

-- RLS: sólo lectura para investigador/administrador; deportistas no ven nada
-- (D9). Sin policies de escritura: escriben las RPCs definer y el service role.
alter table public.alimentos_pendientes_validacion enable row level security;
alter table public.alimentos_pendientes_auditoria enable row level security;

-- Supabase da ALL por default a anon/authenticated en tablas nuevas de public.
revoke all on public.alimentos_pendientes_validacion, public.alimentos_pendientes_auditoria from anon, authenticated;
grant select on public.alimentos_pendientes_validacion, public.alimentos_pendientes_auditoria to authenticated;

drop policy if exists "alimentos_pendientes_validacion: investigador read" on public.alimentos_pendientes_validacion;
create policy "alimentos_pendientes_validacion: investigador read"
  on public.alimentos_pendientes_validacion for select to authenticated
  using ((select public.get_my_role()) in ('investigador', 'administrador'));

drop policy if exists "alimentos_pendientes_auditoria: investigador read" on public.alimentos_pendientes_auditoria;
create policy "alimentos_pendientes_auditoria: investigador read"
  on public.alimentos_pendientes_auditoria for select to authenticated
  using ((select public.get_my_role()) in ('investigador', 'administrador'));

-- ------------------------------------------------------------
-- detecciones_ia / detecciones_guardados_items (columnas aditivas)
-- ------------------------------------------------------------

-- Path dentro del bucket detecciones-fotos ({user_id}/{uuid}.jpg).
-- imagen_url queda sin tocar.
alter table public.detecciones_ia
  add column if not exists imagen_path text;

-- Log inmutable: origen_macros es el estado AL GUARDAR; el estado vivo sale
-- de la cola vía id_pendiente (D11). kcal..carbs_g null = sin datos (no 0).
alter table public.detecciones_guardados_items
  add column if not exists id_alimento              integer,
  add column if not exists metodo_match             text,
  add column if not exists score_match              real,
  add column if not exists origen_macros            text,
  add column if not exists kcal_100g                numeric(10,2),
  add column if not exists proteinas_100g           numeric(10,2),
  add column if not exists grasas_100g              numeric(10,2),
  add column if not exists carbs_100g               numeric(10,2),
  add column if not exists kcal                     numeric(10,2),
  add column if not exists proteinas_g              numeric(10,2),
  add column if not exists grasas_g                 numeric(10,2),
  add column if not exists carbs_g                  numeric(10,2),
  add column if not exists modelo_nutricion         text,
  add column if not exists nutrition_prompt_version text,
  add column if not exists id_pendiente             bigint;

-- Constraints con drop + add para que la sección sea re-ejecutable.
alter table public.detecciones_guardados_items
  drop constraint if exists detecciones_guardados_items_id_alimento_fkey,
  drop constraint if exists detecciones_guardados_items_metodo_match_check,
  drop constraint if exists detecciones_guardados_items_origen_macros_check,
  drop constraint if exists detecciones_guardados_items_id_pendiente_fkey;

alter table public.detecciones_guardados_items
  add constraint detecciones_guardados_items_id_alimento_fkey
    foreign key (id_alimento) references public.alimentos(id_alimento),
  add constraint detecciones_guardados_items_metodo_match_check
    check (metodo_match in ('food_ref', 'exacto', 'trigram', 'gemini', 'cola', 'ninguno')),
  add constraint detecciones_guardados_items_origen_macros_check
    check (origen_macros in ('catalogo', 'estimado_ia', 'pendiente', 'validado', 'descartado', 'sin_datos')),
  add constraint detecciones_guardados_items_id_pendiente_fkey
    foreign key (id_pendiente) references public.alimentos_pendientes_validacion(id_pendiente) on delete set null;

create index if not exists idx_detecciones_guardados_items_alimento
  on public.detecciones_guardados_items (id_alimento) where id_alimento is not null;
-- "Ocurrencias" de una fila de cola = count(*) por id_pendiente.
create index if not exists idx_detecciones_guardados_items_pendiente
  on public.detecciones_guardados_items (id_pendiente) where id_pendiente is not null;

-- El dueño conserva INSERT (policy de 011) para no romper el /save actual,
-- pero no puede escribir las columnas nuevas: si pudiera, colgaría
-- ocurrencias falsas de cualquier fila de la cola vía id_pendiente.
create or replace function public.detecciones_guardados_items_proteger_origen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and num_nonnulls(
       new.id_alimento, new.metodo_match, new.score_match, new.origen_macros,
       new.kcal_100g, new.proteinas_100g, new.grasas_100g, new.carbs_100g,
       new.kcal, new.proteinas_g, new.grasas_g, new.carbs_g,
       new.modelo_nutricion, new.nutrition_prompt_version, new.id_pendiente
     ) > 0
  then
    raise exception 'COLUMNA_PROTEGIDA'
      using detail = 'Las columnas de matching/macros de detecciones_guardados_items sólo se escriben desde el servidor.';
  end if;
  return new;
end;
$$;

-- Sólo INSERT: la tabla no tiene UPDATE para usuarios (log inmutable).
drop trigger if exists detecciones_guardados_items_proteger_origen on public.detecciones_guardados_items;
create trigger detecciones_guardados_items_proteger_origen
  before insert on public.detecciones_guardados_items
  for each row execute function public.detecciones_guardados_items_proteger_origen();

-- ------------------------------------------------------------
-- items (diario) — D1 opción A: snapshot por 100 g + origen_macros
-- ------------------------------------------------------------

-- Snapshot sólo cuando no hay id_alimento ni id_alimento_barcode.
-- origen_macros null = legado (catálogo, barcode o manual anterior a 013).
alter table public.items
  add column if not exists kcal_100g        numeric(10,2),
  add column if not exists proteinas_100g   numeric(10,2),
  add column if not exists grasas_100g      numeric(10,2),
  add column if not exists carbs_100g       numeric(10,2),
  add column if not exists origen_macros    text,
  add column if not exists id_guardado_item bigint;

alter table public.items
  drop constraint if exists items_origen_macros_check,
  drop constraint if exists items_id_guardado_item_fkey;

alter table public.items
  add constraint items_origen_macros_check
    check (origen_macros in ('catalogo', 'estimado_ia', 'pendiente', 'validado', 'descartado', 'sin_datos')),
  add constraint items_id_guardado_item_fkey
    foreign key (id_guardado_item) references public.detecciones_guardados_items(id_guardado_item) on delete set null;

create index if not exists idx_items_guardado_item
  on public.items (id_guardado_item) where id_guardado_item is not null;

-- Reemplaza la versión de 010: las ramas barcode y catálogo quedan iguales;
-- la rama "sin id_alimento" (antes siempre 0) ahora usa el snapshot por 100 g,
-- salvo descartado/sin_datos (0). Un manual legado (snapshot null) sigue en 0.
create or replace function public.calculate_item_nutrients()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  kcal_100 numeric(10,2);
  prot_100 numeric(10,2);
  fat_100 numeric(10,2);
  carb_100 numeric(10,2);
begin
  if new.id_alimento_barcode is not null then
    select coalesce(kcal_100g, 0), coalesce(proteinas_100g, 0), coalesce(grasas_100g, 0), coalesce(carbs_100g, 0)
    into kcal_100, prot_100, fat_100, carb_100
    from public.alimentos_barcode
    where id_alimento_barcode = new.id_alimento_barcode;

    if not found then
      raise exception 'Alimento (barcode) no encontrado para id_alimento_barcode=%', new.id_alimento_barcode;
    end if;

    new.kcal = round((kcal_100 * new.cantidad) / 100, 2);
    new.proteinas_g = round((prot_100 * new.cantidad) / 100, 2);
    new.grasas_g = round((fat_100 * new.cantidad) / 100, 2);
    new.carbs_g = round((carb_100 * new.cantidad) / 100, 2);
    return new;
  end if;

  if new.id_alimento is null then
    if new.origen_macros in ('descartado', 'sin_datos') then
      new.kcal = 0;
      new.proteinas_g = 0;
      new.grasas_g = 0;
      new.carbs_g = 0;
      return new;
    end if;

    new.kcal = round((coalesce(new.kcal_100g, 0) * new.cantidad) / 100, 2);
    new.proteinas_g = round((coalesce(new.proteinas_100g, 0) * new.cantidad) / 100, 2);
    new.grasas_g = round((coalesce(new.grasas_100g, 0) * new.cantidad) / 100, 2);
    new.carbs_g = round((coalesce(new.carbs_100g, 0) * new.cantidad) / 100, 2);
    return new;
  end if;

  select coalesce(a.kcal_100g, 0), coalesce(a.proteinas_100g, 0), coalesce(a.grasas_100g, 0), coalesce(a.carbs_100g, 0)
  into kcal_100, prot_100, fat_100, carb_100
  from public.alimentos a
  where a.id_alimento = new.id_alimento;

  if not found then
    raise exception 'Alimento no encontrado para id_alimento=%', new.id_alimento;
  end if;

  new.kcal = round((kcal_100 * new.cantidad) / 100, 2);
  new.proteinas_g = round((prot_100 * new.cantidad) / 100, 2);
  new.grasas_g = round((fat_100 * new.cantidad) / 100, 2);
  new.carbs_g = round((carb_100 * new.cantidad) / 100, 2);
  return new;
end;
$$;

-- Lista "update of" ampliada: cambiar la cantidad recalcula sobre el snapshot
-- y validar/descartar (UPDATE de snapshot/origen) recalcula solo.
drop trigger if exists items_calculate_nutrients on public.items;
create trigger items_calculate_nutrients
  before insert or update of id_alimento, id_alimento_barcode, cantidad,
    kcal_100g, proteinas_100g, grasas_100g, carbs_100g, origen_macros
  on public.items
  for each row execute function public.calculate_item_nutrients();

-- Guard (D14): por PostgREST (roles authenticated/anon) no se puede insertar
-- ni cambiar origen_macros, el snapshot ni id_guardado_item. Dentro de una RPC
-- security definer current_user es el dueño de la función, y el service role
-- es 'service_role', así que esos caminos pasan. El diario manual/catálogo/
-- barcode no toca estas columnas (llegan null), así que sigue funcionando.
create or replace function public.items_proteger_origen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if num_nonnulls(new.origen_macros, new.kcal_100g, new.proteinas_100g,
                    new.grasas_100g, new.carbs_100g, new.id_guardado_item) > 0 then
      raise exception 'COLUMNA_PROTEGIDA'
        using detail = 'origen_macros, snapshot por 100 g e id_guardado_item sólo se escriben desde el servidor.';
    end if;
  elsif (new.origen_macros, new.kcal_100g, new.proteinas_100g, new.grasas_100g, new.carbs_100g, new.id_guardado_item)
        is distinct from
        (old.origen_macros, old.kcal_100g, old.proteinas_100g, old.grasas_100g, old.carbs_100g, old.id_guardado_item) then
    raise exception 'COLUMNA_PROTEGIDA'
      using detail = 'origen_macros, snapshot por 100 g e id_guardado_item sólo se escriben desde el servidor.';
  end if;

  return new;
end;
$$;

drop trigger if exists items_proteger_origen on public.items;
create trigger items_proteger_origen
  before insert or update on public.items
  for each row execute function public.items_proteger_origen();

-- ------------------------------------------------------------
-- Vista para la pantalla /validacion
-- ------------------------------------------------------------

-- security_invoker: aplican las RLS de las tablas base del que consulta (un
-- deportista ve 0 filas). Escala esperada: cientos de filas, el count
-- correlacionado alcanza.
create or replace view public.v_alimentos_pendientes
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

-- ------------------------------------------------------------
-- Storage: fotos de detección (bucket privado)
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('detecciones-fotos', 'detecciones-fotos', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

-- Sin UPDATE/DELETE para usuarios: el borrado usa el cliente admin.
drop policy if exists "detecciones-fotos: own insert" on storage.objects;
drop policy if exists "detecciones-fotos: own read" on storage.objects;
drop policy if exists "detecciones-fotos: investigador read" on storage.objects;

create policy "detecciones-fotos: own insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'detecciones-fotos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "detecciones-fotos: own read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'detecciones-fotos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "detecciones-fotos: investigador read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'detecciones-fotos'
    and (select public.get_my_role()) in ('investigador', 'administrador')
  );

-- ------------------------------------------------------------
-- cola_lookup: ¿hace falta llamar a Gemini para estos nombres? (sólo service role)
-- ------------------------------------------------------------

-- Una fila por nombre, en el orden de entrada (idx 1-based).
-- necesita_ia = no hay fila en la cola, o está pendiente sin valores de Gemini.
create or replace function public.cola_lookup(p_nombres text[])
returns table (idx int, nombre_normalizado text, id_pendiente bigint, estado text, necesita_ia boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    q.idx::int,
    n.nn,
    c.id_pendiente,
    c.estado,
    c.id_pendiente is null
      or (c.estado = 'pendiente'
          and num_nulls(c.gemini_kcal_100g, c.gemini_proteinas_100g, c.gemini_grasas_100g, c.gemini_carbs_100g) > 0)
  from unnest(p_nombres) with ordinality as q(nombre, idx)
  cross join lateral (select public.norm_alimento(q.nombre) as nn) n
  left join public.alimentos_pendientes_validacion c on c.nombre_normalizado = n.nn
  order by q.idx
$$;

revoke all on function public.cola_lookup(text[]) from public, anon, authenticated;
grant execute on function public.cola_lookup(text[]) to service_role;

-- ------------------------------------------------------------
-- registrar_guardado_deteccion: RPC de commit de /save (sólo service role, D5)
-- ------------------------------------------------------------
--
-- Node autentica al usuario, hace matching + Gemini (fuera de la transacción)
-- y llama a esta RPC con el cliente admin. Si fuera invocable por el usuario,
-- un deportista podría inyectar "valores de Gemini" en la cola compartida.
--
-- p_items: array jsonb, un objeto por FinalItem (claves snake_case):
--   source_item_uuid  uuid | null
--   name, category    text
--   grams             numeric (> 0, gramaje FINAL)
--   ai_grams          numeric | null
--   origin            'ai' | 'answered' | 'replaced' | 'added_manually'
--   answers           jsonb (array)
--   food_ref          text | null
--   id_alimento       int | null    (food_ref o match del catálogo)
--   metodo_match      'food_ref' | 'exacto' | 'trigram' | 'gemini' | 'cola' | 'ninguno'
--   score_match       real | null
--   ia                { kcal_100g, proteinas_100g, grasas_100g, carbs_100g } | null
--
-- Errores (message): NOT_FOUND, ALREADY_SAVED, INVALID, FOOD_REF_INVALIDO
-- (detail = id). Devuelve { id_guardado, items_registrados, sin_datos }.
create or replace function public.registrar_guardado_deteccion(
  p_user_id uuid,
  p_id_deteccion bigint,
  p_fecha date,
  p_tipo text,
  p_removed uuid[],
  p_items jsonb,
  p_modelo_nutricion text,
  p_nutrition_prompt_version text
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

  return jsonb_build_object(
    'id_guardado', v_id_guardado,
    'items_registrados', v_registrados,
    'sin_datos', v_sin_datos
  );
end;
$$;

revoke all on function public.registrar_guardado_deteccion(uuid, bigint, date, text, uuid[], jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.registrar_guardado_deteccion(uuid, bigint, date, text, uuid[], jsonb, text, text)
  to service_role;
