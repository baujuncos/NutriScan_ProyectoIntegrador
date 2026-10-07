-- ============================================================
-- NutriScan MVP - Esquema consolidado de base de datos
-- Unifica, en orden cronológico, todos los scripts SQL del proyecto
-- (supabase/migrations/*.sql + supabase/*.sql sueltos)
-- ============================================================


-- ============================================================
-- 001 — Esquema inicial (perfiles, datos físicos/académicos, encuesta psicológica)
-- ============================================================

create extension if not exists "uuid-ossp";

create table if not exists public.profiles (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  nombre      text not null,
  apellido    text not null,
  email       text not null,
  role        text not null check (role in ('investigador', 'deportista_ucc', 'particular', 'administrador')),
  physical_completed     boolean not null default false,
  academic_completed     boolean not null default false,
  psychological_completed boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.physical_data (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null unique references auth.users(id) on delete cascade,
  peso_kg         numeric(5,2) not null,
  altura_cm       numeric(5,1) not null,
  fecha_nacimiento date not null,
  sexo            char(1) not null check (sexo in ('M', 'F')),
  factor_actividad numeric(5,3) not null check (factor_actividad in (1.2, 1.375, 1.55, 1.725)),
  tmb             integer not null,
  get_kcal        integer not null,
  proteinas_g     integer not null,
  carbohidratos_g integer not null,
  grasas_g        integer not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.academic_data (
  id                           uuid primary key default uuid_generate_v4(),
  user_id                      uuid not null unique references auth.users(id) on delete cascade,
  carrera                      text not null,
  anio                         smallint not null check (anio between 1 and 6),
  deporte                      text not null check (deporte in ('hockey', 'basquet')),
  posicion                     text not null,
  frecuencia_practicas_semana  smallint not null check (frecuencia_practicas_semana between 1 and 7),
  horas_practica               numeric(4,1) not null,
  frecuencia_competencias      text not null,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

create table if not exists public.psychological_surveys (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null unique references auth.users(id) on delete cascade,
  respuestas   smallint[] not null,
  completed_at timestamptz not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_profiles_user_id on public.profiles(user_id);
create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_physical_data_user_id on public.physical_data(user_id);
create index if not exists idx_academic_data_user_id on public.academic_data(user_id);
create index if not exists idx_psychological_surveys_user_id on public.psychological_surveys(user_id);

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

create trigger physical_data_updated_at
  before update on public.physical_data
  for each row execute function public.handle_updated_at();

create trigger academic_data_updated_at
  before update on public.academic_data
  for each row execute function public.handle_updated_at();

alter table public.profiles enable row level security;
alter table public.physical_data enable row level security;
alter table public.academic_data enable row level security;
alter table public.psychological_surveys enable row level security;

create or replace function public.get_my_role()
returns text as $$
  select role from public.profiles where user_id = auth.uid() limit 1;
$$ language sql security definer stable;

-- RLS: profiles
create policy "profiles: own read"
  on public.profiles for select
  using (user_id = auth.uid());

create policy "profiles: investigador read all"
  on public.profiles for select
  using (public.get_my_role() in ('investigador', 'administrador'));

create policy "profiles: own insert"
  on public.profiles for insert
  with check (user_id = auth.uid());

create policy "profiles: own update"
  on public.profiles for update
  using (user_id = auth.uid());

-- RLS: physical_data
create policy "physical_data: own read"
  on public.physical_data for select
  using (user_id = auth.uid());

create policy "physical_data: investigador read all"
  on public.physical_data for select
  using (public.get_my_role() in ('investigador', 'administrador'));

create policy "physical_data: own insert"
  on public.physical_data for insert
  with check (user_id = auth.uid());

create policy "physical_data: own update"
  on public.physical_data for update
  using (user_id = auth.uid());

-- RLS: academic_data
create policy "academic_data: own read"
  on public.academic_data for select
  using (user_id = auth.uid());

create policy "academic_data: investigador read all"
  on public.academic_data for select
  using (public.get_my_role() in ('investigador', 'administrador'));

create policy "academic_data: own insert"
  on public.academic_data for insert
  with check (user_id = auth.uid());

create policy "academic_data: own update"
  on public.academic_data for update
  using (user_id = auth.uid());

-- RLS: psychological_surveys
create policy "psychological_surveys: own read"
  on public.psychological_surveys for select
  using (user_id = auth.uid());

create policy "psychological_surveys: investigador read all"
  on public.psychological_surveys for select
  using (public.get_my_role() in ('investigador', 'administrador'));

create policy "psychological_surveys: own insert"
  on public.psychological_surveys for insert
  with check (user_id = auth.uid());

create policy "psychological_surveys: own update"
  on public.psychological_surveys for update
  using (user_id = auth.uid());


-- ============================================================
-- 002 (supabase/002_newtablepolicies_sofi) — Permisos y políticas "dueño" amplias
-- ============================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.physical_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.psychological_surveys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir todo a dueños profiles" ON public.profiles
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Permitir todo a dueños physical" ON public.physical_data
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Permitir todo a dueños academic" ON public.academic_data
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Permitir todo a dueños psychological_surveys" ON public.psychological_surveys
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ============================================================
-- 003 (supabase/003_add_unidad_academica) — Columna unidad_academica
-- ============================================================

ALTER TABLE public.academic_data
  ADD COLUMN IF NOT EXISTS unidad_academica text;


-- ============================================================
-- 002 (migrations/002_nutrition_tracking) — Registro de comidas (alimentos/ingestas/items)
-- ============================================================

create table if not exists public.alimentos (
  id_alimento      integer primary key,
  nombre           text not null,
  categoria        text,
  kcal_100g        numeric(10,2),
  proteinas_100g   numeric(10,2),
  grasas_100g      numeric(10,2),
  carbs_100g       numeric(10,2),
  created_at       timestamptz not null default now()
);

create table if not exists public.ingestas (
  id_ingesta           bigserial primary key,
  id_usuario           uuid not null references auth.users(id) on delete cascade,
  tipo                 text not null check (tipo in ('desayuno', 'almuerzo', 'merienda', 'cena', 'colacion', 'suplemento')),
  fecha                date not null,
  kcal_total           numeric(10,2) not null default 0,
  proteinas_total_g    numeric(10,2) not null default 0,
  grasas_total_g       numeric(10,2) not null default 0,
  carbs_total_g        numeric(10,2) not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id_usuario, fecha, tipo)
);

create table if not exists public.items (
  id_item          bigserial primary key,
  id_ingesta       bigint not null references public.ingestas(id_ingesta) on delete cascade,
  id_alimento      integer not null references public.alimentos(id_alimento),
  tipo_item        text not null check (tipo_item in ('solido', 'liquido', 'en polvo')),
  cantidad         numeric(10,2) not null check (cantidad > 0),
  kcal             numeric(10,2) not null default 0,
  proteinas_g      numeric(10,2) not null default 0,
  grasas_g         numeric(10,2) not null default 0,
  carbs_g          numeric(10,2) not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_alimentos_nombre on public.alimentos(nombre);
create index if not exists idx_ingestas_usuario_fecha on public.ingestas(id_usuario, fecha);
create index if not exists idx_items_ingesta on public.items(id_ingesta);
create index if not exists idx_items_alimento on public.items(id_alimento);

create trigger ingestas_updated_at
  before update on public.ingestas
  for each row execute function public.handle_updated_at();

create trigger items_updated_at
  before update on public.items
  for each row execute function public.handle_updated_at();

create or replace function public.calculate_item_nutrients()
returns trigger as $$
declare
  kcal_100 numeric(10,2);
  prot_100 numeric(10,2);
  fat_100 numeric(10,2);
  carb_100 numeric(10,2);
begin
  select
    coalesce(a.kcal_100g, 0),
    coalesce(a.proteinas_100g, 0),
    coalesce(a.grasas_100g, 0),
    coalesce(a.carbs_100g, 0)
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
$$ language plpgsql;

drop trigger if exists items_calculate_nutrients on public.items;
create trigger items_calculate_nutrients
  before insert or update of id_alimento, cantidad
  on public.items
  for each row execute function public.calculate_item_nutrients();

create or replace function public.recalculate_ingesta_totals()
returns trigger as $$
declare
  target_ingesta_id bigint;
begin
  target_ingesta_id = coalesce(new.id_ingesta, old.id_ingesta);

  update public.ingestas i
  set
    kcal_total = coalesce(
      (select round(sum(coalesce(it.kcal, 0)), 2) from public.items it where it.id_ingesta = target_ingesta_id),
      0
    ),
    proteinas_total_g = coalesce(
      (select round(sum(coalesce(it.proteinas_g, 0)), 2) from public.items it where it.id_ingesta = target_ingesta_id),
      0
    ),
    grasas_total_g = coalesce(
      (select round(sum(coalesce(it.grasas_g, 0)), 2) from public.items it where it.id_ingesta = target_ingesta_id),
      0
    ),
    carbs_total_g = coalesce(
      (select round(sum(coalesce(it.carbs_g, 0)), 2) from public.items it where it.id_ingesta = target_ingesta_id),
      0
    )
  where i.id_ingesta = target_ingesta_id;

  return null;
end;
$$ language plpgsql;

drop trigger if exists items_recalculate_ingesta_totals on public.items;
create trigger items_recalculate_ingesta_totals
  after insert or update or delete on public.items
  for each row execute function public.recalculate_ingesta_totals();

alter table public.alimentos enable row level security;
alter table public.ingestas enable row level security;
alter table public.items enable row level security;

create policy "alimentos: authenticated read"
  on public.alimentos for select
  to authenticated
  using (true);

create policy "ingestas: own read"
  on public.ingestas for select
  using (id_usuario = auth.uid());

create policy "ingestas: own insert"
  on public.ingestas for insert
  with check (id_usuario = auth.uid());

create policy "ingestas: own update"
  on public.ingestas for update
  using (id_usuario = auth.uid())
  with check (id_usuario = auth.uid());

create policy "ingestas: own delete"
  on public.ingestas for delete
  using (id_usuario = auth.uid());

create policy "items: own read"
  on public.items for select
  using (
    exists (
      select 1
      from public.ingestas i
      where i.id_ingesta = items.id_ingesta
      and i.id_usuario = auth.uid()
    )
  );

create policy "items: own insert"
  on public.items for insert
  with check (
    exists (
      select 1
      from public.ingestas i
      where i.id_ingesta = items.id_ingesta
      and i.id_usuario = auth.uid()
    )
  );

create policy "items: own update"
  on public.items for update
  using (
    exists (
      select 1
      from public.ingestas i
      where i.id_ingesta = items.id_ingesta
      and i.id_usuario = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.ingestas i
      where i.id_ingesta = items.id_ingesta
      and i.id_usuario = auth.uid()
    )
  );

create policy "items: own delete"
  on public.items for delete
  using (
    exists (
      select 1
      from public.ingestas i
      where i.id_ingesta = items.id_ingesta
      and i.id_usuario = auth.uid()
    )
  );


-- ============================================================
-- 004 (supabase/004_reminders_policy) — Lectura pública de profiles para recordatorios
-- ============================================================

create policy "public read for reminders"
  on public.profiles for select
  to anon
  using (true);


-- ============================================================
-- 003 (migrations/003_hidratacion) — Registro de hidratación
-- ============================================================

create table if not exists public.hidratacion (
  id          bigserial primary key,
  id_usuario  uuid not null references auth.users(id) on delete cascade,
  fecha       date not null,
  ml_total    integer not null default 0 check (ml_total >= 0),
  updated_at  timestamptz not null default now(),
  unique (id_usuario, fecha)
);

create index if not exists idx_hidratacion_usuario_fecha on public.hidratacion(id_usuario, fecha);

alter table public.hidratacion enable row level security;

create policy "hidratacion: own read"
  on public.hidratacion for select
  using (id_usuario = auth.uid());

create policy "hidratacion: own insert"
  on public.hidratacion for insert
  with check (id_usuario = auth.uid());

create policy "hidratacion: own update"
  on public.hidratacion for update
  using (id_usuario = auth.uid())
  with check (id_usuario = auth.uid());


-- ============================================================
-- 004 (migrations/004_investigador_rls) — Lectura total para investigadores
-- ============================================================

create policy "ingestas: investigador read all"
  on public.ingestas for select
  using (public.get_my_role() in ('investigador', 'administrador'));

create policy "hidratacion: investigador read all"
  on public.hidratacion for select
  using (public.get_my_role() in ('investigador', 'administrador'));


-- ============================================================
-- 005 (migrations/005_fecha_nacimiento_check) — Validación de fecha de nacimiento (JOT-107)
-- ============================================================

alter table public.physical_data
  drop constraint if exists physical_data_fecha_nacimiento_check;

alter table public.physical_data
  add constraint physical_data_fecha_nacimiento_check
  check (
    fecha_nacimiento <= current_date
    and fecha_nacimiento >= current_date - interval '100 years'
  );


-- ============================================================
-- 006 (migrations/006_rls_new_tables) — Permisos y políticas para hidratación/ingestas/items + alimentos
-- ============================================================

create policy "items: investigador read all"
  on public.items for select
  using (public.get_my_role() in ('investigador', 'administrador'));

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hidratacion TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingestas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.items TO authenticated;

ALTER TABLE public.hidratacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

-- HIDRATACION
DROP POLICY IF EXISTS "hidratacion: own read" ON public.hidratacion;
DROP POLICY IF EXISTS "hidratacion: own insert" ON public.hidratacion;
DROP POLICY IF EXISTS "hidratacion: own update" ON public.hidratacion;
DROP POLICY IF EXISTS "hidratacion: investigador read all" ON public.hidratacion;

CREATE POLICY "hidratacion: own read"
  ON public.hidratacion
  FOR SELECT
  TO authenticated
  USING (id_usuario = auth.uid());

CREATE POLICY "hidratacion: own insert"
  ON public.hidratacion
  FOR INSERT
  TO authenticated
  WITH CHECK (id_usuario = auth.uid());

CREATE POLICY "hidratacion: own update"
  ON public.hidratacion
  FOR UPDATE
  TO authenticated
  USING (id_usuario = auth.uid())
  WITH CHECK (id_usuario = auth.uid());

CREATE POLICY "hidratacion: investigador read all"
  ON public.hidratacion
  FOR SELECT
  TO authenticated
  USING (public.get_my_role() IN ('investigador', 'administrador'));

-- INGESTAS
DROP POLICY IF EXISTS "ingestas: own read" ON public.ingestas;
DROP POLICY IF EXISTS "ingestas: own insert" ON public.ingestas;
DROP POLICY IF EXISTS "ingestas: own update" ON public.ingestas;
DROP POLICY IF EXISTS "ingestas: own delete" ON public.ingestas;
DROP POLICY IF EXISTS "ingestas: investigador read all" ON public.ingestas;

CREATE POLICY "ingestas: own read"
  ON public.ingestas
  FOR SELECT
  TO authenticated
  USING (id_usuario = auth.uid());

CREATE POLICY "ingestas: own insert"
  ON public.ingestas
  FOR INSERT
  TO authenticated
  WITH CHECK (id_usuario = auth.uid());

CREATE POLICY "ingestas: own update"
  ON public.ingestas
  FOR UPDATE
  TO authenticated
  USING (id_usuario = auth.uid())
  WITH CHECK (id_usuario = auth.uid());

CREATE POLICY "ingestas: own delete"
  ON public.ingestas
  FOR DELETE
  TO authenticated
  USING (id_usuario = auth.uid());

CREATE POLICY "ingestas: investigador read all"
  ON public.ingestas
  FOR SELECT
  TO authenticated
  USING (public.get_my_role() IN ('investigador', 'administrador'));

-- ITEMS
DROP POLICY IF EXISTS "items: own read" ON public.items;
DROP POLICY IF EXISTS "items: own insert" ON public.items;
DROP POLICY IF EXISTS "items: own update" ON public.items;
DROP POLICY IF EXISTS "items: own delete" ON public.items;

CREATE POLICY "items: own read"
  ON public.items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.ingestas i
      WHERE i.id_ingesta = items.id_ingesta
        AND i.id_usuario = auth.uid()
    )
  );

CREATE POLICY "items: own insert"
  ON public.items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.ingestas i
      WHERE i.id_ingesta = items.id_ingesta
        AND i.id_usuario = auth.uid()
    )
  );

CREATE POLICY "items: own update"
  ON public.items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.ingestas i
      WHERE i.id_ingesta = items.id_ingesta
        AND i.id_usuario = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.ingestas i
      WHERE i.id_ingesta = items.id_ingesta
        AND i.id_usuario = auth.uid()
    )
  );

CREATE POLICY "items: own delete"
  ON public.items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.ingestas i
      WHERE i.id_ingesta = items.id_ingesta
        AND i.id_usuario = auth.uid()
    )
  );

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT ON public.alimentos TO anon, authenticated;

ALTER TABLE public.alimentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alimentos: public read" ON public.alimentos;

CREATE POLICY "alimentos: public read"
  ON public.alimentos
  FOR SELECT
  TO anon, authenticated
  USING (true);


-- ============================================================
-- 007 (migrations/007_fix_anio_constraint) — Año de ingreso a la facultad (1990–2100)
-- ============================================================

ALTER TABLE public.academic_data
  DROP CONSTRAINT IF EXISTS academic_data_anio_check;

ALTER TABLE public.academic_data
  ADD CONSTRAINT academic_data_anio_check
  CHECK (anio BETWEEN 1990 AND 2100) NOT VALID;


-- ============================================================
-- 008 (manual food entry) — Carga manual de alimentos que no están en el catálogo SARA2
-- No se modifica ni se inserta en public.alimentos (catálogo maestro).
-- ============================================================

ALTER TABLE public.items
  ALTER COLUMN id_alimento DROP NOT NULL;

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS nombre_manual text;

ALTER TABLE public.items
  ADD CONSTRAINT items_alimento_or_manual_check
  CHECK (id_alimento IS NOT NULL OR nombre_manual IS NOT NULL) NOT VALID;

-- ============================================================
-- 009 — Integración ANMAT: fuente, marca, denominacion en alimentos
-- ============================================================

ALTER TABLE public.alimentos
  ADD COLUMN IF NOT EXISTS fuente TEXT NOT NULL DEFAULT 'SARA2',
  ADD COLUMN IF NOT EXISTS marca TEXT,
  ADD COLUMN IF NOT EXISTS denominacion TEXT;

-- ponytail: btree only; add GIN+pg_trgm if ilike at 40k rows becomes slow
CREATE INDEX IF NOT EXISTS idx_alimentos_fuente ON public.alimentos(fuente);

GRANT SELECT ON public.alimentos TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.calculate_item_nutrients()
RETURNS TRIGGER AS $$
DECLARE
  kcal_100 numeric(10,2);
  prot_100 numeric(10,2);
  fat_100 numeric(10,2);
  carb_100 numeric(10,2);
BEGIN
  IF new.id_alimento IS NULL THEN
    new.kcal = 0;
    new.proteinas_g = 0;
    new.grasas_g = 0;
    new.carbs_g = 0;
    RETURN new;
  END IF;

  SELECT
    coalesce(a.kcal_100g, 0),
    coalesce(a.proteinas_100g, 0),
    coalesce(a.grasas_100g, 0),
    coalesce(a.carbs_100g, 0)
  INTO kcal_100, prot_100, fat_100, carb_100
  FROM public.alimentos a
  WHERE a.id_alimento = new.id_alimento;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alimento no encontrado para id_alimento=%', new.id_alimento;
  END IF;

  new.kcal = round((kcal_100 * new.cantidad) / 100, 2);
  new.proteinas_g = round((prot_100 * new.cantidad) / 100, 2);
  new.grasas_g = round((fat_100 * new.cantidad) / 100, 2);
  new.carbs_g = round((carb_100 * new.cantidad) / 100, 2);

  RETURN new;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 010 — Escaneo de código de barras (Open Food Facts)
-- ============================================================

create table if not exists public.alimentos_barcode (
  id_alimento_barcode bigserial primary key,
  codigo_ean       text not null unique check (codigo_ean ~ '^[0-9]{13}$'),
  nombre           text not null,
  categoria        text,
  marca            text,
  porcion          numeric(10,2) not null default 100,
  kcal_100g        numeric(10,2),
  proteinas_100g   numeric(10,2),
  grasas_100g      numeric(10,2),
  carbs_100g       numeric(10,2),
  imagen_url       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger alimentos_barcode_updated_at
  before update on public.alimentos_barcode
  for each row execute function public.handle_updated_at();

alter table public.items
  add column if not exists id_alimento_barcode bigint references public.alimentos_barcode(id_alimento_barcode);

create index if not exists idx_items_alimento_barcode on public.items(id_alimento_barcode);

alter table public.items
  drop constraint if exists items_alimento_or_manual_check;

alter table public.items
  add constraint items_alimento_or_manual_check
  check (
    num_nonnulls(id_alimento, nombre_manual, id_alimento_barcode) >= 1
    and num_nonnulls(id_alimento, id_alimento_barcode) <= 1
  ) not valid;

alter table public.alimentos_barcode enable row level security;

create policy "alimentos_barcode: read"
  on public.alimentos_barcode for select
  using (true);

-- Sin políticas de insert/update para 'authenticated': el catálogo se
-- autoalimenta solo a través de addScannedItemAction, que usa el cliente
-- admin (service role) del lado del servidor después de re-consultar Open
-- Food Facts. Una policy "with check (true)" para insert/update dejaría que
-- cualquier usuario autenticado reescriba nombre/macros de cualquier
-- producto llamando a PostgREST directamente con la anon key, sin pasar
-- por el server action ni por OFF — el service role bypassea RLS a
-- propósito para ser el único camino de escritura.

create or replace function public.calculate_item_nutrients()
returns trigger as $$
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
    new.kcal = 0;
    new.proteinas_g = 0;
    new.grasas_g = 0;
    new.carbs_g = 0;
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
$$ language plpgsql;

drop trigger if exists items_calculate_nutrients on public.items;
create trigger items_calculate_nutrients
  before insert or update of id_alimento, id_alimento_barcode, cantidad
  on public.items
  for each row execute function public.calculate_item_nutrients();


-- 011 (NUT-166/NUT-172) — Predicciones de detección por IA (una por foto,
-- sin refinamiento multi-turno) y guardados/correcciones del usuario.
--
-- IMPORTANTE: estas tablas NUNCA deben ser escritas por el mismo código que
-- escribe en `ingestas`/`items` (el diario real). El puente hacia el diario
-- real es un TODO explícito (ver registrarEnDiario en
-- src/app/api/food-recognition/save/route.ts) hasta que exista matching de
-- alimentos + cálculo de macros.
--
-- `imagen_url` queda NULLABLE y sin poblar por decisión de producto (fotos
-- de participantes de investigación, sensibles) — es un add-on fácil si se
-- decide lo contrario más adelante, no un rediseño.
--
-- Políticas RLS: sólo SELECT + INSERT (sin UPDATE/DELETE) — son tablas tipo
-- "log de eventos", nunca se edita una predicción o un guardado después de
-- creado. Decisión de producto confirmada, no un descuido respecto a la
-- plantilla de RLS del resto del esquema.
-- ============================================================

create table if not exists public.detecciones_ia (
  id_deteccion                bigserial primary key,
  id_usuario                  uuid not null references auth.users(id) on delete cascade,
  prompt_version              text not null,
  modelo                      text not null,
  vajilla_tipo                text not null check (vajilla_tipo in ('plato_playo', 'plato_postre', 'plato_hondo')),
  vajilla_diametro_cm         numeric(10,2) not null,
  angulo_captura_grados       integer not null,
  angulo_aproximado           boolean not null default false,
  -- Encuadre (zoom/pan) manual del usuario antes de enviar la foto a Gemini.
  -- NULLABLE: el endpoint todavía no manda estos valores (ver nota en el
  -- plan de sesión 1 — es un cambio chico y opcional, no bloqueante).
  encuadre_zoom                numeric(4,2),
  encuadre_pan_x               integer,
  encuadre_pan_y               integer,
  imagen_url                   text,
  total_estimated_weight_grams numeric(10,2) not null,
  created_at                   timestamptz not null default now()
);

create table if not exists public.detecciones_ia_items (
  id_deteccion_item     bigserial primary key,
  id_deteccion          bigint not null references public.detecciones_ia(id_deteccion) on delete cascade,
  item_uuid             uuid not null unique,
  ingredient            text not null,
  tipo                  text not null,
  confidence            numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  estimated_weight_grams numeric(10,2) not null,
  questions             jsonb not null default '[]'::jsonb,
  bbox_x                numeric(5,4),
  bbox_y                numeric(5,4),
  bbox_width            numeric(5,4),
  bbox_height           numeric(5,4),
  created_at            timestamptz not null default now()
);

create table if not exists public.detecciones_guardados (
  id_guardado          bigserial primary key,
  id_usuario           uuid not null references auth.users(id) on delete cascade,
  id_deteccion         bigint not null references public.detecciones_ia(id_deteccion) on delete cascade,
  tipo_comida          text not null, -- texto libre (mealType), deliberadamente NO acoplado al enum de ingestas.tipo
  removed_item_uuids   uuid[] not null default '{}',
  created_at            timestamptz not null default now()
);

create table if not exists public.detecciones_guardados_items (
  id_guardado_item  bigserial primary key,
  id_guardado       bigint not null references public.detecciones_guardados(id_guardado) on delete cascade,
  source_item_uuid  uuid references public.detecciones_ia_items(item_uuid), -- null = agregado manualmente
  name              text not null,
  category          text not null,
  grams             numeric(10,2) not null check (grams > 0),
  ai_grams          numeric(10,2),
  origin            text not null check (origin in ('ai', 'answered', 'replaced', 'added_manually')),
  answers           jsonb not null default '[]'::jsonb,
  food_ref          text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_detecciones_ia_usuario_fecha on public.detecciones_ia(id_usuario, created_at);
create index if not exists idx_detecciones_ia_items_deteccion on public.detecciones_ia_items(id_deteccion);
create index if not exists idx_detecciones_guardados_deteccion on public.detecciones_guardados(id_deteccion);
create index if not exists idx_detecciones_guardados_usuario_fecha on public.detecciones_guardados(id_usuario, created_at);
create index if not exists idx_detecciones_guardados_items_guardado on public.detecciones_guardados_items(id_guardado);

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT ON public.detecciones_ia TO authenticated;
GRANT SELECT, INSERT ON public.detecciones_ia_items TO authenticated;
GRANT SELECT, INSERT ON public.detecciones_guardados TO authenticated;
GRANT SELECT, INSERT ON public.detecciones_guardados_items TO authenticated;

ALTER TABLE public.detecciones_ia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detecciones_ia_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detecciones_guardados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detecciones_guardados_items ENABLE ROW LEVEL SECURITY;

-- DETECCIONES_IA
DROP POLICY IF EXISTS "detecciones_ia: own read" ON public.detecciones_ia;
DROP POLICY IF EXISTS "detecciones_ia: own insert" ON public.detecciones_ia;
DROP POLICY IF EXISTS "detecciones_ia: investigador read all" ON public.detecciones_ia;

CREATE POLICY "detecciones_ia: own read"
  ON public.detecciones_ia FOR SELECT TO authenticated
  USING (id_usuario = auth.uid());

CREATE POLICY "detecciones_ia: own insert"
  ON public.detecciones_ia FOR INSERT TO authenticated
  WITH CHECK (id_usuario = auth.uid());

CREATE POLICY "detecciones_ia: investigador read all"
  ON public.detecciones_ia FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('investigador', 'administrador'));

-- DETECCIONES_IA_ITEMS (sin id_usuario directo — ownership vía parent)
DROP POLICY IF EXISTS "detecciones_ia_items: own read" ON public.detecciones_ia_items;
DROP POLICY IF EXISTS "detecciones_ia_items: own insert" ON public.detecciones_ia_items;
DROP POLICY IF EXISTS "detecciones_ia_items: investigador read all" ON public.detecciones_ia_items;

CREATE POLICY "detecciones_ia_items: own read"
  ON public.detecciones_ia_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.detecciones_ia d
      WHERE d.id_deteccion = detecciones_ia_items.id_deteccion
        AND d.id_usuario = auth.uid()
    )
  );

CREATE POLICY "detecciones_ia_items: own insert"
  ON public.detecciones_ia_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.detecciones_ia d
      WHERE d.id_deteccion = detecciones_ia_items.id_deteccion
        AND d.id_usuario = auth.uid()
    )
  );

CREATE POLICY "detecciones_ia_items: investigador read all"
  ON public.detecciones_ia_items FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('investigador', 'administrador'));

-- DETECCIONES_GUARDADOS
DROP POLICY IF EXISTS "detecciones_guardados: own read" ON public.detecciones_guardados;
DROP POLICY IF EXISTS "detecciones_guardados: own insert" ON public.detecciones_guardados;
DROP POLICY IF EXISTS "detecciones_guardados: investigador read all" ON public.detecciones_guardados;

CREATE POLICY "detecciones_guardados: own read"
  ON public.detecciones_guardados FOR SELECT TO authenticated
  USING (id_usuario = auth.uid());

CREATE POLICY "detecciones_guardados: own insert"
  ON public.detecciones_guardados FOR INSERT TO authenticated
  WITH CHECK (id_usuario = auth.uid());

CREATE POLICY "detecciones_guardados: investigador read all"
  ON public.detecciones_guardados FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('investigador', 'administrador'));

-- DETECCIONES_GUARDADOS_ITEMS
DROP POLICY IF EXISTS "detecciones_guardados_items: own read" ON public.detecciones_guardados_items;
DROP POLICY IF EXISTS "detecciones_guardados_items: own insert" ON public.detecciones_guardados_items;
DROP POLICY IF EXISTS "detecciones_guardados_items: investigador read all" ON public.detecciones_guardados_items;

CREATE POLICY "detecciones_guardados_items: own read"
  ON public.detecciones_guardados_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.detecciones_guardados g
      WHERE g.id_guardado = detecciones_guardados_items.id_guardado
        AND g.id_usuario = auth.uid()
    )
  );

CREATE POLICY "detecciones_guardados_items: own insert"
  ON public.detecciones_guardados_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.detecciones_guardados g
      WHERE g.id_guardado = detecciones_guardados_items.id_guardado
        AND g.id_usuario = auth.uid()
    )
  );

CREATE POLICY "detecciones_guardados_items: investigador read all"
  ON public.detecciones_guardados_items FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('investigador', 'administrador'));


-- ============================================================
-- 012 — Info ampliada de Open Food Facts en alimentos_barcode
-- ============================================================

ALTER TABLE public.alimentos_barcode
  ADD COLUMN IF NOT EXISTS nutriscore_grade text CHECK (nutriscore_grade IN ('a','b','c','d','e')),
  ADD COLUMN IF NOT EXISTS nova_group smallint CHECK (nova_group BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS is_gluten_free boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_vegan boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_vegetarian boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS serving_quantity_label text;

COMMENT ON COLUMN public.alimentos_barcode.nutriscore_grade IS 'Calificación Nutri-Score de A a E (Open Food Facts)';
COMMENT ON COLUMN public.alimentos_barcode.nova_group IS 'Clasificación NOVA de procesamiento (1 a 4, Open Food Facts)';


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

-- ------------------------------------------------------------
-- match_alimentos — mejor candidato del catálogo por cada nombre (NUT-119)
--
-- Una sola llamada para todos los nombres de una comida (nada de N+1).
-- `%` usa el índice GIN trigram con el umbral del GUC pg_trgm.similarity_threshold
-- (0.3 por default); después se filtra por similarity() >= greatest(p_umbral, 0.3).
-- No se llama set_config desde una función STABLE. Orden: exacto primero, luego
-- score + bonus (marca explícita en el nombre consultado +0.10, SARA2 +0.08). El
-- score devuelto es la similitud cruda, sin bonus. Devuelve una fila por nombre
-- (id_alimento null si no hubo match) y los macros por 100 g del candidato.
-- ------------------------------------------------------------

create or replace function public.match_alimentos(p_nombres text[], p_umbral real default 0.5)
returns table (
  idx int,
  nombre_normalizado text,
  id_alimento int,
  nombre text,
  fuente text,
  score real,
  metodo text,
  kcal_100g numeric,
  proteinas_100g numeric,
  grasas_100g numeric,
  carbs_100g numeric
)
language sql stable security invoker
set search_path = public, extensions
as $$
  select
    q.idx::int,
    qn.n,
    m.id_alimento,
    m.nombre,
    m.fuente,
    m.score,
    m.metodo,
    m.kcal_100g,
    m.proteinas_100g,
    m.grasas_100g,
    m.carbs_100g
  from unnest(p_nombres) with ordinality as q(nombre, idx)
  cross join lateral (select public.norm_alimento(q.nombre) as n) qn
  left join lateral (
    select
      a.id_alimento,
      a.nombre,
      a.fuente,
      similarity(a.nombre_normalizado, qn.n) as score,
      case when a.nombre_normalizado = qn.n then 'exacto' else 'trigram' end as metodo,
      a.kcal_100g,
      a.proteinas_100g,
      a.grasas_100g,
      a.carbs_100g
    from public.alimentos a
    where qn.n is not null
      and a.nombre_normalizado % qn.n
      and similarity(a.nombre_normalizado, qn.n) >= greatest(p_umbral, 0.3)
    order by
      (a.nombre_normalizado = qn.n) desc,
      similarity(a.nombre_normalizado, qn.n)
        + case
            when a.marca is not null
              and public.norm_alimento(a.marca) is not null
              and qn.n like '%' || public.norm_alimento(a.marca) || '%' then 0.10
            when a.fuente = 'SARA2' then 0.08
            else 0
          end desc,
      a.id_alimento
    limit 1
  ) m on true
  order by q.idx
$$;

revoke all on function public.match_alimentos(text[], real) from public, anon;
grant execute on function public.match_alimentos(text[], real) to authenticated, service_role;

-- ------------------------------------------------------------
-- Acciones del investigador sobre la cola: modificar / validar / descartar
-- ------------------------------------------------------------
--
-- security definer + chequeo de rol ADENTRO (get_my_role() lee auth.uid() de
-- los claims del JWT de la sesión, así que funciona igual dentro de un definer).
-- Dentro de estas funciones current_user es el dueño (no 'authenticated'):
-- el guard items_proteger_origen las deja pasar y RLS no aplica.
--
-- Concurrencia / locks, siempre en este orden: fila de cola → items → ingestas.
--   * `for update` de la fila de cola serializa a los investigadores entre sí y
--     contra registrar_guardado_deteccion (que toma la misma fila antes de
--     insertar la ocurrencia): si el commit gana, el UPDATE de items de acá
--     (snapshot nuevo, READ COMMITTED) ya ve sus ítems; si gana validar, el
--     commit ve 'validado'. Nunca queda un ítem 'pendiente' colgado de una
--     fila resuelta.
--   * items y después ingestas (ordenadas) se bloquean ANTES del UPDATE: es
--     el mismo orden que un update/delete del dueño (item → trigger → ingesta)
--     y evita el deadlock entre dos validaciones que tocan la misma ingesta.
--
-- detecciones_guardados_items NO se actualiza (D11): es el log al guardar; el
-- estado vivo sale de la cola vía id_pendiente.
--
-- Errores (message): FORBIDDEN, NOT_FOUND, ESTADO_INVALIDO, INVALID,
-- DUPLICADO_EN_CATALOGO (detail = id_alimento existente), ALIMENTO_NO_ENCONTRADO.

-- Borrador: guarda final_*/observaciones sin cambiar el estado.
create or replace function public.pendiente_modificar(
  p_id bigint,
  p_nombre text,
  p_categoria text,
  p_kcal numeric,
  p_prot numeric,
  p_grasas numeric,
  p_carbs numeric,
  p_observaciones text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes   public.alimentos_pendientes_validacion%rowtype;
  v_despues public.alimentos_pendientes_validacion%rowtype;
begin
  if coalesce(public.get_my_role() in ('investigador', 'administrador'), false) is false then
    raise exception 'FORBIDDEN';
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

  update public.alimentos_pendientes_validacion c
  set nombre_final = nullif(btrim(p_nombre), ''),
      categoria_final = nullif(btrim(p_categoria), ''),
      final_kcal_100g = p_kcal,
      final_proteinas_100g = p_prot,
      final_grasas_100g = p_grasas,
      final_carbs_100g = p_carbs,
      observaciones = p_observaciones
  where c.id_pendiente = p_id
  returning * into v_despues;

  insert into public.alimentos_pendientes_auditoria (id_pendiente, accion, id_usuario, antes, despues, items_afectados)
  values (p_id, 'modificar', auth.uid(), to_jsonb(v_antes), to_jsonb(v_despues), 0);
end;
$$;

-- Validar: alta en el catálogo (VALIDADO) o vínculo a un alimento existente,
-- y re-apunta los ítems del diario. El trigger calculate_item_nutrients
-- recalcula cada ítem con SU cantidad y recalculate_ingesta_totals las ingestas.
-- Con p_id_alimento_existente mandan los valores del catálogo (cola, snapshot
-- e items quedan coherentes con lo que calcula el trigger); p_kcal… se ignoran.
create or replace function public.pendiente_validar(
  p_id bigint,
  p_nombre text,
  p_categoria text,
  p_kcal numeric,
  p_prot numeric,
  p_grasas numeric,
  p_carbs numeric,
  p_observaciones text,
  p_id_alimento_existente int default null
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
  v_id      integer;
  v_k       numeric;
  v_p       numeric;
  v_g       numeric;
  v_c       numeric;
  v_n       integer;
begin
  if coalesce(public.get_my_role() in ('investigador', 'administrador'), false) is false then
    raise exception 'FORBIDDEN';
  end if;

  if v_nombre is null or v_norm is null then
    raise exception 'INVALID' using detail = 'p_nombre';
  end if;
  if p_id_alimento_existente is null
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

  if p_id_alimento_existente is not null then
    select a.id_alimento, a.kcal_100g, a.proteinas_100g, a.grasas_100g, a.carbs_100g
    into v_id, v_k, v_p, v_g, v_c
    from public.alimentos a
    where a.id_alimento = p_id_alimento_existente;
    if not found then
      raise exception 'ALIMENTO_NO_ENCONTRADO' using detail = p_id_alimento_existente::text;
    end if;
  else
    -- Serializa altas con el mismo nombre desde filas de cola distintas.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('alimentos_validados:' || v_norm));

    select a.id_alimento into v_id
    from public.alimentos a
    where a.nombre_normalizado = v_norm
    order by a.id_alimento
    limit 1;
    if found then
      raise exception 'DUPLICADO_EN_CATALOGO' using detail = v_id::text;
    end if;

    v_k := p_kcal; v_p := p_prot; v_g := p_grasas; v_c := p_carbs;
    insert into public.alimentos (id_alimento, nombre, categoria, fuente, kcal_100g, proteinas_100g, grasas_100g, carbs_100g)
    values (nextval('public.alimentos_validados_seq'), v_nombre, nullif(btrim(p_categoria), ''), 'VALIDADO', v_k, v_p, v_g, v_c)
    returning id_alimento into v_id;
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
      resuelto_por = auth.uid(),
      resuelto_at = now()
  where c.id_pendiente = p_id
  returning * into v_despues;

  -- Locks en orden (ver encabezado). nombre_manual se conserva (trazabilidad).
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

-- Descartar: los ítems NO se borran (el deportista sigue viendo qué comió);
-- origen_macros = 'descartado' y el trigger los pone en 0.
create or replace function public.pendiente_descartar(p_id bigint, p_observaciones text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes   public.alimentos_pendientes_validacion%rowtype;
  v_despues public.alimentos_pendientes_validacion%rowtype;
  v_n       integer;
begin
  if coalesce(public.get_my_role() in ('investigador', 'administrador'), false) is false then
    raise exception 'FORBIDDEN';
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

  update public.alimentos_pendientes_validacion c
  set estado = 'descartado',
      observaciones = coalesce(p_observaciones, c.observaciones),
      resuelto_por = auth.uid(),
      resuelto_at = now()
  where c.id_pendiente = p_id
  returning * into v_despues;

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

  update public.items it
  set origen_macros = 'descartado'
  where it.id_guardado_item in (select gi.id_guardado_item from public.detecciones_guardados_items gi where gi.id_pendiente = p_id);
  get diagnostics v_n = row_count;

  insert into public.alimentos_pendientes_auditoria (id_pendiente, accion, id_usuario, antes, despues, items_afectados)
  values (p_id, 'descartar', auth.uid(), to_jsonb(v_antes), to_jsonb(v_despues), v_n);

  return jsonb_build_object('items_afectados', v_n);
end;
$$;

revoke all on function public.pendiente_modificar(bigint, text, text, numeric, numeric, numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function public.pendiente_modificar(bigint, text, text, numeric, numeric, numeric, numeric, text)
  to authenticated;
revoke all on function public.pendiente_validar(bigint, text, text, numeric, numeric, numeric, numeric, text, int)
  from public, anon, authenticated;
grant execute on function public.pendiente_validar(bigint, text, text, numeric, numeric, numeric, numeric, text, int)
  to authenticated;
revoke all on function public.pendiente_descartar(bigint, text)
  from public, anon, authenticated;
grant execute on function public.pendiente_descartar(bigint, text)
  to authenticated;


-- ============================================================
-- 014 — Protección del rol en public.profiles (fix de escalada de privilegios)
--
-- Problema: las políticas "profiles: own insert/update" y "Permitir todo a
-- dueños profiles" dejan al dueño escribir CUALQUIER columna de su fila, incluido
-- `role`. Con su propia sesión, un usuario común podía hacer
--   PATCH /rest/v1/profiles?user_id=eq.<uid>  { "role": "investigador" }
-- y pasar a leer los datos de todos los deportistas (y, con NUT-119, la cola de
-- validación y las fotos).
--
-- Solución: un trigger que restringe QUÉ roles se puede asignar un usuario de la
-- API de cliente (authenticated / anon). El alta de investigador/administrador
-- queda sólo para el service role (el servidor, después de validar el código de
-- invitación). Se identifica al que escribe por `current_user` (PostgREST hace
-- SET ROLE): no es security definer a propósito, porque dentro de una función
-- definer current_user sería el dueño y el guard nunca se activaría.
--
-- Reglas para authenticated / anon:
--   * INSERT: role 'particular' siempre; 'deportista_ucc' sólo si el email del JWT
--     termina en @ucc.edu.ar. Nunca 'investigador' ni 'administrador'.
--   * UPDATE de `role`: sólo entre 'particular' y 'deportista_ucc' (este último
--     con email @ucc.edu.ar). Nadie sale ni entra a investigador/administrador.
--   * service_role / postgres / funciones definer: sin restricción.
-- Los DELETE (borrar la cuenta) no se tocan.
-- ============================================================

create or replace function public.profiles_proteger_rol()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_es_ucc boolean := lower(coalesce(auth.jwt() ->> 'email', '')) like '%@ucc.edu.ar';
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role = 'particular' or (new.role = 'deportista_ucc' and v_es_ucc) then
      return new;
    end if;
    raise exception 'ROL_PROTEGIDO' using detail = 'No podés asignarte ese rol.';
  end if;

  -- UPDATE
  if new.role is distinct from old.role then
    if old.role in ('particular', 'deportista_ucc')
       and (new.role = 'particular' or (new.role = 'deportista_ucc' and v_es_ucc)) then
      return new;
    end if;
    raise exception 'ROL_PROTEGIDO' using detail = 'No podés cambiar tu rol a ese valor.';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_proteger_rol on public.profiles;
create trigger profiles_proteger_rol
  before insert or update of role on public.profiles
  for each row execute function public.profiles_proteger_rol();

-- ------------------------------------------------------------
-- Lectura pública de profiles (anon): se elimina.
--
-- La política "public read for reminders" (004) dejaba que cualquiera con la
-- anon key —que es pública— leyera TODA la tabla: nombres, emails y roles.
-- /api/send-reminders usa el service role (bypass de RLS) y no la necesita.
-- ------------------------------------------------------------

drop policy if exists "public read for reminders" on public.profiles;


-- ============================================================
-- 015 (NUT-119) — El matching automático sólo usa SARA2 (+ VALIDADO), nunca ANMAT
--
-- Problema: el matching por similitud de texto contra TODO el catálogo
-- confundía "huevo" con un producto ANMAT cuyo nombre es exactamente "Huevo"
-- (un huevo de chocolate). Los productos envasados no se pueden matchear de
-- forma automática con confianza: se cargan por código de barras o eligiéndolos
-- a mano en el buscador.
--
-- Ahora:
--   * match_alimentos sólo hace MATCH EXACTO (nombre normalizado) y sólo contra
--     SARA2 y VALIDADO (los alimentos que aprobaron los investigadores).
--   * Lo que no tiene match exacto lo resuelve Gemini ELIGIENDO de la lista de
--     SARA2/VALIDADO (ver src/lib/geminiNutritionFallback.ts); ese método se
--     guarda como 'sara2_ia'.
-- La firma se mantiene (p_umbral queda sin uso) para que la app funcione igual
-- se despliegue antes o después de esta migración.
-- ============================================================

create or replace function public.match_alimentos(p_nombres text[], p_umbral real default 0.5)
returns table (
  idx int,
  nombre_normalizado text,
  id_alimento int,
  nombre text,
  fuente text,
  score real,
  metodo text,
  kcal_100g numeric,
  proteinas_100g numeric,
  grasas_100g numeric,
  carbs_100g numeric
)
language sql stable security invoker
set search_path = public, extensions
as $$
  select
    q.idx::int,
    qn.n,
    m.id_alimento,
    m.nombre,
    m.fuente,
    m.score,
    m.metodo,
    m.kcal_100g,
    m.proteinas_100g,
    m.grasas_100g,
    m.carbs_100g
  from unnest(p_nombres) with ordinality as q(nombre, idx)
  cross join lateral (select public.norm_alimento(q.nombre) as n) qn
  left join lateral (
    select
      a.id_alimento,
      a.nombre,
      a.fuente,
      1.0::real as score,
      'exacto'::text as metodo,
      a.kcal_100g,
      a.proteinas_100g,
      a.grasas_100g,
      a.carbs_100g
    from public.alimentos a
    where qn.n is not null
      and a.nombre_normalizado = qn.n
      and a.fuente in ('SARA2', 'VALIDADO')
    order by (a.fuente = 'SARA2') desc, a.id_alimento
    limit 1
  ) m on true
  order by q.idx
$$;

revoke all on function public.match_alimentos(text[], real) from public, anon;
grant execute on function public.match_alimentos(text[], real) to authenticated, service_role;

-- Nuevo método de match: la IA eligió una entrada de la lista de SARA2/VALIDADO.
-- 'trigram' se conserva para los guardados anteriores.
alter table public.detecciones_guardados_items
  drop constraint if exists detecciones_guardados_items_metodo_match_check;

alter table public.detecciones_guardados_items
  add constraint detecciones_guardados_items_metodo_match_check
    check (metodo_match in ('food_ref', 'exacto', 'trigram', 'sara2_ia', 'gemini', 'cola', 'ninguno'));
