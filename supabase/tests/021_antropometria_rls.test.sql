-- ============================================================
-- Prueba de la migración 021 (NUT-247/NUT-252, antropometrías) para un
-- proyecto/base DE PRUEBA. NUNCA correr contra producción.
-- Todo corre dentro de una transacción que termina en ROLLBACK: no deja datos.
-- Falla (RAISE EXCEPTION) en el primer caso que no se cumple; si llega al final
-- imprime "TODOS LOS CASOS OK".
-- Requiere el esquema base + 021 aplicados. Crea usuarios en auth.users: en
-- Supabase real esa tabla puede tener columnas/triggers extra; ajustar el insert
-- si hace falta.
-- Uso: psql "$DATABASE_URL" -f supabase/tests/021_antropometria_rls.test.sql
-- ============================================================
begin;

create or replace function pg_temp.chk(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALLÓ: %', msg; end if;
  raise notice 'ok  - %', msg;
end $$;

-- Ejecuta `sql` como el usuario `uid` con rol `authenticated` (como lo ve la API)
-- y devuelve cuántas filas afectó/devolvió; si la base lo rechaza devuelve -1.
create or replace function pg_temp.como(uid text, rol text, sql text) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  execute format('set local role %I', rol);
  begin
    execute sql;
    get diagnostics n = row_count;
  exception when others then
    n := -1;
  end;
  reset role;
  return n;
end $$;

grant usage on all sequences in schema public to authenticated;
grant usage on schema pg_temp to authenticated, anon;

-- Usuarios: i = investigador, a = administrador, d = deportista_ucc, p = particular.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'inv@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'adm@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'dep@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', 'par@test.local');
insert into public.profiles (user_id, nombre, apellido, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Inv', 'Test', 'inv@test.local', 'investigador'),
  ('00000000-0000-0000-0000-0000000000a2', 'Adm', 'Test', 'adm@test.local', 'administrador'),
  ('00000000-0000-0000-0000-0000000000a3', 'Dep', 'Test', 'dep@test.local', 'deportista_ucc'),
  ('00000000-0000-0000-0000-0000000000a4', 'Par', 'Test', 'par@test.local', 'particular');

-- ───────── A. el investigador crea un paciente manual y una medición ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_pacientes_manuales (id, nombre, apellido, fecha_nacimiento, sexo, creado_por)
     values ('10000000-0000-0000-0000-000000000001', 'Julieta', 'Marchetti', '2002-04-05', 'F', '00000000-0000-0000-0000-0000000000a1')$q$) = 1,
  'A: investigador inserta un paciente manual');

select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_mediciones (paciente_manual_id, fecha_medicion, investigador_id, nivel_actividad, series, estado)
     values ('10000000-0000-0000-0000-000000000001', '2026-10-24', '00000000-0000-0000-0000-0000000000a1', 'moderada', '{"peso":[59.5,59.5]}', 'vigente')$q$) = 1,
  'A: investigador inserta una medición vigente de un paciente manual');

select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_mediciones (user_id, fecha_medicion, investigador_id, estado)
     values ('00000000-0000-0000-0000-0000000000a3', '2026-10-24', '00000000-0000-0000-0000-0000000000a1', 'borrador')$q$) = 1,
  'A: investigador inserta un borrador de un deportista registrado');

select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_deportistas_datos (user_id, masa_osea_referencia)
     values ('00000000-0000-0000-0000-0000000000a3', 6.196)$q$) = 1,
  'A: investigador guarda la masa ósea de referencia de un deportista');

-- ───────── B. el administrador también lee y escribe ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a2', 'authenticated',
  'select * from public.antropometria_mediciones') = 2, 'B: administrador lee las mediciones');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a2', 'authenticated',
  $q$update public.antropometria_mediciones set estado = 'anulada' where paciente_manual_id = '10000000-0000-0000-0000-000000000001'$q$) = 1,
  'B: administrador anula una medición (baja lógica)');

-- ───────── C. deportista_ucc y particular NO ven ni escriben nada ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a3', 'authenticated', 'select * from public.antropometria_mediciones') = 0,
  'C: deportista_ucc ve 0 mediciones (ni siquiera las suyas)');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a3', 'authenticated', 'select * from public.antropometria_pacientes_manuales') = 0,
  'C: deportista_ucc ve 0 pacientes manuales');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a3', 'authenticated', 'select * from public.antropometria_deportistas_datos') = 0,
  'C: deportista_ucc ve 0 datos auxiliares');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a4', 'authenticated', 'select * from public.antropometria_mediciones') = 0,
  'C: particular ve 0 mediciones');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a3', 'authenticated',
  $q$insert into public.antropometria_mediciones (user_id, fecha_medicion, investigador_id, estado)
     values ('00000000-0000-0000-0000-0000000000a3', '2026-10-01', '00000000-0000-0000-0000-0000000000a3', 'borrador')$q$) = -1,
  'C: deportista_ucc NO puede insertar mediciones');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a4', 'authenticated',
  $q$insert into public.antropometria_pacientes_manuales (nombre, apellido, fecha_nacimiento, sexo, creado_por)
     values ('X', 'Y', '2000-01-01', 'M', '00000000-0000-0000-0000-0000000000a4')$q$) = -1,
  'C: particular NO puede insertar pacientes manuales');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a3', 'authenticated',
  $q$update public.antropometria_mediciones set estado = 'anulada'$q$) = 0,
  'C: deportista_ucc NO puede modificar mediciones (0 filas visibles)');

-- ───────── D. anon: acceso denegado ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'anon', 'select * from public.antropometria_mediciones') = -1,
  'D: anon no puede leer mediciones');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'anon', 'select * from public.antropometria_pacientes_manuales') = -1,
  'D: anon no puede leer pacientes manuales');

-- ───────── E. nadie borra (baja lógica) ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'delete from public.antropometria_mediciones') = -1,
  'E: investigador NO puede borrar mediciones');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a2', 'authenticated', 'delete from public.antropometria_pacientes_manuales') = -1,
  'E: administrador NO puede borrar pacientes manuales');

-- ───────── F. restricciones de integridad ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_mediciones (user_id, paciente_manual_id, fecha_medicion, investigador_id)
     values ('00000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-000000000001', '2026-10-01', '00000000-0000-0000-0000-0000000000a1')$q$) = -1,
  'F: una medición no puede tener deportista Y paciente manual a la vez');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_mediciones (fecha_medicion, investigador_id)
     values ('2026-10-01', '00000000-0000-0000-0000-0000000000a1')$q$) = -1,
  'F: una medición sin dueño es inválida');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_pacientes_manuales (nombre, apellido, fecha_nacimiento, sexo, creado_por)
     values ('Menor', 'Edad', current_date - interval '17 years', 'F', '00000000-0000-0000-0000-0000000000a1')$q$) = -1,
  'F: no se puede dar de alta a un menor de 18 años');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_mediciones (user_id, fecha_medicion, investigador_id, estado)
     values ('00000000-0000-0000-0000-0000000000a3', '2026-10-02', '00000000-0000-0000-0000-0000000000a2', 'borrador')$q$) = -1,
  'F: no se puede registrar a otro usuario como investigador que mide');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_mediciones (user_id, fecha_medicion, investigador_id, estado)
     values ('00000000-0000-0000-0000-0000000000a3', '2026-10-03', '00000000-0000-0000-0000-0000000000a1', 'vigente')$q$) = -1,
  'F: una medición vigente exige nivel de actividad');

-- ───────── G. auditoría: quién y cuándo editó; el investigador original no cambia ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a2', 'authenticated',
  $q$update public.antropometria_mediciones set deporte = 'voleibol', investigador_id = '00000000-0000-0000-0000-0000000000a2'
     where paciente_manual_id = '10000000-0000-0000-0000-000000000001'$q$) = 1,
  'G: administrador edita una medición');
select pg_temp.chk((select actualizado_por = '00000000-0000-0000-0000-0000000000a2' and investigador_id = '00000000-0000-0000-0000-0000000000a1'
                    from public.antropometria_mediciones where paciente_manual_id = '10000000-0000-0000-0000-000000000001'),
  'G: actualizado_por = quien editó; investigador_id (quien midió) no se pisa');

select 'TODOS LOS CASOS OK' as resultado;
rollback;
