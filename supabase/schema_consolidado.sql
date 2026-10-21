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
--
-- p_revisiones (NUT-149): array jsonb [{ item_uuid, motivos: text[] }], uno por
-- ítem que predijo Gemini (lo calcula calcularRevisiones en src/lib/revisionIa.ts).
-- Marca necesita_revision / motivos_revision / estado_revision en
-- detecciones_ia_items, sólo de esta detección.
--
-- Errores (message): NOT_FOUND, ALREADY_SAVED, INVALID, FOOD_REF_INVALIDO
-- (detail = id). Devuelve { id_guardado, items_registrados, sin_datos }.
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


-- ============================================================
-- 016 (NUT-119) — Los alimentos validados NO se agregan al catálogo `alimentos`
--
-- Antes (decisión D2): validar insertaba una fila `fuente = 'VALIDADO'` en
-- `alimentos` y la IA podía elegirla en el matching. Se revierte:
--   * `alimentos` queda como referencia pura (SARA2 y ANMAT), sin filas propias.
--   * Lo validado vive en la cola (`alimentos_pendientes_validacion`, estado
--     'validado': nombre y macros finales, quién y cuándo, valores originales de
--     Gemini y auditoría). Los ítems del diario guardan los macros por 100 g en
--     el propio ítem (`origen_macros = 'validado'`), igual que los estimados por IA.
--   * Otros deportistas que cargan el mismo alimento lo reutilizan por la cola
--     (cola_lookup / registrar_guardado_deteccion), sin llamar a la IA.
--   * El matching automático (match_alimentos) vuelve a mirar SÓLO SARA2.
--   * Vincular un pendiente a una entrada EXISTENTE del catálogo sigue
--     funcionando (p_id_alimento_existente).
--   * Ya no existe DUPLICADO_EN_CATALOGO: como no se inserta en `alimentos`, no
--     hay catálogo que ensuciar (y bloqueaba validar "Huevo" por un producto ANMAT
--     con el mismo nombre).
--
-- Las filas `VALIDADO` que ya existan en `alimentos` (de pruebas) NO se tocan:
-- quedan sin uso. Para verlas:  select * from public.alimentos where fuente = 'VALIDADO';
-- La secuencia alimentos_validados_seq también queda (sin uso).
-- ============================================================

-- Matching automático: sólo SARA2.
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
      and a.fuente = 'SARA2'
    order by a.id_alimento
    limit 1
  ) m on true
  order by q.idx
$$;

revoke all on function public.match_alimentos(text[], real) from public, anon;
grant execute on function public.match_alimentos(text[], real) to authenticated, service_role;

-- Validar: ya no inserta en `alimentos`.
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
    -- Vinculado a una entrada existente del catálogo: los valores son los del catálogo.
    select a.id_alimento, a.kcal_100g, a.proteinas_100g, a.grasas_100g, a.carbs_100g
    into v_id, v_k, v_p, v_g, v_c
    from public.alimentos a
    where a.id_alimento = p_id_alimento_existente;
    if not found then
      raise exception 'ALIMENTO_NO_ENCONTRADO' using detail = p_id_alimento_existente::text;
    end if;
  else
    -- Alimento nuevo: NO se inserta en `alimentos`. Los valores quedan en la cola y en cada ítem.
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

revoke all on function public.pendiente_validar(bigint, text, text, numeric, numeric, numeric, numeric, text, int)
  from public, anon, authenticated;
grant execute on function public.pendiente_validar(bigint, text, text, numeric, numeric, numeric, numeric, text, int)
  to authenticated;

-- Vista de los alimentos validados (con cuántas veces aparecieron). security_invoker:
-- la RLS de la cola aplica al que consulta (sólo investigadores/administradores ven filas).
create or replace view public.v_alimentos_validados
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
-- se guardan los valores que manda el cliente (y los ingredientes ya cargados, si son válidos).
-- Sin p_composicion se conserva la anterior.
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
  v_norm    jsonb;
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
      -- Catálogo sin ingredientes, 'ia' o 'manual': los valores son los del cliente. Si hay
      -- ingredientes cargados (el investigador guarda estando en otra pestaña) se CONSERVAN,
      -- normalizados desde la base; si no son válidos el borrador se guarda sin ellos.
      v_comp := jsonb_build_object('modo', v_modo, 'id_guardado_item', null, 'gramos_foto', null, 'componentes', '[]'::jsonb);
      if jsonb_typeof(p_composicion -> 'componentes') = 'array'
         and jsonb_array_length(p_composicion -> 'componentes') > 0 then
        begin
          select r.composicion_normalizada into v_norm
          from public.calcular_composicion(p_id, jsonb_set(p_composicion, '{modo}', '"catalogo"')) r;
          v_comp := jsonb_set(v_norm, '{modo}', to_jsonb(v_modo));
        exception when others then
          null;
        end;
      elsif v_modo = 'catalogo' and jsonb_typeof(p_composicion -> 'id_guardado_item') = 'number' then
        select gi.id_guardado_item into v_ref
        from public.detecciones_guardados_items gi
        where gi.id_pendiente = p_id
          and gi.id_guardado_item = (p_composicion ->> 'id_guardado_item')::numeric;
        v_comp := jsonb_build_object('modo', v_modo, 'id_guardado_item', v_ref, 'gramos_foto', null, 'componentes', '[]'::jsonb);
      end if;
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

-- ============================================================
-- 018 (NUT-119) — La foto de referencia es siempre la PRIMERA ocurrencia
--
-- Para pasar los gramos reales de la foto a valores por 100 g hace falta el
-- peso del alimento en una foto. Antes el investigador elegía cuál de las
-- ocurrencias usar (y el servidor validaba que fuera de ese pendiente); eso
-- complicaba el flujo y dependía de las últimas 20 ocurrencias que trae la
-- pantalla. Ahora la referencia es SIEMPRE la primera ocurrencia del pendiente
-- (la comida que lo originó): no cambia cuando aparecen más, así que un
-- borrador guardado sigue siendo válido. El servidor la determina solo e
-- ignora `id_guardado_item` y `gramos_foto` que mande el cliente.
--
-- Sólo cambia calcular_composicion (misma firma); pendiente_modificar y
-- pendiente_validar la siguen usando igual.
-- ============================================================

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

-- ============================================================
-- 012 (NUT-191) — "Confirmar y guardar" del chat de comidas por IA.
--
-- Script para correr en el SQL Editor de Supabase. Es seguro re-ejecutarlo
-- (IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE).
--
-- QUÉ AGREGA (todo nuevo; NO modifica ninguna tabla, columna, política ni
-- trigger existente — en particular NO toca calculate_item_nutrients):
--   1) chat_ia_registros / chat_ia_registros_items: auditoría para
--      investigadores de lo que estimó la IA vs. lo que el usuario confirmó.
--      Mismo patrón que detecciones_guardados*: solo SELECT + INSERT (sin
--      UPDATE/DELETE), el usuario ve lo suyo e investigadores/administradores
--      ven todo.
--   2) confirmar_chat_ia_registro(jsonb): guarda TODO en una sola
--      transacción (diario ingestas/items, hidratación y auditoría). Si algo
--      falla, no queda nada guardado a medias.
--
-- SOBRE EL TRIGGER DE MACROS (leer antes de aplicar):
--   items tiene `before insert or update of id_alimento, id_alimento_barcode,
--   cantidad` → calculate_item_nutrients(). Para un ítem sin catálogo
--   (id_alimento nulo) el trigger deja kcal/proteínas/grasas/carbs en 0. La
--   función inserta el ítem normalmente y, a continuación, hace un UPDATE
--   SOLO de esas 4 columnas sobre la fila que ella misma acaba de insertar
--   (por id_item). Como ese UPDATE no nombra id_alimento, id_alimento_barcode
--   ni cantidad, el trigger NO se vuelve a disparar y los valores quedan.
--   Ojo (comportamiento ya existente, no lo introduce este script): si luego
--   el usuario edita la cantidad de ese ítem desde /alimentacion
--   (updateItemAction), el trigger sí se dispara y vuelve a poner 0, igual
--   que hoy con los ítems de carga manual.
-- ============================================================

create table if not exists public.chat_ia_registros (
  id_registro        bigserial primary key,
  id_usuario         uuid not null references auth.users(id) on delete cascade,
  -- Idempotencia: si el cliente reintenta una confirmación que ya se guardó
  -- (ej. se cortó la respuesta), no se duplica nada.
  request_id         uuid not null,
  fecha              date not null,
  -- Momento del día: mismo enum que ingestas.tipo.
  tipo_ingesta       text not null check (tipo_ingesta in ('desayuno', 'almuerzo', 'merienda', 'cena', 'colacion', 'suplemento')),
  modelo             text not null,
  prompt_version     text not null,
  -- Totales finales confirmados (sin contar los ítems quitados).
  kcal_total         numeric(10,2) not null,
  proteinas_total_g  numeric(10,2) not null,
  carbs_total_g      numeric(10,2) not null,
  grasas_total_g     numeric(10,2) not null,
  gramos_total       numeric(10,2) not null,
  created_at         timestamptz not null default now(),
  unique (id_usuario, request_id)
);

create table if not exists public.chat_ia_registros_items (
  id_registro_item  bigserial primary key,
  id_registro       bigint not null references public.chat_ia_registros(id_registro) on delete cascade,
  ingrediente       text not null,
  tipo              text not null,
  unidad            text not null check (unidad in ('g', 'ml')),
  -- ai: el usuario no lo tocó | edited: cambió gramaje o alimento
  -- added_manually: lo agregó el usuario (no vino de la IA)
  -- removed: la IA lo detectó pero el usuario lo sacó antes de confirmar
  origin            text not null check (origin in ('ai', 'edited', 'added_manually', 'removed')),
  -- Dónde terminó: diario (ingestas/items), hidratacion (agua) o ninguno (removed).
  destino           text not null check (destino in ('diario', 'hidratacion', 'ninguno')),
  -- Lo que estimó la IA (null solo si origin = 'added_manually').
  gramos_ia         numeric(10,2),
  kcal_ia           numeric(10,2),
  proteinas_ia_g    numeric(10,2),
  carbs_ia_g        numeric(10,2),
  grasas_ia_g       numeric(10,2),
  -- Lo que quedó tras la edición del usuario (null si origin = 'removed').
  gramos_final      numeric(10,2),
  kcal_final        numeric(10,2),
  proteinas_final_g numeric(10,2),
  carbs_final_g     numeric(10,2),
  grasas_final_g    numeric(10,2),
  confidence        numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  -- sara2 = macros del catálogo | estimado_ia = estimación del modelo.
  -- El matching es solo contra SARA2 (ANMAT no participa).
  macro_source      text check (macro_source is null or macro_source in ('sara2', 'estimado_ia')),
  id_alimento       integer references public.alimentos(id_alimento),
  created_at        timestamptz not null default now(),

  constraint chat_ia_items_ia_presente check (
    origin = 'added_manually'
    or (gramos_ia is not null and kcal_ia is not null and proteinas_ia_g is not null
        and carbs_ia_g is not null and grasas_ia_g is not null)
  ),
  constraint chat_ia_items_final_coherente check (
    (origin = 'removed'
      and gramos_final is null and kcal_final is null and proteinas_final_g is null
      and carbs_final_g is null and grasas_final_g is null)
    or
    (origin <> 'removed'
      and gramos_final is not null and kcal_final is not null and proteinas_final_g is not null
      and carbs_final_g is not null and grasas_final_g is not null)
  ),
  constraint chat_ia_items_destino_coherente check ((origin = 'removed') = (destino = 'ninguno'))
);

create index if not exists idx_chat_ia_registros_usuario_fecha on public.chat_ia_registros(id_usuario, fecha);
create index if not exists idx_chat_ia_registros_items_registro on public.chat_ia_registros_items(id_registro);

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT ON public.chat_ia_registros TO authenticated;
GRANT SELECT, INSERT ON public.chat_ia_registros_items TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.chat_ia_registros_id_registro_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.chat_ia_registros_items_id_registro_item_seq TO authenticated;

ALTER TABLE public.chat_ia_registros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_ia_registros_items ENABLE ROW LEVEL SECURITY;

-- CHAT_IA_REGISTROS
DROP POLICY IF EXISTS "chat_ia_registros: own read" ON public.chat_ia_registros;
DROP POLICY IF EXISTS "chat_ia_registros: own insert" ON public.chat_ia_registros;
DROP POLICY IF EXISTS "chat_ia_registros: investigador read all" ON public.chat_ia_registros;

CREATE POLICY "chat_ia_registros: own read"
  ON public.chat_ia_registros FOR SELECT TO authenticated
  USING (id_usuario = auth.uid());

CREATE POLICY "chat_ia_registros: own insert"
  ON public.chat_ia_registros FOR INSERT TO authenticated
  WITH CHECK (id_usuario = auth.uid());

CREATE POLICY "chat_ia_registros: investigador read all"
  ON public.chat_ia_registros FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('investigador', 'administrador'));

-- CHAT_IA_REGISTROS_ITEMS (sin id_usuario directo — ownership vía parent)
DROP POLICY IF EXISTS "chat_ia_registros_items: own read" ON public.chat_ia_registros_items;
DROP POLICY IF EXISTS "chat_ia_registros_items: own insert" ON public.chat_ia_registros_items;
DROP POLICY IF EXISTS "chat_ia_registros_items: investigador read all" ON public.chat_ia_registros_items;

CREATE POLICY "chat_ia_registros_items: own read"
  ON public.chat_ia_registros_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_ia_registros r
      WHERE r.id_registro = chat_ia_registros_items.id_registro
        AND r.id_usuario = auth.uid()
    )
  );

CREATE POLICY "chat_ia_registros_items: own insert"
  ON public.chat_ia_registros_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_ia_registros r
      WHERE r.id_registro = chat_ia_registros_items.id_registro
        AND r.id_usuario = auth.uid()
    )
  );

CREATE POLICY "chat_ia_registros_items: investigador read all"
  ON public.chat_ia_registros_items FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('investigador', 'administrador'));

-- ============================================================
-- confirmar_chat_ia_registro — guardado atómico.
--
-- SECURITY INVOKER (el default): corre con los permisos y la RLS del usuario
-- que la llama, así que solo puede escribir lo que ya podría escribir a mano.
-- Cualquier error aborta la transacción completa.
--
-- Payload (lo arma y valida POST /api/chat/meal/confirm):
-- {
--   "requestId": uuid, "fecha": "YYYY-MM-DD", "tipoIngesta": "almuerzo",
--   "modelo": text, "promptVersion": text,
--   "totales": { "kcal", "proteinas_g", "carbs_g", "grasas_g", "gramos" },
--   "items": [{
--     "ingrediente", "tipo", "unidad", "origin", "destino",
--     "macroSource", "idAlimento", "confidence",
--     "ia":    { "gramos","kcal","proteinas_g","carbs_g","grasas_g" } | null,
--     "final": { "gramos","kcal","proteinas_g","carbs_g","grasas_g" } | null
--   }]
-- }
-- ============================================================
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
    );
  end loop;

  -- Hidratación: suma atómica al día (el módulo guarda ml_total por usuario y día;
  -- los "vasos" son solo visualización, 250 ml).
  if v_agua_ml > 0 then
    insert into public.hidratacion (id_usuario, fecha, ml_total)
    values (v_user, v_fecha, round(v_agua_ml)::integer)
    on conflict (id_usuario, fecha)
    do update set ml_total = hidratacion.ml_total + excluded.ml_total, updated_at = now();
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
