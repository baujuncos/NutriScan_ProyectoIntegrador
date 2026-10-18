-- ============================================================
-- Script para correr en el SQL Editor de Supabase.
--
-- Es exactamente la sección "018" ya agregada al final de
-- supabase/schema_consolidado.sql (que sigue siendo la fuente de verdad del
-- esquema completo) — este archivo separado es sólo para pegarlo y correrlo
-- de una sin tener que ubicar la sección en el archivo grande.
--
-- Es seguro re-ejecutar: CREATE OR REPLACE.
-- ============================================================

-- ============================================================
-- 018 (NUT-119) — La foto de referencia es siempre la PRIMERA ocurrencia
--
-- Para pasar los gramos reales de la foto a valores por 100 g hace falta el
-- peso del alimento en una foto. Antes el investigador elegía cuál de las
-- ocurrencias usar (y el servidor validaba que fuera de ese pendiente); eso
-- complicaba el flujo y dependía de las últimas 20 ocurrencias que trae la
-- pantalla. Ahora la referencia es SIEMPRE la primera ocurrencia del pendiente
-- (la comida que lo originó): no cambia cuando aparecen más, así que un
-- borrador guardado sigue siendo válido. El servidor la determina solo e
-- ignora `id_guardado_item` y `gramos_foto` que mande el cliente.
--
-- Sólo cambia calcular_composicion (misma firma); pendiente_modificar y
-- pendiente_validar la siguen usando igual.
-- ============================================================

create or replace function public.calcular_composicion(p_id_pendiente bigint, p_composicion jsonb)
returns table (
  kcal numeric,
  prot numeric,
  grasas numeric,
  carbs numeric,
  id_vinculo integer,
  composicion_normalizada jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref    bigint;
  v_peso   numeric;
  v_comps  jsonb := p_composicion -> 'componentes';
  v_el     jsonb;
  v_id     integer;
  v_g      numeric;
  v_a      public.alimentos%rowtype;
  v_k      numeric := 0;
  v_p      numeric := 0;
  v_gr     numeric := 0;
  v_c      numeric := 0;
  v_out    jsonb := '[]'::jsonb;
  v_n      integer := 0;
  v_vinc   integer := null;
begin
  if jsonb_typeof(p_composicion) is distinct from 'object'
     or p_composicion ->> 'modo' is distinct from 'catalogo'
     or jsonb_typeof(v_comps) is distinct from 'array'
     or jsonb_array_length(v_comps) not between 1 and 30 then
    raise exception 'COMPOSICION_INVALIDA' using detail = 'Estructura inválida.';
  end if;

  -- Foto de referencia: la primera ocurrencia de ESTE pendiente; su peso sale de la base.
  select gi.id_guardado_item, gi.grams
  into v_ref, v_peso
  from public.detecciones_guardados_items gi
  where gi.id_pendiente = p_id_pendiente
  order by gi.id_guardado_item
  limit 1;
  if not found or v_peso is null or v_peso <= 0 then
    raise exception 'COMPOSICION_INVALIDA' using detail = 'El alimento no tiene una foto con peso para tomar de referencia.';
  end if;

  for v_el in select e from jsonb_array_elements(v_comps) as t(e) loop
    if jsonb_typeof(v_el -> 'id') is distinct from 'number'
       or jsonb_typeof(v_el -> 'gramos') is distinct from 'number' then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Ingrediente mal formado.';
    end if;
    begin
      v_id := (v_el ->> 'id')::integer;
    exception when others then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Ingrediente mal formado.';
    end;
    v_g := (v_el ->> 'gramos')::numeric;
    if v_g <= 0 or v_g > 1000 then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Los gramos de cada ingrediente deben ser mayores a 0 y hasta 1000.';
    end if;

    select * into v_a from public.alimentos a where a.id_alimento = v_id;
    if not found then
      raise exception 'ALIMENTO_NO_ENCONTRADO' using detail = v_id::text;
    end if;
    if num_nulls(v_a.kcal_100g, v_a.proteinas_100g, v_a.grasas_100g, v_a.carbs_100g) > 0 then
      raise exception 'COMPOSICION_INVALIDA' using detail = v_a.nombre || ' no tiene datos nutricionales en el catálogo.';
    end if;

    v_k  := v_k  + v_a.kcal_100g      * v_g;
    v_p  := v_p  + v_a.proteinas_100g * v_g;
    v_gr := v_gr + v_a.grasas_100g    * v_g;
    v_c  := v_c  + v_a.carbs_100g     * v_g;
    v_n  := v_n + 1;
    v_out := v_out || jsonb_build_object(
      'origen', 'catalogo', 'id', v_a.id_alimento, 'nombre', v_a.nombre, 'fuente', v_a.fuente,
      'gramos', v_g, 'kcal_100g', v_a.kcal_100g, 'proteinas_100g', v_a.proteinas_100g,
      'grasas_100g', v_a.grasas_100g, 'carbs_100g', v_a.carbs_100g);
    if v_n = 1 and abs(v_g - v_peso) <= 0.5 then
      v_vinc := v_a.id_alimento;
    end if;
  end loop;

  -- Vínculo puro: los valores son exactamente los del catálogo (sin redondeos de la cuenta).
  if v_n = 1 and v_vinc is not null then
    return query select v_a.kcal_100g, v_a.proteinas_100g, v_a.grasas_100g, v_a.carbs_100g, v_vinc,
      jsonb_build_object('modo', 'catalogo', 'id_guardado_item', v_ref, 'gramos_foto', v_peso, 'componentes', v_out);
    return;
  end if;

  return query select
    round(v_k / v_peso, 2), round(v_p / v_peso, 2), round(v_gr / v_peso, 2), round(v_c / v_peso, 2),
    null::integer,
    jsonb_build_object('modo', 'catalogo', 'id_guardado_item', v_ref, 'gramos_foto', v_peso, 'componentes', v_out);
end;
$$;

revoke all on function public.calcular_composicion(bigint, jsonb) from public, anon, authenticated;
