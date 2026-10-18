-- ============================================================
-- Script para correr en el SQL Editor de Supabase.
--
-- Es exactamente la sección "014" ya agregada al final de
-- supabase/schema_consolidado.sql (que sigue siendo la fuente de verdad del
-- esquema completo) — este archivo separado es sólo para pegarlo y correrlo
-- de una sin tener que ubicar la sección en el archivo grande.
--
-- Es seguro re-ejecutar: todo usa CREATE OR REPLACE / DROP ... IF EXISTS.
--
-- ANTES de correrlo, auditá quién tiene hoy un rol privilegiado y compará con
-- las personas reales (si alguien se coló antes de este fix, corregilo a mano):
--
--   select user_id, nombre, apellido, email, role, created_at
--   from public.profiles
--   where role in ('investigador', 'administrador')
--   order by created_at;
-- ============================================================

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
