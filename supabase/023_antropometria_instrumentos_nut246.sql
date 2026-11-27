begin;

-- ============================================================
-- 023 (NUT-246/NUT-240) — Antropometrías: instrumentos, investigador que midió y error técnico
--
-- Qué agrega (todo ADITIVO e idempotente: no toca datos existentes ni la
-- semántica de investigador_id, que sigue siendo quien CREÓ la medición y no
-- cambia nunca):
--   * antropometria_mediciones.medido_por: el investigador que realizó las
--     mediciones. Puede ser distinto de quien cargó los datos. NULL = el mismo
--     que investigador_id (así las mediciones anteriores a esta migración no
--     cambian). Si no es NULL tiene que ser un perfil con rol investigador o
--     administrador (lo valida el trigger de abajo, además de la acción).
--   * antropometria_mediciones.instrumento_balanza / _calibres / _plicometro /
--     _cinta: TEXTO LIBRE ("modelo o marca", hasta 120 caracteres) con los
--     instrumentos usados. Es una FOTO de lo que se escribió al medir: si el
--     investigador cambia después su catálogo, los informes viejos no cambian.
--     Todos opcionales: nunca bloquean el guardado.
--   * antropometria_instrumentos_investigador: "Mis instrumentos". Una fila por
--     investigador con sus 4 instrumentos habituales; el asistente de medición
--     los precarga al empezar una medición nueva.
--
-- El error técnico de medición (ETM/TEM) NO se guarda: se calcula al vuelo
-- desde las series de las mediciones vigentes (src/lib/antropometria/errorTecnico.ts).
--
-- Permisos: igual que el resto del panel (get_my_role() en investigador o
-- administrador). "Mis instrumentos" es PRIVADO de cada investigador: solo ve y
-- escribe su propia fila (investigador_id = auth.uid()), ni siquiera el
-- administrador ve la de otros. Sin DELETE para nadie.
--
-- Riesgos: ninguno para datos existentes (columnas nuevas nulas). Los
-- instrumentos son texto libre: no deben contener datos personales.
-- Reversión:
--   drop trigger if exists antropometria_mediciones_medido_por on public.antropometria_mediciones;
--   drop function if exists public.antropometria_mediciones_validar_medido_por();
--   alter table public.antropometria_mediciones
--     drop column if exists medido_por, drop column if exists instrumento_balanza,
--     drop column if exists instrumento_calibres, drop column if exists instrumento_plicometro,
--     drop column if exists instrumento_cinta;
--   drop table if exists public.antropometria_instrumentos_investigador;
-- ============================================================

alter table public.antropometria_mediciones
  add column if not exists medido_por uuid references auth.users(id),
  add column if not exists instrumento_balanza    text check (instrumento_balanza    is null or char_length(instrumento_balanza)    <= 120),
  add column if not exists instrumento_calibres   text check (instrumento_calibres   is null or char_length(instrumento_calibres)   <= 120),
  add column if not exists instrumento_plicometro text check (instrumento_plicometro is null or char_length(instrumento_plicometro) <= 120),
  add column if not exists instrumento_cinta      text check (instrumento_cinta      is null or char_length(instrumento_cinta)      <= 120);

-- El que midió tiene que ser investigador o administrador. Solo se valida cuando el valor
-- se carga o cambia: así, si a alguien le sacan el rol después, sus mediciones viejas se
-- siguen pudiendo editar. SECURITY DEFINER para no depender de las policies de profiles.
create or replace function public.antropometria_mediciones_validar_medido_por()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cambia boolean;
begin
  if new.medido_por is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    cambia := new.medido_por is distinct from old.medido_por;
  else
    cambia := true;
  end if;
  if cambia and not exists (
       select 1 from public.profiles p
       where p.user_id = new.medido_por and p.role in ('investigador', 'administrador')
     )
  then
    raise exception 'medido_por debe ser un investigador o administrador'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists antropometria_mediciones_medido_por on public.antropometria_mediciones;
create trigger antropometria_mediciones_medido_por
  before insert or update on public.antropometria_mediciones
  for each row execute function public.antropometria_mediciones_validar_medido_por();

create table if not exists public.antropometria_instrumentos_investigador (
  investigador_id        uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  instrumento_balanza    text check (instrumento_balanza    is null or char_length(instrumento_balanza)    <= 120),
  instrumento_calibres   text check (instrumento_calibres   is null or char_length(instrumento_calibres)   <= 120),
  instrumento_plicometro text check (instrumento_plicometro is null or char_length(instrumento_plicometro) <= 120),
  instrumento_cinta      text check (instrumento_cinta      is null or char_length(instrumento_cinta)      <= 120),
  actualizado_en         timestamptz not null default now()
);

alter table public.antropometria_instrumentos_investigador enable row level security;

-- Supabase da ALL por default a anon/authenticated en tablas nuevas de public:
-- se quita todo y se otorga solo lo que se usa. Sin DELETE.
revoke all on public.antropometria_instrumentos_investigador from anon, authenticated;
grant select, insert, update on public.antropometria_instrumentos_investigador to authenticated;

drop policy if exists "antropometria_instrumentos_investigador: propio read" on public.antropometria_instrumentos_investigador;
create policy "antropometria_instrumentos_investigador: propio read"
  on public.antropometria_instrumentos_investigador for select to authenticated
  using ((select public.get_my_role()) in ('investigador', 'administrador')
         and investigador_id = (select auth.uid()));

drop policy if exists "antropometria_instrumentos_investigador: propio insert" on public.antropometria_instrumentos_investigador;
create policy "antropometria_instrumentos_investigador: propio insert"
  on public.antropometria_instrumentos_investigador for insert to authenticated
  with check ((select public.get_my_role()) in ('investigador', 'administrador')
              and investigador_id = (select auth.uid()));

drop policy if exists "antropometria_instrumentos_investigador: propio update" on public.antropometria_instrumentos_investigador;
create policy "antropometria_instrumentos_investigador: propio update"
  on public.antropometria_instrumentos_investigador for update to authenticated
  using ((select public.get_my_role()) in ('investigador', 'administrador')
         and investigador_id = (select auth.uid()))
  with check ((select public.get_my_role()) in ('investigador', 'administrador')
              and investigador_id = (select auth.uid()));

commit;
