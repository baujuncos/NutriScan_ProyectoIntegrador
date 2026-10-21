-- ============================================================
-- Prueba de la migración 020 (NUT-192/NUT-193) para un proyecto/base DE PRUEBA.
-- NUNCA correr contra producción. Todo corre dentro de una transacción que
-- termina en ROLLBACK: no deja datos. Falla (RAISE EXCEPTION) en el primer caso
-- que no se cumple; si llega al final imprime "TODOS LOS CASOS OK".
-- Requiere 001–020 aplicadas. Crea usuarios en auth.users: en Supabase real esa
-- tabla puede tener columnas/triggers extra; ajustar el insert si hace falta.
-- ============================================================
begin;

create or replace function pg_temp.chk(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALLÓ: %', msg; end if;
  raise notice 'ok  - %', msg;
end $$;

-- Supabase ya da USAGE de secuencias a authenticated por default; en un Postgres pelado hace falta (se revierte con el rollback).
grant usage on all sequences in schema public to authenticated;

-- Usuarios: u1 particular, u2 deportista_ucc, u3 investigador.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'u1@test.local'),
  ('00000000-0000-0000-0000-000000000002', 'u2@test.local'),
  ('00000000-0000-0000-0000-000000000003', 'u3@test.local');
insert into public.profiles (user_id, nombre, apellido, email, role) values
  ('00000000-0000-0000-0000-000000000001', 'U1', 'Particular', 'u1@test.local', 'particular'),
  ('00000000-0000-0000-0000-000000000002', 'U2', 'Deportista', 'u2@test.local', 'deportista_ucc'),
  ('00000000-0000-0000-0000-000000000003', 'U3', 'Investigador', 'u3@test.local', 'investigador');

-- Un alimento de catálogo para el caso "validado y vinculado".
insert into public.alimentos (id_alimento, nombre, categoria, fuente, kcal_100g, proteinas_100g, grasas_100g, carbs_100g)
values (2000001, 'Pan lactal validado', 'Panificados', 'VALIDADO', 270, 9, 4, 50);

-- ───────── A. carga manual nueva (u1, particular) ─────────
set local role service_role;
select public.registrar_item_manual('00000000-0000-0000-0000-000000000001', current_date, 'almuerzo', 'solido', 'Tarta casera de verduras', 150);
reset role;

select pg_temp.chk((select count(*) from public.alimentos_pendientes_validacion where nombre_normalizado = 'tarta casera de verduras') = 1, 'A: una sola entrada en la cola');
select pg_temp.chk((select origen from public.alimentos_pendientes_validacion where nombre_normalizado = 'tarta casera de verduras') = 'manual', 'A: origen = manual');
select pg_temp.chk((select estado from public.alimentos_pendientes_validacion where nombre_normalizado = 'tarta casera de verduras') = 'pendiente', 'A: estado = pendiente');
select pg_temp.chk((select nombre_original from public.alimentos_pendientes_validacion where nombre_normalizado = 'tarta casera de verduras') = 'Tarta casera de verduras', 'A: guarda el primer nombre visto');
select pg_temp.chk((select count(*) from public.items where nombre_manual = 'Tarta casera de verduras' and origen_macros = 'pendiente' and id_alimento is null and kcal_100g is null and proteinas_100g is null and id_pendiente is not null and id_guardado_item is null) = 1, 'A: ítem pendiente, sin id_alimento, snapshot NULL, vinculado a la cola');
select pg_temp.chk((select kcal_total from public.ingestas where id_usuario = '00000000-0000-0000-0000-000000000001') = 0, 'A: la ingesta no suma nada (0 almacenado = no disponible, lo marca origen_macros)');
select pg_temp.chk((select ocurrencias = 0 and ocurrencias_manuales = 1 and usuarios_distintos = 1 and origen = 'manual' from public.v_alimentos_pendientes where nombre_normalizado = 'tarta casera de verduras'), 'A: vista -> ocurrencias 0, manuales 1, usuarios 1');

-- ───────── B. repetida por otro usuario y por el mismo ─────────
set local role service_role;
select public.registrar_item_manual('00000000-0000-0000-0000-000000000002', current_date, 'cena', 'solido', '  TARTA   Casera de VERDURAS ', 200);
select public.registrar_item_manual('00000000-0000-0000-0000-000000000001', current_date, 'cena', 'solido', 'tarta casera de verduras', 100);
reset role;
select pg_temp.chk((select count(*) from public.alimentos_pendientes_validacion where nombre_normalizado = 'tarta casera de verduras') = 1, 'B: sigue habiendo UNA sola entrada (nombre normalizado)');
select pg_temp.chk((select ocurrencias_manuales = 3 and usuarios_distintos = 2 from public.v_alimentos_pendientes where nombre_normalizado = 'tarta casera de verduras'), 'B: 3 solicitudes de 2 usuarios distintos');
select pg_temp.chk((select nombre_original from public.alimentos_pendientes_validacion where nombre_normalizado = 'tarta casera de verduras') = 'Tarta casera de verduras', 'B: el nombre original no se pisa');

-- ───────── C. nombre ya validado (sin vínculo) y validado vinculado a catálogo ─────────
insert into public.alimentos_pendientes_validacion (nombre_original, nombre_normalizado, origen, estado, nombre_final, final_kcal_100g, final_proteinas_100g, final_grasas_100g, final_carbs_100g)
values ('Budín de limón', 'budin de limon', 'manual', 'validado', 'Budín de limón', 400, 5, 15, 60);
insert into public.alimentos_pendientes_validacion (nombre_original, nombre_normalizado, origen, estado, nombre_final, final_kcal_100g, final_proteinas_100g, final_grasas_100g, final_carbs_100g, id_alimento_vinculado)
values ('Pan lactal validado', 'pan lactal validado', 'manual', 'validado', 'Pan lactal validado', 270, 9, 4, 50, 2000001);
set local role service_role;
select public.registrar_item_manual('00000000-0000-0000-0000-000000000001', current_date, 'merienda', 'solido', 'budin de limon', 50);
select public.registrar_item_manual('00000000-0000-0000-0000-000000000001', current_date, 'merienda', 'solido', 'Pan lactal validado', 100);
reset role;
select pg_temp.chk((select origen_macros = 'validado' and id_alimento is null and kcal_100g = 400 and kcal = 200 and carbs_g = 30 from public.items where nombre_manual = 'budin de limon'), 'C: validado sin vínculo -> snapshot final, id_alimento null, kcal = 400*50/100');
select pg_temp.chk((select origen_macros = 'validado' and id_alimento = 2000001 and kcal_100g is null and kcal = 270 from public.items where nombre_manual = 'Pan lactal validado'), 'C: validado vinculado -> id_alimento del catálogo, kcal desde el catálogo');
select pg_temp.chk((select estado = 'validado' from public.alimentos_pendientes_validacion where nombre_normalizado = 'budin de limon'), 'C: la entrada validada no cambia de estado');

-- ───────── D. nombre ya descartado ─────────
insert into public.alimentos_pendientes_validacion (nombre_original, nombre_normalizado, origen, estado, observaciones)
values ('Comida inventada', 'comida inventada', 'manual', 'descartado', 'No es un alimento');
set local role service_role;
select public.registrar_item_manual('00000000-0000-0000-0000-000000000002', current_date, 'cena', 'solido', 'Comida inventada', 80);
reset role;
select pg_temp.chk((select origen_macros = 'descartado' and kcal_100g is null and id_alimento is null and id_pendiente is not null from public.items where nombre_manual = 'Comida inventada'), 'D: el ítem hereda "descartado", snapshot NULL');
select pg_temp.chk((select estado = 'descartado' from public.alimentos_pendientes_validacion where nombre_normalizado = 'comida inventada') and (select count(*) from public.alimentos_pendientes_validacion where nombre_normalizado = 'comida inventada') = 1, 'D: no reabre la cola (sigue descartada, una sola fila)');

-- ───────── E. rol investigador: ítem legado, sin cola ─────────
set local role service_role;
select public.registrar_item_manual('00000000-0000-0000-0000-000000000003', current_date, 'almuerzo', 'solido', 'Alimento solo investigador', 60);
reset role;
select pg_temp.chk((select origen_macros is null and id_pendiente is null and id_alimento is null and nombre_manual = 'Alimento solo investigador' from public.items where nombre_manual = 'Alimento solo investigador'), 'E: investigador -> ítem manual legado (origen_macros NULL, sin id_pendiente)');
select pg_temp.chk((select count(*) from public.alimentos_pendientes_validacion where nombre_normalizado = 'alimento solo investigador') = 0, 'E: investigador -> NO entra a la cola');

-- ───────── F. colisión con un ítem de IA del mismo nombre ─────────
insert into public.alimentos_pendientes_validacion (nombre_original, nombre_normalizado, origen)
values ('Milanesa casera', 'milanesa casera', 'ia');
insert into public.detecciones_ia (id_deteccion, id_usuario, prompt_version, modelo, vajilla_tipo, vajilla_diametro_cm, angulo_captura_grados, total_estimated_weight_grams)
values (9001, '00000000-0000-0000-0000-000000000002', 'v1', 'm', 'plato_playo', 26, 45, 300);
insert into public.detecciones_guardados (id_guardado, id_usuario, id_deteccion, tipo_comida)
values (9001, '00000000-0000-0000-0000-000000000002', 9001, 'cena');
insert into public.detecciones_guardados_items (id_guardado, name, category, grams, origin, id_pendiente)
values (9001, 'Milanesa casera', 'carnes', 120, 'ai', (select id_pendiente from public.alimentos_pendientes_validacion where nombre_normalizado = 'milanesa casera'));
set local role service_role;
select public.registrar_item_manual('00000000-0000-0000-0000-000000000001', current_date, 'cena', 'solido', 'milanesa casera', 90);
select public.registrar_item_manual('00000000-0000-0000-0000-000000000002', current_date, 'cena', 'solido', 'Milanesa Casera', 70);
reset role;
select pg_temp.chk((select origen = 'ia' from public.alimentos_pendientes_validacion where nombre_normalizado = 'milanesa casera'), 'F: la entrada creada por IA conserva origen = ia');
select pg_temp.chk((select ocurrencias = 1 and ocurrencias_manuales = 2 from public.v_alimentos_pendientes where nombre_normalizado = 'milanesa casera'), 'F: ocurrencias (con foto) = 1 y ocurrencias_manuales = 2');
select pg_temp.chk((select usuarios_distintos = 2 from public.v_alimentos_pendientes where nombre_normalizado = 'milanesa casera'), 'F: usuarios_distintos = 2 (u2 por ambos caminos cuenta una vez)');

-- ───────── G. nombre que no se puede normalizar ─────────
set local role service_role;
select public.registrar_item_manual('00000000-0000-0000-0000-000000000001', current_date, 'colacion', 'solido', '!!!', 10);
reset role;
select pg_temp.chk((select origen_macros = 'sin_datos' and id_pendiente is null from public.items where nombre_manual = '!!!'), 'G: nombre no normalizable -> sin_datos, sin cola');

-- ───────── H. permisos y guardas ─────────
do $$ begin
  set local role authenticated;
  perform public.registrar_item_manual('00000000-0000-0000-0000-000000000001', current_date, 'cena', 'solido', 'x', 1);
  reset role;
  raise exception 'FALLÓ: authenticated pudo ejecutar registrar_item_manual';
exception when insufficient_privilege then
  reset role; raise notice 'ok  - H: authenticated NO puede ejecutar registrar_item_manual';
end $$;
do $$ begin
  set local role anon;
  perform public.registrar_item_manual('00000000-0000-0000-0000-000000000001', current_date, 'cena', 'solido', 'x', 1);
  reset role;
  raise exception 'FALLÓ: anon pudo ejecutar registrar_item_manual';
exception when insufficient_privilege then
  reset role; raise notice 'ok  - H: anon NO puede ejecutar registrar_item_manual';
end $$;
do $$ declare v_pid bigint := (select id_pendiente from public.alimentos_pendientes_validacion where nombre_normalizado = 'milanesa casera'); begin
  -- v_pid se lee ANTES de pasar a authenticated: la cola no es legible para un usuario.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  update public.items set id_pendiente = v_pid where nombre_manual = 'Tarta casera de verduras';
  reset role;
  raise exception 'FALLÓ: un usuario pudo reescribir items.id_pendiente';
exception when others then
  reset role;
  if sqlerrm = 'COLUMNA_PROTEGIDA' then raise notice 'ok  - H: items.id_pendiente protegida contra UPDATE de un usuario';
  else raise exception 'FALLÓ: error inesperado: %', sqlerrm; end if;
end $$;
do $$ declare v_pid bigint := (select id_pendiente from public.alimentos_pendientes_validacion where nombre_normalizado = 'milanesa casera'); begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  insert into public.items (id_ingesta, nombre_manual, tipo_item, cantidad, id_pendiente)
  select i.id_ingesta, 'trampa', 'solido', 10, v_pid
  from public.ingestas i where i.id_usuario = '00000000-0000-0000-0000-000000000001' limit 1;
  reset role;
  raise exception 'FALLÓ: un usuario pudo insertar un ítem con id_pendiente';
exception when others then
  reset role;
  if sqlerrm = 'COLUMNA_PROTEGIDA' then raise notice 'ok  - H: items.id_pendiente protegida contra INSERT de un usuario';
  else raise exception 'FALLÓ: error inesperado: %', sqlerrm; end if;
end $$;
-- Control: un usuario SÍ puede insertar su propio ítem manual sin id_pendiente (flujo viejo/legado intacto).
do $$ declare n int; begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  insert into public.items (id_ingesta, nombre_manual, tipo_item, cantidad)
  select i.id_ingesta, 'control', 'solido', 10 from public.ingestas i where i.id_usuario = '00000000-0000-0000-0000-000000000001' limit 1;
  get diagnostics n = row_count;
  reset role;
  if n <> 1 then raise exception 'FALLÓ: control no insertó'; end if;
  raise notice 'ok  - H: control, un usuario puede insertar su ítem sin columnas protegidas';
end $$;

-- ───────── I. quién ve la vista ─────────
do $$ declare n int; begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  select count(*) into n from public.v_alimentos_pendientes;
  reset role;
  if n <> 0 then raise exception 'FALLÓ: un particular ve % filas de la cola', n; end if;
  raise notice 'ok  - I: un particular ve 0 filas de la cola';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
  set local role authenticated;
  select count(*) into n from public.v_alimentos_pendientes;
  reset role;
  if n < 4 then raise exception 'FALLÓ: el investigador ve % filas', n; end if;
  raise notice 'ok  - I: el investigador ve la cola (% filas)', n;
end $$;

-- ───────── J. entradas inválidas ─────────
do $$ begin
  begin
    perform public.registrar_item_manual('00000000-0000-0000-0000-000000000001', current_date, 'cena', 'solido', '   ', 10);
    raise exception 'FALLÓ: aceptó nombre vacío';
  exception when others then
    if sqlerrm <> 'INVALID' then raise exception 'FALLÓ: nombre vacío dio %', sqlerrm; end if;
  end;
  begin
    perform public.registrar_item_manual('00000000-0000-0000-0000-000000000001', current_date, 'cena', 'solido', 'algo', 0);
    raise exception 'FALLÓ: aceptó cantidad 0';
  exception when others then
    if sqlerrm <> 'INVALID' then raise exception 'FALLÓ: cantidad 0 dio %', sqlerrm; end if;
  end;
  raise notice 'ok  - J: nombre vacío y cantidad 0 -> INVALID';
end $$;

-- ───────── K. la vista conserva el orden de columnas existentes ─────────
select pg_temp.chk((select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'v_alimentos_pendientes') like '%id_alimento_propio,ocurrencias,ultima_ocurrencia,ocurrencias_manuales,usuarios_distintos,origen', 'K: columnas existentes en su orden y las nuevas al final');

select 'TODOS LOS CASOS OK' as resultado;
rollback;

-- ============================================================
-- No regresión del camino de IA (registrar_guardado_deteccion no cambió)
-- ============================================================
begin;
create or replace function pg_temp.chk(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALLÓ: %', msg; end if; raise notice 'ok  - %', msg; end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a2', 'ia2@test.local');
insert into public.profiles (user_id, nombre, apellido, email, role) values ('00000000-0000-0000-0000-0000000000a2', 'I', 'A', 'ia2@test.local', 'deportista_ucc');
insert into public.detecciones_ia (id_deteccion, id_usuario, prompt_version, modelo, vajilla_tipo, vajilla_diametro_cm, angulo_captura_grados, total_estimated_weight_grams)
values (9100, '00000000-0000-0000-0000-0000000000a2', 'v1', 'm', 'plato_playo', 26, 45, 300);
set local role service_role;
select public.registrar_guardado_deteccion('00000000-0000-0000-0000-0000000000a2', 9100, current_date, 'cena', '{}'::uuid[],
  '[{"name":"Zapallo grillado","category":"verduras","grams":100,"origin":"ai","metodo_match":"ninguno","ia":{"kcal_100g":30,"proteinas_100g":1,"grasas_100g":0.5,"carbs_100g":6}}]'::jsonb, 'gemini', 'v1');
reset role;
select pg_temp.chk((select origen = 'ia' and estado = 'pendiente' and gemini_kcal_100g = 30 from public.alimentos_pendientes_validacion where nombre_normalizado = 'zapallo grillado'), 'IA: entrada creada con origen ia (default) y valores de Gemini');
select pg_temp.chk((select origen_macros = 'pendiente' and kcal_100g = 30 and kcal = 30 and id_guardado_item is not null and id_pendiente is null from public.items where nombre_manual = 'Zapallo grillado'), 'IA: ítem pendiente con snapshot de Gemini, vinculado por id_guardado_item (id_pendiente NULL)');
select pg_temp.chk((select ocurrencias = 1 and ocurrencias_manuales = 0 and usuarios_distintos = 1 and origen = 'ia' from public.v_alimentos_pendientes where nombre_normalizado = 'zapallo grillado'), 'IA: vista -> ocurrencias 1, manuales 0, usuarios 1');
select 'IA OK' as resultado;
rollback;
