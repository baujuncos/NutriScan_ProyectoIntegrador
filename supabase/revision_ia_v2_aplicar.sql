-- Cola de revisión v2 — Aplicar en Supabase (SQL Editor). Pegar y correr TODO junto (re-ejecutable).
-- Requiere haber aplicado antes nut149_aplicar.sql.

begin;

-- ============================================================
-- NUT-149 (v2) — La cola muestra la foto con la marca del ítem y quién revisó
--
-- v_revision_ia expone el boundingBox del ítem (bbox_* de detecciones_ia_items, fracciones
-- 0–1 de la foto) y el nombre de quien revisó. Sólo se AGREGAN columnas al final de la
-- vista (create or replace no permite cambiar ni reordenar las existentes).
-- ============================================================

create or replace view public.v_revision_ia
with (security_invoker = true)
as
select
  di.id_deteccion_item,
  di.id_deteccion,
  di.item_uuid,
  di.ingredient             as alimento_ia,
  di.estimated_weight_grams as gramos_ia,
  di.confidence,
  di.necesita_revision,
  di.motivos_revision,
  ('item_quitado' = any (di.motivos_revision)) as item_quitado,
  di.estado_revision,
  di.revisado_por,
  di.revisado_en,
  di.nutricionista_alimento,
  di.nutricionista_gramos,
  di.candidato_ejemplo,
  d.created_at,
  d.id_usuario,
  d.imagen_path,
  d.vajilla_tipo,
  d.vajilla_diametro_cm,
  d.angulo_captura_grados,
  d.angulo_aproximado,
  gi.name                   as alimento_usuario,
  gi.grams                  as gramos_usuario,
  gi.origin                 as origen_usuario,
  di.bbox_x,
  di.bbox_y,
  di.bbox_width,
  di.bbox_height,
  nullif(btrim(coalesce(rev.nombre, '') || ' ' || coalesce(rev.apellido, '')), '') as revisor_nombre
from public.detecciones_ia_items di
join public.detecciones_ia d on d.id_deteccion = di.id_deteccion
left join lateral (
  select g.name, g.grams, g.origin
  from public.detecciones_guardados_items g
  where g.source_item_uuid = di.item_uuid
  order by g.id_guardado_item
  limit 1
) gi on true
left join public.profiles rev on rev.user_id = di.revisado_por
where di.necesita_revision;

revoke all on public.v_revision_ia from anon, authenticated;
grant select on public.v_revision_ia to authenticated;

-- Reabrir un ítem ya revisado para corregirlo de nuevo: vuelve a Pendientes y se borran los valores
-- del investigador (nutricionista_*, revisado_*). No toca nada de la IA ni del deportista, ni
-- candidato_ejemplo. Errores (message): FORBIDDEN, NOT_FOUND, ESTADO_INVALIDO (ya estaba pendiente).
create or replace function public.revision_ia_reabrir(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado text;
begin
  if coalesce((select public.get_my_role()), '') not in ('investigador', 'administrador') then
    raise exception 'FORBIDDEN';
  end if;

  select estado_revision into v_estado
  from public.detecciones_ia_items where id_deteccion_item = p_id and necesita_revision for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_estado = 'pendiente' then raise exception 'ESTADO_INVALIDO'; end if;

  update public.detecciones_ia_items
  set estado_revision = 'pendiente', revisado_por = null, revisado_en = null,
      nutricionista_alimento = null, nutricionista_gramos = null
  where id_deteccion_item = p_id;
end;
$$;

revoke all on function public.revision_ia_reabrir(bigint) from public, anon;
grant execute on function public.revision_ia_reabrir(bigint) to authenticated;

-- ============================================================
-- NUT-151 (export) — Más columnas en v_metricas_ia_items para el resumen en .md
--
-- Se AGREGAN al final (create or replace view no permite cambiar ni reordenar las existentes):
-- el nombre y el origen que dejó el deportista, lo que corrigió el investigador y el contexto de
-- captura. Sirven para armar el resumen descargable (qué confunde la IA, sesgos de peso, casos
-- concretos). No exponen nada personal: ni usuario, ni foto.
-- ============================================================

create or replace view public.v_metricas_ia_items
with (security_invoker = true)
as
select
  di.id_deteccion_item,
  di.ingredient                                              as alimento,
  coalesce(public.norm_alimento(di.ingredient), lower(btrim(di.ingredient))) as alimento_norm,
  di.confidence,
  di.estimated_weight_grams                                  as gramos_ia,
  gi.grams                                                   as gramos_usuario,
  di.motivos_revision,
  di.estado_revision,
  di.candidato_ejemplo,
  d.prompt_version,
  d.vajilla_tipo,
  d.created_at,
  gi.name                                                    as alimento_usuario,
  gi.origin                                                  as origen_usuario,
  di.nutricionista_alimento,
  di.nutricionista_gramos,
  d.vajilla_diametro_cm,
  d.angulo_captura_grados
from public.detecciones_ia_items di
join public.detecciones_ia d on d.id_deteccion = di.id_deteccion
left join lateral (
  select g.name, g.grams, g.origin
  from public.detecciones_guardados_items g
  where g.source_item_uuid = di.item_uuid
  order by g.id_guardado_item
  limit 1
) gi on true
where di.necesita_revision is not null;

revoke all on public.v_metricas_ia_items from anon, authenticated;
grant select on public.v_metricas_ia_items to authenticated;

commit;

-- Que Supabase (PostgREST) vea la función nueva y la vista actualizada sin esperar.
notify pgrst, 'reload schema';
