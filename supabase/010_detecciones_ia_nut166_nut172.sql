-- ============================================================
-- Script para correr en el SQL Editor de Supabase.
--
-- Es exactamente la sección "010 (NUT-166/NUT-172)" ya agregada al final de
-- supabase/schema_consolidado.sql (que sigue siendo la fuente de verdad del
-- esquema completo) — este archivo separado es sólo para pegarlo y correrlo
-- de una sin tener que ubicar la sección en el archivo grande.
--
-- Es seguro re-ejecutar: todo usa IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================

-- ============================================================
-- 010 (NUT-166/NUT-172) — Predicciones de detección por IA (una por foto,
-- sin refinamiento multi-turno) y guardados/correcciones del usuario.
--
-- IMPORTANTE: estas tablas NUNCA deben ser escritas por el mismo código que
-- escribe en `ingestas`/`items` (el diario real). El puente hacia el diario
-- real es un TODO explícito (ver registrarEnDiario en
-- src/app/api/food-recognition/save/route.ts) hasta que exista matching de
-- alimentos + cálculo de macros.
--
-- `imagen_url` queda NULLABLE y sin poblar por decisión de producto (fotos
-- de participantes de investigación, sensibles) — es un add-on fácil si se
-- decide lo contrario más adelante, no un rediseño.
--
-- Políticas RLS: sólo SELECT + INSERT (sin UPDATE/DELETE) — son tablas tipo
-- "log de eventos", nunca se edita una predicción o un guardado después de
-- creado. Decisión de producto confirmada, no un descuido respecto a la
-- plantilla de RLS del resto del esquema.
-- ============================================================

create table if not exists public.detecciones_ia (
  id_deteccion                bigserial primary key,
  id_usuario                  uuid not null references auth.users(id) on delete cascade,
  prompt_version              text not null,
  modelo                      text not null,
  vajilla_tipo                text not null check (vajilla_tipo in ('plato_playo', 'plato_postre', 'plato_hondo')),
  vajilla_diametro_cm         numeric(10,2) not null,
  angulo_captura_grados       integer not null,
  angulo_aproximado           boolean not null default false,
  -- Encuadre (zoom/pan) manual del usuario antes de enviar la foto a Gemini.
  -- NULLABLE: el endpoint todavía no manda estos valores (ver nota en el
  -- plan de sesión 1 — es un cambio chico y opcional, no bloqueante).
  encuadre_zoom                numeric(4,2),
  encuadre_pan_x               integer,
  encuadre_pan_y               integer,
  imagen_url                   text,
  total_estimated_weight_grams numeric(10,2) not null,
  created_at                   timestamptz not null default now()
);

create table if not exists public.detecciones_ia_items (
  id_deteccion_item     bigserial primary key,
  id_deteccion          bigint not null references public.detecciones_ia(id_deteccion) on delete cascade,
  item_uuid             uuid not null unique,
  ingredient            text not null,
  tipo                  text not null,
  confidence            numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  estimated_weight_grams numeric(10,2) not null,
  questions             jsonb not null default '[]'::jsonb,
  bbox_x                numeric(5,4),
  bbox_y                numeric(5,4),
  bbox_width            numeric(5,4),
  bbox_height           numeric(5,4),
  created_at            timestamptz not null default now()
);

create table if not exists public.detecciones_guardados (
  id_guardado          bigserial primary key,
  id_usuario           uuid not null references auth.users(id) on delete cascade,
  id_deteccion         bigint not null references public.detecciones_ia(id_deteccion) on delete cascade,
  tipo_comida          text not null, -- texto libre (mealType), deliberadamente NO acoplado al enum de ingestas.tipo
  removed_item_uuids   uuid[] not null default '{}',
  created_at            timestamptz not null default now()
);

create table if not exists public.detecciones_guardados_items (
  id_guardado_item  bigserial primary key,
  id_guardado       bigint not null references public.detecciones_guardados(id_guardado) on delete cascade,
  source_item_uuid  uuid references public.detecciones_ia_items(item_uuid), -- null = agregado manualmente
  name              text not null,
  category          text not null,
  grams             numeric(10,2) not null check (grams > 0),
  ai_grams          numeric(10,2),
  origin            text not null check (origin in ('ai', 'answered', 'replaced', 'added_manually')),
  answers           jsonb not null default '[]'::jsonb,
  food_ref          text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_detecciones_ia_usuario_fecha on public.detecciones_ia(id_usuario, created_at);
create index if not exists idx_detecciones_ia_items_deteccion on public.detecciones_ia_items(id_deteccion);
create index if not exists idx_detecciones_guardados_deteccion on public.detecciones_guardados(id_deteccion);
create index if not exists idx_detecciones_guardados_usuario_fecha on public.detecciones_guardados(id_usuario, created_at);
create index if not exists idx_detecciones_guardados_items_guardado on public.detecciones_guardados_items(id_guardado);

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT ON public.detecciones_ia TO authenticated;
GRANT SELECT, INSERT ON public.detecciones_ia_items TO authenticated;
GRANT SELECT, INSERT ON public.detecciones_guardados TO authenticated;
GRANT SELECT, INSERT ON public.detecciones_guardados_items TO authenticated;

ALTER TABLE public.detecciones_ia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detecciones_ia_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detecciones_guardados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detecciones_guardados_items ENABLE ROW LEVEL SECURITY;

-- DETECCIONES_IA
DROP POLICY IF EXISTS "detecciones_ia: own read" ON public.detecciones_ia;
DROP POLICY IF EXISTS "detecciones_ia: own insert" ON public.detecciones_ia;
DROP POLICY IF EXISTS "detecciones_ia: investigador read all" ON public.detecciones_ia;

CREATE POLICY "detecciones_ia: own read"
  ON public.detecciones_ia FOR SELECT TO authenticated
  USING (id_usuario = auth.uid());

CREATE POLICY "detecciones_ia: own insert"
  ON public.detecciones_ia FOR INSERT TO authenticated
  WITH CHECK (id_usuario = auth.uid());

CREATE POLICY "detecciones_ia: investigador read all"
  ON public.detecciones_ia FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('investigador', 'administrador'));

-- DETECCIONES_IA_ITEMS (sin id_usuario directo — ownership vía parent)
DROP POLICY IF EXISTS "detecciones_ia_items: own read" ON public.detecciones_ia_items;
DROP POLICY IF EXISTS "detecciones_ia_items: own insert" ON public.detecciones_ia_items;
DROP POLICY IF EXISTS "detecciones_ia_items: investigador read all" ON public.detecciones_ia_items;

CREATE POLICY "detecciones_ia_items: own read"
  ON public.detecciones_ia_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.detecciones_ia d
      WHERE d.id_deteccion = detecciones_ia_items.id_deteccion
        AND d.id_usuario = auth.uid()
    )
  );

CREATE POLICY "detecciones_ia_items: own insert"
  ON public.detecciones_ia_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.detecciones_ia d
      WHERE d.id_deteccion = detecciones_ia_items.id_deteccion
        AND d.id_usuario = auth.uid()
    )
  );

CREATE POLICY "detecciones_ia_items: investigador read all"
  ON public.detecciones_ia_items FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('investigador', 'administrador'));

-- DETECCIONES_GUARDADOS
DROP POLICY IF EXISTS "detecciones_guardados: own read" ON public.detecciones_guardados;
DROP POLICY IF EXISTS "detecciones_guardados: own insert" ON public.detecciones_guardados;
DROP POLICY IF EXISTS "detecciones_guardados: investigador read all" ON public.detecciones_guardados;

CREATE POLICY "detecciones_guardados: own read"
  ON public.detecciones_guardados FOR SELECT TO authenticated
  USING (id_usuario = auth.uid());

CREATE POLICY "detecciones_guardados: own insert"
  ON public.detecciones_guardados FOR INSERT TO authenticated
  WITH CHECK (id_usuario = auth.uid());

CREATE POLICY "detecciones_guardados: investigador read all"
  ON public.detecciones_guardados FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('investigador', 'administrador'));

-- DETECCIONES_GUARDADOS_ITEMS
DROP POLICY IF EXISTS "detecciones_guardados_items: own read" ON public.detecciones_guardados_items;
DROP POLICY IF EXISTS "detecciones_guardados_items: own insert" ON public.detecciones_guardados_items;
DROP POLICY IF EXISTS "detecciones_guardados_items: investigador read all" ON public.detecciones_guardados_items;

CREATE POLICY "detecciones_guardados_items: own read"
  ON public.detecciones_guardados_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.detecciones_guardados g
      WHERE g.id_guardado = detecciones_guardados_items.id_guardado
        AND g.id_usuario = auth.uid()
    )
  );

CREATE POLICY "detecciones_guardados_items: own insert"
  ON public.detecciones_guardados_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.detecciones_guardados g
      WHERE g.id_guardado = detecciones_guardados_items.id_guardado
        AND g.id_usuario = auth.uid()
    )
  );

CREATE POLICY "detecciones_guardados_items: investigador read all"
  ON public.detecciones_guardados_items FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('investigador', 'administrador'));
