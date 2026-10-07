-- ============================================================
-- Script para correr en el SQL Editor de Supabase.
--
-- Es exactamente la sección "016" ya agregada al final de
-- supabase/schema_consolidado.sql (que sigue siendo la fuente de verdad del
-- esquema completo) — este archivo separado es sólo para pegarlo y correrlo
-- de una sin tener que ubicar la sección en el archivo grande.
--
-- Es seguro re-ejecutar: CREATE OR REPLACE.
-- ============================================================

-- ============================================================
-- 016 (NUT-119) — Los alimentos validados NO se agregan al catálogo `alimentos`
--
-- Antes (decisión D2): validar insertaba una fila `fuente = 'VALIDADO'` en
-- `alimentos` y la IA podía elegirla en el matching. Se revierte:
--   * `alimentos` queda como referencia pura (SARA2 y ANMAT), sin filas propias.
--   * Lo validado vive en la cola (`alimentos_pendientes_validacion`, estado
--     'validado': nombre y macros finales, quién y cuándo, valores originales de
--     Gemini y auditoría). Los ítems del diario guardan los macros por 100 g en
--     el propio ítem (`origen_macros = 'validado'`), igual que los estimados por IA.
--   * Otros deportistas que cargan el mismo alimento lo reutilizan por la cola
--     (cola_lookup / registrar_guardado_deteccion), sin llamar a la IA.
--   * El matching automático (match_alimentos) vuelve a mirar SÓLO SARA2.
--   * Vincular un pendiente a una entrada EXISTENTE del catálogo sigue
--     funcionando (p_id_alimento_existente).
--   * Ya no existe DUPLICADO_EN_CATALOGO: como no se inserta en `alimentos`, no
--     hay catálogo que ensuciar (y bloqueaba validar "Huevo" por un producto ANMAT
--     con el mismo nombre).
--
-- Las filas `VALIDADO` que ya existan en `alimentos` (de pruebas) NO se tocan:
-- quedan sin uso. Para verlas:  select * from public.alimentos where fuente = 'VALIDADO';
-- La secuencia alimentos_validados_seq también queda (sin uso).
-- ============================================================

-- Matching automático: sólo SARA2.
create or replace function public.match_alimentos(p_nombres text[], p_umbral real default 0.5)
returns table (
  idx int,
  nombre_normalizado text,
  id_alimento int,
  nombre text,
  fuente text,
  score real,
  metodo text,
  kcal_100g numeric,
  proteinas_100g numeric,
  grasas_100g numeric,
  carbs_100g numeric
)
language sql stable security invoker
set search_path = public, extensions
as $$
  select
    q.idx::int,
    qn.n,
    m.id_alimento,
    m.nombre,
    m.fuente,
    m.score,
    m.metodo,
    m.kcal_100g,
    m.proteinas_100g,
    m.grasas_100g,
    m.carbs_100g
  from unnest(p_nombres) with ordinality as q(nombre, idx)
  cross join lateral (select public.norm_alimento(q.nombre) as n) qn
  left join lateral (
    select
      a.id_alimento,
      a.nombre,
      a.fuente,
      1.0::real as score,
      'exacto'::text as metodo,
      a.kcal_100g,
      a.proteinas_100g,
      a.grasas_100g,
      a.carbs_100g
    from public.alimentos a
    where qn.n is not null
      and a.nombre_normalizado = qn.n
      and a.fuente = 'SARA2'
    order by a.id_alimento
    limit 1
  ) m on true
  order by q.idx
$$;

revoke all on function public.match_alimentos(text[], real) from public, anon;
grant execute on function public.match_alimentos(text[], real) to authenticated, service_role;

-- Validar: ya no inserta en `alimentos`.
create or replace function public.pendiente_validar(
  p_id bigint,
  p_nombre text,
  p_categoria text,
  p_kcal numeric,
  p_prot numeric,
  p_grasas numeric,
  p_carbs numeric,
  p_observaciones text,
  p_id_alimento_existente int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes   public.alimentos_pendientes_validacion%rowtype;
  v_despues public.alimentos_pendientes_validacion%rowtype;
  v_nombre  text := nullif(btrim(p_nombre), '');
  v_norm    text := public.norm_alimento(p_nombre);
  v_id      integer;
  v_k       numeric;
  v_p       numeric;
  v_g       numeric;
  v_c       numeric;
  v_n       integer;
begin
  if coalesce(public.get_my_role() in ('investigador', 'administrador'), false) is false then
    raise exception 'FORBIDDEN';
  end if;

  if v_nombre is null or v_norm is null then
    raise exception 'INVALID' using detail = 'p_nombre';
  end if;
  if p_id_alimento_existente is null
     and (num_nulls(p_kcal, p_prot, p_grasas, p_carbs) > 0 or least(p_kcal, p_prot, p_grasas, p_carbs) < 0) then
    raise exception 'INVALID' using detail = 'Los 4 valores por 100 g son obligatorios y >= 0.';
  end if;

  select * into v_antes
  from public.alimentos_pendientes_validacion c
  where c.id_pendiente = p_id
  for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_antes.estado <> 'pendiente' then
    raise exception 'ESTADO_INVALIDO';
  end if;

  if p_id_alimento_existente is not null then
    -- Vinculado a una entrada existente del catálogo: los valores son los del catálogo.
    select a.id_alimento, a.kcal_100g, a.proteinas_100g, a.grasas_100g, a.carbs_100g
    into v_id, v_k, v_p, v_g, v_c
    from public.alimentos a
    where a.id_alimento = p_id_alimento_existente;
    if not found then
      raise exception 'ALIMENTO_NO_ENCONTRADO' using detail = p_id_alimento_existente::text;
    end if;
  else
    -- Alimento nuevo: NO se inserta en `alimentos`. Los valores quedan en la cola y en cada ítem.
    v_id := null;
    v_k := p_kcal; v_p := p_prot; v_g := p_grasas; v_c := p_carbs;
  end if;

  update public.alimentos_pendientes_validacion c
  set estado = 'validado',
      nombre_final = v_nombre,
      categoria_final = nullif(btrim(p_categoria), ''),
      final_kcal_100g = v_k,
      final_proteinas_100g = v_p,
      final_grasas_100g = v_g,
      final_carbs_100g = v_c,
      id_alimento_vinculado = v_id,
      observaciones = p_observaciones,
      resuelto_por = auth.uid(),
      resuelto_at = now()
  where c.id_pendiente = p_id
  returning * into v_despues;

  -- Locks en orden: fila de cola → ítems → ingestas (igual que descartar / registrar).
  -- nombre_manual se conserva (trazabilidad: el nombre que cargó el deportista).
  perform 1 from public.items it
  where it.id_guardado_item in (select gi.id_guardado_item from public.detecciones_guardados_items gi where gi.id_pendiente = p_id)
  order by it.id_item
  for update;
  perform 1 from public.ingestas g
  where g.id_ingesta in (
    select it.id_ingesta from public.items it
    where it.id_guardado_item in (select gi.id_guardado_item from public.detecciones_guardados_items gi where gi.id_pendiente = p_id)
  )
  order by g.id_ingesta
  for update;

  -- El trigger recalcula cada ítem con SU cantidad (desde el catálogo si hay id_alimento,
  -- desde el snapshot si no) y el de ingestas ajusta los totales.
  update public.items it
  set id_alimento = v_id,
      kcal_100g = v_k,
      proteinas_100g = v_p,
      grasas_100g = v_g,
      carbs_100g = v_c,
      origen_macros = 'validado'
  where it.id_guardado_item in (select gi.id_guardado_item from public.detecciones_guardados_items gi where gi.id_pendiente = p_id);
  get diagnostics v_n = row_count;

  insert into public.alimentos_pendientes_auditoria (id_pendiente, accion, id_usuario, antes, despues, items_afectados)
  values (p_id, 'validar', auth.uid(), to_jsonb(v_antes), to_jsonb(v_despues), v_n);

  return jsonb_build_object('id_alimento', v_id, 'items_afectados', v_n);
end;
$$;

revoke all on function public.pendiente_validar(bigint, text, text, numeric, numeric, numeric, numeric, text, int)
  from public, anon, authenticated;
grant execute on function public.pendiente_validar(bigint, text, text, numeric, numeric, numeric, numeric, text, int)
  to authenticated;

-- Vista de los alimentos validados (con cuántas veces aparecieron). security_invoker:
-- la RLS de la cola aplica al que consulta (sólo investigadores/administradores ven filas).
create or replace view public.v_alimentos_validados
with (security_invoker = true)
as
select
  p.id_pendiente,
  p.nombre_final,
  p.categoria_final,
  p.final_kcal_100g,
  p.final_proteinas_100g,
  p.final_grasas_100g,
  p.final_carbs_100g,
  p.id_alimento_vinculado,
  p.observaciones,
  p.resuelto_por,
  p.resuelto_at,
  o.ocurrencias
from public.alimentos_pendientes_validacion p
cross join lateral (
  select count(*) as ocurrencias
  from public.detecciones_guardados_items gi
  where gi.id_pendiente = p.id_pendiente
) o
where p.estado = 'validado';

revoke all on public.v_alimentos_validados from anon, authenticated;
grant select on public.v_alimentos_validados to authenticated;
