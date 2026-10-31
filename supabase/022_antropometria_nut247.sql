begin;

-- ============================================================
-- 022 (NUT-247/NUT-252) — Antropometrías: pacientes manuales y mediciones
--
-- Qué agrega (todo ADITIVO: no toca ninguna tabla ni función existente):
--   * antropometria_pacientes_manuales: pacientes que no son usuarios de la app
--     (nombre, apellido, nacimiento, sexo). Solo mayores de 18 años.
--     `masa_osea_referencia` guarda la masa ósea fija del paciente (desde los 21
--     años no cambia: se reutiliza la de la primera medición).
--   * antropometria_deportistas_datos: tabla AUXILIAR por deportista registrado
--     (deportista_ucc). Guarda, sin tocar `physical_data` (que es del deportista):
--       - masa_osea_referencia (la misma regla que en pacientes manuales);
--       - sexo y fecha_nacimiento SOLO como respaldo cuando el deportista no
--         completó `physical_data` (en ese caso esas columnas no existen: son
--         NOT NULL allá). Si `physical_data` tiene el dato, ese manda y la
--         aplicación no lo pisa.
--   * antropometria_mediciones: UNA fila por medición con los DATOS CRUDOS
--     (series jsonb con las 25 variables y 2–3 series cada una). No se guarda
--     ningún resultado derivado: el informe se calcula al vuelo con
--     src/lib/antropometria, así editar una medición siempre recalcula.
--     La medición pertenece a un deportista registrado (user_id) O a un paciente
--     manual (paciente_manual_id), nunca a ambos ni a ninguno.
--     estado: borrador (autoguardado, series parciales) | vigente | anulada.
--     La baja es lógica: no hay permiso de DELETE para nadie desde la API.
--
-- Permisos (NUT-252): solo investigador y administrador leen y escriben. Los
-- demás roles (deportista_ucc, particular) y anon no ven ni una fila. Mismo
-- criterio que el resto del panel de investigadores (get_my_role()).
--
-- Riesgos: ninguno para datos existentes. Reversión:
--   drop table public.antropometria_mediciones, public.antropometria_deportistas_datos,
--              public.antropometria_pacientes_manuales;
--   drop function public.antropometria_mediciones_auditoria();
-- ============================================================

create table if not exists public.antropometria_pacientes_manuales (
  id                   uuid primary key default uuid_generate_v4(),
  nombre               text not null check (btrim(nombre) <> ''),
  apellido             text not null check (btrim(apellido) <> ''),
  fecha_nacimiento     date not null
                         check (fecha_nacimiento <= current_date - interval '18 years'
                                and fecha_nacimiento >= current_date - interval '100 years'),
  sexo                 char(1) not null check (sexo in ('M', 'F')),
  masa_osea_referencia numeric(6,3) check (masa_osea_referencia is null or masa_osea_referencia > 0),
  creado_por           uuid not null default auth.uid() references auth.users(id),
  creado_en            timestamptz not null default now()
);

create index if not exists idx_antropometria_manuales_nombre
  on public.antropometria_pacientes_manuales (lower(apellido), lower(nombre));

create table if not exists public.antropometria_deportistas_datos (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  sexo                 char(1) check (sexo is null or sexo in ('M', 'F')),
  fecha_nacimiento     date check (fecha_nacimiento is null
                                   or (fecha_nacimiento <= current_date - interval '18 years'
                                       and fecha_nacimiento >= current_date - interval '100 years')),
  masa_osea_referencia numeric(6,3) check (masa_osea_referencia is null or masa_osea_referencia > 0),
  actualizado_por      uuid default auth.uid() references auth.users(id),
  actualizado_en       timestamptz not null default now()
);

create table if not exists public.antropometria_mediciones (
  id                   uuid primary key default uuid_generate_v4(),
  user_id              uuid references auth.users(id) on delete cascade,
  paciente_manual_id   uuid references public.antropometria_pacientes_manuales(id) on delete cascade,
  fecha_medicion       date not null,
  investigador_id      uuid not null default auth.uid() references auth.users(id),
  nivel_actividad      text check (nivel_actividad is null
                                   or nivel_actividad in ('sedentaria', 'liviana', 'moderada', 'intensa', 'extremada')),
  deporte              text,
  series               jsonb not null default '{}'::jsonb check (jsonb_typeof(series) = 'object'),
  estado               text not null default 'borrador' check (estado in ('borrador', 'vigente', 'anulada')),
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),
  actualizado_por      uuid default auth.uid() references auth.users(id),
  -- Un solo dueño: deportista registrado XOR paciente manual.
  constraint antropometria_mediciones_un_dueno
    check ((user_id is not null) <> (paciente_manual_id is not null)),
  -- Una medición vigente tiene que tener el nivel de actividad (el informe lo usa).
  constraint antropometria_mediciones_vigente_completa
    check (estado <> 'vigente' or nivel_actividad is not null)
);

create index if not exists idx_antropometria_mediciones_user
  on public.antropometria_mediciones (user_id, estado, fecha_medicion);
create index if not exists idx_antropometria_mediciones_manual
  on public.antropometria_mediciones (paciente_manual_id, estado, fecha_medicion);

-- Auditoría de edición: quién y cuándo modificó por última vez. Se pisa siempre
-- desde la base para que no se pueda falsear desde el cliente.
create or replace function public.antropometria_mediciones_auditoria()
returns trigger as $$
begin
  new.actualizado_en  = now();
  new.actualizado_por = auth.uid();
  -- El investigador que creó la medición y la fecha de creación no cambian.
  new.investigador_id = old.investigador_id;
  new.creado_en       = old.creado_en;
  return new;
end;
$$ language plpgsql;

drop trigger if exists antropometria_mediciones_auditoria on public.antropometria_mediciones;
create trigger antropometria_mediciones_auditoria
  before update on public.antropometria_mediciones
  for each row execute function public.antropometria_mediciones_auditoria();

alter table public.antropometria_pacientes_manuales enable row level security;
alter table public.antropometria_deportistas_datos  enable row level security;
alter table public.antropometria_mediciones         enable row level security;

-- Supabase da ALL por default a anon/authenticated en tablas nuevas de public:
-- se quita todo y se otorga solo lo que se usa. Sin DELETE para nadie (baja lógica).
revoke all on public.antropometria_pacientes_manuales,
              public.antropometria_deportistas_datos,
              public.antropometria_mediciones from anon, authenticated;
grant select, insert, update on public.antropometria_pacientes_manuales,
                                public.antropometria_deportistas_datos,
                                public.antropometria_mediciones to authenticated;

-- RLS: pacientes manuales
drop policy if exists "antropometria_pacientes_manuales: investigador read" on public.antropometria_pacientes_manuales;
create policy "antropometria_pacientes_manuales: investigador read"
  on public.antropometria_pacientes_manuales for select to authenticated
  using ((select public.get_my_role()) in ('investigador', 'administrador'));

drop policy if exists "antropometria_pacientes_manuales: investigador insert" on public.antropometria_pacientes_manuales;
create policy "antropometria_pacientes_manuales: investigador insert"
  on public.antropometria_pacientes_manuales for insert to authenticated
  with check ((select public.get_my_role()) in ('investigador', 'administrador')
              and creado_por = (select auth.uid()));

drop policy if exists "antropometria_pacientes_manuales: investigador update" on public.antropometria_pacientes_manuales;
create policy "antropometria_pacientes_manuales: investigador update"
  on public.antropometria_pacientes_manuales for update to authenticated
  using ((select public.get_my_role()) in ('investigador', 'administrador'))
  with check ((select public.get_my_role()) in ('investigador', 'administrador'));

-- RLS: datos auxiliares de deportistas
drop policy if exists "antropometria_deportistas_datos: investigador read" on public.antropometria_deportistas_datos;
create policy "antropometria_deportistas_datos: investigador read"
  on public.antropometria_deportistas_datos for select to authenticated
  using ((select public.get_my_role()) in ('investigador', 'administrador'));

drop policy if exists "antropometria_deportistas_datos: investigador insert" on public.antropometria_deportistas_datos;
create policy "antropometria_deportistas_datos: investigador insert"
  on public.antropometria_deportistas_datos for insert to authenticated
  with check ((select public.get_my_role()) in ('investigador', 'administrador'));

drop policy if exists "antropometria_deportistas_datos: investigador update" on public.antropometria_deportistas_datos;
create policy "antropometria_deportistas_datos: investigador update"
  on public.antropometria_deportistas_datos for update to authenticated
  using ((select public.get_my_role()) in ('investigador', 'administrador'))
  with check ((select public.get_my_role()) in ('investigador', 'administrador'));

-- RLS: mediciones
drop policy if exists "antropometria_mediciones: investigador read" on public.antropometria_mediciones;
create policy "antropometria_mediciones: investigador read"
  on public.antropometria_mediciones for select to authenticated
  using ((select public.get_my_role()) in ('investigador', 'administrador'));

drop policy if exists "antropometria_mediciones: investigador insert" on public.antropometria_mediciones;
create policy "antropometria_mediciones: investigador insert"
  on public.antropometria_mediciones for insert to authenticated
  with check ((select public.get_my_role()) in ('investigador', 'administrador')
              and investigador_id = (select auth.uid()));

drop policy if exists "antropometria_mediciones: investigador update" on public.antropometria_mediciones;
create policy "antropometria_mediciones: investigador update"
  on public.antropometria_mediciones for update to authenticated
  using ((select public.get_my_role()) in ('investigador', 'administrador'))
  with check ((select public.get_my_role()) in ('investigador', 'administrador'));

commit;
