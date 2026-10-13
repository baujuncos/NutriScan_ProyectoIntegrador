-- ============================================================
-- 012 (NUT-191) — "Confirmar y guardar" del chat de comidas por IA.
--
-- Script para correr en el SQL Editor de Supabase. Es seguro re-ejecutarlo
-- (IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE).
--
-- QUÉ AGREGA (todo nuevo; NO modifica ninguna tabla, columna, política ni
-- trigger existente — en particular NO toca calculate_item_nutrients):
--   1) chat_ia_registros / chat_ia_registros_items: auditoría para
--      investigadores de lo que estimó la IA vs. lo que el usuario confirmó.
--      Mismo patrón que detecciones_guardados*: solo SELECT + INSERT (sin
--      UPDATE/DELETE), el usuario ve lo suyo e investigadores/administradores
--      ven todo.
--   2) confirmar_chat_ia_registro(jsonb): guarda TODO en una sola
--      transacción (diario ingestas/items, hidratación y auditoría). Si algo
--      falla, no queda nada guardado a medias.
--
-- SOBRE EL TRIGGER DE MACROS (leer antes de aplicar):
--   items tiene `before insert or update of id_alimento, id_alimento_barcode,
--   cantidad` → calculate_item_nutrients(). Para un ítem sin catálogo
--   (id_alimento nulo) el trigger deja kcal/proteínas/grasas/carbs en 0. La
--   función inserta el ítem normalmente y, a continuación, hace un UPDATE
--   SOLO de esas 4 columnas sobre la fila que ella misma acaba de insertar
--   (por id_item). Como ese UPDATE no nombra id_alimento, id_alimento_barcode
--   ni cantidad, el trigger NO se vuelve a disparar y los valores quedan.
--   Ojo (comportamiento ya existente, no lo introduce este script): si luego
--   el usuario edita la cantidad de ese ítem desde /alimentacion
--   (updateItemAction), el trigger sí se dispara y vuelve a poner 0, igual
--   que hoy con los ítems de carga manual.
-- ============================================================

create table if not exists public.chat_ia_registros (
  id_registro        bigserial primary key,
  id_usuario         uuid not null references auth.users(id) on delete cascade,
  -- Idempotencia: si el cliente reintenta una confirmación que ya se guardó
  -- (ej. se cortó la respuesta), no se duplica nada.
  request_id         uuid not null,
  fecha              date not null,
  -- Momento del día: mismo enum que ingestas.tipo.
  tipo_ingesta       text not null check (tipo_ingesta in ('desayuno', 'almuerzo', 'merienda', 'cena', 'colacion', 'suplemento')),
  modelo             text not null,
  prompt_version     text not null,
  -- Totales finales confirmados (sin contar los ítems quitados).
  kcal_total         numeric(10,2) not null,
  proteinas_total_g  numeric(10,2) not null,
  carbs_total_g      numeric(10,2) not null,
  grasas_total_g     numeric(10,2) not null,
  gramos_total       numeric(10,2) not null,
  created_at         timestamptz not null default now(),
  unique (id_usuario, request_id)
);

create table if not exists public.chat_ia_registros_items (
  id_registro_item  bigserial primary key,
  id_registro       bigint not null references public.chat_ia_registros(id_registro) on delete cascade,
  ingrediente       text not null,
  tipo              text not null,
  unidad            text not null check (unidad in ('g', 'ml')),
  -- ai: el usuario no lo tocó | edited: cambió gramaje o alimento
  -- added_manually: lo agregó el usuario (no vino de la IA)
  -- removed: la IA lo detectó pero el usuario lo sacó antes de confirmar
  origin            text not null check (origin in ('ai', 'edited', 'added_manually', 'removed')),
  -- Dónde terminó: diario (ingestas/items), hidratacion (agua) o ninguno (removed).
  destino           text not null check (destino in ('diario', 'hidratacion', 'ninguno')),
  -- Lo que estimó la IA (null solo si origin = 'added_manually').
  gramos_ia         numeric(10,2),
  kcal_ia           numeric(10,2),
  proteinas_ia_g    numeric(10,2),
  carbs_ia_g        numeric(10,2),
  grasas_ia_g       numeric(10,2),
  -- Lo que quedó tras la edición del usuario (null si origin = 'removed').
  gramos_final      numeric(10,2),
  kcal_final        numeric(10,2),
  proteinas_final_g numeric(10,2),
  carbs_final_g     numeric(10,2),
  grasas_final_g    numeric(10,2),
  confidence        numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  -- sara2 = macros del catálogo | estimado_ia = estimación del modelo.
  -- El matching es solo contra SARA2 (ANMAT no participa).
  macro_source      text check (macro_source is null or macro_source in ('sara2', 'estimado_ia')),
  id_alimento       integer references public.alimentos(id_alimento),
  created_at        timestamptz not null default now(),

  constraint chat_ia_items_ia_presente check (
    origin = 'added_manually'
    or (gramos_ia is not null and kcal_ia is not null and proteinas_ia_g is not null
        and carbs_ia_g is not null and grasas_ia_g is not null)
  ),
  constraint chat_ia_items_final_coherente check (
    (origin = 'removed'
      and gramos_final is null and kcal_final is null and proteinas_final_g is null
      and carbs_final_g is null and grasas_final_g is null)
    or
    (origin <> 'removed'
      and gramos_final is not null and kcal_final is not null and proteinas_final_g is not null
      and carbs_final_g is not null and grasas_final_g is not null)
  ),
  constraint chat_ia_items_destino_coherente check ((origin = 'removed') = (destino = 'ninguno'))
);

create index if not exists idx_chat_ia_registros_usuario_fecha on public.chat_ia_registros(id_usuario, fecha);
create index if not exists idx_chat_ia_registros_items_registro on public.chat_ia_registros_items(id_registro);

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT ON public.chat_ia_registros TO authenticated;
GRANT SELECT, INSERT ON public.chat_ia_registros_items TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.chat_ia_registros_id_registro_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.chat_ia_registros_items_id_registro_item_seq TO authenticated;

ALTER TABLE public.chat_ia_registros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_ia_registros_items ENABLE ROW LEVEL SECURITY;

-- CHAT_IA_REGISTROS
DROP POLICY IF EXISTS "chat_ia_registros: own read" ON public.chat_ia_registros;
DROP POLICY IF EXISTS "chat_ia_registros: own insert" ON public.chat_ia_registros;
DROP POLICY IF EXISTS "chat_ia_registros: investigador read all" ON public.chat_ia_registros;

CREATE POLICY "chat_ia_registros: own read"
  ON public.chat_ia_registros FOR SELECT TO authenticated
  USING (id_usuario = auth.uid());

CREATE POLICY "chat_ia_registros: own insert"
  ON public.chat_ia_registros FOR INSERT TO authenticated
  WITH CHECK (id_usuario = auth.uid());

CREATE POLICY "chat_ia_registros: investigador read all"
  ON public.chat_ia_registros FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('investigador', 'administrador'));

-- CHAT_IA_REGISTROS_ITEMS (sin id_usuario directo — ownership vía parent)
DROP POLICY IF EXISTS "chat_ia_registros_items: own read" ON public.chat_ia_registros_items;
DROP POLICY IF EXISTS "chat_ia_registros_items: own insert" ON public.chat_ia_registros_items;
DROP POLICY IF EXISTS "chat_ia_registros_items: investigador read all" ON public.chat_ia_registros_items;

CREATE POLICY "chat_ia_registros_items: own read"
  ON public.chat_ia_registros_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_ia_registros r
      WHERE r.id_registro = chat_ia_registros_items.id_registro
        AND r.id_usuario = auth.uid()
    )
  );

CREATE POLICY "chat_ia_registros_items: own insert"
  ON public.chat_ia_registros_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_ia_registros r
      WHERE r.id_registro = chat_ia_registros_items.id_registro
        AND r.id_usuario = auth.uid()
    )
  );

CREATE POLICY "chat_ia_registros_items: investigador read all"
  ON public.chat_ia_registros_items FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('investigador', 'administrador'));

-- ============================================================
-- confirmar_chat_ia_registro — guardado atómico.
--
-- SECURITY INVOKER (el default): corre con los permisos y la RLS del usuario
-- que la llama, así que solo puede escribir lo que ya podría escribir a mano.
-- Cualquier error aborta la transacción completa.
--
-- Payload (lo arma y valida POST /api/chat/meal/confirm):
-- {
--   "requestId": uuid, "fecha": "YYYY-MM-DD", "tipoIngesta": "almuerzo",
--   "modelo": text, "promptVersion": text,
--   "totales": { "kcal", "proteinas_g", "carbs_g", "grasas_g", "gramos" },
--   "items": [{
--     "ingrediente", "tipo", "unidad", "origin", "destino",
--     "macroSource", "idAlimento", "confidence",
--     "ia":    { "gramos","kcal","proteinas_g","carbs_g","grasas_g" } | null,
--     "final": { "gramos","kcal","proteinas_g","carbs_g","grasas_g" } | null
--   }]
-- }
-- ============================================================
create or replace function public.confirmar_chat_ia_registro(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user         uuid := auth.uid();
  v_request_id   uuid := (p_payload->>'requestId')::uuid;
  v_fecha        date := (p_payload->>'fecha')::date;
  v_tipo         text := p_payload->>'tipoIngesta';
  v_registro     bigint;
  v_ingesta      bigint;
  v_item         jsonb;
  v_item_id      bigint;
  v_agua_ml      numeric := 0;
  v_diario_items integer := 0;
begin
  if v_user is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  -- Idempotencia: la confirmación ya se guardó (reintento del cliente).
  select r.id_registro into v_registro
  from public.chat_ia_registros r
  where r.id_usuario = v_user and r.request_id = v_request_id;
  if found then
    return jsonb_build_object('idRegistro', v_registro, 'yaGuardado', true);
  end if;

  -- La ingesta solo se crea si algún ítem va al diario (si es todo agua, no).
  if exists (select 1 from jsonb_array_elements(p_payload->'items') e where e->>'destino' = 'diario') then
    insert into public.ingestas (id_usuario, fecha, tipo)
    values (v_user, v_fecha, v_tipo)
    on conflict (id_usuario, fecha, tipo) do nothing;

    select i.id_ingesta into v_ingesta
    from public.ingestas i
    where i.id_usuario = v_user and i.fecha = v_fecha and i.tipo = v_tipo;
  end if;

  insert into public.chat_ia_registros (
    id_usuario, request_id, fecha, tipo_ingesta, modelo, prompt_version,
    kcal_total, proteinas_total_g, carbs_total_g, grasas_total_g, gramos_total
  ) values (
    v_user, v_request_id, v_fecha, v_tipo, p_payload->>'modelo', p_payload->>'promptVersion',
    (p_payload#>>'{totales,kcal}')::numeric,
    (p_payload#>>'{totales,proteinas_g}')::numeric,
    (p_payload#>>'{totales,carbs_g}')::numeric,
    (p_payload#>>'{totales,grasas_g}')::numeric,
    (p_payload#>>'{totales,gramos}')::numeric
  ) returning id_registro into v_registro;

  for v_item in select value from jsonb_array_elements(p_payload->'items') loop
    if v_item->>'destino' = 'diario' then
      -- Un ítem sin catálogo se guarda con nombre_manual (lo exige items_alimento_or_manual_check).
      insert into public.items (id_ingesta, id_alimento, nombre_manual, tipo_item, cantidad)
      values (
        v_ingesta,
        (v_item->>'idAlimento')::integer,
        case when v_item->>'idAlimento' is null then left(v_item->>'ingrediente', 120) end,
        case when v_item->>'unidad' = 'ml' then 'liquido' else 'solido' end,
        (v_item#>>'{final,gramos}')::numeric
      ) returning id_item into v_item_id;

      -- Sin catálogo el trigger dejó las macros en 0: se corrigen SOLO en esta fila
      -- (la que acabamos de insertar) y SOLO esas 4 columnas, para no volver a
      -- disparar calculate_item_nutrients (que escucha id_alimento/barcode/cantidad).
      if v_item->>'idAlimento' is null then
        update public.items
        set kcal        = (v_item#>>'{final,kcal}')::numeric,
            proteinas_g = (v_item#>>'{final,proteinas_g}')::numeric,
            grasas_g    = (v_item#>>'{final,grasas_g}')::numeric,
            carbs_g     = (v_item#>>'{final,carbs_g}')::numeric
        where id_item = v_item_id;
      end if;

      v_diario_items := v_diario_items + 1;
    elsif v_item->>'destino' = 'hidratacion' then
      v_agua_ml := v_agua_ml + (v_item#>>'{final,gramos}')::numeric;
    end if;

    insert into public.chat_ia_registros_items (
      id_registro, ingrediente, tipo, unidad, origin, destino,
      gramos_ia, kcal_ia, proteinas_ia_g, carbs_ia_g, grasas_ia_g,
      gramos_final, kcal_final, proteinas_final_g, carbs_final_g, grasas_final_g,
      confidence, macro_source, id_alimento
    ) values (
      v_registro, v_item->>'ingrediente', v_item->>'tipo', v_item->>'unidad', v_item->>'origin', v_item->>'destino',
      (v_item#>>'{ia,gramos}')::numeric, (v_item#>>'{ia,kcal}')::numeric, (v_item#>>'{ia,proteinas_g}')::numeric,
      (v_item#>>'{ia,carbs_g}')::numeric, (v_item#>>'{ia,grasas_g}')::numeric,
      (v_item#>>'{final,gramos}')::numeric, (v_item#>>'{final,kcal}')::numeric, (v_item#>>'{final,proteinas_g}')::numeric,
      (v_item#>>'{final,carbs_g}')::numeric, (v_item#>>'{final,grasas_g}')::numeric,
      (v_item->>'confidence')::numeric, v_item->>'macroSource', (v_item->>'idAlimento')::integer
    );
  end loop;

  -- Hidratación: suma atómica al día (el módulo guarda ml_total por usuario y día;
  -- los "vasos" son solo visualización, 250 ml).
  if v_agua_ml > 0 then
    insert into public.hidratacion (id_usuario, fecha, ml_total)
    values (v_user, v_fecha, round(v_agua_ml)::integer)
    on conflict (id_usuario, fecha)
    do update set ml_total = hidratacion.ml_total + excluded.ml_total, updated_at = now();
  end if;

  return jsonb_build_object(
    'idRegistro', v_registro,
    'idIngesta', v_ingesta,
    'itemsDiario', v_diario_items,
    'mlAgua', round(v_agua_ml),
    'yaGuardado', false
  );
end;
$$;

REVOKE ALL ON FUNCTION public.confirmar_chat_ia_registro(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirmar_chat_ia_registro(jsonb) TO authenticated;
