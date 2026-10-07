# NUT-119 — Matching de alimentos, macros, diario, foto y cola de validación

Branch: `feat-nut119-matching-macros-validacion` (sale de `fix-registro-investigador-y-elegir-uso`, que ya trae la épica de detección NUT-119 que `main` todavía no tiene)

Estado: **diseño para revisión**. No implementar hasta que el usuario dé OK a §13 (Decisiones abiertas).

## 1. Objetivo y alcance

Cerrar el circuito de la detección por foto: que lo que el usuario confirma en `/save` termine en su diario (`ingestas`/`items`) con kcal/macros calculados sobre el **gramaje final** (`FinalItem.grams`), y que lo que no se pudo resolver con el catálogo pase por una cola de validación de investigadores (solo deportistas UCC).

**Incluye:**
1. Matching nombre → `public.alimentos` (~39k filas, SARA2 + ANMAT) hecho 100 % en Postgres (`pg_trgm` + `unaccent`), una sola RPC para todo el lote.
2. Fallback a Gemini (texto, una llamada batch) con valores por 100 g, validados con zod + chequeos de plausibilidad 4/4/9.
3. `registrarEnDiario` real: `/save` escribe guardado + ítems + cola + ingesta + ítems del diario en **una transacción** (RPC de commit).
4. Regla por rol leída en servidor desde `profiles`: `deportista_ucc` → lo no encontrado queda `pendiente` en la cola y se registra igual con valores de IA; `particular` → nunca pendiente, valor de IA marcado `estimado_ia`. A deportistas no se les devuelve ni muestra kcal/macros en ninguna respuesta ni pantalla.
5. Foto del plato guardada en Storage privado (bucket `detecciones-fotos`), con path en `detecciones_ia.imagen_path`, signed URLs cortas, y borrado al eliminar la cuenta.
6. Cola `alimentos_pendientes_validacion` deduplicada por nombre normalizado + auditoría append-only.
7. Acciones del investigador (Modificar / Validar / Descartar) como RPCs `security definer` transaccionales con verificación de rol.
8. Pantalla `/validacion` en el panel de investigadores.
9. Columna "Dato nutricional" en la exportación Excel.
10. Pasar `foodRef` (id del alimento elegido en el buscador) y `fecha` desde el cliente; ocultar los números del mock a deportistas.

**No incluye:**
- Pre-match en `POST /api/food-recognition` (ver §4.6).
- Reemplazar `nutritionProviderMock` por datos reales en la pantalla de resultado (follow-up; ver D13).
- "Reabrir" un ítem validado/descartado.
- Matching por `denominacion` y uso de la categoría de Gemini para matchear (v1 solo la persiste).
- Ocultamiento de macros a nivel de base para deportistas (hoy y después, el dueño puede leer `items.kcal` por PostgREST; ver §12).

**Numeración de la migración:** el usuario pidió `012`, pero `schema_consolidado.sql` ya tiene una sección "012 — Info ampliada de Open Food Facts". La nueva es **`supabase/013_matching_macros_validacion_nut119.sql`**.

## 2. Arquitectura y flujo end-to-end

### 2.1 `POST /api/food-recognition` (cambios mínimos)

```
cliente ──multipart──▶ route
                        ├─ comprimirImagenParaGemini (≤1024 px, JPEG q78)
                        ├─ en paralelo:
                        │    ├─ reconocerAlimentos (Gemini, ≤25 s)
                        │    └─ subirFotoDeteccion → storage `detecciones-fotos/{uid}/{uuid}.jpg`
                        ├─ Gemini falló → borrar foto (best effort, admin) → error como hoy
                        ├─ insert detecciones_ia (imagen_path = path si subió, si no null)
                        │    └─ insert falló → borrar foto (best effort) → 502 como hoy
                        └─ 200 DetectionResponse (sin cambios)
```

La subida nunca hace fallar la detección: si falla, `console.error` y `imagen_path = null`.

### 2.2 `POST /api/food-recognition/save`

```
cliente ──SaveRequest (+fecha?, +foodRef)──▶ route (Node)
  1. auth (getUser) ─────────────────────────────── 401
  2. zod: mealType ∈ INGESTA_TIPOS (case-insensitive), fecha en rango editable,
     grams ≤ MAX_CANTIDAD, foodRef /^\d+$/ ───────── 400 INVALID (+field)
  3. rol ← profiles.role (cliente del usuario)
  4. predicción existe / es mía / sourceItemIds válidos (igual que hoy) ── 404/403/400
     ya tiene guardado → 409 ALREADY_SAVED (pre-check barato, antes de pagar Gemini)
  5. resolver cada ítem:
       foodRef ──────────────▶ id_alimento directo        metodo=food_ref
       resto ──rpc match_alimentos(nombres[], UMBRAL)──▶ exacto | trigram | sin match
  6. sin match (dedup por nombre_normalizado que devuelve la RPC):
       deportista ─rpc cola_lookup (admin)─▶ ya en cola con valores / validado / descartado → no se llama a Gemini
       resto ─▶ estimarMacrosPor100g (1 llamada batch, ≤12 s) ─▶ valores | null (sin datos)
  7. admin.rpc registrar_guardado_deteccion(p_user_id, …, p_items jsonb)   ── UNA transacción
       ├─ lock detecciones_ia FOR UPDATE; si ya hay guardado → ALREADY_SAVED
       ├─ insert detecciones_guardados
       ├─ upsert ingestas (id_usuario, fecha, tipo) → id_ingesta
       └─ por ítem (ordenados por nombre_normalizado, evita deadlocks):
            catálogo  → origen=catalogo
            sin match + deportista → cola: insert … on conflict do nothing; select … for update
                 cola.validado  → usa id_alimento_vinculado / final_*   origen=validado
                 cola.descartado→ origen=descartado (macros 0)
                 si no          → completa gemini_* si estaban null       origen=pendiente
            sin match + otro rol → valores IA ? estimado_ia : sin_datos
            insert detecciones_guardados_items (snapshot/100 g + totales + método + score)
            insert items (id_alimento | nombre_manual + snapshot, origen_macros, id_guardado_item)
               └─ triggers existentes: calculate_item_nutrients → recalculate_ingesta_totals
  8. 200 { ok, savedId, diario: { itemsRegistrados, sinDatos } }   ← nunca kcal/macros
```

**Por rol:**

| Situación | `deportista_ucc` | `particular` (y cualquier otro rol) |
|---|---|---|
| `foodRef` o match del catálogo | `catalogo` | `catalogo` |
| Sin match, Gemini OK | `pendiente` + fila en cola, macros de IA en el diario | `estimado_ia` |
| Sin match, Gemini falla/inválido | `pendiente` (sin datos, macros 0) + fila en cola | `sin_datos` (macros 0) |
| Nombre ya validado en cola | `validado` (valores finales) | n/a (si D2=sí, lo encuentra el matching en el catálogo) |
| Nombre ya descartado en cola | `descartado` (macros 0) | n/a |
| Respuesta HTTP | sin macros | sin macros (YAGNI: contadores alcanzan) |

Investigador/administrador que use `/save` se trata como `particular` (D12).

### 2.3 Por qué una RPC de commit (D5)

Hoy `/save` hace 3 inserts no atómicos y permite guardar la misma predicción N veces. Sumando diario + cola, un doble click o un fallo a mitad dejaría ítems duplicados en el diario o filas de cola huérfanas. Node hace lo lento e idempotente (matching, Gemini); la RPC hace toda la escritura en una transacción, con lock de la predicción y rechazo del segundo guardado.

La RPC se ejecuta **solo con `service_role`** (`revoke … from public, anon, authenticated`): si fuera invocable por el usuario, un deportista podría llamarla por PostgREST con "valores de Gemini" inventados que terminarían en la cola compartida. Node ya autenticó al usuario y le pasa `p_user_id`; la RPC lee el rol de `profiles` por ese id.

## 3. Modelo de datos (migración 013)

### 3.1 Extensiones y normalización

| Objeto | Definición |
|---|---|
| `pg_trgm`, `unaccent` | `create extension if not exists … with schema extensions` |
| `public.norm_alimento(text) returns text` | `language sql immutable parallel safe strict`. `lower` → `extensions.unaccent('extensions.unaccent'::regdictionary, x)` (diccionario calificado: es lo que permite declararla IMMUTABLE) → `regexp_replace('[^a-z0-9 ]+',' ')` → colapsar espacios → `btrim` → `nullif('')`. Única fuente de verdad de la normalización: la usan la columna generada, el matching, la cola y el lookup. Nunca se reimplementa en TS. |

Nota: `unaccent` convierte `ñ`→`n` en ambos lados, así que es consistente. Si `norm_alimento` cambia, hay que recrear la columna generada (drop + add) y re-normalizar la cola.

### 3.2 `alimentos` (catálogo)

| Cambio | Detalle |
|---|---|
| `nombre_normalizado text generated always as (public.norm_alimento(nombre)) stored` | Reescribe 39k filas una vez. |
| `idx_alimentos_nombre_norm_trgm` | `gin (nombre_normalizado extensions.gin_trgm_ops)` |
| `idx_alimentos_nombre_norm` | btree, para el exacto |
| `alimentos_validados_seq` | `start 2000000` — **no 1_000_000**: ANMAT ya usa `1_000_000 + id` (`ANMAT/seed_anmat.py`, ~39.8k filas). Solo se usa si D2 = sí. |
| `fuente` | Nuevo valor `'VALIDADO'` (no hay check constraint sobre `fuente`, no hace falta tocarlo). |

### 3.3 `items` (diario) — opción A de D1

| Columna | Tipo | Notas |
|---|---|---|
| `kcal_100g`, `proteinas_100g`, `grasas_100g`, `carbs_100g` | `numeric(10,2)` null | Snapshot por 100 g cuando no hay `id_alimento` ni `id_alimento_barcode`. |
| `origen_macros` | `text` null, check `in ('catalogo','estimado_ia','pendiente','validado','descartado','sin_datos')` | `null` = legado (catálogo, barcode o manual anterior a 013). |
| `id_guardado_item` | `bigint` FK `detecciones_guardados_items` `on delete set null` | Trazabilidad diario ↔ detección. Índice parcial `where id_guardado_item is not null`. |

- Sin dato de estado físico: `tipo_item = 'solido'` (D10).
- Sin `id_alimento`: `nombre_manual = name` (cumple `items_alimento_or_manual_check`).
- **Trigger `calculate_item_nutrients`** (reemplazo): barcode → igual que hoy; `id_alimento` → igual que hoy; si no: `origen_macros in ('descartado','sin_datos')` → 0; si no → `round(coalesce(snapshot,0) * cantidad / 100, 2)`. Lista `update of` ampliada: `id_alimento, id_alimento_barcode, cantidad, kcal_100g, proteinas_100g, grasas_100g, carbs_100g, origen_macros`. Así un cambio de cantidad posterior (`updateItemAction`) recalcula sobre el snapshot y la validación recalcula sola.
- **Trigger guard `items_proteger_origen`** (D14): si `current_user in ('authenticated','anon')`, rechaza insertar o cambiar `origen_macros`, snapshot o `id_guardado_item`. El diario manual actual no los toca, así que no rompe nada; solo las RPCs definer y el service role los escriben.

### 3.4 `detecciones_ia`

| Columna | Notas |
|---|---|
| `imagen_path text` null | Path dentro del bucket. `imagen_url` queda sin tocar (sugiere URL pública/expirable). El path se arma antes del insert porque la tabla no tiene UPDATE para el usuario. |

### 3.5 `detecciones_guardados_items` (log inmutable, columnas aditivas)

| Columna | Tipo | Notas |
|---|---|---|
| `id_alimento` | `integer` FK `alimentos` null | Matcheado o vinculado al guardar. |
| `metodo_match` | `text` check `in ('food_ref','exacto','trigram','gemini','cola','ninguno')` | `cola` = se reusaron valores ya en cola sin llamar a Gemini; `ninguno` = sin datos. |
| `score_match` | `real` null | Similitud trigram (1.0 exacto). |
| `origen_macros` | mismo check que `items` | Estado **al momento de guardar** (inmutable). El estado vivo sale de la cola vía `id_pendiente` (D11). |
| `kcal_100g` … `carbs_100g` | `numeric(10,2)` null | Snapshot por 100 g usado. |
| `kcal`, `proteinas_g`, `grasas_g`, `carbs_g` | `numeric(10,2)` null | Totales del ítem con `grams` final. `null` = sin datos (no 0). |
| `modelo_nutricion`, `nutrition_prompt_version` | `text` null | Solo si intervino Gemini. |
| `id_pendiente` | `bigint` FK cola `on delete set null` | Índice parcial. "Ocurrencias" = `count(*)` por `id_pendiente`. |

El campo existente `food_ref` sigue igual (`String(id_alimento)` del buscador).

### 3.6 Cola `alimentos_pendientes_validacion`

| Columna | Tipo | Notas |
|---|---|---|
| `id_pendiente` | `bigserial` PK | |
| `nombre_original` | `text not null` | Primer nombre visto. |
| `nombre_normalizado` | `text not null unique` | `norm_alimento(nombre_original)`, calculado en SQL. Clave de dedup. |
| `categoria_ia` | `text` | Categoría de Gemini (no mapea al catálogo; solo informativa). |
| `gemini_kcal_100g` … `gemini_carbs_100g` | `numeric(10,2)` null, check `>= 0` | **Inmutables** una vez no-null (trigger). Pueden llegar null y completarse en una ocurrencia posterior. |
| `gemini_modelo`, `gemini_prompt_version` | `text` null | Inmutables igual que arriba. |
| `nombre_final`, `categoria_final` | `text` null | Borrador/valor final del investigador. |
| `final_kcal_100g` … `final_carbs_100g` | `numeric(10,2)` null, check `>= 0` | |
| `id_alimento_vinculado` | `integer` FK `alimentos` null | Alimento del catálogo resultante (nuevo VALIDADO o existente). |
| `estado` | `text not null default 'pendiente'` check `in ('pendiente','validado','descartado')` | |
| `observaciones` | `text` | |
| `resuelto_por` | `uuid` FK `auth.users` `on delete set null` | |
| `resuelto_at`, `updated_at`, `created_at` | `timestamptz` | |

Índices: unique `(nombre_normalizado)`, `(estado, created_at desc)`.

### 3.7 Auditoría `alimentos_pendientes_auditoria` (append-only)

| Columna | Tipo |
|---|---|
| `id_auditoria` | `bigserial` PK |
| `id_pendiente` | `bigint not null` FK cola `on delete cascade` |
| `accion` | `text` check `in ('modificar','validar','descartar')` |
| `id_usuario` | `uuid` FK `auth.users` `on delete set null` |
| `antes`, `despues` | `jsonb not null` (fila completa de la cola) |
| `items_afectados` | `integer not null default 0` |
| `created_at` | `timestamptz default now()` |

Índice `(id_pendiente, created_at)`.

### 3.8 Vista `v_alimentos_pendientes`

`with (security_invoker = true)`: cola + `ocurrencias` (`count` correlacionado sobre `detecciones_guardados_items.id_pendiente`) + `ultima_ocurrencia`. Con `security_invoker`, las RLS de las tablas base se aplican al que consulta: un deportista ve 0 filas. Escala esperada: cientos de filas → el count correlacionado es suficiente.

### 3.9 RLS y grants

Patrón de la skill `supabase-postgres-best-practices`: `(select auth.uid())` y `(select public.get_my_role())` envueltos en subselect para que se evalúen una vez por query.

| Tabla / objeto | authenticated (dueño) | investigador / administrador | Escritura |
|---|---|---|---|
| `alimentos_pendientes_validacion` | nada | SELECT | solo RPCs definer / service role |
| `alimentos_pendientes_auditoria` | nada | SELECT | solo RPCs definer |
| `v_alimentos_pendientes` | grant SELECT (RLS base → 0 filas) | SELECT | — |
| `items` columnas nuevas | igual que hoy (dueño CRUD) + guard §3.3 | igual (SELECT) | RPCs |
| `detecciones_*` | sin cambios (SELECT+INSERT dueño, sin UPDATE) | SELECT | — |

Funciones:

| Función | Tipo | Execute |
|---|---|---|
| `norm_alimento(text)` | sql immutable | authenticated |
| `match_alimentos(text[], real)` | sql stable **security invoker** | authenticated |
| `cola_lookup(text[])` | sql stable security definer, `search_path=''` | **solo service_role** |
| `registrar_guardado_deteccion(...)` | plpgsql security definer, `search_path=''` | **solo service_role** |
| `pendiente_modificar/validar/descartar(...)` | plpgsql security definer, `search_path=''`, chequea `get_my_role()` | authenticated (la verificación de rol está adentro) |

Supabase da `execute` a `anon`/`authenticated` por default en funciones nuevas: la migración hace `revoke all on function … from public, anon, authenticated` explícito antes de cada `grant`.

### 3.10 Storage

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('detecciones-fotos', 'detecciones-fotos', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;
```

| Policy sobre `storage.objects` | Operación | Condición |
|---|---|---|
| `detecciones-fotos: own insert` | INSERT authenticated | `bucket_id = 'detecciones-fotos' and (storage.foldername(name))[1] = (select auth.uid())::text` |
| `detecciones-fotos: own read` | SELECT authenticated | ídem |
| `detecciones-fotos: investigador read` | SELECT authenticated | `bucket_id = 'detecciones-fotos' and (select public.get_my_role()) in ('investigador','administrador')` |

Sin UPDATE/DELETE para usuarios. El borrado (limpieza best-effort y borrado de cuenta) usa el cliente admin. Los `drop policy if exists` hacen la sección idempotente.

## 4. Matching

### 4.1 Estrategia

1. `foodRef` presente → ese `id_alimento`, sin matching (se verifica que exista vía FK al insertar).
2. Exacto sobre `nombre_normalizado`.
3. Trigram sobre `nombre_normalizado` (`%` usa el índice GIN con el umbral del GUC `pg_trgm.similarity_threshold` = 0.3 por default; después se filtra `similarity() >= greatest(p_umbral, 0.3)`; no se llama `set_config` desde una función STABLE).
4. Desempate: `score + bonus`, con bonus +0.10 al candidato cuya `norm_alimento(marca)` aparece en el nombre consultado; si no, +0.08 a `fuente = 'SARA2'`. El `score` devuelto y el umbral usan la similitud cruda, sin bonus.
5. `denominacion`: fuera de v1 (índice grande; medir primero).
6. La categoría de Gemini ("cereal", "proteína animal") no mapea a las del catálogo: no se usa para matchear.

### 4.2 Firma

```sql
create or replace function public.match_alimentos(p_nombres text[], p_umbral real default 0.5)
returns table (
  idx int, nombre_normalizado text,           -- siempre (para dedup en Node)
  id_alimento int, nombre text, fuente text,  -- null si no hubo match
  score real, metodo text,                    -- 'exacto' | 'trigram' | null
  kcal_100g numeric, proteinas_100g numeric, grasas_100g numeric, carbs_100g numeric
)
language sql stable security invoker
set search_path = public, extensions
as $$
  select q.idx::int, qn.n, m.*
  from unnest(p_nombres) with ordinality as q(nombre, idx)
  cross join lateral (select public.norm_alimento(q.nombre) as n) qn
  left join lateral (
    select a.id_alimento, a.nombre, a.fuente,
           similarity(a.nombre_normalizado, qn.n) as score,
           case when a.nombre_normalizado = qn.n then 'exacto' else 'trigram' end,
           a.kcal_100g, a.proteinas_100g, a.grasas_100g, a.carbs_100g
    from public.alimentos a
    where a.nombre_normalizado % qn.n
      and similarity(a.nombre_normalizado, qn.n) >= greatest(p_umbral, 0.3)
    order by (a.nombre_normalizado = qn.n) desc,
             similarity(a.nombre_normalizado, qn.n) + <bonus marca/SARA2> desc,
             a.id_alimento
    limit 1
  ) m on true
$$;
```

Una sola llamada por `/save`. Devuelve una fila por nombre (con `id_alimento` null si no hubo match) y macros por 100 g para no hacer otro round-trip. Alternativa considerada: índice GiST con `ORDER BY <-> LIMIT 1` (KNN). Se elige GIN porque filtra mejor con `%`, construye más rápido y sirve a futuro para el `ilike` del buscador.

### 4.3 Umbral (D3)

`UMBRAL_MATCH = 0.5` en `src/lib/matchingAlimentos.ts`, pasado como `p_umbral`. Un falso positivo (macros "confiables" de otro alimento y, en deportistas, sin pasar por validación) es peor que un falso negativo (cae a Gemini/cola). Calibración: correr la RPC contra ~30 nombres reales de `detecciones_ia_items.ingredient` y registrar acá la tabla nombre → match → score antes de fijar el valor.

### 4.4 Verificación con EXPLAIN

`set search_path` impide que Postgres "inline" la función, así que `EXPLAIN` sobre `select * from match_alimentos(...)` solo muestra un `Function Scan`. Para ver el plan real, en el SQL Editor de Supabase se corre el **cuerpo** con literales:

```sql
explain (analyze, buffers)
select q.idx, m.*
from unnest(array['milanesa de carne','arroz blanco hervido','coca cola']) with ordinality q(nombre, idx)
cross join lateral (select public.norm_alimento(q.nombre) n) qn
left join lateral (
  select a.id_alimento, extensions.similarity(a.nombre_normalizado, qn.n) s
  from public.alimentos a
  where a.nombre_normalizado operator(extensions.%) qn.n
  order by (a.nombre_normalizado = qn.n) desc, s desc limit 1
) m on true;
```

Esperado: `Bitmap Index Scan on idx_alimentos_nombre_norm_trgm` dentro del loop, sin `Seq Scan on alimentos`, y < 50 ms para 10 nombres.

**Resultado EXPLAIN ANALYZE** (completar en la implementación):

```
(pegar acá el plan y el tiempo total)
```

### 4.5 TS

`src/lib/matchingAlimentos.ts`: `UMBRAL_MATCH` y `matchearAlimentos(supabase, nombres)` → `MatchResultado[]` indexado igual que la entrada. El cliente es el del usuario (función invoker sobre catálogo de lectura pública).

### 4.6 Pre-match en `/api/food-recognition`: no

Los nombres cambian con las respuestas y los reemplazos del usuario, el endpoint ya consume 25–30 s de presupuesto con Gemini, y el único valor sería mostrar kcal reales en `AIRecognitionResult`/`ChangeFoodSheet`, que hoy usan `nutritionProviderMock`. Eso queda como follow-up (D13).

## 5. Fallback Gemini

### 5.1 Refactor previo de `geminiClient.ts`

`callGemini`/`callWithFallback` son closures dentro de `reconocerAlimentos`. Para no duplicar cliente, timeouts, mapeo de errores, fallback de modelo y reintento por JSON, se extrae:

```ts
export async function llamarGeminiJson<T>(opts: {
  systemInstruction: string;
  contents: Content[];
  responseSchema: ResponseSchema;
  parse: (text: string) => T | null;   // null → reintento con INSTRUCCION_RETRY_JSON
  maxTotalMs: number;                   // reconocerAlimentos: 25_000; nutrición: 12_000
  timeoutMs: number;                    // por intento
}): Promise<{ resultado: T; modeloUsado: string }>;
```

`reconocerAlimentos` pasa a usarla sin cambiar su comportamiento. Antes se escribe un test de caracterización (mock de `@google/generative-ai`, mismo patrón que `testing/food-recognition-route.test.ts`): éxito, 503→fallback OK, 503+503→`GeminiUnavailableError`, 429→`GeminiRateLimitError`, abort→`GeminiTimeoutError`, JSON inválido→reintento OK, inválido dos veces→`GeminiInvalidResponseError`, sin key→`GeminiConfigError`.

### 5.2 `src/lib/geminiNutritionFallback.ts`

```ts
export interface Macros100 { kcal_100g: number; proteinas_100g: number; grasas_100g: number; carbs_100g: number }
export async function estimarMacrosPor100g(
  alimentos: { nombre: string; categoria: string }[],   // ya deduplicados
): Promise<{ valores: (Macros100 | null)[]; modelo: string | null }>;  // nunca lanza
```

- Texto, sin imagen, `thinkingConfig: minimal`, `maxTotalMs = 12_000`. Una llamada batch para todos los nombres (Node deduplica por el `nombre_normalizado` que devuelve `match_alimentos`).
- `responseSchema`: `{ items: [{ index: integer, kcal_100g: number|null, proteinas_100g, grasas_100g, carbs_100g }] }` + zod equivalente. `null` = el modelo no lo reconoce.
- Prompt: valores por 100 g de porción comestible tal como se describe (cocido/crudo, con o sin piel según el nombre), con tablas argentinas (SARA2/ARGENFOODS) como referencia. Constante `NUTRITION_PROMPT_VERSION = 'nut119-macros-v1'` en `src/lib/deteccion.ts`.
- Mapeo por `index`: índices faltantes, duplicados o fuera de rango → ese ítem `null`.
- Plausibilidad (`macrosPlausibles` en `src/lib/macros.ts`, la misma que usa el formulario del investigador): todos finitos y ≥ 0; cada macro ≤ 100; P + C + G ≤ 105; kcal ≤ 900; `|kcal − (4P + 4C + 9G)| ≤ max(25, 0.35·kcal)`. Si no pasa → `null`.
- Cualquier error de Gemini (timeout, 429, 503, inválido, config) → `console.error` y todos `null`. El guardado nunca falla por Gemini.

### 5.3 Síncrono dentro de `/save` (D7)

`/save` espera a Gemini (≤12 s) y declara `export const maxDuration = 30`. Es simple, testeable y deja el diario completo al responder. La alternativa `after()` (responder ya y completar en background) baja la latencia, pero obliga a un segundo UPDATE sobre filas recién escritas, abre una ventana con ítems "en proceso" y es más difícil de testear y de recuperar si la función muere.

## 6. Diario

- `SaveRequest.fecha?: string` (aditivo, `YYYY-MM-DD`). Default `todayAR()`. Se valida con `estaEnRangoEditable(fecha)` (hoy `isWithinEditableRange`, privada en `alimentacion/actions.ts`; se mueve a `src/lib/date.ts` y `actions.ts` la importa).
- `mealType`: `toLowerCase()` + `INGESTA_TIPOS`; si no → `400 INVALID` con `field: 'mealType'`. `detecciones_guardados.tipo_comida` guarda el valor normalizado.
- `grams ≤ MAX_CANTIDAD` (2000). `MAX_CANTIDAD` se mueve a `src/lib/nutrition.ts` y lo usan `actions.ts` y `/save`.
- Cálculo: `valor_item = round(valor_100g × grams / 100, 2)` en SQL. Para `items` lo hace el trigger; para `detecciones_guardados_items`, la RPC con la misma fórmula. En TS existe `macrosItem(per100, grams)` (`src/lib/macros.ts`) solo para la vista previa del investigador.
- Ingesta: `insert … on conflict (id_usuario, fecha, tipo) do nothing` + `select id_ingesta` dentro de la RPC (mismo patrón que `upsertIngestaAndInsertItem`).
- Cliente: `AlimentacionClient` pasa `fecha` y `hideNutrition` a `AIRecognitionModal`; después de guardar con éxito, `router.refresh()` para que el diario muestre los ítems nuevos.

## 7. Foto

- **Qué se guarda (D6):** el JPEG que devuelve `comprimirImagenParaGemini` (≤1024 px de lado mayor, q78, orientación EXIF aplicada; `sharp ^0.35.3` ya está instalado). Es exactamente la imagen sobre la que Gemini devolvió los bounding boxes (fracciones 0–1), así que el bbox se dibuja coherente. Alcanza para que un investigador identifique alimentos a simple vista. El servidor nunca recibe la original: el recorte de encuadre (zoom/pan) es client-side (NUT-165, `recortarImagen`).
- **Path:** `{user_id}/{crypto.randomUUID()}.jpg`, generado en servidor antes del insert.
- **Subida:** cliente del usuario (`storage.from('detecciones-fotos').upload(path, buffer, { contentType: 'image/jpeg', upsert: false })`), en paralelo con Gemini. La policy fuerza que la carpeta sea la del usuario.
- **Limpieza best effort** (cliente admin): si Gemini falla o el insert de `detecciones_ia` falla después de subir.
- **Lectura:** solo signed URLs de 300 s generadas en servidor (`createSignedUrls(paths, 300)` en una llamada) por la pantalla `/validacion`. El investigador las genera con su propio cliente: la policy de investigador lo habilita. Nunca son públicas.
- **Helper único** `src/lib/fotosDeteccion.ts`: `BUCKET_FOTOS`, `subirFotoDeteccion`, `borrarFoto`, `borrarFotosDeUsuario(admin, userId)` (list paginado + remove de `{userId}/`), `urlsFirmadas`.
- **Borrado de cuenta (D4):** el cascade de la DB no borra objetos de Storage, y Supabase bloquea `delete from storage.objects` por SQL. `borrarFotosDeUsuario` se llama **antes** de `deleteUser` en los 3 sitios: `src/app/perfil/actions.ts` (el que usa la UI), `src/app/api/delete-account/route.ts` (marcado "NO USAMOS", se actualiza igual para que no quede una puerta que deje fotos) y `src/app/api/admin/delete-account-by-email/route.ts`. Si falla, se loguea y se sigue con el borrado: no se bloquea el derecho a borrar la cuenta. Las filas de cola y los alimentos `VALIDADO` sobreviven (no tienen datos personales); la cola puede quedar con 0 ocurrencias.

## 8. Cola y acciones del investigador

### 8.1 Estados

```
          ┌─ Modificar (borrador final_*, observaciones; estado no cambia)
pendiente ┼─ Validar ──▶ validado   (terminal en v1)
          └─ Descartar ─▶ descartado (terminal en v1)
```

Un nombre que reaparece reusa su fila (`on conflict (nombre_normalizado)`): si está `descartado` el ítem nuevo nace `descartado` y no reabre la cola; si está `validado` el ítem nace `validado`.

### 8.2 RPCs (todas `security definer`, `set search_path = ''`, `get_my_role() in ('investigador','administrador')` o `raise 'FORBIDDEN'`)

```sql
pendiente_modificar(p_id bigint, p_nombre text, p_categoria text,
                    p_kcal numeric, p_prot numeric, p_grasas numeric, p_carbs numeric,
                    p_observaciones text) returns void
pendiente_validar(p_id bigint, p_nombre text, p_categoria text,
                  p_kcal numeric, p_prot numeric, p_grasas numeric, p_carbs numeric,
                  p_observaciones text, p_id_alimento_existente int default null)
  returns jsonb  -- { id_alimento, items_afectados }
pendiente_descartar(p_id bigint, p_observaciones text) returns jsonb  -- { items_afectados }
```

Todas: `select … from cola where id_pendiente = p_id for update`; si `estado <> 'pendiente'` → `raise 'ESTADO_INVALIDO'`; guardan `antes`/`despues` en la auditoría con `auth.uid()`.

**Validar** (una transacción):
1. Exige los 4 valores no-null y ≥ 0 (checks de la tabla). La plausibilidad 4/4/9 es solo un aviso en la UI: el investigador es la autoridad.
2. Si `p_id_alimento_existente` → vincula a ese alimento. Si no (y D2 = sí): busca en `alimentos` por `nombre_normalizado = norm_alimento(p_nombre)`; si existe → `raise 'DUPLICADO_EN_CATALOGO'` con el id en `detail`, y la UI ofrece vincular. Si no existe → `insert into alimentos (id_alimento = nextval('alimentos_validados_seq'), fuente = 'VALIDADO', …)`.
3. Cola: `estado = 'validado'`, `final_*`, `id_alimento_vinculado`, `resuelto_por/at`.
4. `update items set id_alimento = v_id, kcal_100g… = finales, origen_macros = 'validado' where id_guardado_item in (select id_guardado_item from detecciones_guardados_items where id_pendiente = p_id)`. El trigger recalcula cada ítem con **su** cantidad actual y `recalculate_ingesta_totals` ajusta las ingestas. `nombre_manual` se conserva (trazabilidad); la UI y el Excel priorizan `alimentos.nombre`.
5. Auditoría con `items_afectados`.

**Descartar:** cola → `descartado`; `update items set origen_macros = 'descartado'` sobre los vinculados (el trigger los pone en 0 y las ingestas dejan de sumar un dato rechazado). Los ítems **no se borran**: el deportista sigue viendo que comió eso, con nombre y gramos.

**Implicancias de agregar VALIDADO al catálogo (D2):**
- Buscador (`BusquedaAlimento.tsx`): aparecen en "Todas" con badge "VALIDADO" (azul, el estilo no-ANMAT); no entran en los tabs SARA2/ANMAT. Aceptable en v1.
- `getAlimentosRecientesAction`: funciona igual (son `id_alimento`).
- Rompe a propósito la nota de la migración 008 ("catálogo maestro, no se modifica"). La sección 013 lo documenta.
- Exportación: los ítems validados pasan a tener `id_alimento` → el nombre sale por `alimentos(nombre)`.
- Re-importar SARA2/ANMAT: los ids ≥ 2_000_000 no chocan; un script de re-seed que haga `truncate alimentos` los borraría y además rompería las FKs de `items`. Hay que documentarlo en `ANMAT/` (nota, sin código).

### 8.3 Concurrencia

- `for update` sobre la fila de cola serializa modificar/validar/descartar entre investigadores.
- La RPC de commit toma la misma fila con `for update` después del `insert … on conflict do nothing`: si un validar termina primero, el commit ve `validado` y usa los valores finales (no queda un ítem `pendiente` colgado de una fila ya resuelta). Si el commit termina primero, validar ve los ítems nuevos.
- El commit procesa los ítems ordenados por `nombre_normalizado` para tomar siempre los locks en el mismo orden (sin deadlocks entre guardados concurrentes).
- Transacciones cortas: Gemini y el matching ocurren **fuera** de la RPC.

### 8.4 Inmutabilidad

Trigger `before update` en la cola: si un `gemini_*` era no-null y cambia → `raise`. Las tablas log (`detecciones_*`) siguen sin UPDATE para usuarios; las columnas nuevas de `detecciones_guardados_items` se escriben solo en el insert.

## 9. Pantalla `/validacion`

**Archivos:** `src/app/(researcher)/validacion/page.tsx` (server component), `ValidacionClient.tsx`, `PendienteDetalle.tsx`, `actions.ts`, y una entrada en `NAV_ITEMS` de `src/components/researcher/Sidebar.tsx`.

- **Guard:** `(researcher)/layout.tsx` ya valida el rol con `getAuthenticatedResearcher()`. Las server actions **re-verifican** (`profiles.role in ('investigador','administrador')`, patrón de `deportistas/actions.ts`); las RPCs vuelven a verificar adentro.
- **Listado** (server-side, querystring `?estado=pendiente&q=&orden=fecha|ocurrencias&page=1`): `from('v_alimentos_pendientes').select('*', { count: 'exact' }).eq('estado', …).ilike('nombre_original', %q%).order(…).range(…)`, 20 por página. Pendiente por defecto. Filtros como `<form method="get">` (funciona sin JS). En desktop es tabla y en mobile tarjetas, con el mismo criterio que `AthletesTable`.
- **Detalle** (`Modal` de `src/components/ui/Modal.tsx`, cargado por `getPendienteDetalleAction(id)`): hasta 20 ocurrencias más recientes ("y N más"), cada una con:
  - foto por signed URL + recuadro del bbox (div absoluto con `left/top/width/height` en %);
  - nombre IA (`detecciones_ia_items.ingredient`) vs. nombre final;
  - respuestas a las preguntas;
  - gramaje IA vs. final;
  - deportista (nombre y apellido de `profiles`) y fecha.
  
  Arriba se muestran los valores de Gemini (solo lectura, auditoría) y la cantidad de ocurrencias.
- **Formulario:** nombre, categoría, kcal/P/G/C por 100 g, observaciones (`Input`, `Button` de `src/components/ui/`), pre-cargado con `final_*` o, si no hay, con los de Gemini. Muestra la vista previa de totales por ocurrencia (`macrosItem(form, grams)`) y el aviso de `macrosPlausibles` (no bloquea: el investigador manda). Botones "Guardar borrador" (Modificar), "Validar" y "Descartar"; los dos últimos piden confirmación en un modal con el número de ítems afectados.
- **"Buscar en catálogo"** (opcional, incluido): reusa `searchAlimentosAction` para elegir un alimento existente y validar vinculándolo (`p_id_alimento_existente`). También es la salida natural del error `DUPLICADO_EN_CATALOGO`.
- **Accesibilidad:** labels en todos los inputs, `aria-live` para los resultados de las acciones, foco devuelto al listado al cerrar, foto con `alt` descriptivo ("Foto del plato de {deportista}, {fecha}").

## 10. Contrato / API (todo aditivo)

`src/lib/deteccion.ts`:

```ts
export interface SaveRequest { …; fecha?: string }            // YYYY-MM-DD, default hoy AR
export interface SaveResponse {
  ok: true; savedId: string;
  diario: { itemsRegistrados: number; sinDatos: number };   // nunca kcal/macros
}
export const NUTRITION_PROMPT_VERSION = 'nut119-macros-v1';
// FinalItem.foodRef ya existe: ahora el cliente lo llena con String(id_alimento)
```

Errores nuevos o con semántica nueva en `docs/contrato-deteccion.md`:

| Código | Status | Cuándo |
|---|---|---|
| `ALREADY_SAVED` | 409 | La predicción ya tiene un guardado (pre-check o RPC) |
| `INVALID` (`field: 'mealType'`/`'fecha'`/`'items.N.grams'`/`'items.N.foodRef'`) | 400 | mealType fuera de `INGESTA_TIPOS`, fecha fuera de la ventana editable, grams > 2000, foodRef no numérico o inexistente |
| `PERSISTENCE_ERROR` | 502 | Falló la RPC de commit (incluye matching caído) |

No se agrega código para "Gemini de nutrición falló": no es un error del guardado.

El doc también cambia en tres puntos: ya hay datos nutricionales (persistidos, nunca devueltos); `/save` escribe en el diario; la foto se guarda (bucket privado, signed URLs, borrado con la cuenta).

## 11. Estrategia de tests

Infra: `testing/supabaseMock.ts` gana `rpc(nombre, args)` encolable por nombre, `storage.from(b).upload/remove/list/createSignedUrls` registrables, y `upsert` explícito. Se mockean `@/lib/supabase/admin` y `@/lib/supabase/server`.

| Área | Archivo | Casos |
|---|---|---|
| Caracterización Gemini | `testing/geminiClient.test.ts` (nuevo) | 8 casos de §5.1, antes del refactor |
| Fallback nutrición | `testing/geminiNutritionFallback.test.ts` | éxito; índice faltante/duplicado → null; implausible (4/4/9, >100 g) → null; timeout/429/503/inválido → todos null sin lanzar; dedup no se hace acá |
| Macros | `testing/macros.test.ts` | `macrosItem` con gramos corregidos; `macrosPlausibles` en bordes |
| Matching TS | `testing/matchingAlimentos.test.ts` | RPC mockeada: arma `p_nombres`/`p_umbral`; mapea por `idx`; error de RPC → lanza |
| `/save` | `testing/food-recognition-save-route.test.ts` (**se reescribe**: hoy asume inserts directos en 2 tablas y el test "nunca toca el diario" deja de ser cierto) | validación (mealType, fecha, grams, foodRef); ownership; `ALREADY_SAVED`; foodRef salta matching; deportista vs particular (payload a la RPC y que **la respuesta no tenga kcal/macros**); Gemini falla → guardado OK con sin datos; dedup: dos ítems con mismo normalizado → un solo nombre a Gemini; `cola_lookup` evita Gemini; payload usa `grams` final |
| Detección + foto | `testing/food-recognition-route.test.ts` (se amplía) | subida OK → `imagen_path` en el insert; subida falla → 200 con `imagen_path: null`; Gemini falla → se borra la foto; insert falla → se borra la foto |
| Borrado de cuenta | `testing/fotosDeteccion.test.ts` | `borrarFotosDeUsuario` lista paginado y borra; error no lanza |
| Acciones investigador | `testing/validacionActions.test.ts` | rol no permitido → error sin llamar RPC; validar/descartar/modificar arman la RPC correcta; `DUPLICADO_EN_CATALOGO` → mensaje para vincular. La lógica transaccional (recálculo, descartar sin borrar) se prueba en SQL (checklist manual, Task 16 del plan) porque el repo no tiene DB de test. |
| Pantalla | `testing/ValidacionClient.test.tsx`, `testing/PendienteDetalle.test.tsx` | filtros/paginación arman querystring; detalle muestra foto/bbox/nombres/gramos; preview recalcula; confirmación antes de validar/descartar |
| Cliente | `testing/deteccionResultado.test.ts`, `ChangeFoodSheet.test.tsx`, `AIRecognitionModal.test.tsx`, `AIRecognitionResult.test.tsx` | `foodRef` viaja desde el buscador; respuesta `identity` lo limpia; `fecha` en el SaveRequest; `hideNutrition` oculta kcal |
| Exportación | `testing/datoNutricional.test.ts` | etiqueta por `origen_macros` y celdas vacías para descartado/sin datos |

`npm run build` = `vitest run && next build`.

## 12. Riesgos y limitaciones conocidas

1. **Ocultamiento solo de UI/respuesta.** Un deportista puede leer `items.kcal` y los snapshots de `detecciones_guardados_items` por PostgREST con su sesión (como hoy con `items.kcal`). Los column grants no distinguen roles de la app (todos son `authenticated`). Mitigación posible fuera de alcance: vistas sin columnas de macros + revocar SELECT directo.
2. **Bebidas alcohólicas y alimentos con mucha fibra** no cumplen 4/4/9 y caen a "sin datos" (cola para deportistas). Es aceptable: el investigador los carga.
3. **Columna generada** acoplada a `norm_alimento`: cambiar la función exige recrear la columna y re-normalizar la cola.
4. **Re-seed del catálogo** con `truncate` borraría los `VALIDADO` y rompería FKs (ver §8.2).
5. **Self-tampering:** el guard trigger impide que el dueño cambie `origen_macros`/snapshot por PostgREST, pero puede seguir borrando ítems o cambiando cantidades (igual que hoy).
6. **Comentario de 011** ("estas tablas NUNCA deben ser escritas por el mismo código que escribe en el diario"): 013 lo reemplaza explícitamente. La escritura conjunta es justamente el objetivo y ocurre en una sola RPC.
7. **Latencia de `/save`:** hasta ~12 s extra cuando hay ítems sin match (solo la primera vez por nombre si es deportista). La UI ya muestra "guardando".
8. **Predicciones ya guardadas varias veces** antes de 013: no se tocan. El pre-check `ALREADY_SAVED` aplica a cualquier guardado previo, así que una predicción vieja ya guardada no puede pasar al diario (aceptable: son de antes del diario).

## 13. Decisiones abiertas

Cada una con su recomendación por defecto (**Rec.**). Si el usuario no dice nada, se implementa la recomendación.

**D1 — Macros de ítems sin `id_alimento` en el diario.**
- A) snapshot por 100 g + `origen_macros` + `id_guardado_item` en `items`, con el trigger leyendo el snapshot.
- B) FK de `items` a la fila de cola y el trigger lee de ahí: acopla el trigger a una tabla con RLS restrictiva y no sirve para particulares, que no tienen fila de cola.
- C) insertar lo de Gemini en `alimentos` con `fuente = 'IA_PENDIENTE'`: contamina el buscador y la exportación.

**Rec. A.** Cambiar la cantidad después sigue recalculando, y validar es un UPDATE más.

**D2 — ¿Validados al catálogo `alimentos`?** Sí, con `fuente = 'VALIDADO'`, ids de `alimentos_validados_seq` desde **2_000_000** (1_000_000 lo usa ANMAT), chequeo de duplicado por nombre normalizado y opción de vincular a uno existente. Costo: rompe la nota "catálogo maestro" de 008, aparece en el buscador bajo "Todas" y hay que cuidar el re-seed. Beneficio: lo validado lo encuentra el matching para todos (incluidos particulares) y el Excel lo nombra por `alimentos(nombre)`. La alternativa "no" deja lo validado solo en la cola + snapshots. **Rec. sí.**

**D3 — Umbral de similitud inicial.** 0.3 (default de pg_trgm, más matches y más falsos positivos) / 0.5 / 0.6 (casi solo exactos). **Rec. 0.5**, calibrado con ~30 nombres reales antes del merge (§4.3) y ajustable con la constante `UMBRAL_MATCH`.

**D4 — Fotos al borrar la cuenta.**
- a) Borrarlas siempre, antes de `deleteUser`.
- b) Conservarlas "anonimizadas" para la investigación. Una foto de comida rara vez identifica a alguien, pero puede tener manos, caras de fondo o metadatos (sharp re-encodea sin EXIF, eso ayuda). Conservarlas después de que el participante pidió borrar su cuenta requiere que el consentimiento informado lo diga explícitamente.

**Rec. a**, salvo que el consentimiento del estudio ya contemple retención. Las filas de cola y los `VALIDADO` sobreviven igual.

**D5 — Atomicidad de `/save`.**
- a) Orquestar en Node con inserts sueltos: no atómico, duplica con doble click.
- b) Node hace matching + Gemini y después **una RPC de commit** `security definer` ejecutable solo por `service_role`, que bloquea la predicción (`for update`) y rechaza el segundo guardado (`409 ALREADY_SAVED`).

**Rec. b.** Difiere de "derivar el usuario de `auth.uid()`": se pasa `p_user_id` desde Node porque, si el usuario pudiera invocarla, podría inyectar "valores de Gemini" falsos en la cola compartida.

**D6 — Qué foto se guarda.**
- a) La procesada que va a Gemini: coherente con el bbox, ≤1024 px, sin cambios en el cliente.
- b) La original sin recortar: requiere mandar un segundo archivo desde el cliente (más datos móviles y tiempo de subida), no se corresponde con el bbox y guarda más contexto personal.

**Rec. a.** b) queda como follow-up si los investigadores lo necesitan después de usar a).

**D7 — Gemini en `/save`: síncrono vs. `after()`.** **Rec. síncrono** (§5.3), con `maxDuration = 30`.

**D8 — Cómo se ve un descartado.** El ítem conserva nombre y gramos, `origen_macros = 'descartado'` y macros 0 (los totales de la ingesta no suman un dato rechazado). El Excel suma la columna "Dato nutricional" (Catálogo / Código de barras / Validado / Estimado IA / Pendiente / Pendiente (sin datos) / Descartado / Sin datos / Manual) con las celdas de macros **vacías** para descartado, sin datos y manual. La columna se inserta como 39 dentro de REGISTRO ALIMENTARIO y Hidratación pasa a 40 (no hay test de exportación hoy; los índices hardcodeados se reemplazan por constantes). Alternativa: conservar los valores de IA en el descartado. **Rec. la descrita.** Efecto colateral: los ítems manuales legados pasan de mostrar 0 a celdas vacías en el Excel.

**D9 — Acceso de los deportistas a la cola.** Ninguno: ni lectura ni escritura directa. La escritura va por la RPC de commit (service role) y la lectura es solo de investigadores/administradores. El "insertan/leen solo lo propio" del pedido no aplica: la fila es compartida entre deportistas (dedup) y contiene macros que no pueden ver. **Rec. ninguno.**

**D10 — `tipo_item` de los ítems de la foto.**
- a) `'solido'` fijo.
- b) Inferirlo de la categoría de Gemini.
- c) Preguntarlo en la UI.

**Rec. a**, documentado. Hoy `tipo_item` no afecta ningún cálculo.

**D11 — "Estado de validación" en `detecciones_guardados_items`.** Esa tabla es un log sin UPDATE. Se guarda `origen_macros` **al momento de guardar** (inmutable) y el estado vivo sale de `id_pendiente → cola.estado`. Alternativa: una columna mutable que actualizan las RPCs del investigador (rompe el criterio "log inmutable" y duplica la fuente de verdad). **Rec. snapshot + join.**

**D12 — Investigador/administrador que guarda una detección.** Se trata como `particular`: nunca pendiente, sin cola. **Rec. sí**; solo `deportista_ucc` alimenta la cola.

**D13 — Números del mock en la pantalla de resultado (hallazgo).** `AIRecognitionResult` y `ChangeFoodSheet` muestran kcal/macros de `nutritionProviderMock` (valores derivados de un hash del nombre) **a todos los roles, incluidos los deportistas**. `AIRecognitionModal` no recibe `hideNutrition`.
- a) Ocultarlos para deportistas y mantener el mock para particulares.
- b) Ocultarlos para todos hasta que exista un provider real: son números inventados que no coinciden con lo que después muestra el diario.
- c) Provider real con pre-match: follow-up.

**Rec. b** (lo mínimo y honesto). Como mínimo hay que hacer a), porque viola `shouldHideNutritionInfo`.

**D14 — Guard trigger sobre `items`.** Impedir que `authenticated` escriba `origen_macros`, el snapshot o `id_guardado_item` por PostgREST (§3.3). Son ~10 líneas y protegen la integridad de las etiquetas de investigación. **Rec. incluirlo.**
