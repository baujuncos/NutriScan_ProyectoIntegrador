-- ============================================================
-- Script para correr en el SQL Editor de Supabase.
--
-- Es exactamente la sección "015" ya agregada al final de
-- supabase/schema_consolidado.sql (que sigue siendo la fuente de verdad del
-- esquema completo) — este archivo separado es sólo para pegarlo y correrlo
-- de una sin tener que ubicar la sección en el archivo grande.
--
-- Es seguro re-ejecutar: CREATE OR REPLACE / DROP ... IF EXISTS.
-- ============================================================

-- ============================================================
-- 015 (NUT-119) — El matching automático sólo usa SARA2 (+ VALIDADO), nunca ANMAT
--
-- Problema: el matching por similitud de texto contra TODO el catálogo
-- confundía "huevo" con un producto ANMAT cuyo nombre es exactamente "Huevo"
-- (un huevo de chocolate). Los productos envasados no se pueden matchear de
-- forma automática con confianza: se cargan por código de barras o eligiéndolos
-- a mano en el buscador.
--
-- Ahora:
--   * match_alimentos sólo hace MATCH EXACTO (nombre normalizado) y sólo contra
--     SARA2 y VALIDADO (los alimentos que aprobaron los investigadores).
--   * Lo que no tiene match exacto lo resuelve Gemini ELIGIENDO de la lista de
--     SARA2/VALIDADO (ver src/lib/geminiNutritionFallback.ts); ese método se
--     guarda como 'sara2_ia'.
-- La firma se mantiene (p_umbral queda sin uso) para que la app funcione igual
-- se despliegue antes o después de esta migración.
-- ============================================================

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
      and a.fuente in ('SARA2', 'VALIDADO')
    order by (a.fuente = 'SARA2') desc, a.id_alimento
    limit 1
  ) m on true
  order by q.idx
$$;

revoke all on function public.match_alimentos(text[], real) from public, anon;
grant execute on function public.match_alimentos(text[], real) to authenticated, service_role;

-- Nuevo método de match: la IA eligió una entrada de la lista de SARA2/VALIDADO.
-- 'trigram' se conserva para los guardados anteriores.
alter table public.detecciones_guardados_items
  drop constraint if exists detecciones_guardados_items_metodo_match_check;

alter table public.detecciones_guardados_items
  add constraint detecciones_guardados_items_metodo_match_check
    check (metodo_match in ('food_ref', 'exacto', 'trigram', 'sara2_ia', 'gemini', 'cola', 'ninguno'));
