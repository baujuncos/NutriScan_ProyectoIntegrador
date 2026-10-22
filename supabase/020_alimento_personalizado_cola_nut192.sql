-- ============================================================
-- Script para correr en el SQL Editor de Supabase (NUT-192).
--
-- Es exactamente la sección "020 (NUT-192)" ya agregada al final de
-- supabase/schema_consolidado.sql (que sigue siendo la fuente de verdad del
-- esquema completo) — este archivo separado es sólo para pegarlo y correrlo
-- de una sin tener que ubicar la sección en el archivo grande.
--
-- Requiere 001–019 aplicadas (en particular 012 NUT-191 y 013–019 NUT-119).
-- Es seguro re-ejecutar: IF NOT EXISTS / DROP ... IF EXISTS / CREATE OR REPLACE.
-- ============================================================

-- ============================================================
-- 020 (NUT-192/NUT-193) — Alimento personalizado: entra a la cola de validación
--
-- NUT-87 permite cargar a mano un alimento que no está en el catálogo (nombre
-- + gramos, sin macros). Hasta ahora ese ítem quedaba para siempre en 0. Desde
-- 020 se anota en la MISMA cola que usa la detección por imagen
-- (alimentos_pendientes_validacion, deduplicada por nombre normalizado) para que
-- un investigador complete los valores desde /validacion.
--
-- Qué agrega (lo mínimo que el camino de la detección no cubre):
--   * alimentos_pendientes_validacion.origen ('ia' | 'manual'): cómo se CREÓ la
--     entrada. No cambia si después la pide el otro camino (una entrada creada
--     por IA y pedida a mano sigue siendo 'ia', y viceversa). Para saber si una
--     entrada tiene ítems con foto, sin foto o ambos, la vista expone
--     `ocurrencias` (con foto, semántica sin cambios) y `ocurrencias_manuales`.
--   * items.id_pendiente: vínculo ítem manual → entrada de la cola (FK
--     on delete set null). La detección vincula por items.id_guardado_item →
--     detecciones_guardados_items.id_pendiente; una carga manual no tiene
--     detección (detecciones_ia exige vajilla, ángulo y peso), así que no puede
--     colgarse de ahí sin inventar filas. Es además el enlace ingesta → ítem →
--     cola que permitirá un backfill futuro de ingestas manuales anteriores.
--   * registrar_item_manual: RPC hermana de registrar_guardado_deteccion (sólo
--     service role). Misma semántica sobre la cola — ver COMMENT ON FUNCTION
--     de ambas. NO se modificó el cuerpo de registrar_guardado_deteccion.
--   * v_alimentos_pendientes: suma `ocurrencias_manuales` y `usuarios_distintos`
--     (une ambas fuentes sin doble conteo). `ocurrencias` no cambia.
--
-- Regla "nunca cero": items.kcal/proteinas_g/grasas_g/carbs_g siguen siendo
-- NOT NULL DEFAULT 0 (no se tocan). Un ítem manual nuevo se inserta con
-- origen_macros = 'pendiente' y el snapshot por 100 g en NULL; el discriminador
-- es origen_macros (el 0 almacenado no significa "dio cero"). La UI y la
-- exportación muestran "no disponible" en esos casos.
--
-- Quién alimenta la cola con una carga manual: todos los roles que no son
-- investigador/administrador (particular y deportista_ucc). Investigador y
-- administrador conservan el comportamiento anterior (ítem manual legado, sin
-- cola, origen_macros null).
--
-- Mezcla "Del catálogo" en entradas de origen manual: calcular_composicion toma
-- el peso de la FOTO de referencia (018) y no se modificó. Una entrada sin
-- ninguna ocurrencia con foto no puede usar esa pestaña (la RPC ya responde
-- COMPOSICION_INVALIDA); desde /validacion se restringe a "A mano".
--
-- ------------------------------------------------------------
-- NUT-194 — Validar / descartar una entrada con ítems manuales (parte final de
-- este archivo, "Resolución de los ítems manuales")
--
-- Un trigger diferido sobre alimentos_pendientes_validacion completa los ítems
-- manuales (items.id_pendiente) cuando la entrada pasa a 'validado' o
-- 'descartado'. NO se edita ninguna función existente de la cola:
-- registrar_guardado_deteccion, pendiente_modificar, pendiente_validar,
-- pendiente_validar_como_propio, pendiente_descartar y calcular_composicion
-- quedan byte por byte como en 013–019. El flujo de IA no cambia: el trigger
-- no hace nada si la entrada no tiene ítems manuales.
--
-- REVERSIÓN PARCIAL DE LA 016: la 016 dejó de insertar alimentos validados en
-- `alimentos`. Acá se vuelve a insertar UNA fila `fuente = 'VALIDADO'` (id de
-- alimentos_validados_seq, desde 2.000.000), pero SOLO cuando se valida una
-- entrada que tiene ítems manuales y no está vinculada a un alimento existente
-- ni va al catálogo propio. Es lo que hace buscable el alimento (NUT-194). Las
-- entradas de IA siguen sin generar filas en `alimentos`. match_alimentos sigue
-- mirando solo SARA2. RIESGO: un re-seed de `alimentos` que haga TRUNCATE
-- borraría estas filas y rompería las FK de items (items.id_alimento) que las
-- usen; ningún script del repo hace TRUNCATE de `alimentos`, pero la carga de
-- SARA2/ANMAT es manual: no re-sembrar con TRUNCATE sin reponer los VALIDADO
-- (select * from public.alimentos where fuente = 'VALIDADO').
--
-- Casos de entradas mixtas (documentados a pedido):
--   * Creada por IA y con una carga manual posterior (entrada pendiente con
--     ítems de IA e ítems manuales): al validarla, los ítems de IA se actualizan
--     exactamente como hoy (RPC existente) y, como hay un ítem manual, el trigger
--     crea (o reutiliza) la fila VALIDADO y completa los ítems manuales.
--   * Ya validada por IA que recibe después una carga manual: el ítem manual toma
--     los valores finales de la cola (registrar_item_manual, como en la IA) y NO
--     se crea fila en `alimentos`: no hay un cambio de estado que dispare el
--     trigger. Es el comportamiento actual y no se cambia.
--
-- Qué hace el trigger (security definer, search_path fijo):
--   * 'validado' → si la entrada NO está vinculada a un alimento existente
--     (id_alimento_vinculado) y NO es un alimento propio (id_alimento_propio),
--     inserta o reutiliza la fila VALIDADO (reutiliza por nombre normalizado; un
--     advisory lock evita duplicados si dos entradas se validan con el mismo
--     nombre final). Los ítems manuales con origen_macros = 'pendiente' reciben
--     el snapshot por 100 g y origen_macros = 'validado'; id_alimento y
--     nombre_manual NO cambian (igual que los de IA); los triggers existentes
--     recalculan el ítem y los totales de la ingesta. Nunca se tocan ítems que no
--     estén pendientes ni el gramaje.
--     NO se escribe id_alimento_vinculado: hacerlo cambiaría cómo
--     registrar_guardado_deteccion trata esa entrada en futuras cargas de IA.
--     Si la fila VALIDADO ya existía (mismo nombre) se reutiliza tal cual: no se
--     pisan sus valores.
--   * 'descartado' → los ítems manuales pendientes pasan a 'descartado' (no se
--     borran); el motivo opcional ya quedó en `observaciones`.
--   * Auditoría: una fila 'resolver_manuales' con la cantidad de ítems afectados
--     y el alimento VALIDADO usado. La fila 'validar'/'descartar' de la RPC
--     existente no cambia (su items_afectados cuenta solo ítems de IA).
--
-- Por qué DIFERIDO (constraint trigger initially deferred, al commit): la RPC
-- pendiente_validar_como_propio valida con pendiente_validar y recién DESPUÉS
-- escribe id_alimento_propio en un segundo UPDATE. Un trigger inmediato vería la
-- fila sin id_alimento_propio y no podría distinguir "como propio" de una
-- validación "A mano" normal. Diferido, lee el estado FINAL de la fila. Además
-- corre una sola vez por transacción: el segundo UPDATE no cumple el WHEN
-- (el estado no cambia) y guardar un borrador tampoco dispara nada.
-- Locks: cola (ya tomado por la RPC) → ítems manuales → ingestas, ambos ordenados.
-- En entradas solo manuales ese es el orden de todo el repo; en entradas mixtas
-- los ítems manuales se toman después de los de IA (la RPC los bloquea primero),
-- un orden distinto solo contra un usuario que edite la cantidad de un ítem
-- manual en el mismo instante (el detector de deadlocks aborta una de las dos).
--
-- Numeración: la 012 (NUT-191, chat IA) ya estaba integrada en main junto con
-- 013–019, así que 020 es el siguiente número libre en esta base. Quien tenga
-- una rama que numere otra migración como 020 debe renumerar la suya.
-- ============================================================

-- ------------------------------------------------------------
-- Cola: origen de la entrada
-- ------------------------------------------------------------

alter table public.alimentos_pendientes_validacion
  add column if not exists origen text not null default 'ia'
  check (origen in ('ia', 'manual'));

-- ------------------------------------------------------------
-- items: vínculo con la cola (ítems manuales)
-- ------------------------------------------------------------

alter table public.items
  add column if not exists id_pendiente bigint;

alter table public.items
  drop constraint if exists items_id_pendiente_fkey;
alter table public.items
  add constraint items_id_pendiente_fkey
    foreign key (id_pendiente) references public.alimentos_pendientes_validacion(id_pendiente) on delete set null;

create index if not exists idx_items_pendiente
  on public.items (id_pendiente) where id_pendiente is not null;

-- Igual que origen_macros / snapshot / id_guardado_item (013, D14): por
-- PostgREST (authenticated/anon) no se puede insertar ni cambiar id_pendiente;
-- si pudiera, un usuario inflaría el contador de otra entrada de la cola.
-- Mismo cuerpo que 013 + id_pendiente.
create or replace function public.items_proteger_origen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if num_nonnulls(new.origen_macros, new.kcal_100g, new.proteinas_100g,
                    new.grasas_100g, new.carbs_100g, new.id_guardado_item, new.id_pendiente) > 0 then
      raise exception 'COLUMNA_PROTEGIDA'
        using detail = 'origen_macros, snapshot por 100 g, id_guardado_item e id_pendiente sólo se escriben desde el servidor.';
    end if;
  elsif (new.origen_macros, new.kcal_100g, new.proteinas_100g, new.grasas_100g, new.carbs_100g, new.id_guardado_item, new.id_pendiente)
        is distinct from
        (old.origen_macros, old.kcal_100g, old.proteinas_100g, old.grasas_100g, old.carbs_100g, old.id_guardado_item, old.id_pendiente) then
    raise exception 'COLUMNA_PROTEGIDA'
      using detail = 'origen_macros, snapshot por 100 g, id_guardado_item e id_pendiente sólo se escriben desde el servidor.';
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- registrar_item_manual: alta de un alimento personalizado (NUT-87) + cola
--
-- Sólo service role (igual que registrar_guardado_deteccion): Node autentica al
-- usuario y pasa su id. Si fuera invocable por el usuario podría anotar
-- nombres arbitrarios en la cola compartida.
--
-- Semántica sobre la cola, IDÉNTICA a registrar_guardado_deteccion
-- (013, rama "deportista_ucc" del loop):
--   * insert ... on conflict (nombre_normalizado) do nothing + select for update
--     (una sola entrada por nombre normalizado; el lock serializa cargas
--     concurrentes del mismo nombre).
--   * estado 'validado'   → origen_macros 'validado', id_alimento = vinculado,
--                           valores finales de la cola.
--   * estado 'descartado' → origen_macros 'descartado', sin valores. No reabre
--                           la cola (el ítem hereda el estado).
--   * estado 'pendiente'  → origen_macros 'pendiente', snapshot en NULL (a
--                           diferencia de la IA, acá no hay valores de Gemini).
--   * con id_alimento el snapshot es el del catálogo (el log coincide con lo
--     que calcula el trigger de items).
-- Locks en el orden del repo: fila de cola → ítems → ingestas.
--
-- Errores (message): INVALID.
-- ------------------------------------------------------------

create or replace function public.registrar_item_manual(
  p_user_id   uuid,
  p_fecha     date,
  p_tipo      text,
  p_tipo_item text,
  p_nombre    text,
  p_cantidad  numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rol          text;
  v_nombre       text := nullif(btrim(p_nombre), '');
  v_norm         text := public.norm_alimento(p_nombre);
  v_encola       boolean;
  v_id_ingesta   bigint;
  v_id_pendiente bigint := null;
  v_id_alim      integer := null;
  v_origen       text := null;
  v_k            numeric := null;
  v_p            numeric := null;
  v_g            numeric := null;
  v_c            numeric := null;
  v_cola         public.alimentos_pendientes_validacion%rowtype;
  v_id_item      bigint;
begin
  if v_nombre is null or length(v_nombre) > 200 then
    raise exception 'INVALID' using detail = 'p_nombre';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'INVALID' using detail = 'p_cantidad';
  end if;

  select p.role into v_rol from public.profiles p where p.user_id = p_user_id;
  -- Investigador/administrador (y usuarios sin perfil) no alimentan la cola.
  v_encola := v_rol is not null and v_rol not in ('investigador', 'administrador');

  if v_encola and v_norm is not null then
    insert into public.alimentos_pendientes_validacion (nombre_original, nombre_normalizado, origen)
    values (v_nombre, v_norm, 'manual')
    on conflict (nombre_normalizado) do nothing;

    select * into v_cola
    from public.alimentos_pendientes_validacion c
    where c.nombre_normalizado = v_norm
    for update;

    v_id_pendiente := v_cola.id_pendiente;

    if v_cola.estado = 'validado' then
      v_origen := 'validado';
      v_id_alim := v_cola.id_alimento_vinculado;
      v_k := v_cola.final_kcal_100g;
      v_p := v_cola.final_proteinas_100g;
      v_g := v_cola.final_grasas_100g;
      v_c := v_cola.final_carbs_100g;
    elsif v_cola.estado = 'descartado' then
      v_origen := 'descartado';
    else
      v_origen := 'pendiente';
    end if;
  elsif v_encola then
    -- Nombre no normalizable (ej. solo símbolos): no se puede deduplicar ni encolar.
    v_origen := 'sin_datos';
  end if;

  if v_id_alim is not null then
    select a.kcal_100g, a.proteinas_100g, a.grasas_100g, a.carbs_100g
    into v_k, v_p, v_g, v_c
    from public.alimentos a
    where a.id_alimento = v_id_alim;
    if not found then
      raise exception 'INVALID' using detail = 'alimento vinculado inexistente';
    end if;
  end if;

  insert into public.ingestas (id_usuario, fecha, tipo)
  values (p_user_id, p_fecha, p_tipo)
  on conflict (id_usuario, fecha, tipo) do nothing;

  select i.id_ingesta into v_id_ingesta
  from public.ingestas i
  where i.id_usuario = p_user_id and i.fecha = p_fecha and i.tipo = p_tipo;

  -- Con id_alimento el nombre vive en el catálogo; si no, va a nombre_manual
  -- (items_alimento_or_manual_check). kcal/macros los calcula el trigger
  -- calculate_item_nutrients: desde el catálogo si hay id_alimento, desde el
  -- snapshot si no (NULL → el trigger deja 0, que NO significa "dio cero":
  -- el discriminador es origen_macros).
  insert into public.items (
    id_ingesta, id_alimento, nombre_manual, tipo_item, cantidad,
    kcal_100g, proteinas_100g, grasas_100g, carbs_100g,
    origen_macros, id_pendiente
  )
  values (
    v_id_ingesta,
    v_id_alim,
    v_nombre,
    p_tipo_item,
    p_cantidad,
    case when v_id_alim is null then v_k end,
    case when v_id_alim is null then v_p end,
    case when v_id_alim is null then v_g end,
    case when v_id_alim is null then v_c end,
    v_origen,
    v_id_pendiente
  )
  returning id_item into v_id_item;

  return jsonb_build_object(
    'id_item', v_id_item,
    'id_pendiente', v_id_pendiente,
    'origen_macros', v_origen
  );
end;
$$;

revoke all on function public.registrar_item_manual(uuid, date, text, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.registrar_item_manual(uuid, date, text, text, text, numeric)
  to service_role;

-- Referencia cruzada (sin tocar el cuerpo de la RPC de IA, que vive en 013).
comment on function public.registrar_item_manual(uuid, date, text, text, text, numeric) is
  'NUT-192. Alta de alimento personalizado. Comparte la semántica sobre alimentos_pendientes_validacion con registrar_guardado_deteccion (013): una entrada por nombre normalizado, validado/descartado/pendiente se respetan igual. Si cambia una, revisar la otra.';
-- La firma de registrar_guardado_deteccion cambió (NUT-149 le agregó p_revisiones): en vez de fijar una
-- firma que vuelve a romperse, se resuelve por nombre. Funciona con cualquier firma vigente (y con ninguna).
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'registrar_guardado_deteccion'
  loop
    execute format(
      'comment on function %s is %L', v_fn,
      'NUT-119. Guarda una detección y el diario en una transacción. Comparte la semántica sobre alimentos_pendientes_validacion con registrar_item_manual (020, NUT-192): una entrada por nombre normalizado, validado/descartado/pendiente se respetan igual. Si cambia una, revisar la otra.'
    );
  end loop;
end
$$;

-- ------------------------------------------------------------
-- Vista para /validacion
--
-- CREATE OR REPLACE VIEW exige conservar nombre, orden y tipo de las columnas
-- existentes y permite agregar nuevas SOLO al final. Por eso la lista de
-- columnas de la cola es explícita (`p.*` metería `origen` antes de
-- `ocurrencias`) y las nuevas van al final:
--   existentes (sin cambios): las de la cola de 019, ocurrencias, ultima_ocurrencia
--   nuevas (al final): ocurrencias_manuales, usuarios_distintos, origen
--   * ocurrencias: sin cambios — ocurrencias CON foto (detecciones_guardados_items).
--   * ultima_ocurrencia: mismo nombre y tipo; ahora es la más reciente de las dos
--     fuentes (greatest ignora los null; para entradas solo de IA es idéntica).
--   * ocurrencias_manuales: ítems cargados a mano vinculados por items.id_pendiente.
--   * usuarios_distintos: une ambas fuentes (detecciones_guardados.id_usuario e
--     ingestas.id_usuario) con UNION → un usuario que lo cargó por los dos
--     caminos cuenta una sola vez.
-- security_invoker: la RLS del que consulta aplica a cada tabla base. Como
-- CREATE OR REPLACE conserva los permisos, el revoke/grant solo reafirma lo de 013.
-- ------------------------------------------------------------

create or replace view public.v_alimentos_pendientes
with (security_invoker = true)
as
select
  p.id_pendiente, p.nombre_original, p.nombre_normalizado, p.categoria_ia,
  p.gemini_kcal_100g, p.gemini_proteinas_100g, p.gemini_grasas_100g, p.gemini_carbs_100g,
  p.gemini_modelo, p.gemini_prompt_version,
  p.nombre_final, p.categoria_final,
  p.final_kcal_100g, p.final_proteinas_100g, p.final_grasas_100g, p.final_carbs_100g,
  p.id_alimento_vinculado, p.estado, p.observaciones, p.resuelto_por, p.resuelto_at,
  p.created_at, p.updated_at, p.composicion, p.id_alimento_propio,
  o.ocurrencias,
  greatest(o.ultima_ia, m.ultima_manual) as ultima_ocurrencia,
  m.ocurrencias_manuales,
  u.usuarios_distintos,
  p.origen
from public.alimentos_pendientes_validacion p
cross join lateral (
  select count(*) as ocurrencias, max(gi.created_at) as ultima_ia
  from public.detecciones_guardados_items gi
  where gi.id_pendiente = p.id_pendiente
) o
cross join lateral (
  select count(*) as ocurrencias_manuales, max(it.created_at) as ultima_manual
  from public.items it
  where it.id_pendiente = p.id_pendiente
) m
cross join lateral (
  select count(*) as usuarios_distintos
  from (
    select g.id_usuario
    from public.detecciones_guardados_items gi
    join public.detecciones_guardados g on g.id_guardado = gi.id_guardado
    where gi.id_pendiente = p.id_pendiente
    union
    select ing.id_usuario
    from public.items it
    join public.ingestas ing on ing.id_ingesta = it.id_ingesta
    where it.id_pendiente = p.id_pendiente
  ) x
) u;

revoke all on public.v_alimentos_pendientes from anon, authenticated;
grant select on public.v_alimentos_pendientes to authenticated;

-- ------------------------------------------------------------
-- Resolución de los ítems manuales (NUT-194)
-- ------------------------------------------------------------

alter table public.alimentos_pendientes_auditoria
  drop constraint if exists alimentos_pendientes_auditoria_accion_check;
alter table public.alimentos_pendientes_auditoria
  add constraint alimentos_pendientes_auditoria_accion_check
  check (accion in ('modificar', 'validar', 'descartar', 'crear_propio', 'retirar_propio', 'resolver_manuales'));

create or replace function public.pendiente_resolver_items_manuales()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cola    public.alimentos_pendientes_validacion%rowtype;
  v_nombre  text;
  v_norm    text;
  v_id_alim integer := null;
  v_creada  boolean := false;
  v_n       integer := 0;
begin
  -- Estado vigente de la fila (el trigger es diferido: puede haber cambiado
  -- después del evento, por ejemplo con id_alimento_propio).
  select * into v_cola
  from public.alimentos_pendientes_validacion c
  where c.id_pendiente = new.id_pendiente;
  if not found or v_cola.estado not in ('validado', 'descartado') then
    return null;
  end if;

  -- Solo entradas con ítems manuales; las de IA puras no pasan de acá.
  if not exists (select 1 from public.items it where it.id_pendiente = v_cola.id_pendiente) then
    return null;
  end if;

  if v_cola.estado = 'descartado' then
    perform 1 from public.items it
    where it.id_pendiente = v_cola.id_pendiente and it.origen_macros = 'pendiente'
    order by it.id_item
    for update;
    perform 1 from public.ingestas g
    where g.id_ingesta in (
      select it.id_ingesta from public.items it
      where it.id_pendiente = v_cola.id_pendiente and it.origen_macros = 'pendiente'
    )
    order by g.id_ingesta
    for update;

    -- El trigger de items deja los macros en 0 (no disponible) y el de ingestas ajusta los totales.
    update public.items it
    set origen_macros = 'descartado'
    where it.id_pendiente = v_cola.id_pendiente and it.origen_macros = 'pendiente';
    get diagnostics v_n = row_count;
  else
    -- Una validación sin los 4 valores no es posible (la RPC lo exige); por las dudas, no se inventa nada.
    if num_nulls(v_cola.final_kcal_100g, v_cola.final_proteinas_100g, v_cola.final_grasas_100g, v_cola.final_carbs_100g) > 0 then
      return null;
    end if;

    -- Fila VALIDADO para el buscador: solo si no es un vínculo a un alimento existente ni un propio.
    if v_cola.id_alimento_vinculado is null and v_cola.id_alimento_propio is null then
      v_nombre := coalesce(nullif(btrim(v_cola.nombre_final), ''), v_cola.nombre_original);
      v_norm := public.norm_alimento(v_nombre);
      if v_norm is not null then
        perform pg_advisory_xact_lock(hashtext('alimentos_validado:' || v_norm));
        select a.id_alimento into v_id_alim
        from public.alimentos a
        where a.fuente = 'VALIDADO' and a.nombre_normalizado = v_norm
        order by a.id_alimento
        limit 1;
        if v_id_alim is null then
          insert into public.alimentos (id_alimento, nombre, categoria, fuente, kcal_100g, proteinas_100g, grasas_100g, carbs_100g)
          values (
            nextval('public.alimentos_validados_seq'), v_nombre, nullif(btrim(v_cola.categoria_final), ''), 'VALIDADO',
            v_cola.final_kcal_100g, v_cola.final_proteinas_100g, v_cola.final_grasas_100g, v_cola.final_carbs_100g
          )
          returning id_alimento into v_id_alim;
          v_creada := true;
        end if;
      end if;
    end if;

    perform 1 from public.items it
    where it.id_pendiente = v_cola.id_pendiente and it.origen_macros = 'pendiente'
    order by it.id_item
    for update;
    perform 1 from public.ingestas g
    where g.id_ingesta in (
      select it.id_ingesta from public.items it
      where it.id_pendiente = v_cola.id_pendiente and it.origen_macros = 'pendiente'
    )
    order by g.id_ingesta
    for update;

    -- Solo ítems pendientes; id_alimento y nombre_manual no se tocan. El trigger de items
    -- recalcula con SU cantidad y el de ingestas ajusta los totales.
    update public.items it
    set kcal_100g = v_cola.final_kcal_100g,
        proteinas_100g = v_cola.final_proteinas_100g,
        grasas_100g = v_cola.final_grasas_100g,
        carbs_100g = v_cola.final_carbs_100g,
        origen_macros = 'validado'
    where it.id_pendiente = v_cola.id_pendiente and it.origen_macros = 'pendiente';
    get diagnostics v_n = row_count;
  end if;

  if v_n > 0 or v_creada then
    insert into public.alimentos_pendientes_auditoria (id_pendiente, accion, id_usuario, antes, despues, items_afectados)
    values (
      v_cola.id_pendiente, 'resolver_manuales', auth.uid(),
      jsonb_build_object('estado', 'pendiente'),
      jsonb_build_object('estado', v_cola.estado, 'id_alimento_validado', v_id_alim, 'alimento_creado', v_creada),
      v_n
    );
  end if;

  return null;
end;
$$;

revoke all on function public.pendiente_resolver_items_manuales() from public, anon, authenticated;

-- Diferido (al commit) y con WHEN: ver el encabezado de esta migración. Se recrea para ser re-ejecutable.
drop trigger if exists alimentos_pendientes_resolver_manuales on public.alimentos_pendientes_validacion;
create constraint trigger alimentos_pendientes_resolver_manuales
  after update on public.alimentos_pendientes_validacion
  deferrable initially deferred
  for each row
  when (old.estado is distinct from new.estado and new.estado in ('validado', 'descartado'))
  execute function public.pendiente_resolver_items_manuales();
