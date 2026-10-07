# NUT-119 — Matching de alimentos, macros, diario, foto y cola de validación — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (o superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Dentro de cada tarea aplicar superpowers:test-driven-development (test que falla → implementación → verde → commit).

**Goal:** Que `/save` registre en el diario los alimentos confirmados con kcal/macros calculados sobre el gramaje final (catálogo vía `pg_trgm` o Gemini como fallback), con cola de validación para deportistas, foto en Storage privado y pantalla `/validacion` para investigadores.

**Spec:** `docs/superpowers/specs/2026-10-07-nut119-matching-macros-validacion-design.md`

**Branch:** `feat-nut119-matching-macros-validacion`

**Prerrequisito:** el usuario dio OK a §13 del spec (Decisiones abiertas). Si alguna decisión cambia, ajustar las tareas marcadas con `(D#)` antes de empezar.

## Global Constraints

- **Modelo por tarea:** Sonnet 5.5, esfuerzo Alto, por defecto. **Opus 5.5 solo** en la Task 1 (migración SQL con RLS) y la Task 11 (transacción validar/descartar con recálculo de ítems). Commits chicos, uno por tarea como mínimo.
- **Migración:** `supabase/013_matching_macros_validacion_nut119.sql` (no 012: el consolidado ya tiene una sección 012). Idempotente (`if not exists`, `create or replace`, `drop policy if exists`, `on conflict do nothing`). Cada tarea que agrega SQL lo agrega **al mismo archivo** y a la sección "013" al final de `supabase/schema_consolidado.sql` (contenido idéntico). El header del archivo sigue el formato del 011: instrucciones para el SQL Editor y "seguro re-ejecutar".
- **Contrato aditivo:** `src/lib/deteccion.ts` solo suma campos y constantes; no se renombra nada.
- **Estilo:** comentarios en español; ticket (`NUT-119`) en el header de cada archivo nuevo o tocado de forma sustancial; errores HTTP siempre con `errorResponse` (`src/lib/httpErrors.ts`); componentes de `src/components/ui/` (Button, Input, Select, Modal).
- **Roles:** el rol se lee siempre en servidor desde `profiles`. Ninguna respuesta HTTP de `/save` lleva kcal/macros. Ninguna pantalla muestra kcal/macros a `deportista_ucc` (`shouldHideNutritionInfo`).
- **Sin dependencias npm nuevas** (`sharp`, `zod`, `@google/generative-ai`, `exceljs` ya están).
- **SQL:** seguir `.agents/skills/supabase-postgres-best-practices/` (`security-rls-performance`: `(select auth.uid())`; `schema-foreign-key-indexes`: índice en cada FK nueva; `lock-short-transactions`, `lock-deadlock-prevention`). Funciones `security definer` con `set search_path = ''` y nombres totalmente calificados; `revoke all on function … from public, anon, authenticated` antes de cada `grant`.
- **Antes de cada commit:** `npx vitest run` y `npx tsc --noEmit` limpios. Al final, `npm run build` (corre vitest + next build).

## Task 1: Migración 013 — esquema, RLS, Storage, cola y RPC de commit

**Modelo:** Opus 5.5 (SQL con RLS y `security definer`; revisión de seguridad).

**Files:** `supabase/013_matching_macros_validacion_nut119.sql` (nuevo), `supabase/schema_consolidado.sql`

- [ ] Header (formato 011) + nota explícita: "013 reemplaza la regla de 011 'nunca escribir detecciones y diario desde el mismo código': ahora se escriben juntos en una RPC transaccional" y "rompe a propósito la nota de 008 (catálogo maestro) si D2 = sí".
- [ ] Extensiones `pg_trgm`, `unaccent` en `extensions`; `public.norm_alimento(text)` IMMUTABLE/PARALLEL SAFE/STRICT (spec §3.1).
- [ ] `alimentos`: columna generada `nombre_normalizado`, índice GIN trigram, btree, `alimentos_validados_seq start 2000000` (D2).
- [ ] `items`: snapshot por 100 g, `origen_macros` (check), `id_guardado_item` (FK `on delete set null` + índice parcial). Reemplazar `calculate_item_nutrients` (spec §3.3) y recrear el trigger con la lista `update of` ampliada. Trigger guard `items_proteger_origen` (D14).
- [ ] `detecciones_ia.imagen_path`; columnas aditivas de `detecciones_guardados_items` (spec §3.5) + índice parcial en `id_pendiente`.
- [ ] Tablas `alimentos_pendientes_validacion` y `alimentos_pendientes_auditoria` (spec §3.6–3.7), trigger de inmutabilidad de `gemini_*`, trigger `updated_at` (reusar `public.handle_updated_at`), índices.
- [ ] Vista `v_alimentos_pendientes` `with (security_invoker = true)` + `grant select` a authenticated.
- [ ] RLS: enable en cola y auditoría; solo policies SELECT para `(select public.get_my_role()) in ('investigador','administrador')`; `grant select` a authenticated (sin insert/update/delete).
- [ ] Storage: bucket privado `detecciones-fotos` (`on conflict do nothing`) + 3 policies (spec §3.10).
- [ ] `public.cola_lookup(p_nombres text[])` → `table(idx int, nombre_normalizado text, id_pendiente bigint, estado text, necesita_ia boolean)`, definer, **solo service_role**. `necesita_ia` = no existe la fila, o existe `pendiente` con `gemini_*` null.
- [ ] `public.registrar_guardado_deteccion(p_user_id uuid, p_id_deteccion bigint, p_fecha date, p_tipo text, p_removed uuid[], p_items jsonb, p_modelo_nutricion text, p_nutrition_prompt_version text) returns jsonb`, plpgsql definer, **solo service_role** (D5). Hace la lógica de la spec §2.2 paso 7: rol por `p_user_id`, `for update` sobre `detecciones_ia` con `id_usuario = p_user_id` (si no → `raise exception 'NOT_FOUND'`), guardado previo → `raise exception 'ALREADY_SAVED'`, ítems ordenados por `norm_alimento(name)`, snapshot de catálogo leído de `alimentos` para los ítems con `id_alimento`, totales `round(v * grams / 100, 2)` (null si no hay valores). Devuelve `{id_guardado, items_registrados, sin_datos}`.
- [ ] Copiar la sección completa al final de `schema_consolidado.sql` bajo `-- 013 (NUT-119) — Matching, macros, diario, foto y cola de validación`.
- [ ] Autorrevisión con la skill de Supabase: índice en cada FK nueva; ninguna policy con `auth.uid()` sin subselect; ningún definer sin `search_path`; ningún `grant execute` sobrante a anon.
- [ ] Commit `feat(db): migración 013 matching/macros/cola NUT-119`.

## Task 2: Mocks de testing para `rpc`, `storage` y `upsert`

**Modelo:** Sonnet 5.5 Alto.

**Files:** `testing/supabaseMock.ts`, `testing/supabaseMock.test.ts` (nuevo, chico)

- [ ] Test que falla: `rpc('x', args)` devuelve lo encolado con `mockRpc('x', resultado)` y registra `rpcLlamadas()`; `storage.from(b).upload/remove/list/createSignedUrls` devuelven lo encolado con `mockStorage(metodo, resultado)` y registran llamadas; `upsert` registra como `insert`.
- [ ] Implementar extendiendo `createSupabaseFromMock` (mismo estilo FIFO; sin romper usos actuales).
- [ ] `npx vitest run` (todos los tests existentes siguen verdes). Commit.

## Task 3: RPC de matching

**Modelo:** Sonnet 5.5 Alto.

**Files:** `supabase/013_matching_macros_validacion_nut119.sql`, `supabase/schema_consolidado.sql`, `src/lib/matchingAlimentos.ts` (nuevo), `testing/matchingAlimentos.test.ts` (nuevo)

- [ ] Agregar `public.match_alimentos(p_nombres text[], p_umbral real default 0.5)` (spec §4.2): invoker, stable, `set search_path = public, extensions`, `grant execute` a authenticated.
- [ ] Test que falla: `matchearAlimentos(supabase, ['Arroz', 'X'])` llama `rpc('match_alimentos', { p_nombres, p_umbral: UMBRAL_MATCH })`, devuelve un resultado por índice (con `idAlimento: null` si no hubo match), y lanza si la RPC devuelve error.
- [ ] Implementar `UMBRAL_MATCH = 0.5` (D3) y `matchearAlimentos`.
- [ ] Commit.

## Task 4: Refactor de `geminiClient` con test de caracterización

**Modelo:** Sonnet 5.5 Alto.

**Files:** `testing/geminiClient.test.ts` (nuevo), `src/lib/geminiClient.ts`

- [ ] Escribir el test de caracterización **contra el código actual** (mock de `@google/generative-ai` como en `testing/food-recognition-route.test.ts`). Los 8 casos de la spec §5.1 deben pasar en verde antes de tocar nada.
- [ ] Extraer `llamarGeminiJson<T>(opts)` exportada (callGemini + callWithFallback + reintento JSON, con `maxTotalMs`/`timeoutMs` por parámetro). `reconocerAlimentos` pasa a usarla con 25 000/15 000.
- [ ] Mismos tests en verde, más `testing/food-recognition-route.test.ts` en verde. Commit `refactor: extraer llamarGeminiJson`.

## Task 5: Fallback Gemini de macros por 100 g

**Modelo:** Sonnet 5.5 Alto.

**Files:** `src/lib/macros.ts` (nuevo), `src/lib/geminiNutritionFallback.ts` (nuevo), `src/lib/deteccion.ts`, `testing/macros.test.ts` (nuevo), `testing/geminiNutritionFallback.test.ts` (nuevo)

- [ ] Tests que fallan para `macros.ts`: `macrosItem({kcal_100g: 130, …}, 250)` → 325 (gramos corregidos, redondeo a 2); `macrosPlausibles` acepta arroz/pollo/aceite reales y rechaza negativos, NaN, macro > 100, P+C+G > 105, kcal > 900 y kcal incoherente con 4/4/9.
- [ ] Implementar `macros.ts` (`Macros100`, `macrosItem`, `macrosPlausibles`).
- [ ] Tests que fallan para `estimarMacrosPor100g`: éxito por índice; índice faltante/duplicado/fuera de rango → `null` en ese ítem; valores implausibles → `null`; `GeminiTimeoutError`/429/503/JSON inválido/sin key → todos `null`, `modelo: null`, **no lanza**; lista vacía → no llama a Gemini.
- [ ] Implementar con `llamarGeminiJson` (12 000 ms total), `responseSchema` + zod, prompt de la spec §5.2. Sumar `NUTRITION_PROMPT_VERSION = 'nut119-macros-v1'` a `deteccion.ts`.
- [ ] Commit.

## Task 6: Contrato, cálculo, `/save` y diario

**Modelo:** Sonnet 5.5 Alto.

**Files:** `src/lib/deteccion.ts`, `src/lib/nutrition.ts`, `src/lib/date.ts`, `src/app/alimentacion/actions.ts`, `src/app/api/food-recognition/save/route.ts`, `testing/food-recognition-save-route.test.ts` (**reescritura**), `testing/dates.test.ts`

- [ ] Mover `MAX_CANTIDAD` a `nutrition.ts` y `isWithinEditableRange` a `date.ts` como `estaEnRangoEditable` (test en `dates.test.ts`); `actions.ts` los importa (sin cambio de comportamiento; `alimentacionActions.test.ts` verde).
- [ ] `deteccion.ts`: `SaveRequest.fecha?`, `SaveResponse` (spec §10).
- [ ] Reescribir `food-recognition-save-route.test.ts` con los mocks de la Task 2. Hay que eliminar el bloque "nunca toca el diario real" y los asserts de inserts directos en `detecciones_guardados*`. Casos que fallan:
  - [ ] validación: `mealType` inválido / con mayúsculas (`'Desayuno'` aceptado), `fecha` fuera de rango, `grams > 2000`, `foodRef` no numérico → 400 `INVALID` con `field`;
  - [ ] 401 / 404 / 403 / sourceItemId ajeno (como hoy);
  - [ ] guardado previo → 409 `ALREADY_SAVED` **sin** llamar a Gemini; error `ALREADY_SAVED` de la RPC → 409;
  - [ ] `foodRef` → no entra en `p_nombres` de `match_alimentos` y viaja con `metodo_match: 'food_ref'`;
  - [ ] match del catálogo → `id_alimento` + `metodo_match` + `score_match` en `p_items`; `grams` es el final, no `aiGrams`;
  - [ ] sin match + particular → Gemini una vez, valores en `ia`; Gemini falla → `ia: null` y 200;
  - [ ] sin match + deportista → mismo payload (la RPC decide la cola) y **la respuesta no tiene ninguna clave de kcal/macros** (assert recursivo sobre el JSON);
  - [ ] dos ítems con el mismo `nombre_normalizado` → un solo nombre a Gemini;
  - [ ] la RPC de commit se llama con el cliente **admin** y `p_user_id = user.id`; si falla → 502 `PERSISTENCE_ERROR`.
- [ ] Implementar la ruta (spec §2.2): `maxDuration = 30`, rol desde `profiles`, pre-check de guardado, `matchearAlimentos`, `estimarMacrosPor100g`, `createAdminClient().rpc('registrar_guardado_deteccion', …)`, mapeo de `ALREADY_SAVED`/`NOT_FOUND`. Borrar el no-op `registrarEnDiario` y su TODO. La respuesta es `SaveResponse`.
- [ ] Commit.

## Task 7: Cliente — `foodRef`, `fecha`, `hideNutrition` y refresh del diario

**Modelo:** Sonnet 5.5 Alto.

**Files:** `src/lib/deteccionResultado.ts`, `src/app/alimentacion/ChangeFoodSheet.tsx`, `src/app/alimentacion/AIRecognitionModal.tsx`, `src/app/alimentacion/AIRecognitionResult.tsx`, `src/app/alimentacion/AlimentacionClient.tsx`, `src/app/alimentacion/reconocimientoApi.ts`, `testing/deteccionResultado.test.ts`, `testing/ChangeFoodSheet.test.tsx`, `testing/AIRecognitionModal.test.tsx`, `testing/AIRecognitionResult.test.tsx`

- [ ] Tests que fallan:
  - [ ] `WorkingItem.foodRef` (aditivo): `reemplazarAlimento` y `crearItemManual` lo reciben; `aplicarRespuesta` con `identity` y respuesta no-null lo limpia (`attribute` lo conserva); `armarSaveRequest(…, fecha)` lo propaga;
  - [ ] `ChangeFoodSheet.onConfirm` entrega `{ nombre, categoria, idAlimento }`;
  - [ ] con `hideNutrition` no se renderiza ningún "kcal" ni P/C/G en `AIRecognitionResult` ni en `ChangeFoodSheet` (D13: si se eligió b, se ocultan para todos y el test no depende del prop);
  - [ ] `AIRecognitionModal` manda `fecha` en el `SaveRequest` y llama `onSaved` (que en `AlimentacionClient` hace `router.refresh()`).
- [ ] Implementar. `AlimentacionClient` pasa `fecha` y `hideNutrition` al modal.
- [ ] `guardarCorrecciones` devuelve `SaveResponse`; si `diario.sinDatos > 0` y no es deportista, el mensaje de éxito lo menciona ("N alimentos sin datos nutricionales").
- [ ] Commit.

## Task 8: Foto en Storage

**Modelo:** Sonnet 5.5 Alto.

**Files:** `src/lib/fotosDeteccion.ts` (nuevo), `src/app/api/food-recognition/route.ts`, `testing/fotosDeteccion.test.ts` (nuevo), `testing/food-recognition-route.test.ts`

- [ ] Tests que fallan (`fotosDeteccion`): `subirFotoDeteccion` sube a `{uid}/{uuid}.jpg` con `contentType: 'image/jpeg'` y `upsert: false`, devuelve el path o `null` si falla (no lanza); `borrarFoto` no lanza; `urlsFirmadas(supabase, paths)` usa `createSignedUrls(paths, 300)` en una llamada.
- [ ] Tests que fallan (ruta): subida OK → `imagen_path` en el insert de `detecciones_ia`; subida falla → 200 y `imagen_path: null`; Gemini falla → `remove` del path con el admin; insert de `detecciones_ia` falla → `remove`. La foto y Gemini corren en paralelo (`Promise.allSettled` + `Promise.all`).
- [ ] Implementar. El buffer sale de `Buffer.from(imagen.base64, 'base64')` (no tocar `comprimirImagenParaGemini`). Quitar el comentario "no se guarda la foto".
- [ ] Commit.

## Task 9: Borrar las fotos al borrar la cuenta (3 sitios)

**Modelo:** Sonnet 5.5 Alto.

**Files:** `src/lib/fotosDeteccion.ts`, `src/app/perfil/actions.ts`, `src/app/api/delete-account/route.ts`, `src/app/api/admin/delete-account-by-email/route.ts`, `testing/fotosDeteccion.test.ts`

- [ ] Test que falla: `borrarFotosDeUsuario(admin, uid)` pagina `list(uid, { limit: 1000, offset })` hasta vaciar, hace `remove` de los paths `uid/…` y nunca lanza (loguea).
- [ ] Implementar y llamarlo **antes** de `deleteUser` en los 3 sitios (D4). Si D4 = conservar, en cambio documentar en el header de `fotosDeteccion.ts` y no llamarlo.
- [ ] Commit.

## Task 10: Cola — reuso de valores y dedup en `/save`

**Modelo:** Sonnet 5.5 Alto.

**Files:** `src/app/api/food-recognition/save/route.ts`, `testing/food-recognition-save-route.test.ts`

- [ ] Tests que fallan (solo deportista): los nombres sin match pasan por `admin.rpc('cola_lookup', { p_nombres })`; los que vuelven con `necesita_ia: false` (validado, descartado o pendiente con valores) **no** van a Gemini y viajan con `metodo_match: 'cola'`; un particular nunca llama a `cola_lookup`; si `cola_lookup` falla → se sigue con Gemini para todos (degrada, no rompe).
- [ ] Implementar. Commit.

## Task 11: Acciones del investigador (Modificar / Validar / Descartar)

**Modelo:** Opus 5.5 (transacción con recálculo de ítems, locks y auditoría).

**Files:** `supabase/013_matching_macros_validacion_nut119.sql`, `supabase/schema_consolidado.sql`, `src/app/(researcher)/validacion/actions.ts` (nuevo), `testing/validacionActions.test.ts` (nuevo)

- [ ] SQL: `pendiente_modificar`, `pendiente_validar`, `pendiente_descartar` (spec §8.2), definer, `search_path = ''`, chequeo `public.get_my_role()` adentro, `for update`, `ESTADO_INVALIDO`, `DUPLICADO_EN_CATALOGO` (con id en `detail`), auditoría con `antes`/`despues`/`items_afectados`. Validar inserta el `VALIDADO` con `nextval('public.alimentos_validados_seq')` (D2) o vincula, y re-apunta los `items` (`id_alimento`, snapshot, `origen_macros = 'validado'`). Descartar solo cambia `origen_macros = 'descartado'` (nunca `delete`). `grant execute` a authenticated.
- [ ] Tests que fallan (`actions.ts`): sin sesión / rol `deportista_ucc` / `particular` → `{ error }` y **no** llama a la RPC; rol `investigador` y `administrador` → llama a la RPC correcta con los args; validar con `idAlimentoExistente` lo pasa; `DUPLICADO_EN_CATALOGO` → `{ error, idAlimentoExistente }` para que la UI ofrezca vincular; `ESTADO_INVALIDO` → mensaje "ya fue resuelto por otro investigador"; `getPendienteDetalleAction` genera signed URLs en **una** llamada.
- [ ] Implementar `actions.ts` (`'use server'`, re-verificación de rol con el patrón de `deportistas/actions.ts`, `revalidatePath('/validacion')`).
- [ ] Probar el SQL en Supabase con el bloque "Validar/Descartar" del checklist de la Task 16 antes del commit. Commit.

## Task 12: Pantalla `/validacion`

**Modelo:** Sonnet 5.5 Alto.

**Files:** `src/app/(researcher)/validacion/page.tsx`, `src/app/(researcher)/validacion/ValidacionClient.tsx`, `src/app/(researcher)/validacion/PendienteDetalle.tsx` (nuevos), `src/components/researcher/Sidebar.tsx`, `testing/ValidacionClient.test.tsx`, `testing/PendienteDetalle.test.tsx` (nuevos)

- [ ] Tests que fallan (jsdom):
  - [ ] el listado muestra nombre, estado, ocurrencias y fecha;
  - [ ] el filtro de estado (pendiente por defecto), la búsqueda y el orden arman la querystring;
  - [ ] la paginación muestra "Página X de Y" y los links correctos;
  - [ ] el detalle muestra la foto con `alt`, el recuadro del bbox con estilos en %, nombre IA vs final, respuestas, gramos IA vs final, deportista y valores de Gemini;
  - [ ] editar kcal/100 g actualiza la vista previa de totales por ocurrencia;
  - [ ] "Validar" y "Descartar" piden confirmación con la cantidad de ítems afectados;
  - [ ] el aviso de plausibilidad aparece pero no bloquea;
  - [ ] "Buscar en catálogo" permite elegir un alimento y validar vinculado.
- [ ] Implementar (spec §9): server component con `range()` + `count: 'exact'` sobre `v_alimentos_pendientes`, 20 por página. Estilo de `deportistas/`. Mobile-first (tarjetas < `sm`, tabla ≥ `sm`).
- [ ] Sumar `{ href: '/validacion', label: 'Validación', icon }` a `NAV_ITEMS`.
- [ ] Commit.

## Task 13: Exportación — columna "Dato nutricional"

**Modelo:** Sonnet 5.5 Alto.

**Files:** `src/lib/datoNutricional.ts` (nuevo), `src/app/(researcher)/deportistas/actions.ts`, `testing/datoNutricional.test.ts` (nuevo)

- [ ] Test que falla: `etiquetaDatoNutricional(item)` → Catálogo / Código de barras / Manual / Estimado IA / Pendiente / Pendiente (sin datos) / Validado / Descartado / Sin datos, y `macrosExportables(item)` → números o `''` para descartado, sin datos, manual y pendiente sin snapshot (D8).
- [ ] `generateExcelAction`: sumar `origen_macros, kcal_100g, id_alimento_barcode` al select de `items`; columna 39 "Dato nutricional" dentro de REGISTRO ALIMENTARIO (31–39); Hidratación pasa a 40; `TOTAL_COLS = 40`. Reemplazar los literales 38/39 por constantes (`COL_DATO_NUTRICIONAL`, `COL_HIDRATACION`) en `SECTIONS`, `COL_HEADERS`, `COL_HEADER_COLORS`, `writeRow`, el merge de hidratación y `COL_WIDTHS`.
- [ ] Generar un Excel a mano con un deportista de prueba y revisar columnas/merges. Commit.

## Task 14: Tests — consolidación y huecos

**Modelo:** Sonnet 5.5 Alto.

**Files:** `testing/*`

- [ ] Recorrer la tabla de la spec §11 y cubrir lo que falte. Mínimo: rama deportista vs particular, dedup de cola, foto fallida que no rompe la detección, descartar sin borrar ítems (a nivel action: nunca se llama a un `delete`), pantalla.
- [ ] Buscar asserts que hayan quedado obsoletos ("sin datos nutricionales", `imagen_url: null`, "nunca toca el diario").
- [ ] `npx vitest run --coverage` sobre los archivos nuevos de `src/lib/` (objetivo ≥ 90 % de líneas). Commit.

## Task 15: Documentación

**Modelo:** Sonnet 5.5 Alto.

**Files:** `docs/contrato-deteccion.md`, `docs/superpowers/specs/2026-10-07-nut119-matching-macros-validacion-design.md` (completar §4.3 calibración y §4.4 EXPLAIN)

- [ ] `contrato-deteccion.md`: reescribir "Alcance y no-objetivos" (sí hay macros persistidos, nunca devueltos; `/save` escribe el diario; la foto se guarda en un bucket privado y se borra con la cuenta). Documentar `/save` (`fecha?`, `foodRef`, `SaveResponse`), el `field` de `INVALID`, `ALREADY_SAVED` 409, `NUTRITION_PROMPT_VERSION` y el flujo por rol (tabla de spec §2.2).
- [ ] Pegar en el spec la tabla de calibración y el resultado de EXPLAIN ANALYZE de la Task 16.
- [ ] Commit.

## Task 16: Verificación manual en Supabase + build final

**Modelo:** Sonnet 5.5 Alto (el usuario corre el SQL Editor; el agente prepara los scripts y los interpreta).

- [ ] **Pre-chequeo:** `select count(*) from public.alimentos where id_alimento >= 2000000;` → 0.
- [ ] Pegar `supabase/013_…sql` en el SQL Editor y correrlo **dos veces** (idempotencia: la segunda corrida sin errores).
- [ ] `select nombre, nombre_normalizado from public.alimentos order by random() limit 10;` → normalizado sin tildes ni puntuación.
- [ ] **EXPLAIN:** correr el bloque de la spec §4.4. Confirmar `Bitmap Index Scan on idx_alimentos_nombre_norm_trgm` y que no hay `Seq Scan on alimentos`. Anotar el tiempo.
- [ ] **Calibración (D3):** `select ingredient from public.detecciones_ia_items group by 1 order by count(*) desc limit 30;` → pasarlos a `match_alimentos(array[…], 0.3)` y revisar a ojo con qué umbral se cortan los falsos positivos. Ajustar `UMBRAL_MATCH` si hace falta.
- [ ] **RLS como deportista** (en el SQL Editor: `set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid deportista>"}';` dentro de `begin … rollback`):
  - [ ] `select * from alimentos_pendientes_validacion` y `select * from v_alimentos_pendientes` → 0 filas;
  - [ ] `select public.cola_lookup(array['x'])` y `select public.registrar_guardado_deteccion(...)` → permission denied;
  - [ ] `select public.pendiente_validar(...)` → `FORBIDDEN`;
  - [ ] `update items set origen_macros = 'validado' where …` (ítem propio) → error del guard trigger;
  - [ ] `insert into storage.objects`, vía app: subir a la carpeta de otro uid → rechazado.
- [ ] **RLS como investigador:** ve la cola, la vista y la auditoría; no puede `update` directo la cola (0 filas afectadas o permission denied); puede generar signed URL de la foto de un deportista.
- [ ] **End-to-end en la app** (deportista de prueba): foto → guardar con un alimento que matchea y uno inventado → el diario muestra ambos **sin** kcal; la cola tiene 1 fila; repetir el guardado → 409. Como particular: mismo flujo → sin fila de cola y el ítem inventado tiene kcal estimadas.
- [ ] **Validar/Descartar:** validar la fila con valores finales → los `items` vinculados cambian kcal según su `cantidad` y la ingesta recalcula `kcal_total`; auditoría con `antes/despues`. Descartar otra → los ítems siguen existiendo con kcal 0 y `origen_macros = 'descartado'`. Validar dos veces → `ESTADO_INVALIDO`. Intentar cambiar `gemini_kcal_100g` → error del trigger.
- [ ] **Borrado de cuenta** de un deportista de prueba → la carpeta `{uid}/` del bucket queda vacía y la fila de cola sigue (0 ocurrencias).
- [ ] `npx tsc --noEmit` y `npm run build` limpios. Commit final si hubo ajustes.
