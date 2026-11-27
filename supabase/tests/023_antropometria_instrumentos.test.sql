-- ============================================================
-- Prueba de la migración 023 (NUT-246/NUT-240, instrumentos y "investigador que
-- midió") para un proyecto/base DE PRUEBA. NUNCA correr contra producción.
-- Todo corre dentro de una transacción que termina en ROLLBACK: no deja datos.
-- Falla (RAISE EXCEPTION) en el primer caso que no se cumple; si llega al final
-- imprime "TODOS LOS CASOS OK".
-- Requiere el esquema base + 022 + 023 aplicados. Crea usuarios en auth.users:
-- en Supabase real esa tabla puede tener columnas/triggers extra; ajustar el
-- insert si hace falta.
-- Uso: psql "$DATABASE_URL" -f supabase/tests/023_antropometria_instrumentos.test.sql
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

insert into public.antropometria_pacientes_manuales (id, nombre, apellido, fecha_nacimiento, sexo, creado_por) values
  ('10000000-0000-0000-0000-000000000001', 'Julieta', 'Marchetti', '2002-04-05', 'F', '00000000-0000-0000-0000-0000000000a1');

-- ───────── A. "Mis instrumentos": cada investigador maneja solo los suyos ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_instrumentos_investigador (investigador_id, instrumento_balanza, instrumento_plicometro)
     values ('00000000-0000-0000-0000-0000000000a1', 'Balanza digital Tanita', 'Harpenden')$q$) = 1,
  'A: investigador guarda sus instrumentos');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$update public.antropometria_instrumentos_investigador set instrumento_cinta = 'Cescorf' where investigador_id = '00000000-0000-0000-0000-0000000000a1'$q$) = 1,
  'A: investigador actualiza sus instrumentos');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_instrumentos_investigador (investigador_id) values ('00000000-0000-0000-0000-0000000000a2')$q$) = -1,
  'A: investigador NO puede crear los instrumentos de otro');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a2', 'authenticated',
  $q$insert into public.antropometria_instrumentos_investigador (investigador_id, instrumento_balanza)
     values ('00000000-0000-0000-0000-0000000000a2', 'Balanza del administrador')$q$) = 1,
  'A: administrador guarda los suyos');

-- ───────── B. privacidad: ni el administrador ve los de otros ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a2', 'authenticated',
  'select * from public.antropometria_instrumentos_investigador') = 1,
  'B: administrador ve solo su propia fila');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a2', 'authenticated',
  $q$update public.antropometria_instrumentos_investigador set instrumento_balanza = 'pisada' where investigador_id = '00000000-0000-0000-0000-0000000000a1'$q$) = 0,
  'B: administrador NO puede modificar los instrumentos de otro (0 filas visibles)');

-- ───────── C. otros roles y anon: nada ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a3', 'authenticated',
  'select * from public.antropometria_instrumentos_investigador') = 0,
  'C: deportista_ucc ve 0 filas');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a4', 'authenticated',
  $q$insert into public.antropometria_instrumentos_investigador (investigador_id) values ('00000000-0000-0000-0000-0000000000a4')$q$) = -1,
  'C: particular NO puede insertar instrumentos');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'anon',
  'select * from public.antropometria_instrumentos_investigador') = -1,
  'C: anon no puede leer instrumentos');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  'delete from public.antropometria_instrumentos_investigador') = -1,
  'C: nadie borra instrumentos (sin permiso de DELETE)');

-- ───────── D. largo máximo de 120 caracteres ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$update public.antropometria_instrumentos_investigador set instrumento_balanza = repeat('x', 121) where investigador_id = '00000000-0000-0000-0000-0000000000a1'$q$) = -1,
  'D: un instrumento de más de 120 caracteres se rechaza');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$update public.antropometria_instrumentos_investigador set instrumento_balanza = repeat('x', 120) where investigador_id = '00000000-0000-0000-0000-0000000000a1'$q$) = 1,
  'D: uno de exactamente 120 se acepta');

-- ───────── E. mediciones: instrumentos y "medido por" ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_mediciones (id, paciente_manual_id, fecha_medicion, investigador_id, estado,
                                                  medido_por, instrumento_balanza, instrumento_cinta)
     values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2026-10-24',
             '00000000-0000-0000-0000-0000000000a1', 'borrador',
             '00000000-0000-0000-0000-0000000000a2', 'Tanita BC-601', 'Lufkin')$q$) = 1,
  'E: la medición guarda instrumentos y un administrador como "medido por"');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_mediciones (paciente_manual_id, fecha_medicion, investigador_id, estado)
     values ('10000000-0000-0000-0000-000000000001', '2026-10-25', '00000000-0000-0000-0000-0000000000a1', 'borrador')$q$) = 1,
  'E: instrumentos y "medido por" son opcionales (NULL)');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_mediciones (paciente_manual_id, fecha_medicion, investigador_id, estado, medido_por)
     values ('10000000-0000-0000-0000-000000000001', '2026-10-26', '00000000-0000-0000-0000-0000000000a1', 'borrador',
             '00000000-0000-0000-0000-0000000000a3')$q$) = -1,
  'E: "medido por" no puede ser un deportista');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$update public.antropometria_mediciones set medido_por = '00000000-0000-0000-0000-0000000000a4'
     where id = '20000000-0000-0000-0000-000000000001'$q$) = -1,
  'E: tampoco al editar (un usuario "particular" no puede ser quien midió)');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$update public.antropometria_mediciones set instrumento_balanza = repeat('x', 121)
     where id = '20000000-0000-0000-0000-000000000001'$q$) = -1,
  'E: un instrumento de la medición de más de 120 caracteres se rechaza');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$update public.antropometria_mediciones set medido_por = '00000000-0000-0000-0000-0000000000a1', instrumento_balanza = null
     where id = '20000000-0000-0000-0000-000000000001'$q$) = 1,
  'E: se puede cambiar quién midió a otro investigador y vaciar un instrumento');

-- ───────── F. el investigador que CREÓ la medición no cambia ─────────
select pg_temp.chk((select investigador_id = '00000000-0000-0000-0000-0000000000a1' and medido_por = '00000000-0000-0000-0000-0000000000a1'
                    from public.antropometria_mediciones where id = '20000000-0000-0000-0000-000000000001'),
  'F: investigador_id (creador) sigue igual; medido_por es otra columna');

-- ───────── G. editar otros campos no revalida "medido por" si no cambió ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$update public.antropometria_mediciones set deporte = 'voleibol' where id = '20000000-0000-0000-0000-000000000001'$q$) = 1,
  'G: editar otros campos de la medición sigue funcionando');

select 'TODOS LOS CASOS OK' as resultado;
rollback;
