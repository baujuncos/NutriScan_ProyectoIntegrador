-- ============================================================
-- No regresión del flujo de IA (NUT-192): MISMO escenario contra la 019 y la 020.
-- Uso: correrlo en una base con 001–019 y en otra con 001–020 (base DESCARTABLE, desde
-- un esquema recién creado: los ids salen de secuencias) y comparar las salidas:
--     psql -At -f 020_regresion_ia.sql  base_019  > salida_019.txt
--     psql -At -f 020_regresion_ia.sql  base_020  > salida_020.txt
--     diff salida_019.txt salida_020.txt     # debe ser vacío
-- Normaliza lo único que cambia a propósito: la clave `origen` de la cola y los timestamps.
-- Termina en ROLLBACK.
-- ============================================================
-- Escenario de IA ejecutado igual contra la versión 019 y la 020: se comparan los resultados normalizados.
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c3', 'c3@t.l'), ('00000000-0000-0000-0000-0000000000c4', 'c4@t.l'), ('00000000-0000-0000-0000-0000000000c5', 'c5@t.l');
insert into public.profiles (user_id, nombre, apellido, email, role) values
  ('00000000-0000-0000-0000-0000000000c3', 'I', 'N', 'c3@t.l', 'investigador'),
  ('00000000-0000-0000-0000-0000000000c4', 'D', 'U', 'c4@t.l', 'deportista_ucc'),
  ('00000000-0000-0000-0000-0000000000c5', 'D', 'V', 'c5@t.l', 'deportista_ucc');
insert into public.alimentos (id_alimento, nombre, categoria, fuente, kcal_100g, proteinas_100g, grasas_100g, carbs_100g)
values (5, 'Arroz SARA2', 'Cereales', 'SARA2', 130, 2.7, 0.3, 28);

-- Detecciones y guardados (service role), fechas fijas.
create table public._det (id int, uid uuid, nombre text, grams numeric);
grant select on public._det to service_role;
insert into public._det values
  (9301, '00000000-0000-0000-0000-0000000000c4', 'Flan IA', 120),
  (9302, '00000000-0000-0000-0000-0000000000c4', 'Milanesa IA', 150),
  (9303, '00000000-0000-0000-0000-0000000000c4', 'Pizza IA', 200),
  (9304, '00000000-0000-0000-0000-0000000000c4', 'Barra IA', 60),
  (9305, '00000000-0000-0000-0000-0000000000c4', 'Mezcla IA', 100),
  (9306, '00000000-0000-0000-0000-0000000000c4', 'Borrador IA', 80),
  (9307, '00000000-0000-0000-0000-0000000000c5', 'flan  ia', 90);
insert into public.detecciones_ia (id_deteccion, id_usuario, prompt_version, modelo, vajilla_tipo, vajilla_diametro_cm, angulo_captura_grados, total_estimated_weight_grams)
select id, uid, 'v1', 'm', 'plato_playo', 26, 45, 300 from public._det;

set local role service_role;
select public.registrar_guardado_deteccion(d.uid, d.id, date '2026-10-01' + (d.id - 9300), 'cena', '{}'::uuid[],
  jsonb_build_array(jsonb_build_object('name', d.nombre, 'category', 'platos', 'grams', d.grams, 'origin', 'ai', 'metodo_match', 'ninguno',
    'ia', jsonb_build_object('kcal_100g', 100 + d.id - 9300, 'proteinas_100g', 5, 'grasas_100g', 4, 'carbs_100g', 10))), 'gemini', 'v1')
from public._det d order by d.id;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', true);
set local role authenticated;
-- validar (nuevo, A mano)
select public.pendiente_validar((select id_pendiente from public.alimentos_pendientes_validacion where nombre_normalizado = 'flan ia'), 'Flan IA', 'Postres', 200, 5, 6, 30, 'ok', null,
  jsonb_build_object('modo','manual','id_guardado_item',null,'gramos_foto',null,'componentes','[]'::jsonb));
-- validar vinculado a catálogo
select public.pendiente_validar((select id_pendiente from public.alimentos_pendientes_validacion where nombre_normalizado = 'pizza ia'), 'Pizza IA', null, null, null, null, null, null, 5);
-- descartar
select public.pendiente_descartar((select id_pendiente from public.alimentos_pendientes_validacion where nombre_normalizado = 'milanesa ia'), 'no aplica');
-- validar como propio
select public.pendiente_validar_como_propio((select id_pendiente from public.alimentos_pendientes_validacion where nombre_normalizado = 'barra ia'), 'Barra IA', null, 380, 10, 12, 55, null,
  jsonb_build_object('fuente_dato','etiqueta_producto','justificacion','Etiqueta del fabricante verificada','confirmaciones',jsonb_build_object('revise_fuente',true,'valores_por_100g',true,'busque_existente',true)));
-- validar con mezcla del catálogo
select public.pendiente_validar((select id_pendiente from public.alimentos_pendientes_validacion where nombre_normalizado = 'mezcla ia'), 'Mezcla IA', null, null, null, null, null, null, null,
  jsonb_build_object('modo','catalogo','componentes',jsonb_build_array(jsonb_build_object('origen','catalogo','id',5,'gramos',50))));
-- borrador
select public.pendiente_modificar((select id_pendiente from public.alimentos_pendientes_validacion where nombre_normalizado = 'borrador ia'), 'Borrador IA', 'x', 150, 5, 5, 20, 'borrador',
  jsonb_build_object('modo','manual','id_guardado_item',null,'gramos_foto',null,'componentes','[]'::jsonb));
reset role;
set constraints all immediate;   -- simula el commit (en 019 no hay triggers diferidos: no hace nada)
set constraints all deferred;

-- ───────── Volcado normalizado ─────────
\echo '### cola'
select to_jsonb(c) - 'origen' - 'created_at' - 'updated_at' - 'resuelto_at' from public.alimentos_pendientes_validacion c order by id_pendiente;
\echo '### items'
select id_item, id_ingesta, id_alimento, nombre_manual, cantidad, kcal, proteinas_g, grasas_g, carbs_g, kcal_100g, proteinas_100g, grasas_100g, carbs_100g, origen_macros, id_guardado_item from public.items order by id_item;
\echo '### ingestas'
select id_ingesta, id_usuario, tipo, fecha, kcal_total, proteinas_total_g, grasas_total_g, carbs_total_g from public.ingestas order by id_ingesta;
\echo '### guardados_items'
select id_guardado_item, name, grams, id_alimento, origen_macros, kcal_100g, kcal, id_pendiente from public.detecciones_guardados_items order by id_guardado_item;
\echo '### auditoria (sin la clave origen ni timestamps)'
select id_auditoria, id_pendiente, accion, items_afectados,
  (antes - 'origen' - 'created_at' - 'updated_at' - 'resuelto_at') as antes,
  ((despues - 'origen' - 'created_at' - 'updated_at' - 'resuelto_at') #- '{propio,creado_at}') as despues
from public.alimentos_pendientes_auditoria order by id_auditoria;
\echo '### alimentos propios'
select id_alimento_propio, nombre, kcal_100g, fuente_dato, id_pendiente_origen, estado from public.alimentos_propios order by 1;
\echo '### alimentos VALIDADO (debe ser 0 filas)'
select count(*) from public.alimentos where fuente = 'VALIDADO';
\echo '### alimentos total'
select count(*) from public.alimentos;
rollback;
