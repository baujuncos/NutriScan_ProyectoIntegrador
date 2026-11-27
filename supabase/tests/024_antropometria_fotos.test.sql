-- ============================================================
-- Prueba de la migración 024 (NUT-251/NUT-240, fotos posturales) para un
-- proyecto/base DE PRUEBA. NUNCA correr contra producción.
-- Todo corre dentro de una transacción que termina en ROLLBACK: no deja datos.
-- Falla (RAISE EXCEPTION) en el primer caso que no se cumple; si llega al final
-- imprime "TODOS LOS CASOS OK".
-- Requiere el esquema base + 022 + 023 + 024 aplicados. Crea usuarios en
-- auth.users y objetos en storage.objects: en Supabase real esas tablas pueden
-- tener columnas/triggers extra; ajustar los insert si hace falta. Las filas de
-- storage.objects de la prueba se descartan con el ROLLBACK (no hay archivos
-- reales detrás).
-- Uso: psql "$DATABASE_URL" -f supabase/tests/024_antropometria_fotos.test.sql
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

-- Usuarios: a1 = investigador, a2 = administrador, a3 = deportista_ucc, a4 = particular.
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

-- Dos mediciones: m1 vigente y m2 anulada.
insert into public.antropometria_mediciones (id, paciente_manual_id, fecha_medicion, investigador_id, estado) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2026-10-24', '00000000-0000-0000-0000-0000000000a1', 'vigente'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '2026-10-25', '00000000-0000-0000-0000-0000000000a1', 'anulada');

-- ───────── A. el bucket es privado y con límites ─────────
select pg_temp.chk((select public = false and file_size_limit = 3145728
                           and allowed_mime_types @> array['image/jpeg', 'image/webp', 'image/png']
                    from storage.buckets where id = 'antropometria-fotos'),
  'A: el bucket antropometria-fotos existe, es privado, de 3 MB y solo imágenes');

-- ───────── B. tabla: el investigador registra fotos en posiciones fijas ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_fotos (medicion_id, posicion, path)
     values ('20000000-0000-0000-0000-000000000001', 'frente', '20000000-0000-0000-0000-000000000001/frente-aaaa.jpg')$q$) = 1,
  'B: investigador registra la foto de frente');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_fotos (medicion_id, posicion, path)
     values ('20000000-0000-0000-0000-000000000001', 'frente', '20000000-0000-0000-0000-000000000001/frente-bbbb.jpg')$q$) = -1,
  'B: no puede haber dos fotos en la misma posición (unique medicion + posicion)');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_fotos (medicion_id, posicion, path)
     values ('20000000-0000-0000-0000-000000000001', 'costado', '20000000-0000-0000-0000-000000000001/costado-cccc.jpg')$q$) = -1,
  'B: una posición fuera de frente/lateral/espalda se rechaza');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_fotos (medicion_id, posicion, path)
     values ('20000000-0000-0000-0000-000000000001', 'lateral', '20000000-0000-0000-0000-000000000001/frente-aaaa.jpg')$q$) = -1,
  'B: el path es único');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a2', 'authenticated',
  $q$insert into public.antropometria_fotos (medicion_id, posicion, path)
     values ('20000000-0000-0000-0000-000000000001', 'lateral', '20000000-0000-0000-0000-000000000001/lateral-dddd.jpg')$q$) = 1,
  'B: administrador registra la foto lateral');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_fotos (medicion_id, posicion, path)
     values ('20000000-0000-0000-0000-000000000001', 'espalda', '20000000-0000-0000-0000-000000000001/espalda-eeee.jpg')$q$) = 1,
  'B: y la de espalda: ya son 3 (el máximo)');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into public.antropometria_fotos (medicion_id, posicion, path, creado_por)
     values ('20000000-0000-0000-0000-000000000001', 'frente', 'x/otra.jpg', '00000000-0000-0000-0000-0000000000a2')$q$) = -1,
  'B: creado_por tiene que ser el usuario con sesión');

-- ───────── C. tabla: reemplazar una foto (update solo de path y creado_en) ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$update public.antropometria_fotos set path = '20000000-0000-0000-0000-000000000001/frente-ffff.jpg', creado_en = now()
     where medicion_id = '20000000-0000-0000-0000-000000000001' and posicion = 'frente'$q$) = 1,
  'C: investigador reemplaza el path de una posición');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$update public.antropometria_fotos set posicion = 'lateral' where posicion = 'frente'$q$) = -1,
  'C: no se puede cambiar la posición ni otras columnas (grant update acotado)');

-- ───────── D. tabla: otros roles y anon no ven ni tocan nada ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a2', 'authenticated',
  'select * from public.antropometria_fotos') = 3,
  'D: administrador ve las 3 fotos');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a3', 'authenticated',
  'select * from public.antropometria_fotos') = 0,
  'D: deportista_ucc ve 0 filas');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a4', 'authenticated',
  'select * from public.antropometria_fotos') = 0,
  'D: particular ve 0 filas');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a3', 'authenticated',
  $q$insert into public.antropometria_fotos (medicion_id, posicion, path)
     values ('20000000-0000-0000-0000-000000000002', 'frente', '20000000-0000-0000-0000-000000000002/frente-gggg.jpg')$q$) = -1,
  'D: deportista_ucc NO puede registrar fotos');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a3', 'authenticated',
  'delete from public.antropometria_fotos') = 0,
  'D: deportista_ucc no borra nada (0 filas visibles)');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'anon',
  'select * from public.antropometria_fotos') = -1,
  'D: anon no puede leer la tabla');

-- ───────── E. tabla: el investigador quita una foto ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$delete from public.antropometria_fotos where medicion_id = '20000000-0000-0000-0000-000000000001' and posicion = 'espalda'$q$) = 1,
  'E: investigador quita la foto de espalda');

-- ───────── F. storage: subir solo a la carpeta de una medición existente y no anulada ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into storage.objects (bucket_id, name, owner)
     values ('antropometria-fotos', '20000000-0000-0000-0000-000000000001/espalda-hhhh.jpg', '00000000-0000-0000-0000-0000000000a1')$q$) = 1,
  'F: investigador sube a la carpeta de una medición vigente');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into storage.objects (bucket_id, name, owner)
     values ('antropometria-fotos', '99999999-9999-4999-8999-999999999999/frente-iiii.jpg', '00000000-0000-0000-0000-0000000000a1')$q$) = -1,
  'F: NO puede subir a la carpeta de una medición que no existe');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into storage.objects (bucket_id, name, owner)
     values ('antropometria-fotos', 'cualquier-cosa/frente-jjjj.jpg', '00000000-0000-0000-0000-0000000000a1')$q$) = -1,
  'F: NO puede subir a una carpeta que no es un id de medición');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into storage.objects (bucket_id, name, owner)
     values ('antropometria-fotos', '20000000-0000-0000-0000-000000000002/frente-kkkk.jpg', '00000000-0000-0000-0000-0000000000a1')$q$) = -1,
  'F: NO puede subir a una medición anulada');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a3', 'authenticated',
  $q$insert into storage.objects (bucket_id, name, owner)
     values ('antropometria-fotos', '20000000-0000-0000-0000-000000000001/frente-llll.jpg', '00000000-0000-0000-0000-0000000000a3')$q$) = -1,
  'F: deportista_ucc NO puede subir fotos posturales');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a4', 'authenticated',
  $q$insert into storage.objects (bucket_id, name, owner)
     values ('antropometria-fotos', '20000000-0000-0000-0000-000000000001/frente-mmmm.jpg', '00000000-0000-0000-0000-0000000000a4')$q$) = -1,
  'F: particular NO puede subir fotos posturales');

-- ───────── G. storage: lectura y borrado solo del panel de investigador ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a2', 'authenticated',
  $q$select * from storage.objects where bucket_id = 'antropometria-fotos'$q$) = 1,
  'G: administrador ve el objeto del bucket');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a3', 'authenticated',
  $q$select * from storage.objects where bucket_id = 'antropometria-fotos'$q$) = 0,
  'G: deportista_ucc no ve ningún objeto del bucket');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a3', 'authenticated',
  $q$delete from storage.objects where bucket_id = 'antropometria-fotos'$q$) = 0,
  'G: deportista_ucc no borra nada (0 filas visibles)');
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$delete from storage.objects where bucket_id = 'antropometria-fotos' and name = '20000000-0000-0000-0000-000000000001/espalda-hhhh.jpg'$q$) = 1,
  'G: investigador borra un objeto del bucket (quitar foto / anular medición)');

-- ───────── H. las fotos de otros buckets no se ven afectadas ─────────
select pg_temp.chk(pg_temp.como('00000000-0000-0000-0000-0000000000a1', 'authenticated',
  $q$insert into storage.objects (bucket_id, name, owner)
     values ('detecciones-fotos', '20000000-0000-0000-0000-000000000001/frente-nnnn.jpg', '00000000-0000-0000-0000-0000000000a1')$q$) = -1,
  'H: las policies de antropometria-fotos no abren otros buckets');

-- ───────── I. borrar la medición borra sus filas de fotos (los objetos los borra la app) ─────────
delete from public.antropometria_mediciones where id = '20000000-0000-0000-0000-000000000001';
select pg_temp.chk((select count(*) from public.antropometria_fotos where medicion_id = '20000000-0000-0000-0000-000000000001') = 0,
  'I: on delete cascade: sin medición no quedan filas de fotos');

select 'TODOS LOS CASOS OK' as resultado;
rollback;
