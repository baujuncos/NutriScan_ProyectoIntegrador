# Registro de defectos

Cada defecto tiene: pasos para reproducir, resultado esperado, resultado obtenido, severidad, estado, vínculo al caso de prueba (ID en [casos-de-prueba.md](casos-de-prueba.md) y archivo de test) y, cuando se corrigió en este trabajo, los commits **rojo** (el test falla) y **verde** (el fix). Todo lo medido sale de ejecuciones reales; la evidencia en bruto está en [`docs/evidencia/`](evidencia/).

**Formato para Jira:** [defectos.csv](defectos.csv) se importa directo (*Configuración → Sistema → Importación CSV externa*); cada bloque de abajo se puede copiar como descripción de un issue de tipo *Bug*. Mapeo de severidad → prioridad de Jira: Crítica → Highest, Alta → High, Media → Medium, Baja → Low.

**Escala de severidad:** *Crítica* = filtración de datos personales o toma de control de cuentas/roles; *Alta* = pérdida/corrupción de datos o función principal rota; *Media* = función secundaria incorrecta o robustez; *Baja* = cosmético o inconsistencia sin impacto en datos.

## Resumen

| ID | Título | Sev. | Estado | Hallado por | Caso / test de regresión |
| --- | --- | --- | --- | --- | --- |
| DEF-001 | Test de componentes falla de forma intermitente por timeout bajo cobertura | Media | Corregido | Corrida de cobertura inicial | TC-QA-01 · `vitest.config.ts` (`testTimeout`) |
| DEF-002 | `/api/send-reminders` sin autenticación: dispara mails y devuelve los emails de todos los usuarios | **Crítica** | Corregido (rojo→verde) | Escribir tests de API (tabla de decisión) | TC-API-10…20 · `testing/sendRemindersRoute.test.ts` |
| DEF-003 | `delete-account-by-email` no encuentra usuarios más allá del puesto 50 | Media | Corregido (rojo→verde) | Valores límite de paginación | TC-API-30…33 · `testing/deleteAccountByEmailRoute.test.ts`, `testing/findUserByEmail.test.ts` |
| DEF-004 | Harris-Benedict: constantes de 1919 documentadas como "revisadas 1984" | Media | **Abierto — decisión del equipo** | Revisión del código contra la fuente | TC-CALC-05 (documenta el valor actual) |
| DEF-005 | `/api/validate-investigator` permite intentos ilimitados del código de invitación | Alta | Corregido (rojo→verde) | Análisis de riesgos + tests de API | TC-API-40…42 · `testing/validateInvestigatorRoute.test.ts` |
| DEF-006 | La cobertura reportada (86 %) ignoraba los archivos sin tests: real 70 % | Media (proceso) | Corregido | Medir con `include: src/**` | TC-QA-02 · `vitest.config.ts` |
| DEF-007 | Login: valida mínimo 6 caracteres pero el mensaje dice "Mínimo 8" | Baja | Corregido (rojo→verde) | Valores límite del campo contraseña | TC-UI-01…03 · `testing/LoginPage.test.tsx` |
| DEF-008 | `updateHidratacion` acepta cualquier delta (NaN, Infinity, 1e12) | Alta | Corregido (rojo→verde) | Particiones de equivalencia del delta | TC-ACT-20…30 · `testing/hidratacionAction.test.ts` |
| DEF-009 | La tabla `profiles` es legible **sin sesión** en la base real (nombres, emails, roles) | **Crítica** | **Abierto — requiere acción en Supabase** | **E2E contra Supabase real** | TC-E2E-04 · `testing/e2e/supabase.e2e.test.ts` |
| DEF-010 | Open Food Facts: una ficha con kcal pero sin macros se aceptaba (alimento inutilizable) | Media | Corregido (regresión agregada ahora) | Histórico (`0980b7f`) | TC-OFF-06 · `testing/openFoodFacts.test.ts` |
| DEF-011 | Buscador: el filtro "suplemento" descartaba todos los alimentos SARA2 | Alta | Corregido (histórico) | Histórico (`53aa8b9`) | `testing/searchQuery.test.ts` |
| DEF-012 | Buscador: el corte alfabético dejaba afuera a los SARA2 | Alta | Corregido (histórico) | Histórico (`4c509f8`) | `testing/alimentacionActions.test.ts` |
| DEF-013 | Escalada de rol: un usuario podía hacerse investigador/administrador | **Crítica** | Corregido (histórico) | Histórico (`a8ac1fa`) | `testing/registerRoute.test.ts`, `authCallback.test.ts`, `roles.test.ts` |
| DEF-014 | Open Food Facts: macros/porción que llegan como texto se perdían | Media | Corregido (histórico) | Histórico (`dea867f`) | `testing/openFoodFacts.test.ts` |
| DEF-015 | Open Food Facts: peso neto adivinado en multipacks ("4 x 25 g") | Media | Corregido (histórico) | Histórico (`d8ac81d`) | `testing/openFoodFacts.test.ts` |
| DEF-016 | Validación: las confirmaciones de advertencias sobrevivían a una edición | Media | Corregido (histórico) | Histórico (`28eb536`) | `testing/PendienteDetalle.test.tsx`, `ComposicionCatalogo.test.tsx` |
| DEF-017 | Estudio a ciegas: deportistas veían kcal/macros del buscador y del escáner | Alta | Corregido (histórico) | Histórico (`f5654cd`, `5ed6915`) | `testing/ocultarMacros.test.ts`, `AlimentacionSearch.test.tsx`, `BarcodeScannerModal.test.tsx` |
| DEF-018 | Escáner: la cantidad por paquete superaba el máximo que acepta el servidor | Media | Corregido (histórico) | Histórico (`134cd4e`) | `testing/BarcodeScannerModal.test.tsx` |

Los DEF-011…018 son defectos reales que el equipo ya había corregido antes del TP (commits en el historial de git); se registran con su regresión existente para que la trazabilidad quede completa. DEF-010 se registra aparte porque **su corrección no tenía test de regresión**: se agregó ahora.

---

## Contraste rojo / verde (DEF-002)

Es el defecto más grave de los hallados con tests. El procedimiento fue: primero el test, después el fix, con un commit para cada paso.

1. **Rojo** — commit `c220b12`. Se escribe el test con el comportamiento correcto y se corre contra el código sin tocar:

   ```
   npx vitest run testing/sendRemindersRoute.test.ts
   × sin header Authorization responde 401 y no consulta la base ni envía mails
   AssertionError: expected 200 to be 401
   × la respuesta no filtra emails ni objetos de error de los usuarios
   AssertionError: expected '{"sent":2,"results":[{"email":"ana@ex…' not to contain '@'
   Tests  10 failed | 1 passed (11)
   ```
   Evidencia completa: [`evidencia/def002-rojo.txt`](evidencia/def002-rojo.txt).

2. **Verde** — commit `da001fb`. Se agrega la validación de `CRON_SECRET` (comparación en tiempo constante, falla cerrado si la variable no existe), se reducen las respuestas a contadores y se saca el PII de los logs:

   ```
   npx vitest run testing/sendRemindersRoute.test.ts testing/secretEquals.test.ts
   Test Files  2 passed (2)
        Tests  23 passed (23)
   ```
   Evidencia completa: [`evidencia/def002-verde.txt`](evidencia/def002-verde.txt).

El mismo procedimiento se repitió para DEF-003, 005, 007 y 008 (archivos `defNNN-rojo.txt` / `defNNN-verde.txt`; tabla de commits al final).

---

## DEF-001 — Test de componentes falla de forma intermitente por timeout

- **Severidad:** Media · **Estado:** Corregido · **Componente:** infraestructura de tests
- **Pasos:** 1) `npx vitest run --coverage` en el repo sin cambios. 2) Observar `testing/PendienteDetalle.test.tsx` (61 tests, ~77 s).
- **Esperado:** los 1416 tests pasan siempre.
- **Obtenido:** `al editar un valor se pide confirmar de nuevo la advertencia` → `Error: Test timed out in 5000ms` (1 de 1416). Con `--testTimeout=60000` pasaban todos: era el timeout, no la lógica. El test arma un formulario largo con `user-event` (tecla por tecla) y la instrumentación de cobertura lo vuelve más lento que 5 s.
- **Causa raíz:** timeout por defecto de Vitest (5 s) inadecuado para tests de componentes bajo cobertura. Sin esto el pipeline se pondría rojo a veces sin que haya un bug (falso positivo).
- **Corrección:** `testTimeout: 30_000` en los dos proyectos de `vitest.config.ts` (commit `73a47cf`).
- **Verificación:** 1784 tests pasan en 3 corridas con cobertura consecutivas.

## DEF-002 — `/api/send-reminders` sin autenticación

- **Severidad:** Crítica · **Estado:** Corregido · **Componente:** API / privacidad
- **Pasos:** 1) `curl https://<app>/api/send-reminders` (GET o POST) sin ningún header. 
- **Esperado:** `401 No autorizado`. Solo el cron de Vercel (con `Authorization: Bearer $CRON_SECRET`) puede dispararlo.
- **Obtenido:** `200` con `{"sent": N, "results": [{"email": "...", "status": "sent"}, ...]}`: cualquiera podía (a) disparar el envío de mails a todos los usuarios que no cargaron sus comidas, tantas veces como quisiera, y (b) leer los emails de todos los usuarios; además los logs del servidor volcaban perfiles e ingestas completos.
- **Corrección:** autorización por `CRON_SECRET` con `secretEquals` (tiempo constante); respuesta solo `{sent, failed}`; sin PII en logs; nombre escapado en el HTML del mail; clientes creados después de autorizar.
- **Acción tuya:** cargar `CRON_SECRET` en Vercel (ver [SETUP_SECRETS.md](SETUP_SECRETS.md)); sin esa variable los recordatorios dejan de enviarse (falla cerrado a propósito).
- **Rojo / Verde:** `c220b12` / `da001fb`.

## DEF-003 — `delete-account-by-email` no encuentra usuarios más allá del puesto 50

- **Severidad:** Media · **Estado:** Corregido
- **Pasos:** 1) Con más de 50 usuarios registrados, llamar a `POST /api/admin/delete-account-by-email` con el email de uno que no esté entre los primeros 50 (header `x-admin-key` correcto).
- **Esperado:** `200` y la cuenta se elimina.
- **Obtenido:** `404 No existe ningún usuario con email ...`. `auth.admin.listUsers()` sin parámetros devuelve solo la primera página (50).
- **Corrección:** helper `findUserByEmail` que recorre páginas de 200; ahora lo usan también `register` y `provider-hint` (que ya tenían su propia copia). La clave admin se compara con `secretEquals`.
- **Rojo / Verde:** `6f6969e` / `2beea3a`. Valores límite probados: 199, 200 y 201 usuarios; posiciones 49 y 50.

## DEF-004 — Harris-Benedict: constantes originales documentadas como "revisadas"

- **Severidad:** Media · **Estado:** **Abierto — requiere decisión del equipo (no se tocó el cálculo)**
- **Pasos:** 1) Leer `src/lib/calculations.ts` y el README ("ecuación de Harris-Benedict revisada (Roza & Shizgal, 1984)"). 2) Comparar las constantes.
- **Esperado:** el código implementa lo que dice la documentación.
- **Obtenido:** las constantes son las de la **ecuación original de 1919** (hombres 66,47 + 13,75·P + 5,003·A − 6,755·E; mujeres 655,1 + 9,563·P + 1,85·A − 4,676·E). Las de Roza & Shizgal 1984 son otras (hombres 88,362 + 13,397·P + 4,799·A − 5,677·E; mujeres 447,593 + 9,247·P + 3,098·A − 4,330·E).
- **Impacto:** diferencia de decenas de kcal en la TMB; afecta los GET y macros que ve el usuario y los datos del estudio. Corregir cambiaría resultados ya guardados, por eso no se hizo sin consultar.
- **Opciones:** (a) corregir el texto a "Harris-Benedict original (1919)" — cambia solo documentación; (b) cambiar las constantes a las de 1984 y recalcular los perfiles existentes.
- **Test que documenta el valor actual:** `testing/calculations.test.ts`.

## DEF-005 — Intentos ilimitados del código de investigador

- **Severidad:** Alta · **Estado:** Corregido
- **Pasos:** 1) Enviar 11 `POST /api/validate-investigator` seguidos con códigos distintos desde la misma IP.
- **Esperado:** a partir del intento 11 en el mismo minuto, `429`.
- **Obtenido:** todos devuelven `401` (o `200` si el código era el correcto): se podía probar códigos sin tope hasta acertar y obtener acceso de investigador (datos de todos los deportistas).
- **Corrección:** límite de 10 intentos por minuto por IP (reutiliza `checkRateLimit`) y comparación del código en tiempo constante. **Limitación conocida:** el contador vive en memoria de cada instancia serverless, así que es un freno aproximado; para uno estricto hace falta un almacén compartido (documentado en [plan-de-pruebas.md](plan-de-pruebas.md), riesgo R-04).
- **Rojo / Verde:** `b8ce9ce` / `5e663f4`.

## DEF-006 — Cobertura inflada

- **Severidad:** Media (de proceso) · **Estado:** Corregido
- **Pasos:** 1) `npx vitest run --coverage` (configuración original). 2) Repetir con `--coverage.include='src/**/*.{ts,tsx}'`.
- **Esperado:** el porcentaje refleja todo el código.
- **Obtenido:** 86,11 % de sentencias vs **70,34 %** real: sin `coverage.include`, Vitest solo cuenta los archivos que algún test importa; las rutas de API (`send-reminders`, `delete-account`, `chat/meal`, `provider-hint`, …) y `proxy.ts` estaban en 0 % y no aparecían.
- **Corrección:** `coverage.include: ['src/**']` con exclusiones justificadas (tipos, `sw.ts`, `manifest.ts`, `loading.tsx`) y subir la cobertura real con tests (ver [metricas.md](metricas.md)).

## DEF-007 — Mensaje de contraseña inconsistente en el login

- **Severidad:** Baja · **Estado:** Corregido
- **Pasos:** 1) Abrir `/login`. 2) Escribir un email válido y dejar la contraseña vacía. 3) Enviar. 
- **Esperado:** un mensaje coherente con la regla que realmente se valida.
- **Obtenido:** "Mínimo 8 caracteres", pero el código validaba `min(6)`: una contraseña de 7 caracteres pasaba la validación con un mensaje que prometía otra regla.
- **Corrección:** el login solo exige que no esté vacía ("Ingresá tu contraseña"); la política de contraseñas es del registro y Supabase decide si las credenciales sirven.
- **Rojo / Verde:** `c04a23f` / `c98011e`.

## DEF-008 — `updateHidratacion` confía en el cliente

- **Severidad:** Alta · **Estado:** Corregido
- **Pasos:** 1) Invocar la Server Action con `delta = 1e12` (o `NaN`, `Infinity`, `250.5`).
- **Esperado:** rechazo; el total diario queda entre 0 y 10000 ml (los topes que ya impone la interfaz).
- **Obtenido:** el valor se guardaba tal cual en `hidratacion.ml_total` (dato de un estudio científico).
- **Corrección:** `Number.isInteger(delta)` y `|delta| ≤ 10000`; el total se acota a 10000.
- **Rojo / Verde:** `51d52b2` / `dbee6d3`.

## DEF-009 — `profiles` legible sin sesión en la base real

- **Severidad:** Crítica · **Estado:** **Abierto — requiere ejecutar una sentencia en Supabase (la tenés que aplicar vos)**
- **Pasos:** 1) `npm run test:e2e` con las variables de `.env.local` (o: `GET {SUPABASE_URL}/rest/v1/profiles?select=user_id,email&limit=5` con solo el header `apikey: <anon key>`).
- **Esperado:** `[]` (RLS: sin sesión no se ve ninguna fila).
- **Obtenido:** filas con `user_id` y `email` de usuarios reales (se contaron 5 de 5 pedidas; no se copiaron ni guardaron). La anon key es pública (viaja en el JS del navegador), así que cualquiera puede listar nombres, emails y roles.
- **Causa raíz:** la política `"public read for reminders"` (migración 004) sigue activa en la base real. `supabase/schema_consolidado.sql` ya la elimina (línea ~2246), pero esa sección no se aplicó en el proyecto de Supabase que usa `.env.local`. El cron de recordatorios no la necesita: usa el service role.
- **Corrección (la ejecutás en Supabase → SQL Editor):**

  ```sql
  drop policy if exists "public read for reminders" on public.profiles;
  ```
  Después, `npm run test:e2e` debe dar el test `RLS: sin sesión NO se pueden leer perfiles de usuarios` en verde. Conviene confirmar lo mismo en el proyecto de producción si es otro.
- **Por qué lo vio el E2E y no los otros tests:** los tests unitarios usan dobles de Supabase; solo una prueba contra la integración real puede notar que la base no coincide con el repositorio. Es el argumento central de la sección de E2E del informe.

## DEF-010 … DEF-018 — Defectos históricos

Corregidos por el equipo antes del TP; el commit está en el historial (`git show <hash>`).

| ID | Commit | Qué pasaba | Test de regresión |
| --- | --- | --- | --- |
| DEF-010 | `0980b7f` | Una ficha de Open Food Facts con kcal pero proteínas/grasas/carbohidratos en 0 o ausentes se aceptaba y el alimento no se podía usar. | `openFoodFacts.test.ts` › *regresión: ficha con kcal pero … → encontrado:false* (**agregado en este trabajo**: el fix original no traía test) |
| DEF-011 | `53aa8b9` | Excluir "suplemento" en la búsqueda también descartaba todos los SARA2 porque su `denominacion` es NULL. | `searchQuery.test.ts` |
| DEF-012 | `4c509f8` | Con ~38 mil productos ANMAT, el corte alfabético dejaba fuera a los ~900 SARA2. | `alimentacionActions.test.ts` › *ordena con SARA2 primero…* |
| DEF-013 | `a8ac1fa` | El rol de investigador se leía de `user_metadata`, que escribe el propio usuario: escalada de privilegios. Ahora se lee de `app_metadata` (solo service role). | `registerRoute.test.ts`, `authCallback.test.ts`, `roles.test.ts` |
| DEF-014 | `dea867f` | OFF manda números como texto ("450"); se tomaban como ausentes. | `openFoodFacts.test.ts` |
| DEF-015 | `d8ac81d` | Para "4 x 25 g" se tomaba un número cualquiera como peso neto. | `openFoodFacts.test.ts` › *multipack ambiguo* |
| DEF-016 | `28eb536` | Tras confirmar una advertencia y editar un valor, la confirmación seguía vigente. | `PendienteDetalle.test.tsx` › *las confirmaciones no sobreviven a una edición* |
| DEF-017 | `f5654cd`, `5ed6915` | Los deportistas (estudio a ciegas) recibían kcal/macros en el payload del buscador/escáner. | `ocultarMacros.test.ts`, `AlimentacionSearch.test.tsx`, `BarcodeScannerModal.test.tsx` |
| DEF-018 | `134cd4e` | El escáner permitía una cantidad mayor al máximo del servidor. | `BarcodeScannerModal.test.tsx` |

---

## Trazabilidad de commits (rojo → verde)

| Defecto | Commit rojo | Commit verde | Tests rojos antes → después |
| --- | --- | --- | --- |
| DEF-002 | `c220b12` | `da001fb` | 10 de 11 fallan → 23/23 pasan |
| DEF-003 | `6f6969e` | `2beea3a` | 2 de 14 fallan → 14/14 |
| DEF-005 | `b8ce9ce` | `5e663f4` | 2 de 16 fallan → 16/16 |
| DEF-007 | `c04a23f` | `c98011e` | 2 de 30 fallan → 30/30 |
| DEF-008 | `51d52b2` | `dbee6d3` | 8 de 15 fallan → 15/15 |

## Observaciones sin registrar como defecto (riesgos)

Detectadas al leer el código; quedan en la matriz de riesgos del [plan de pruebas](plan-de-pruebas.md):

- `obtenerProductoPorEAN` devuelve "no encontrado" tanto si el producto no existe como si Open Food Facts está caído (el usuario no sabe que fue una caída). Riesgo R-06.
- `getAthleteData` consulta `ingestas` sin paginar: Supabase corta en 1000 filas por consulta, así que con muchos deportistas el cumplimiento semanal podría subestimarse. Riesgo R-07 (a verificar con datos reales).
- `/api/auth/provider-hint` permite saber si un email está registrado solo con Google (enumeración de cuentas, compromiso de usabilidad). Riesgo R-08.
- El rate limit del chat es por instancia serverless (aproximado). Riesgo R-04.
- Dos SDK de Gemini conviven (`@google/generative-ai`, deprecado, y `@google/genai`). Deuda técnica R-09.
