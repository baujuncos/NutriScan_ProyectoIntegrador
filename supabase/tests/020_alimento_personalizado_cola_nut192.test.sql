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

-- ============================================================
-- NUT-194 — Resolución de los ítems manuales al validar / descartar (trigger diferido).
-- Termina en ROLLBACK. El trigger es DIFERIDO (corre al commit): como acá no hay commit,
-- después de cada acción del investigador se fuerza con `set constraints all immediate`.
-- ============================================================
begin;
create or replace function pg_temp.chk(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALLÓ: %', msg; end if; raise notice 'ok  - %', msg; end $$;
create or replace function pg_temp.pid(norm text) returns bigint language sql as
  $$ select id_pendiente from public.alimentos_pendientes_validacion where nombre_normalizado = norm $$;

grant usage on all sequences in schema public to authenticated;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'b1@t.l'), ('00000000-0000-0000-0000-0000000000b2', 'b2@t.l'),
  ('00000000-0000-0000-0000-0000000000b3', 'b3@t.l'), ('00000000-0000-0000-0000-0000000000b4', 'b4@t.l');
insert into public.profiles (user_id, nombre, apellido, email, role) values
  ('00000000-0000-0000-0000-0000000000b1', 'U1', 'P', 'b1@t.l', 'particular'),
  ('00000000-0000-0000-0000-0000000000b2', 'U2', 'P', 'b2@t.l', 'particular'),
  ('00000000-0000-0000-0000-0000000000b3', 'INV', 'I', 'b3@t.l', 'investigador'),
  ('00000000-0000-0000-0000-0000000000b4', 'DEP', 'U', 'b4@t.l', 'deportista_ucc');
insert into public.alimentos (id_alimento, nombre, categoria, fuente, kcal_100g, proteinas_100g, grasas_100g, carbs_100g)
values (5, 'Arroz SARA2', 'Cereales', 'SARA2', 130, 2.7, 0.3, 28);

-- ───────── M1. entrada solo manual, validada "A mano" ─────────
set local role service_role;
select public.registrar_item_manual('00000000-0000-0000-0000-0000000000b1', current_date - 1, 'almuerzo', 'solido', 'Flan casero', 150);
select public.registrar_item_manual('00000000-0000-0000-0000-0000000000b2', current_date - 1, 'almuerzo', 'solido', 'flan CASERO', 100);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
set local role authenticated;
select public.pendiente_validar(pg_temp.pid('flan casero'), 'Flan casero', 'Postres', 200, 5, 6, 30, 'ok', null,
  jsonb_build_object('modo','manual','id_guardado_item',null,'gramos_foto',null,'componentes','[]'::jsonb));
reset role;
-- Antes del commit (trigger diferido) los ítems siguen pendientes.
select pg_temp.chk((select count(*) from public.items where id_pendiente = pg_temp.pid('flan casero') and origen_macros = 'pendiente') = 2, 'M1: antes del commit los ítems siguen pendientes (el trigger es diferido)');
set constraints all immediate; set constraints all deferred;
select pg_temp.chk((select count(*) from public.items where id_pendiente = pg_temp.pid('flan casero') and origen_macros = 'validado' and id_alimento is null and kcal_100g = 200 and proteinas_100g = 5) = 2, 'M1: ambos ítems quedan validados con el snapshot y SIN id_alimento');
select pg_temp.chk((select array_agg(nombre_manual order by cantidad desc) from public.items where id_pendiente = pg_temp.pid('flan casero')) = array['Flan casero','flan CASERO'], 'M1: nombre_manual intacto');
select pg_temp.chk((select array_agg(cantidad order by cantidad desc) from public.items where id_pendiente = pg_temp.pid('flan casero')) = array[150::numeric, 100], 'M1: el gramaje no cambia');
select pg_temp.chk((select array_agg(kcal order by cantidad desc) from public.items where id_pendiente = pg_temp.pid('flan casero')) = array[300::numeric, 200], 'M1: kcal recalculadas con la cantidad de cada ítem (200*150/100 y 200*100/100)');
select pg_temp.chk((select kcal_total from public.ingestas where id_usuario = '00000000-0000-0000-0000-0000000000b1' and fecha = current_date - 1) = 300, 'M1: el total de la ingesta se recalcula');
select pg_temp.chk((select count(*) from public.alimentos where fuente = 'VALIDADO' and nombre = 'Flan casero' and kcal_100g = 200 and id_alimento >= 2000000) = 1, 'M1: una fila VALIDADO (id de alimentos_validados_seq) para el buscador');
select pg_temp.chk((select id_alimento_vinculado is null from public.alimentos_pendientes_validacion where id_pendiente = pg_temp.pid('flan casero')), 'M1: no se escribe id_alimento_vinculado en la cola');
select pg_temp.chk((select count(*) from public.alimentos_pendientes_auditoria where id_pendiente = pg_temp.pid('flan casero') and accion = 'resolver_manuales' and items_afectados = 2 and (despues ->> 'alimento_creado')::boolean) = 1, 'M1: auditoría resolver_manuales (2 ítems, alimento creado)');
select pg_temp.chk((select items_afectados from public.alimentos_pendientes_auditoria where id_pendiente = pg_temp.pid('flan casero') and accion = 'validar') = 0, 'M1: la auditoría de la RPC existente no cambia (cuenta 0 ítems de IA)');
-- No se dispara dos veces ni al guardar otra cosa de la cola.
update public.alimentos_pendientes_validacion set observaciones = 'nota' where id_pendiente = pg_temp.pid('flan casero');
update public.alimentos_pendientes_validacion set estado = 'validado' where id_pendiente = pg_temp.pid('flan casero');
set constraints all immediate; set constraints all deferred;
select pg_temp.chk((select count(*) from public.alimentos_pendientes_auditoria where id_pendiente = pg_temp.pid('flan casero') and accion = 'resolver_manuales') = 1, 'M1: tocar la fila sin cambiar el estado no re-dispara el trigger');
select pg_temp.chk((select count(*) from public.alimentos where fuente = 'VALIDADO' and nombre = 'Flan casero') = 1, 'M1: sigue habiendo una sola fila VALIDADO');
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
  set local role authenticated;
  perform public.pendiente_validar(pg_temp.pid('flan casero'), 'Flan casero', null, 1, 1, 1, 1, null);
  reset role;
  raise exception 'FALLÓ: se pudo re-validar una entrada ya validada';
exception when others then
  reset role;
  if sqlerrm = 'ESTADO_INVALIDO' then raise notice 'ok  - M1: re-validar una entrada ya validada -> ESTADO_INVALIDO (el trigger no corre)';
  else raise exception 'FALLÓ: re-validar dio %', sqlerrm; end if;
end $$;

-- ───────── M2. descartar una entrada solo manual (con motivo) ─────────
set local role service_role;
select public.registrar_item_manual('00000000-0000-0000-0000-0000000000b1', current_date - 2, 'cena', 'solido', 'Comida rara', 80);
select public.registrar_item_manual('00000000-0000-0000-0000-0000000000b2', current_date - 2, 'cena', 'solido', 'comida rara', 40);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
set local role authenticated;
select public.pendiente_descartar(pg_temp.pid('comida rara'), 'No es un alimento');
reset role;
set constraints all immediate; set constraints all deferred;
select pg_temp.chk((select count(*) from public.items where id_pendiente = pg_temp.pid('comida rara') and origen_macros = 'descartado' and kcal_100g is null and id_alimento is null) = 2, 'M2: los 2 ítems pasan a "descartado" y NO se borran');
select pg_temp.chk((select array_agg(cantidad order by cantidad desc) from public.items where id_pendiente = pg_temp.pid('comida rara')) = array[80::numeric, 40], 'M2: nombre y gramaje del usuario intactos');
select pg_temp.chk((select observaciones from public.alimentos_pendientes_validacion where id_pendiente = pg_temp.pid('comida rara')) = 'No es un alimento', 'M2: el motivo queda en observaciones');
select pg_temp.chk((select count(*) from public.alimentos where nombre ilike 'comida rara') = 0, 'M2: descartar no crea filas en alimentos');
select pg_temp.chk((select kcal_total from public.ingestas where id_usuario = '00000000-0000-0000-0000-0000000000b1' and fecha = current_date - 2) = 0, 'M2: el total de la ingesta no cuenta el ítem descartado');
set local role service_role;
select public.registrar_item_manual('00000000-0000-0000-0000-0000000000b2', current_date - 2, 'merienda', 'solido', 'COMIDA  rara', 10);
reset role;
select pg_temp.chk((select origen_macros = 'descartado' from public.items where cantidad = 10 and nombre_manual = 'COMIDA  rara') and (select estado = 'descartado' from public.alimentos_pendientes_validacion where id_pendiente = pg_temp.pid('comida rara')), 'M2: una carga posterior hereda "descartado" y no reabre la cola');

-- ───────── M3. validada y vinculada a un alimento existente (SARA2): no crea fila VALIDADO ─────────
set local role service_role;
select public.registrar_item_manual('00000000-0000-0000-0000-0000000000b1', current_date - 3, 'cena', 'solido', 'Arroz raro', 200);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
set local role authenticated;
select public.pendiente_validar(pg_temp.pid('arroz raro'), 'Arroz raro', null, null, null, null, null, null, 5);
reset role;
set constraints all immediate; set constraints all deferred;
select pg_temp.chk((select origen_macros = 'validado' and id_alimento is null and kcal_100g = 130 and kcal = 260 from public.items where id_pendiente = pg_temp.pid('arroz raro')), 'M3: vinculado a SARA2 -> el ítem recibe el snapshot del catálogo (sin id_alimento)');
select pg_temp.chk((select count(*) from public.alimentos where fuente = 'VALIDADO' and nombre ilike 'arroz raro') = 0, 'M3: NO se crea fila VALIDADO (ese alimento ya es buscable)');

-- ───────── M4. validada "como propio": va a alimentos_propios, no al buscador ─────────
set local role service_role;
select public.registrar_item_manual('00000000-0000-0000-0000-0000000000b1', current_date - 4, 'cena', 'solido', 'Barra casera', 60);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
set local role authenticated;
select public.pendiente_validar_como_propio(pg_temp.pid('barra casera'), 'Barra casera', null, 380, 10, 12, 55, null,
  jsonb_build_object('fuente_dato','etiqueta_producto','justificacion','Etiqueta del fabricante verificada','confirmaciones',jsonb_build_object('revise_fuente',true,'valores_por_100g',true,'busque_existente',true)));
reset role;
set constraints all immediate; set constraints all deferred;
select pg_temp.chk((select count(*) from public.alimentos_propios where nombre = 'Barra casera') = 1, 'M4: se crea el alimento propio');
select pg_temp.chk((select count(*) from public.alimentos where fuente = 'VALIDADO' and nombre ilike 'barra casera') = 0, 'M4: como propio NO crea fila VALIDADO');
select pg_temp.chk((select origen_macros = 'validado' and kcal_100g = 380 and kcal = 228 and id_alimento is null from public.items where id_pendiente = pg_temp.pid('barra casera')), 'M4: el ítem manual recibe el snapshot (380*60/100 = 228)');
select pg_temp.chk((select count(*) from public.alimentos_pendientes_auditoria where id_pendiente = pg_temp.pid('barra casera') and accion = 'resolver_manuales') = 1, 'M4: el trigger corre una sola vez aunque la RPC haga dos UPDATE de la fila');

-- ───────── M5. entrada MIXTA (IA + carga manual posterior), con mezcla del catálogo ─────────
insert into public.detecciones_ia (id_deteccion, id_usuario, prompt_version, modelo, vajilla_tipo, vajilla_diametro_cm, angulo_captura_grados, total_estimated_weight_grams)
values (9401, '00000000-0000-0000-0000-0000000000b4', 'v1', 'm', 'plato_playo', 26, 45, 300);
set local role service_role;
select public.registrar_guardado_deteccion('00000000-0000-0000-0000-0000000000b4', 9401, current_date - 5, 'cena', '{}'::uuid[],
  '[{"name":"Guiso casero","category":"platos","grams":100,"origin":"ai","metodo_match":"ninguno","ia":{"kcal_100g":50,"proteinas_100g":3,"grasas_100g":2,"carbs_100g":6}}]'::jsonb, 'gemini', 'v1');
select public.registrar_item_manual('00000000-0000-0000-0000-0000000000b1', current_date - 5, 'cena', 'solido', 'guiso casero', 200);
reset role;
select pg_temp.chk((select origen = 'ia' from public.alimentos_pendientes_validacion where id_pendiente = pg_temp.pid('guiso casero')), 'M5: la entrada creada por IA conserva origen = ia');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
set local role authenticated;
select public.pendiente_validar(pg_temp.pid('guiso casero'), 'Guiso casero', null, null, null, null, null, null, null,
  jsonb_build_object('modo','catalogo','componentes',jsonb_build_array(jsonb_build_object('origen','catalogo','id',5,'gramos',50))));
reset role;
set constraints all immediate; set constraints all deferred;
select pg_temp.chk((select origen_macros = 'validado' and kcal_100g = 65 and kcal = 65 and id_alimento is null and id_guardado_item is not null from public.items where nombre_manual = 'Guiso casero'), 'M5: el ítem de IA se actualiza como siempre (por id_guardado_item)');
select pg_temp.chk((select origen_macros = 'validado' and kcal_100g = 65 and kcal = 130 and id_alimento is null and id_guardado_item is null from public.items where nombre_manual = 'guiso casero'), 'M5: el ítem manual recibe el mismo snapshot (65*200/100 = 130)');
select pg_temp.chk((select count(*) from public.alimentos where fuente = 'VALIDADO' and nombre = 'Guiso casero' and kcal_100g = 65) = 1, 'M5: la fila VALIDADO se crea porque hay un ítem manual');

-- ───────── M6. entrada mixta descartada ─────────
insert into public.detecciones_ia (id_deteccion, id_usuario, prompt_version, modelo, vajilla_tipo, vajilla_diametro_cm, angulo_captura_grados, total_estimated_weight_grams)
values (9402, '00000000-0000-0000-0000-0000000000b4', 'v1', 'm', 'plato_playo', 26, 45, 300);
set local role service_role;
select public.registrar_guardado_deteccion('00000000-0000-0000-0000-0000000000b4', 9402, current_date - 6, 'cena', '{}'::uuid[],
  '[{"name":"Pastel raro","category":"platos","grams":90,"origin":"ai","metodo_match":"ninguno","ia":{"kcal_100g":50,"proteinas_100g":3,"grasas_100g":2,"carbs_100g":6}}]'::jsonb, 'gemini', 'v1');
select public.registrar_item_manual('00000000-0000-0000-0000-0000000000b1', current_date - 6, 'cena', 'solido', 'pastel raro', 70);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
set local role authenticated;
select public.pendiente_descartar(pg_temp.pid('pastel raro'), null);
reset role;
set constraints all immediate; set constraints all deferred;
select pg_temp.chk((select count(*) from public.items where nombre_manual ilike 'pastel raro' and origen_macros = 'descartado') = 2, 'M6: mixta descartada -> ítem de IA y manual en "descartado"');
select pg_temp.chk((select count(*) from public.alimentos where nombre ilike 'pastel raro') = 0, 'M6: no se crea fila en alimentos');

-- ───────── M7. entrada ya VALIDADA por IA que recibe después una carga manual: NO crea fila ─────────
insert into public.detecciones_ia (id_deteccion, id_usuario, prompt_version, modelo, vajilla_tipo, vajilla_diametro_cm, angulo_captura_grados, total_estimated_weight_grams)
values (9403, '00000000-0000-0000-0000-0000000000b4', 'v1', 'm', 'plato_playo', 26, 45, 300);
set local role service_role;
select public.registrar_guardado_deteccion('00000000-0000-0000-0000-0000000000b4', 9403, current_date - 7, 'cena', '{}'::uuid[],
  '[{"name":"Sopa casera","category":"platos","grams":250,"origin":"ai","metodo_match":"ninguno","ia":{"kcal_100g":40,"proteinas_100g":2,"grasas_100g":1,"carbs_100g":6}}]'::jsonb, 'gemini', 'v1');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
set local role authenticated;
select public.pendiente_validar(pg_temp.pid('sopa casera'), 'Sopa casera', null, 45, 2, 1, 7, null, null,
  jsonb_build_object('modo','manual','id_guardado_item',null,'gramos_foto',null,'componentes','[]'::jsonb));
reset role;
set constraints all immediate; set constraints all deferred;
select pg_temp.chk((select count(*) from public.alimentos where nombre ilike 'sopa casera') = 0, 'M7: validada por IA (sin ítems manuales) -> NO crea fila en alimentos');
select pg_temp.chk((select count(*) from public.alimentos_pendientes_auditoria where id_pendiente = pg_temp.pid('sopa casera') and accion = 'resolver_manuales') = 0, 'M7: el trigger no hace nada en una entrada de IA pura');
set local role service_role;
select public.registrar_item_manual('00000000-0000-0000-0000-0000000000b1', current_date - 7, 'almuerzo', 'solido', 'sopa casera', 100);
reset role;
select pg_temp.chk((select origen_macros = 'validado' and kcal_100g = 45 and kcal = 45 and id_alimento is null from public.items where nombre_manual = 'sopa casera'), 'M7: la carga manual posterior toma los valores finales, como hoy');
set constraints all immediate; set constraints all deferred;
select pg_temp.chk((select count(*) from public.alimentos where nombre ilike 'sopa casera') = 0, 'M7: y tampoco entonces se crea fila en alimentos');

-- ───────── M8. dos entradas distintas validadas con el mismo nombre final: una sola fila VALIDADO ─────────
set local role service_role;
select public.registrar_item_manual('00000000-0000-0000-0000-0000000000b1', current_date - 8, 'cena', 'solido', 'Pan casero', 50);
select public.registrar_item_manual('00000000-0000-0000-0000-0000000000b2', current_date - 8, 'cena', 'solido', 'Pan hogareño', 50);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
set local role authenticated;
select public.pendiente_validar(pg_temp.pid('pan casero'), 'Pan casero', null, 250, 8, 3, 48, null, null, jsonb_build_object('modo','manual','id_guardado_item',null,'gramos_foto',null,'componentes','[]'::jsonb));
select public.pendiente_validar(pg_temp.pid('pan hogareno'), 'Pan casero', null, 300, 9, 4, 55, null, null, jsonb_build_object('modo','manual','id_guardado_item',null,'gramos_foto',null,'componentes','[]'::jsonb));
reset role;
set constraints all immediate; set constraints all deferred;
select pg_temp.chk((select count(*) from public.alimentos where fuente = 'VALIDADO' and nombre_normalizado = 'pan casero') = 1, 'M8: mismo nombre final -> una sola fila VALIDADO (se reutiliza)');
select pg_temp.chk((select kcal_100g from public.items where id_pendiente = pg_temp.pid('pan hogareno')) = 300, 'M8: cada ítem conserva SU snapshot validado');

-- ───────── M9. retroactividad solo sobre ítems pendientes ─────────
set local role service_role;
select public.registrar_item_manual('00000000-0000-0000-0000-0000000000b1', current_date - 9, 'cena', 'solido', 'Torta de prueba', 100);
reset role;
insert into public.items (id_ingesta, nombre_manual, tipo_item, cantidad, kcal_100g, proteinas_100g, grasas_100g, carbs_100g, origen_macros, id_pendiente)
select i.id_ingesta, 'Torta de prueba', 'solido', 50, 999, 1, 1, 1, 'validado', pg_temp.pid('torta de prueba')
from public.ingestas i where i.id_usuario = '00000000-0000-0000-0000-0000000000b1' and i.fecha = current_date - 9;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
set local role authenticated;
select public.pendiente_validar(pg_temp.pid('torta de prueba'), 'Torta de prueba', null, 400, 5, 15, 60, null, null, jsonb_build_object('modo','manual','id_guardado_item',null,'gramos_foto',null,'componentes','[]'::jsonb));
reset role;
set constraints all immediate; set constraints all deferred;
select pg_temp.chk((select kcal_100g from public.items where id_pendiente = pg_temp.pid('torta de prueba') and cantidad = 100) = 400, 'M9: el ítem pendiente se completa');
select pg_temp.chk((select kcal_100g from public.items where id_pendiente = pg_temp.pid('torta de prueba') and cantidad = 50) = 999, 'M9: un ítem que NO está pendiente no se sobrescribe');

-- ───────── M10. entrada de IA pura: nada cambia en alimentos ─────────
insert into public.detecciones_ia (id_deteccion, id_usuario, prompt_version, modelo, vajilla_tipo, vajilla_diametro_cm, angulo_captura_grados, total_estimated_weight_grams)
values (9404, '00000000-0000-0000-0000-0000000000b4', 'v1', 'm', 'plato_playo', 26, 45, 300);
set local role service_role;
select public.registrar_guardado_deteccion('00000000-0000-0000-0000-0000000000b4', 9404, current_date - 10, 'cena', '{}'::uuid[],
  '[{"name":"Wrap IA","category":"platos","grams":120,"origin":"ai","metodo_match":"ninguno","ia":{"kcal_100g":200,"proteinas_100g":8,"grasas_100g":8,"carbs_100g":24}}]'::jsonb, 'gemini', 'v1');
reset role;
create temp table _antes as select count(*) as n from public.alimentos;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
set local role authenticated;
select public.pendiente_validar(pg_temp.pid('wrap ia'), 'Wrap IA', null, 210, 8, 9, 24, null, null, jsonb_build_object('modo','manual','id_guardado_item',null,'gramos_foto',null,'componentes','[]'::jsonb));
reset role;
set constraints all immediate; set constraints all deferred;
select pg_temp.chk((select count(*) from public.alimentos) = (select n from _antes), 'M10: validar una entrada de IA pura no agrega filas a alimentos');

-- ───────── M11. el buscador y el matching ─────────
select pg_temp.chk((select count(*) from public.alimentos where fuente = 'VALIDADO' and nombre = 'Flan casero') = 1, 'M11: el alimento validado está en alimentos con fuente VALIDADO (lo encuentra el buscador)');
select pg_temp.chk((select id_alimento is null from public.match_alimentos(array['flan casero']) limit 1), 'M11: match_alimentos (IA) sigue mirando solo SARA2: no encuentra el VALIDADO');
do $$ declare n int; begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
  set local role authenticated;
  select count(*) into n from public.alimentos where fuente = 'VALIDADO' and nombre = 'Flan casero';
  reset role;
  if n <> 1 then raise exception 'FALLÓ: un usuario no ve el VALIDADO (%)', n; end if;
  raise notice 'ok  - M11: cualquier usuario autenticado ve el VALIDADO (lectura pública de alimentos)';
end $$;

select 'FASE 2: TODOS LOS CASOS OK' as resultado;
rollback;
