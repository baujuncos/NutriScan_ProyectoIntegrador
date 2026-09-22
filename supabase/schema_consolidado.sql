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
