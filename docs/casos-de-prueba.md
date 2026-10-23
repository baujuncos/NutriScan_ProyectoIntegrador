# Casos de prueba documentados

Todos los casos están **automatizados** y siguen **Arrange – Act – Assert** (preparar, ejecutar, verificar). El resultado esperado se escribió antes de ejecutar; cuando el caso falló contra el código, el fallo se registró como defecto ([defectos.md](defectos.md)). Plantilla de caso: [plan-de-pruebas.md §7](plan-de-pruebas.md).

Cómo ejecutar: `npm test` (todo, rápido y sin red) · `npm run test:coverage` (con cobertura) · `npm run test:e2e` (contra servicios reales).

## 1. Índice de casos y dónde están

| Grupo | Qué cubre | Técnica principal | Archivos de test |
| --- | --- | --- | --- |
| TC-CALC | Cálculos nutricionales | Valor límite, valor de referencia a mano | `calculations.test.ts`, `valoresLimiteDominio.test.ts` |
| TC-DATE | Fecha de nacimiento y edad | Valor límite, clases de equivalencia | `dates.test.ts`, `valoresLimiteDominio.test.ts` |
| TC-PWD | Reglas de contraseña | Clases de equivalencia (tabla de decisión) | `password.test.ts` |
| TC-ACT | Server Actions del diario e hidratación | Clases de equivalencia + valor límite | `alimentacionItemActions.test.ts`, `hidratacionAction.test.ts`, `deleteAccountAction.test.ts` |
| TC-API | Rutas `/api/*`, `proxy`, `authenticate` | **Tablas de decisión** | `sendRemindersRoute`, `deleteAccountRoute`, `deleteAccountByEmailRoute`, `findUserByEmail`, `validateInvestigatorRoute`, `chatMealRoute`, `authenticate`, `proxy`, `providerHintRoute`, `rateLimit`, `secretEquals` |
| TC-UI | Pantallas y formularios | Clases de equivalencia + valor límite | `LoginPage.test.tsx`, `HidratacionCard.test.tsx`, `PWAInstallPrompt.test.tsx` |
| TC-OFF | Cliente de Open Food Facts | Clases de equivalencia | `openFoodFacts.test.ts` |
| TC-LIB | Capa de datos del investigador y utilidades | Particiones | `athletes.test.ts`, `athleteDetailAction.test.ts`, `sara2Catalog.test.ts`, `supabaseClients.test.ts`, `recortarImagen.test.tsx` |
| TC-QA | La propia infraestructura de calidad | Valor límite (umbrales del gate) | `qaScripts.test.ts`, `vitest.config.ts` |
| TC-E2E | Integraciones reales | Escenario | `testing/e2e/*.e2e.test.ts` |
| TC-SMK | Smoke post-despliegue | Escenario | `scripts/smoke.mjs` |
| TC-LOAD | Stress y esfuerzo sostenido | Umbrales | `load/stress.js`, `load/soak.js` |

Además hay unos 100 archivos de test previos al TP (componentes, validación de alimentos, reconocimiento por foto, etc.) que se mantienen y se ejecutan en el mismo comando.

## 2. Clases de equivalencia

### 2.1 Contraseña de registro (TC-PWD) — regla: ≥ 8 caracteres, 1 mayúscula, 1 minúscula, 1 dígito

| Clase | Ejemplo | Largo | May. | Min. | Díg. | Esperado |
| --- | --- | --- | --- | --- | --- | --- |
| V1 válida | `Abcdef12` | 8 | ✔ | ✔ | ✔ | acepta |
| I1 corta | `Abcde12` | 7 | ✔ | ✔ | ✔ | "Mínimo 8 caracteres" |
| I2 sin mayúscula | `abcdefg1` | 8 | ✘ | ✔ | ✔ | "Debe incluir al menos una mayúscula" |
| I3 sin minúscula | `ABCDEFG1` | 8 | ✔ | ✘ | ✔ | "…una minúscula" |
| I4 sin dígito | `Abcdefgh` | 8 | ✔ | ✔ | ✘ | "…un número" |
| I5 vacía | `` | 0 | ✘ | ✘ | ✘ | falla las 4 |

Valores límite del largo: **7** (rechaza) y **8** (acepta). Tests: `password.test.ts`, y desde la pantalla `LoginPage.test.tsx` (registro).

### 2.2 Campo "ml exactos" de la hidratación (TC-UI-2x)

| Clase | Valores | Esperado |
| --- | --- | --- |
| No positivo | `0`, `-5` | "Ingresá un número mayor a 0" |
| Válido | `1` … `5000` | se envía al servidor |
| Excede el máximo | `5001` | "Máximo 5000 ml" |
| Vacío | — | botón "Agregar" deshabilitado |

**Valores límite:** 0, 1, 5000, 5001. Test: `HidratacionCard.test.tsx`. El servidor repite la validación (DEF-008): `hidratacionAction.test.ts` con particiones `NaN` / `±Infinity` / no entero / `|delta| > 10000`, y límites 10000 y 10001.

### 2.3 Cantidad al agregar un alimento (TC-ACT)

Válida: `0 < c ≤ 2000` · Inválidas: `0`, negativa, no numérica, `> 2000`. **Límites probados:** 0, 0,01, 2000, 2000,01. Fecha: válida de "hace 7 días" a "hoy"; inválidas: formato incorrecto, futura, hace 8 días (**límites:** hoy, hoy−7, hoy−8). Test: `alimentacionItemActions.test.ts`.

## 3. Valores límite

### 3.1 Fecha de nacimiento (TC-DATE) — edad válida 10 ≤ edad ≤ 100, no futura

| Fecha (relativa a hoy) | Edad | Esperado | Test |
| --- | --- | --- | --- |
| mañana | — | "La fecha no puede ser futura." | `valoresLimiteDominio.test.ts` |
| hace 10 años − 1 día | 9 | "Debés tener al menos 10 años." | idem |
| hace 10 años exactos | 10 | acepta | idem |
| hace 100 años exactos | 100 | acepta | idem |
| hace 100 años y 364 días | 100 | acepta | idem |
| hace 101 años exactos | 101 | "La edad máxima es 100 años." | idem |
| `1990-02-30`, `15/03/1990`, `1990-13-01`, vacío | — | "Fecha inválida…" | idem + `dates.test.ts` |

Este análisis de límites reveló **DEF-019**: el selector de fecha bloqueaba (por su atributo `min`) fechas que el validador aceptaba. Se corrigió con rojo → verde.

### 3.2 Paginación de usuarios (TC-API-3x) — páginas de 200

| Usuarios | Consultas esperadas para no encontrar a nadie |
| --- | --- |
| 199 | 1 (página incompleta ⇒ no hay más) |
| 200 | 2 (página justa: hay que pedir la siguiente para confirmar que está vacía) |
| 201 | 2 |

Y posiciones 49/50 con la paginación por defecto de 50 (DEF-003). Tests: `findUserByEmail.test.ts`, `deleteAccountByEmailRoute.test.ts`.

### 3.3 Límite de intentos (TC-API-4x, TC-API-75)

Máximo 10 por minuto: intento 9 y 10 pasan, el **11** devuelve 429; a 59 999 ms de la primera request sigue bloqueado y a 60 000 ms se libera. Tests: `rateLimit.test.ts`, `validateInvestigatorRoute.test.ts`, `chatMealRoute.test.ts`.

### 3.4 Umbrales del quality gate (TC-QA)

Cobertura de código nuevo: 79,99 % rechaza, 80 % acepta; duplicación: 5 % acepta, 5,01 % rechaza. Test: `qaScripts.test.ts`.

## 4. Tablas de decisión

### 4.1 Autorización de `/api/send-reminders` (TC-API-10…19, DEF-002)

| Regla | `CRON_SECRET` configurada | Header `Authorization` | Resultado |
| --- | --- | --- | --- |
| R1 | sí | `Bearer <correcto>` | 200 y procesa |
| R2 | sí | `Bearer <otro>` (incluido el correcto + 1 carácter) | 401 |
| R3 | sí | ausente | 401 |
| R4 | no | cualquiera (incluido `Bearer ` vacío) | 401 (falla cerrado) |

Cada regla es un test. Archivo: `sendRemindersRoute.test.ts`.

### 4.2 Errores de `/api/chat/meal` (TC-API-50…59)

| Condición | HTTP | code |
| --- | --- | --- |
| sin sesión | 401 | UNAUTHORIZED |
| > 10 requests/min del usuario | 429 | RATE_LIMITED |
| cuerpo no JSON | 400 | BAD_REQUEST |
| esquema inválido (6 variantes) | 400 | BAD_REQUEST (no llama a Gemini) |
| Gemini: RATE_LIMITED | 429 | RATE_LIMITED |
| Gemini: AI_UNAVAILABLE | 503 | AI_UNAVAILABLE |
| Gemini: AI_INVALID_RESPONSE | 502 | AI_INVALID_RESPONSE |
| Gemini: AI_BLOCKED | 502 | AI_INVALID_RESPONSE |
| error inesperado | 503 | AI_UNAVAILABLE (sin detalle crudo) |

Archivo: `chatMealRoute.test.ts`.

### 4.3 Redirecciones del `proxy` (TC-API-65…69)

| Sesión | Ruta | Perfil | Resultado |
| --- | --- | --- | --- |
| no | pública / `/api/*` | — | pasa |
| no | protegida | — | `/login` |
| sí | `/login` | sin perfil | pasa |
| sí | `/login` | investigador | `/dashboard` |
| sí | `/login` | particular completo | `/home` |
| sí | `/login` | sin perfil físico | `/perfil-fisico` |
| sí | `/login` | deportista sin académico / sin encuesta | `/perfil-academico` / `/encuesta-psicologica` |
| sí | `/home` | onboarding incompleto | paso pendiente |
| sí | `/perfil-fisico` | onboarding completo | `/home` o `/dashboard` |

Archivo: `proxy.test.ts` (38 casos).

### 4.4 Pista de proveedor de login (TC-API-70…74)

| Usuario | Proveedores | Pista |
| --- | --- | --- |
| no existe | — | unknown |
| existe | ninguno | unknown |
| existe | email | unknown |
| existe | email + google | unknown |
| existe | google (de 4 campos distintos de Supabase) | google_only |
| existe | otro OAuth | google_only |

Archivo: `providerHintRoute.test.ts`.

### 4.5 Quality gate (TC-QA-03)

| Errores ESLint | Duplicación | Cobertura global | Cobertura nueva | Gate |
| --- | --- | --- | --- | --- |
| 0 | ≤ 5 % | ≥ 80 % | ≥ 80 % | ✅ |
| ≥ 1 | — | — | — | ❌ |
| — | > 5 % | — | — | ❌ |
| — | — | < 80 % | — | ❌ |
| — | — | — | < 80 % | ❌ |

Archivo: `qaScripts.test.ts`.

## 5. Cobertura de sentencia y de decisión

Medidas con Vitest (V8) sobre **todo `src/`** — generado por `node scripts/qa/modulos.mjs` a partir de `coverage/coverage-summary.json` (corrida del 23/10/2026; el pipeline la regenera en cada ejecución):

| Módulo | Qué es | Sentencias | Decisiones (ramas) |
| --- | --- | --- | --- |
| `src/lib/calculations.ts` | Cálculos TMB / GET / macros | 100 % (20/20) | 100 % (4/4) |
| `src/lib/dates.ts` | Fechas de nacimiento y edad | 95.23 % (40/42) | 93.75 % (30/32) |
| `src/lib/password.ts` | Reglas de contraseña | 100 % (7/7) | 100 % (4/4) |
| `src/lib/macros.ts` | Macros por 100 g y mezcla | 100 % (29/29) | 100 % (23/23) |
| `src/lib/chat/rateLimit.ts` | Límite de requests | 100 % (16/16) | 100 % (9/9) |
| `src/lib/secretEquals.ts` | Comparación de secretos | 100 % (5/5) | 100 % (4/4) |
| `src/lib/supabase/findUserByEmail.ts` | Búsqueda paginada de usuario | 100 % (15/15) | 100 % (8/8) |
| `src/app/api/send-reminders/route.ts` | API recordatorios (DEF-002) | 100 % (47/47) | 91.66 % (22/24) |
| `src/app/api/admin/delete-account-by-email/route.ts` | API borrado por email (DEF-003) | 100 % (31/31) | 86.36 % (19/22) |
| `src/app/api/validate-investigator/route.ts` | API código de investigador (DEF-005) | 100 % (20/20) | 91.66 % (11/12) |
| `src/app/api/chat/meal/route.ts` | API chat con IA | 100 % (25/25) | 93.33 % (14/15) |
| `src/app/api/delete-account/route.ts` | API borrado de cuenta | 100 % (29/29) | 100 % (26/26) |
| `src/app/api/auth/provider-hint/route.ts` | API pista de proveedor | 97.67 % (42/43) | 77.5 % (31/40) |
| `src/app/home/actions.ts` | Acción de hidratación (DEF-008) | 100 % (16/16) | 100 % (10/10) |
| `src/proxy.ts` | Middleware de sesión y onboarding | 100 % (48/48) | 98 % (49/50) |
| `src/lib/geminiClient.ts` | Cliente Gemini (visión) | 97.01 % (65/67) | 91.66 % (33/36) |
| `src/lib/openFoodFacts.ts` | Cliente Open Food Facts | 97.14 % (68/70) | 93.81 % (91/97) |
| **Todo `src/`** | | **84.82 %** (5624/6630) | **81.21 %** (4549/5601) |

- **Cobertura de sentencia** (*statement coverage*): qué porcentaje de las instrucciones se ejecutó al menos una vez.
- **Cobertura de decisión** (*branch coverage*): qué porcentaje de las salidas de cada condición (`if`, `?:`, `&&`, `??`, `switch`) se recorrió, tanto la verdadera como la falsa. Es más exigente: se puede tener 100 % de sentencias y menos de decisiones (p. ej. un `if` sin `else` que nunca se probó con la condición falsa).
- Las ramas sin cubrir de cada módulo se ven en `coverage/index.html` (reporte navegable que genera el pipeline).

## 6. Catálogo de casos con ID

Los casos con ID fijo se citan desde la trazabilidad del plan. Cada fila = uno o varios tests parametrizados.

| ID | Descripción | Técnica | Req. | Test |
| --- | --- | --- | --- | --- |
| TC-CALC-01 | TMB hombre con la fórmula implementada | Referencia | RF-02 | `calculations.test.ts` |
| TC-CALC-02 | TMB mujer | Referencia | RF-02 | idem |
| TC-CALC-03 | La TMB sube con el peso y baja con la edad | Propiedad | RF-02 | idem |
| TC-CALC-04 | GET = TMB × factor de actividad (1,2 / 1,375 / 1,55 / 1,725) | EP | RF-02 | idem |
| TC-CALC-05 | TMB hombre 70 kg · 175 cm · 30 años = 1701,845 (cálculo a mano; documenta el valor actual de DEF-004) | Referencia | RF-02 | `valoresLimiteDominio.test.ts` |
| TC-CALC-06 | TMB mujer 60 kg · 165 cm · 25 años = 1417,23 | Referencia | RF-02 | idem |
| TC-CALC-07 | Macros para 2000 y 2500 kcal (15/55/30) | EP | RF-02 | `calculations.test.ts` |
| TC-CALC-08 | Macros: 0, 1 y 2000 kcal (redondeo en el borde) | VL | RF-02 | `valoresLimiteDominio.test.ts` |
| TC-CALC-09 | kcal restantes nunca negativas | VL | RF-02 | `calculations.test.ts` |
| TC-CALC-10 | kcal restantes con consumo 1999,4 / 1999,6 / 2000 | VL | RF-02 | `valoresLimiteDominio.test.ts` |
| TC-CALC-11 | Edad calculada (cumpleaños hoy; fecha inválida → 0) | EP | RF-02 | `calculations.test.ts` |
| TC-CALC-12 | Perfil nutricional completo (enteros positivos, GET > TMB) | EP | RF-02 | idem |
| TC-DATE-01…06 | `parseDateLocal`: válida, vacía, formato, mes 0/13, día 0, 30 de febrero, bisiesto | EP/VL | RF-02 | `dates.test.ts` |
| TC-DATE-07…15 | `validateFechaNacimiento`: 9 límites de la tabla 3.1 | VL | RF-02 | `valoresLimiteDominio.test.ts` |
| TC-DATE-16…18 | El selector y el validador usan el mismo límite (DEF-019) | VL | RF-02 | idem |
| TC-PWD-01…10 | Contraseña: tabla 2.1 | EP | RF-01 | `password.test.ts` |
| TC-ACT-01…19 | Alta/edición/borrado de ítems y escaneo: particiones y límites (sección 2.3) | EP/VL | RF-03, RF-04 | `alimentacionItemActions.test.ts` |
| TC-ACT-20…30 | `updateHidratacion`: camino normal y DEF-008 | EP/VL | RF-07 | `hidratacionAction.test.ts` |
| TC-API-10…19 | `/api/send-reminders` | Tabla de decisión | RF-12 | `sendRemindersRoute.test.ts` |
| TC-API-20…25 | `/api/delete-account` y la acción de `/perfil` | EP | RF-11 | `deleteAccountRoute.test.ts`, `deleteAccountAction.test.ts` |
| TC-API-30…39 | `/api/admin/delete-account-by-email` y `findUserByEmail` | VL | RNF-01 | `deleteAccountByEmailRoute.test.ts`, `findUserByEmail.test.ts` |
| TC-API-40…49 | `/api/validate-investigator` (validación + límite de intentos) | EP/VL | RNF-01 | `validateInvestigatorRoute.test.ts` |
| TC-API-50…59 | `/api/chat/meal` | Tabla de decisión | RF-05 | `chatMealRoute.test.ts` |
| TC-API-60…64 | `authenticate` (Bearer / cookie) | EP | RF-01 | `authenticate.test.ts` |
| TC-API-65…69 | `proxy` (middleware) | Tabla de decisión | RNF-01 | `proxy.test.ts` |
| TC-API-70…74 | `provider-hint` | Tabla de decisión | RF-01 | `providerHintRoute.test.ts` |
| TC-API-75 | `checkRateLimit` | VL | RNF-01 | `rateLimit.test.ts` |
| TC-UI-01…10 | Login, registro, recuperar contraseña, Google (incluye DEF-007) | EP/VL | RF-01 | `LoginPage.test.tsx` |
| TC-UI-20…30 | Tarjeta de hidratación | EP/VL | RF-07 | `HidratacionCard.test.tsx` |
| TC-UI-31 | Banner de instalación PWA (tabla de decisión) | Tabla de decisión | RNF | `PWAInstallPrompt.test.tsx` |
| TC-OFF-01…06 | Open Food Facts: normalización, fichas vacías, multipacks, textos | EP | RF-04 | `openFoodFacts.test.ts` |
| TC-LIB-01…08 | Datos del panel de investigador, catálogo SARA2, clientes Supabase | EP | RF-08 | `athletes`, `athleteDetailAction`, `sara2Catalog`, `supabaseClients`, `recortarImagen` |
| TC-QA-01 | Tests de componentes no fallan por timeout (DEF-001) | — | Proceso | `vitest.config.ts` |
| TC-QA-02 | La cobertura se mide sobre todo `src/` (DEF-006) | — | Proceso | `vitest.config.ts` |
| TC-QA-03 | Quality gate: umbrales y diff | VL / tabla | Proceso | `qaScripts.test.ts` |
| TC-E2E-01…07 | Integraciones reales | Escenario | RNF-01, RF-05 | `testing/e2e/*` (ver [integracion-externa.md](integracion-externa.md)) |
| TC-SMK-01…08 | Smoke | Escenario | RNF-01 | `scripts/smoke.mjs` |
| TC-LOAD-01 | Stress | Umbrales | RNF-02 | `load/stress.js` |
| TC-LOAD-02 | Esfuerzo sostenido | Umbrales | RNF-02 | `load/soak.js` |
