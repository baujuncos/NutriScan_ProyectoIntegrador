# Contrato de detección por IA (épica NUT-119)

## Alcance y no-objetivos

- Una sola llamada a Gemini por foto para identificar y estimar gramos. No hay una segunda llamada de refinamiento cuando el usuario responde una pregunta aclaratoria — eso se aplica del lado del cliente y se manda todo junto al guardar (`SaveRequest`).
- **Datos nutricionales (NUT-119):** `/save` calcula kcal, proteínas, grasas y carbohidratos de cada alimento sobre el **gramaje final** (`FinalItem.grams`: el estimado por la IA o el corregido por el usuario) y los **persiste** (`detecciones_guardados_items`, `items`, cola de validación). **Ningún endpoint los devuelve**: la respuesta solo trae contadores. Los deportistas UCC (`shouldHideNutritionInfo`) tampoco ven kcal/macros en ninguna pantalla.
- **Diario real:** `/save` escribe en `ingestas`/`items` (antes era un TODO). Toda la escritura (log de la detección, diario y cola de validación) ocurre en **una sola transacción** (RPC `registrar_guardado_deteccion`, solo `service_role`). Una predicción se puede guardar **una sola vez**.
- **Foto del plato (NUT-119):** SÍ se guarda, en el bucket **privado** `detecciones-fotos` de Supabase Storage, con la misma imagen procesada que se manda a Gemini (coherente con los bounding boxes). El path va en `detecciones_ia.imagen_path` (`imagen_url` queda sin usar). Solo se accede con signed URLs de 5 minutos generadas en el servidor. Si la subida falla, la detección continúa (queda sin foto). **Se borra junto con la cuenta.**

## Endpoints

### `POST /api/food-recognition`

Requiere sesión (cookie de Supabase). `multipart/form-data`:

| Campo | Tipo | Descripción |
|---|---|---|
| `image` | File | Foto ya recortada por el cliente (NUT-165) |
| `vajilla` | JSON string | `{ tipo: 'plato_playo'\|'plato_postre'\|'plato_hondo', diametroCm: number }` |
| `angulo` | JSON string | `{ beta: number\|null, estado: EstadoAngulo, dentroDeRango: boolean }` |

Respuesta 200 — `{ ok: true, ...DetectionResponse }` (ver `src/lib/deteccion.ts`). Persiste la predicción original en `detecciones_ia`/`detecciones_ia_items` y devuelve `predictionId`. La foto se sube a Storage en paralelo con la llamada a Gemini; si Gemini o el insert fallan después de subirla, se borra.

### `POST /api/food-recognition/save`

Requiere sesión. JSON body: `SaveRequest` (ver `src/lib/deteccion.ts`):

| Campo | Notas |
|---|---|
| `predictionId`, `mealType`, `items`, `removedItemIds` | Como antes. `mealType` se acepta sin importar mayúsculas/tildes (`Desayuno`, `Colación`) y debe ser un tipo de ingesta (`desayuno`, `almuerzo`, `merienda`, `cena`, `colacion`, `suplemento`). |
| `fecha?` | **Aditivo.** `YYYY-MM-DD` de la comida en el diario. Default: hoy (Argentina). Solo hoy y hasta 7 días atrás. |
| `items[].foodRef?` | `id_alimento` (como string numérico) elegido en el buscador. Si viene, se usa directo y **no se hace matching**. |
| `items[].grams` | Gramaje **final**, máximo 2000. Es el que se usa para calcular los macros. |

Respuesta 200 — `SaveResponse`: `{ ok: true, savedId, diario: { itemsRegistrados, sinDatos } }`. Nunca lleva kcal/macros.

Qué hace, por cada alimento:

1. `foodRef` → ese `id_alimento`.
2. Si no, **matching** contra `public.alimentos` en Postgres (RPC `match_alimentos`, `pg_trgm` + `unaccent`, una sola llamada para todos los nombres): exacto normalizado → similitud trigram ≥ `UMBRAL_MATCH` (0.5). A igual similitud se prefiere `fuente = 'SARA2'`, salvo que el nombre traiga la marca explícita del candidato (ANMAT).
3. Si no hay match, **fallback de Gemini** (una sola llamada batch, valores **por 100 g**, validados con zod y chequeo de plausibilidad 4/4/9; `NUTRITION_PROMPT_VERSION`). Si Gemini falla el guardado **no** falla: el ítem queda `sin_datos` (macros 0 marcados, nunca un cero silencioso).
4. Valor del ítem = valor por 100 g × gramos finales / 100. Se persisten el snapshot por 100 g y los totales calculados.

Según el rol (leído en el servidor desde `profiles`, nunca del cliente):

| Situación | `deportista_ucc` | `particular` (y cualquier otro rol) |
|---|---|---|
| `foodRef` o match del catálogo | `catalogo` | `catalogo` |
| Sin match, Gemini OK | `pendiente` + fila en la **cola de validación**; el diario lleva los valores de Gemini | `estimado_ia` (nunca pasa a validación) |
| Sin match, Gemini falla | `pendiente` sin datos + fila en la cola | `sin_datos` |
| Nombre ya en la cola (pendiente con valores, validado o descartado) | Se reutiliza, **no** se llama a Gemini | — |

Cada `item` del diario queda vinculado al `detecciones_guardados_items` que lo originó (`items.id_guardado_item`), y `items.origen_macros` indica el origen del dato: `catalogo`, `estimado_ia`, `pendiente`, `validado`, `descartado` o `sin_datos`.

## Panel de investigadores — `/validacion`

Cola de alimentos de deportistas que no estaban en el catálogo. El investigador (o administrador) puede **modificar** (borrador), **validar** (recalcula los `items` vinculados con sus gramos y, opcionalmente, agrega el alimento al catálogo con `fuente = 'VALIDADO'`, ids desde 2 000 000, o lo vincula a uno existente) o **descartar** (los ítems **no se borran**: se conservan con nombre y gramos, con macros 0 y `origen_macros = 'descartado'`). Todo se ejecuta en RPCs transaccionales (`pendiente_modificar`, `pendiente_validar`, `pendiente_descartar`) con verificación de rol adentro y auditoría append-only (`alimentos_pendientes_auditoria`).

La exportación a Excel suma la columna **"Dato nutricional"** (Catálogo / Código de barras / Manual / Estimado IA / Pendiente / Pendiente (sin datos) / Validado / Descartado / Sin datos); las celdas de macros de los ítems descartados, sin datos o manuales quedan **vacías** (no 0).

## Códigos de error

Todos los endpoints devuelven `{ error: string, message: string, field?: string }` con el status HTTP correspondiente.

| Código | Status | Cuándo |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Sin sesión |
| `INVALID` | 400 | Body/campo inválido. En `/save` trae `field`: `mealType`, `fecha` (fuera de la ventana de 7 días), `items.N.grams` (> 2000 o ≤ 0), `items.N.foodRef` (no numérico o inexistente), etc. |
| `IMAGE_REQUIRED` / `IMAGE_TOO_LARGE` / `IMAGE_INVALID_TYPE` | 400 | Problema con la foto |
| `NOT_FOUND` | 404 | `predictionId` inexistente (sólo `/save`) |
| `FORBIDDEN` | 403 | `predictionId` de otro usuario (sólo `/save`) |
| `ALREADY_SAVED` | 409 | La predicción ya tiene un guardado (sólo `/save`) |
| `SERVER_CONFIG` | 500 | Falta `GEMINI_API_KEY` |
| `GEMINI_TIMEOUT` / `GEMINI_RATE_LIMIT` / `GEMINI_UNAVAILABLE` / `GEMINI_INVALID_RESPONSE` / `GEMINI_ERROR` | 502 | Fallos de la llamada a Gemini **de reconocimiento** (ver `src/lib/geminiClient.ts`). Los fallos de Gemini en la estimación de macros **no** son un error del guardado. |
| `PERSISTENCE_ERROR` | 502 | Falló el insert en Supabase, el matching o la RPC de commit |

## Tipos

`src/lib/deteccion.ts` es la única fuente de verdad de los tipos del contrato (`DetectedItem`, `DetectionResponse`, `ClarifyingQuestion`, `SaveRequest`, `SaveResponse`, `FinalItem`, etc.) — no se duplican acá para evitar que se desincronicen.

## Versiones de prompt

- `PROMPT_VERSION`: persistido en `detecciones_ia.prompt_version`. Bumpear manualmente cuando cambie la semántica del prompt de reconocimiento (qué se pregunta, cómo se pondera) — no por ajustes de redacción.
- `NUTRITION_PROMPT_VERSION` (`nut119-macros-v1`): versión del prompt de estimación de macros por 100 g; se persiste junto al modelo que generó cada estimación (`detecciones_guardados_items`, cola de validación).

## Notas operativas

- Migración: `supabase/013_matching_macros_validacion_nut119.sql` (misma sección al final de `schema_consolidado.sql`). Es idempotente. La primera corrida reescribe `alimentos` (columna generada `nombre_normalizado`).
- Borrar la cuenta borra las fotos del usuario en Storage antes de eliminar al usuario (`borrarFotosDeUsuario`). Los alimentos `VALIDADO` y las filas de la cola no contienen datos personales y se conservan.
