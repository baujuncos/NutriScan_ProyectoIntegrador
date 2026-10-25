-- NUT-151 — Aplicar en Supabase (SQL Editor). Pegar y correr TODO junto (re-ejecutable).
-- Requiere haber aplicado antes nut149_aplicar.sql.

begin;

-- ============================================================
-- NUT-151 — Métricas de calidad de las detecciones de Gemini
--
-- Dos vistas de sólo lectura para /revision-ia/metricas. Ambas exponen las
-- mismas columnas de filtro (created_at de la detección, vajilla_tipo,
-- prompt_version) para que los filtros del dashboard apliquen igual a las dos.
-- security_invoker: aplican las RLS del que consulta (sólo investigadores ven
-- datos de otros usuarios).
--
-- Los motivos (cambio_alimento / correccion_peso_grande / item_quitado) NO se
-- recalculan acá: salen de lo que guardó NUT-149 en motivos_revision.
-- ============================================================

-- Una fila por ítem de Gemini ya evaluado al guardar (necesita_revision is not null).
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
  d.created_at
from public.detecciones_ia_items di
join public.detecciones_ia d on d.id_deteccion = di.id_deteccion
left join lateral (
  select g.grams
  from public.detecciones_guardados_items g
  where g.source_item_uuid = di.item_uuid
  order by g.id_guardado_item
  limit 1
) gi on true
where di.necesita_revision is not null;

-- Falsos negativos: alimentos que el usuario agregó a mano porque Gemini no los
-- detectó. Aparte del ranking de corrección: mide detección, no estimación.
create or replace view public.v_metricas_ia_no_detectados
with (security_invoker = true)
as
select
  g.id_guardado_item,
  g.name                                                     as alimento,
  coalesce(public.norm_alimento(g.name), lower(btrim(g.name))) as alimento_norm,
  d.prompt_version,
  d.vajilla_tipo,
  d.created_at
from public.detecciones_guardados_items g
join public.detecciones_guardados s on s.id_guardado = g.id_guardado
join public.detecciones_ia d on d.id_deteccion = s.id_deteccion
where g.origin = 'added_manually';

revoke all on public.v_metricas_ia_items, public.v_metricas_ia_no_detectados from anon, authenticated;
grant select on public.v_metricas_ia_items, public.v_metricas_ia_no_detectados to authenticated;

commit;
