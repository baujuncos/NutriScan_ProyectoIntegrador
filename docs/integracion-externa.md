# Integraciones externas: contrato, pruebas y despliegue

NutriScan se integra con **tres sistemas externos**. Este documento define el contrato con cada uno, cómo se prueba (con dobles para el CI rápido y contra el servicio real en cada despliegue) y qué pasa cuando fallan. El plan de contingencia está en [plan-de-pruebas.md §9](plan-de-pruebas.md).

| Sistema | Para qué | Dónde está en el código | Criticidad |
| --- | --- | --- | --- |
| **Supabase** (Auth, PostgreSQL con RLS, Storage) | Cuentas, sesión, todos los datos, fotos | `src/lib/supabase/*`, `proxy.ts`, `supabase/schema_consolidado.sql` | Crítica (toda la app) |
| **Google Gemini API** | Chat de registro de comidas, reconocimiento por foto, estimación de macros | `src/lib/ai/gemini.ts`, `src/lib/geminiClient.ts`, `src/app/api/chat/*`, `src/app/api/food-recognition/*` | Crítica para la función diferencial |
| **Open Food Facts** (API pública) | Datos de productos por código de barras | `src/lib/openFoodFacts.ts` | Baja (hay carga manual) |

## 1. Variables de entorno (solo nombres)

| Variable | Dónde se usa | Sistema |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Servidor y navegador (clave pública, respeta RLS) | Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | **Solo servidor**, rutas administrativas y RPC privilegiadas (bypass de RLS) | Supabase |
| `GEMINI_API_KEY` | **Solo servidor** | Gemini |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` | Modelo principal y de respaldo (se cambian sin tocar código) | Gemini |
| `INVITATION_CODE_INVESTIGADOR`, `CRON_SECRET`, `GMAIL_USER`, `GMAIL_PASS` | Propias de la app | — |

Cómo cargarlas: [SETUP_SECRETS.md](SETUP_SECRETS.md). Nunca llevan prefijo `NEXT_PUBLIC_` salvo la URL y la anon key.

## 2. Contrato con Supabase

**Autenticación.** Dos formas, ambas validadas en el servidor con `supabase.auth.getUser()`:

- Cookie de sesión (app web): `createClient()` de `src/lib/supabase/server.ts`.
- `Authorization: Bearer <access_token>` (scripts, Postman, E2E): `authenticate()` de `src/lib/chat/authenticate.ts` crea un cliente con la **anon key + el token del usuario**, de modo que las consultas respetan RLS. Nunca usa la service role.

**Obtener un token (E2E y Postman):**

```
POST {SUPABASE_URL}/auth/v1/token?grant_type=password
apikey: {SUPABASE_ANON_KEY}
{"email": "...", "password": "..."}   →   200 {"access_token": "<JWT>", "user": {"id": "..."}}
```

**RLS (contrato de seguridad).** Cada usuario solo lee y escribe lo suyo; los investigadores leen datos de deportistas; `anon` (sin sesión) no debe leer ni escribir tablas de usuarios. Excepción deliberada: `alimentos` (catálogo) es legible. Este contrato se **verifica contra la base real** en `testing/e2e/supabase.e2e.test.ts`; así se detectó DEF-009.

**RPC transaccionales usadas:**

| Función | Quién la llama | Contrato |
| --- | --- | --- |
| `confirmar_chat_ia_registro(p_payload jsonb)` | `/api/chat/meal/confirm` con el token del usuario | Guarda diario + hidratación + auditoría en una transacción; idempotente por `requestId` (`yaGuardado: true`) |
| `registrar_guardado_deteccion(...)` | `/api/food-recognition/save` (service role) | Una predicción se guarda una sola vez |
| `match_alimentos(p_nombres text[])` | `matchingAlimentos.ts` | Match exacto por nombre normalizado contra SARA2 y VALIDADO |

**Storage.** Bucket privado `detecciones-fotos`; solo se accede con *signed URLs* de 5–10 minutos generadas en el servidor; se borra junto con la cuenta.

**Errores y tratamiento:** un error de Supabase nunca se devuelve crudo al cliente (los endpoints responden `PERSISTENCE_ERROR` o mensajes genéricos); el detalle va al log del servidor.

## 3. Contrato con Gemini

### 3.1 Chat de comidas — `POST /api/chat/meal`

Especificación completa en [chat-meal-api.md](chat-meal-api.md). Resumen:

| Entrada | Salida 200 | Errores |
| --- | --- | --- |
| `{"messages":[{"role":"user","content":"..."}]}` · 1–20 mensajes · usuario ≤ 500 caracteres · el último es del usuario | `{status, assistantMessage, detectedIngredients[], totalEstimatedWeightGrams, totalMacros}` con `status` ∈ `complete` · `needs_clarification` · `off_topic` · `invalid_input` | `400 BAD_REQUEST` (sin gastar tokens) · `401` · `429 RATE_LIMITED` (10/min por usuario o cuota de Gemini) · `502 AI_INVALID_RESPONSE` · `503 AI_UNAVAILABLE` |

**Política de llamada** (`callLlmJson`): JSON estructurado con esquema, validación Zod, **timeout 15 s por intento**, **1 reintento** con backoff (1 s; el doble si fue 429) para 429 / 5xx / red / timeout / JSON vacío o inválido; sin reintento para 400/401/403/404 (configuración) ni para respuestas bloqueadas por seguridad.

### 3.2 Reconocimiento por foto — `POST /api/food-recognition`

Especificación en [contrato-deteccion.md](contrato-deteccion.md). Política (`llamarGeminiJson`): presupuesto total de **25 s**, **15 s por intento**, un único **modelo de respaldo** ante 503/timeout con backoff de 1 s, **429 sin reintento**, un reintento si el JSON no valida.

### 3.3 Qué se le exige al servicio real

El E2E (`testing/e2e/gemini.e2e.test.ts`) verifica en cada despliegue que: la clave es válida, el modelo configurado existe, devuelve JSON que cumple un esquema, en menos de 15 s y con uso de tokens informado.

## 4. Contrato con Open Food Facts

```
GET https://world.openfoodfacts.org/api/v2/product/{ean}.json     (timeout 8 s)
200 {"status": 1, "product": {product_name, categories, brands, serving_quantity, nutriments{energy-kcal_100g, proteins_100g, fat_100g, carbohydrates_100g}, ...}}
200 {"status": 0}                                                   → producto inexistente
```

Reglas de normalización de la app (cada una nació de un defecto real: DEF-010, 014, 015): los números pueden llegar como texto; si no hay ningún macro (proteínas, grasas y carbohidratos nulos o 0) el producto se descarta; el peso neto se calcula solo si el texto tiene un único número (los multipacks dan `null`); cualquier error de red devuelve "no encontrado" (limitación conocida R-06).

## 5. Cómo se prueba

| Capa | Qué hace | Archivos | Cuándo corre |
| --- | --- | --- | --- |
| **Dobles de prueba (mocks)** | Gemini, Supabase y `fetch` se reemplazan por funciones falsas que devuelven respuestas controladas, incluidos los errores (429, 503, timeout, JSON inválido, RLS que rechaza). Rápido (segundos) y sin red ni credenciales. | `testing/geminiClient.test.ts`, `chatMeal*.test.ts`, `chatMealRoute.test.ts`, `food-recognition-*-route.test.ts`, `openFoodFacts.test.ts`, `authenticate.test.ts`, `supabaseMock.ts` | En **cada push** (CI) |
| **Contrato con esquemas** | Los esquemas Zod de entrada/salida son la fuente de verdad; tests de borde de cada campo | `mealSchemas`, `confirmSchemas` y sus tests | CI |
| **Smoke** | 6 chequeos a la app desplegada + 2 a Supabase (`/auth/v1/health`, catálogo con datos) | `scripts/smoke.mjs` | **Después de cada despliegue** |
| **E2E real** | Contra los servicios reales (ver abajo) | `testing/e2e/*.e2e.test.ts` | **Después de cada despliegue** |

### Pruebas E2E reales (`npm run test:e2e`)

| ID | Prueba | Servicios involucrados | Requiere |
| --- | --- | --- | --- |
| TC-E2E-01 | Gemini responde JSON válido, con modelo y latencia aceptables | Gemini | `GEMINI_API_KEY` |
| TC-E2E-02 | Auth responde; el catálogo tiene ≥ 900 alimentos | Supabase | URL + anon key |
| TC-E2E-03 | Sin sesión **no** se pueden leer ingestas ni escribir | Supabase (RLS) | URL + anon key |
| TC-E2E-04 | Sin sesión **no** se pueden leer perfiles | Supabase (RLS) | URL + anon key |
| TC-E2E-05 | Con sesión solo se ve el propio perfil; el usuario de prueba no es investigador | Supabase | usuario de prueba |
| TC-E2E-06 | Open Food Facts devuelve un producto conocido y un EAN inexistente | Open Food Facts | — |
| TC-E2E-07 | **Flujo completo**: login → `/api/chat/meal` ("una manzana de 150 g") → `/api/chat/meal/confirm` (idempotente) → lectura del diario → limpieza | Supabase Auth + Next.js desplegado + Gemini + SARA2 + RPC transaccional | usuario de prueba + app desplegada |

Las pruebas que dependen de credenciales que no están cargadas **se saltean** (aparecen como *skipped*) en lugar de fallar.

### Resultado de la última ejecución real (23/10/2026, contra `.env.local` y la app local)

Evidencia: [evidencia/e2e-local.txt](evidencia/e2e-local.txt) y [evidencia/smoke-local.md](evidencia/smoke-local.md).

- Smoke: **8/8** (incluye Supabase real).
- E2E: **7 pasaron, 1 falló, 7 se saltearon** (faltan `E2E_USER_*`). La falla es **DEF-009** (`profiles` legible sin sesión): el E2E hizo su trabajo.

## 6. Cómo corre en cada despliegue

```
Vercel termina un despliegue  ──►  evento deployment_status (GitHub)
                                         │
                       .github/workflows/deploy-verify.yml
        ┌────────────────────────────────┼────────────────────────────────┐
     smoke  ─── (si pasa) ──►   e2e (secrets: Supabase, usuario de prueba, Gemini)
                │
                └──────────────►  carga: k6 stress + soak  ──►  informe en el resumen del job
```

Los resultados quedan como artefactos del job (`smoke`, `e2e`, `carga`) y en el resumen de la ejecución. Si el smoke falla, el E2E y la carga no corren: no tiene sentido medir un despliegue roto.

## 7. Qué pasa cuando una integración falla

Ver la tabla completa en [plan-de-pruebas.md §9](plan-de-pruebas.md). Resumen: **Gemini** → reintento, modelo de respaldo, mensaje claro, carga manual disponible; **Supabase** → smoke en rojo, la app no avanza sin sesión; **Open Food Facts** → "no encontrado" y carga manual.
