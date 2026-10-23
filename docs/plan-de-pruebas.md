# Plan de pruebas — NutriScan

| | |
| --- | --- |
| **Versión** | 1.0 — 23/10/2026 (versionado en git: `git log docs/plan-de-pruebas.md`) |
| **Proyecto** | NutriScan (Tesis, UCC) — Next.js 16 + Supabase + Gemini, desplegado en Vercel |
| **Nivel declarado** | **Nivel 3 — prototipo avanzado** |
| **Alcance** | Toda la aplicación (`src/`), sus API, y las integraciones con Supabase (Auth, base de datos con RLS, Storage), Gemini (chat y reconocimiento por foto) y Open Food Facts (código de barras) |
| **Fuera de alcance** | Pruebas con dispositivos físicos (giroscopio, cámara) más allá de los dobles; pruebas de usabilidad con usuarios; las bibliotecas de terceros en sí mismas |

Documentos relacionados: [casos de prueba](casos-de-prueba.md) · [defectos](defectos.md) · [integración externa](integracion-externa.md) · [pruebas de carga](pruebas-de-carga.md) · [métricas](metricas.md) · [herramienta incorporada (k6)](herramienta-k6.md) · [guía de defensa](GUIA_DEFENSA.md).

---

## 1. Objetivos y estrategia

1. Que cada cambio se pruebe **automáticamente** antes de integrarse (CI) y cada despliegue se verifique **automáticamente** después (smoke, E2E real, carga).
2. Que las decisiones de calidad se apoyen en **datos medidos por el pipeline**, no en estimaciones.
3. Concentrar el esfuerzo donde el riesgo es mayor (sección 4): datos personales de salud, dependencia de IA externa y estudio a ciegas.

Se sigue una pirámide de pruebas: muchas pruebas unitarias y de componentes (rápidas, sin red), una capa de pruebas de API/integración con dobles de prueba, y pocas pruebas E2E contra servicios reales.

## 2. Criterios de entrada y de salida

### Entrada (para empezar a ejecutar el plan sobre una versión)

| # | Criterio | Cómo se verifica |
| --- | --- | --- |
| E1 | La versión compila (`next build`) y pasa el chequeo de tipos | Pasos *Compilar* y *Chequeo de tipos* del CI |
| E2 | Dependencias instaladas de forma reproducible | `npm ci` con `package-lock.json` |
| E3 | Para E2E: secrets cargados y despliegue accesible | Smoke test en verde (`scripts/smoke.mjs`) |
| E4 | Casos de prueba y criterio de aceptación definidos **antes** de ejecutar | [casos-de-prueba.md](casos-de-prueba.md); en los defectos con TDD el test se commitea rojo antes del fix |

### Salida (para dar la versión por aceptada)

| # | Criterio | Umbral | Fuente del dato |
| --- | --- | --- | --- |
| S1 | Todas las pruebas automáticas pasan | 100 % de las ejecutadas | `npm run test:coverage` |
| S2 | Cobertura de sentencias sobre **todo** `src/` | ≥ 80 % | `coverage/coverage-summary.json` |
| S3 | Cobertura sobre código nuevo | ≥ 80 % | `scripts/qa/quality-gate.mjs` (diff + lcov) |
| S4 | Errores de ESLint (bugs críticos) | 0 | `reports/eslint.json` |
| S5 | Duplicación de código | ≤ 5 % | `reports/jscpd/` |
| S6 | Defectos de severidad Crítica o Alta abiertos | 0 (los abiertos deben tener decisión y responsable) | [defectos.md](defectos.md) |
| S7 | Smoke test post-despliegue | 100 % | `reports/smoke.json` |
| S8 | E2E con integraciones reales | 100 % de las que corren | `reports/e2e/` |
| S9 | Carga: umbrales de stress y esfuerzo sostenido | Cumplidos (ver [pruebas-de-carga.md](pruebas-de-carga.md)) | `reports/load/` |

Los criterios S2–S5 los aplica automáticamente el **quality gate** (si falla, el CI falla y el PR no se puede integrar). S6–S9 se revisan en cada despliegue.

## 3. Matriz ISO/IEC 25010 con evidencia

| Característica | Qué significa en NutriScan | Evidencia en el repositorio | Prioridad |
| --- | --- | --- | --- |
| **Adecuación funcional** | Los cálculos (TMB/GET/macros, kcal por cantidad), el registro de ingestas y la validación de alimentos hacen lo que dicen | `calculations.test.ts`, `valoresLimiteDominio.test.ts`, `alimentacionItemActions.test.ts`, `macros.test.ts`; hallazgos DEF-004, 007, 008, 010 | **Top 3** |
| **Eficiencia de desempeño** | Tiempos de respuesta aceptables y comportamiento bajo carga | `load/stress.js`, `load/soak.js`; informe en [pruebas-de-carga.md](pruebas-de-carga.md): p95 y punto de degradación medidos | Media |
| **Compatibilidad** | Convivencia con Supabase, Gemini y Open Food Facts; contratos de datos | [integracion-externa.md](integracion-externa.md); `testing/e2e/*`; `geminiClient.test.ts`, `openFoodFacts.test.ts` | Media |
| **Capacidad de uso (usabilidad)** | Formularios claros, mensajes coherentes, accesibilidad móvil | `LoginPage.test.tsx` (DEF-007), `contrasteComponentesUi.test.tsx`, `contrasteRevision.test.ts`, tests de modales/foco | Media |
| **Fiabilidad** | Tolerancia a caídas de dependencias, reintentos, transacciones | `geminiClient.test.ts` (reintento, fallback de modelo, timeouts), RPC transaccionales (`confirmar_chat_ia_registro`), plan de contingencia (sección 9) | **Top 3** |
| **Seguridad** | Confidencialidad de datos de salud, control de roles, estudio a ciegas | RLS en `schema_consolidado.sql`; tests de `proxy`, `authenticate`, rutas protegidas; DEF-002, 005, 009, 013, 017 | **Top 1** |
| **Mantenibilidad** | Código modular, analizable, con tests que permiten cambiar sin miedo | ESLint + jscpd + cobertura en el gate; refactor `supabaseQuery.ts`; [métricas](metricas.md) | Media |
| **Portabilidad** | Instalable como PWA, corre en distintos navegadores/dispositivos | `PWAInstallPrompt.test.tsx`, `manifest.ts`, `overlayMovil`, `anguloDispositivo` | Baja |

### Top 3 justificado

1. **Seguridad.** La app guarda datos de salud de deportistas, y es parte de un estudio científico a ciegas. Una fuga o una escalada de rol invalida el estudio y expone a personas reales. Es la característica con los defectos más graves hallados: DEF-002 (endpoint abierto que filtraba emails), DEF-009 (perfiles legibles sin sesión en la base real), DEF-005 (fuerza bruta del código de investigador) y DEF-013 (escalada de rol, ya corregido). Por eso recibe más casos (API, RLS vía E2E real) y un smoke específico.
2. **Adecuación funcional.** El valor de la app son números correctos: calorías, macros y cantidades. Un error de fórmula (DEF-004) o de validación (DEF-008) contamina los datos del estudio. Se prueba con valores calculados a mano y valores límite.
3. **Fiabilidad.** La función diferencial (registrar comidas con IA) depende de un tercero (Gemini) que puede fallar, saturarse o agotar cuota (riesgo R-01, el de mayor puntaje). El sistema tiene reintentos, modelo de respaldo y degradación a carga manual; se prueban esas rutas con dobles y se verifica la integración real en cada despliegue.

## 4. Riesgos priorizados (probabilidad × impacto)

Escala 1–5 para cada eje. **Puntaje = P × I.** ≥ 15 crítico · 10–14 alto · 5–9 medio · < 5 bajo.

| ID | Riesgo | P | I | Puntaje | Mitigación / prueba | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| R-01 | Gemini caído, saturado o sin cuota → no se puede registrar con IA | 4 | 4 | **16** | Reintentos, modelo de respaldo, degradación a carga manual (sección 9); E2E real de contrato en cada despliegue | Mitigado parcialmente |
| R-12 | La IA devuelve macros o gramos incorrectos (alucinación) | 4 | 4 | **16** | Matching exacto contra SARA2, plausibilidad 4/4/9, edición por el usuario, cola de validación de investigadores | Mitigado |
| R-03 | Fuga de datos personales por RLS mal aplicada | 3 | 5 | **15** | RLS por tabla; **E2E contra Supabase real** | **Materializado: DEF-009 (abierto)** |
| R-04 | Fuerza bruta del código de investigador / rate limit por instancia | 3 | 4 | 12 | Límite por IP (DEF-005); limitación: contador en memoria por instancia | Mitigado parcialmente |
| R-05 | Fórmula nutricional distinta de la documentada | 3 | 4 | 12 | Valores calculados a mano; DEF-004 | Abierto (decisión) |
| R-11 | Dependencias con vulnerabilidades | 4 | 3 | 12 | `npm audit` en el gate (aviso); actualización de `next`/`zod` | Mejorado: críticas 1→0, producción 16→8 |
| R-02 | Supabase caído | 2 | 5 | 10 | Smoke + E2E; plan de contingencia (sección 9) | Aceptado |
| R-14 | Se rompe el estudio a ciegas (un deportista ve macros) | 2 | 5 | 10 | `ocultarMacros`, tests de payload (DEF-017) | Mitigado |
| R-07 | `getAthleteData` consulta `ingestas` sin paginar y Supabase corta en 1000 filas | 3 | 3 | 9 | A verificar con datos reales; paginar si el cohorte crece | Abierto |
| R-10 | Regresiones por cambios sin red de seguridad | 3 | 3 | 9 | CI + gate + una prueba de regresión por defecto | Mitigado |
| R-06 | Open Food Facts caído se muestra como "producto no encontrado" | 3 | 2 | 6 | E2E de contrato; mejora propuesta: distinguir el error | Abierto |
| R-13 | Cold start / latencia de Vercel bajo carga | 3 | 2 | 6 | Pruebas de stress y soak con umbrales | Mitigado |
| R-08 | Enumeración de cuentas por `/api/auth/provider-hint` | 3 | 2 | 6 | Aceptado como compromiso de usabilidad | Aceptado |
| R-09 | Dos SDK de Gemini conviven (uno deprecado) | 2 | 2 | 4 | Deuda técnica registrada | Abierto |

## 5. Mapa de niveles de prueba

| Nivel | Qué prueba | Herramienta | Cantidad | Dónde corre | Comando |
| --- | --- | --- | --- | --- | --- |
| **Unitaria** | Funciones puras de `src/lib` (cálculos, fechas, contraseña, macros, matching) | Vitest (proyecto `node`) | ver [métricas](metricas.md) | CI (cada push) | `npm run test:unit` |
| **Componente** | Pantallas y formularios con React Testing Library | Vitest + RTL (proyecto `jsdom`) | ver [métricas](metricas.md) | CI | `npm run test:unit` |
| **Integración / API** | Rutas `/api/*`, Server Actions, `proxy`, con Supabase/Gemini reemplazados por dobles | Vitest | ver [métricas](metricas.md) | CI | `npm run test:integration` y `test:unit` |
| **Contrato** | Esquemas Zod de requests/responses y forma de lo que devuelven Gemini y Open Food Facts | Vitest | incluido arriba | CI | idem |
| **Estático** | ESLint, tsc, jscpd, `npm audit` | ESLint, TypeScript, jscpd | — | CI | `npm run qa` |
| **Smoke** | El despliegue arrancó y responde | `scripts/smoke.mjs` | 6 + 2 de Supabase | Después de cada despliegue | `npm run smoke` |
| **E2E real** | Flujo completo contra Supabase, Gemini y Open Food Facts reales | Vitest (`vitest.e2e.config.ts`) | 15 | Después de cada despliegue | `npm run test:e2e` |
| **Stress / sostenido** | Capacidad, degradación y estabilidad | k6 | 2 escenarios | Después de cada despliegue | `npm run load:stress`, `npm run load:soak` |
| **Aceptación** | Demo con un despliegue nuevo | [guion-demo.md](guion-demo.md) | — | Manual guiado | — |

## 6. Prácticas de QA vs. QC

**QA (aseguramiento): previenen defectos mejorando el proceso.**

| Práctica | Evidencia |
| --- | --- |
| Pipeline de CI con quality gate obligatorio | `.github/workflows/ci.yml`, `scripts/qa/` |
| Criterio de aceptación escrito **antes** de ejecutar (test rojo antes del fix) | Commits `test(def-NNN): ROJO` previos a `fix(def-NNN)` |
| Una prueba de regresión por cada defecto corregido | Columna "Test de regresión" de [defectos.md](defectos.md) |
| Plantillas de caso y de defecto con trazabilidad | Secciones 7 y 8 |
| Revisión de código vía pull request y checks obligatorios | Historial de PR del repositorio; regla de protección de rama ([SETUP_SECRETS.md](SETUP_SECRETS.md) §4) |
| Gestión de riesgos priorizada | Sección 4 |
| Incorporación de herramientas con proceso de 5 pasos | [herramienta-k6.md](herramienta-k6.md) |

**QC (control): detectan defectos en el producto.**

| Práctica | Evidencia |
| --- | --- |
| Ejecución de pruebas unitarias, de componente, de API | `npm test` (1800+ pruebas) |
| Medición de cobertura de sentencia y de decisión | `coverage/` |
| Análisis estático (ESLint, jscpd, npm audit) | `reports/` |
| Smoke y E2E post-despliegue | `reports/smoke.*`, `reports/e2e/` |
| Pruebas de stress y de esfuerzo sostenido | `reports/load/` |
| Registro y seguimiento de defectos | [defectos.md](defectos.md) / Jira |

## 7. Plantilla de caso de prueba

```
ID:              TC-<GRUPO>-<NN>
Título:          <qué comportamiento verifica>
Requisito:       <RF-NN / RNF-NN>
Nivel:           unitaria | componente | API | E2E | carga
Técnica:         partición de equivalencia | valor límite | tabla de decisión | transición de estados | exploratoria
Precondiciones:  <estado inicial, datos, dobles usados>
Datos de entrada:<valores concretos>
Pasos (AAA):     Arrange — <preparación> / Act — <acción> / Assert — <qué se verifica>
Resultado esperado: <definido ANTES de ejecutar>
Resultado obtenido / estado: Pasa | Falla (DEF-NNN)
Archivo de test: testing/<archivo>
Defectos vinculados: <DEF-NNN o ninguno>
```

## 8. Plantilla de defecto

```
ID:              DEF-<NNN>
Título:          <síntoma en una línea>
Severidad:       Crítica | Alta | Media | Baja     Prioridad (Jira): Highest | High | Medium | Low
Estado:          Abierto | En corrección | Corregido | Cerrado
Entorno:         <local | CI | producción>, versión/commit
Pasos para reproducir: 1) … 2) …
Resultado esperado:    …
Resultado obtenido:    … (con evidencia)
Causa raíz:      …
Caso de prueba que lo detecta / regresión: TC-… · testing/<archivo>
Commits:         rojo <hash> · verde <hash>
```

Los defectos reales están en [defectos.md](defectos.md) y en [defectos.csv](defectos.csv) (importable a Jira).

## 9. Plan de contingencia ante la caída de la dependencia crítica

La dependencia crítica de la función diferencial es **Gemini** (chat y reconocimiento por foto); la de toda la app es **Supabase**.

### Gemini (probabilidad alta, impacto alto → R-01)

| Escenario | Detección | Respuesta automática (ya implementada) | Acción del equipo |
| --- | --- | --- | --- |
| Error 5xx / saturación (503) | `callLlmJson`: clasifica el error; `llamarGeminiJson` | 1 reintento con backoff; modelo de respaldo (`GEMINI_FALLBACK_MODEL`); el chat responde `503 AI_UNAVAILABLE` con mensaje claro | Cambiar `GEMINI_MODEL` en Vercel (sin tocar código) |
| Cuota agotada (429) | `RATE_LIMITED` | Se informa al usuario "esperá un minuto"; no se reintenta en vano | Subir cuota / esperar al reinicio diario |
| Respuesta inválida o bloqueada | Validación Zod | Reintento con instrucción más estricta; luego `502 AI_INVALID_RESPONSE` | Revisar el prompt |
| Caída prolongada | E2E de Gemini falla en el despliegue; logs `[gemini]` | **Degradación:** el usuario sigue registrando comidas con la búsqueda manual en SARA2/ANMAT y el escaneo de códigos de barras, que no dependen de Gemini | Comunicar al grupo de estudio; no hay pérdida de datos porque el chat "no guarda nada" hasta confirmar |
| Clave inválida / revocada | `GEMINI_API_KEY no configurada` → `AI_UNAVAILABLE` | Igual que arriba | Rotar la clave en Vercel |

### Supabase (probabilidad baja, impacto crítico → R-02)

| Escenario | Detección | Respuesta | Acción |
| --- | --- | --- | --- |
| Caída de Auth o base | Smoke (`/auth/v1/health`, `/rest/v1/alimentos`) en rojo tras el despliegue | La app muestra errores; el proxy no deja avanzar sin sesión | Revisar status.supabase.com; la PWA conserva la pantalla offline |
| Datos corruptos / borrado accidental | — | Copias de seguridad automáticas del proyecto Supabase | Restaurar desde el panel de Supabase |

### Open Food Facts (probabilidad media, impacto bajo → R-06)

Si está caído el escaneo devuelve "producto no encontrado" y se puede cargar el alimento a mano ("Personalizar"). Mejora pendiente: distinguir el error de red del producto inexistente.

**Prueba del plan:** los tests con dobles de `geminiClient.test.ts` cubren timeout, 429, 503, JSON inválido y modelo de respaldo; el E2E de Gemini detecta en cada despliegue si la dependencia real dejó de responder.

## 10. Objetivos de calidad medibles

| Perspectiva | Objetivo | Métrica | Meta | Valor medido (23/10/2026) | Fuente |
| --- | --- | --- | --- | --- | --- |
| **Usuario** | Respuesta ágil de la pantalla de entrada | p95 de `/login` bajo carga alta (100 usuarios simultáneos) | < 2000 ms | 611,7 ms | `reports/load` (stress, pico 100) |
| **Usuario** | La IA responde a tiempo | Latencia de una llamada a Gemini (contrato) | < 15 s | 3,7 s (una prueba) | `reports/e2e` |
| **Usuario** | Datos propios protegidos | Filas de `profiles` visibles sin sesión | 0 | **5 → pendiente del fix de DEF-009** | E2E real |
| **Equipo** | El cambio se prueba solo | Pruebas automáticas que pasan | 100 % | 100 % | CI |
| **Equipo** | Poder cambiar con confianza | Cobertura de sentencias (todo `src/`) | ≥ 80 % | 84,82 % | Vitest |
| **Equipo** | Código mantenible | Duplicación / errores de ESLint | ≤ 5 % / 0 | 2,62 % / 0 | jscpd / ESLint |
| **Equipo** | Cada defecto se vuelve test | Defectos corregidos con regresión | 100 % | 100 % de los corregidos (16 de 18 registrados; 2 abiertos por una decisión o acción externa: DEF-004 y DEF-009) | [defectos.md](defectos.md) |
| **Organización** | Detectar problemas antes que el usuario | Despliegues verificados automáticamente | 100 % | Configurado en `deploy-verify.yml` | Pipeline |
| **Organización** | Riesgo de seguridad controlado | Vulnerabilidades críticas en producción (`npm audit`) | 0 | 0 (antes 1) | npm audit |
| **Organización** | Capacidad de respuesta ante caída de IA | Función clave disponible por otra vía | Sí | Sí (carga manual y escaneo) | Sección 9 |

## 11. Los siete principios del testing aplicados al proyecto

| # | Principio | Cómo se aplicó acá |
| --- | --- | --- |
| 1 | **Las pruebas muestran la presencia de defectos, no su ausencia** | 1800+ pruebas en verde no impidieron DEF-009: el E2E contra la base real lo mostró. Nunca se afirma "no hay bugs", solo "estos pasan". |
| 2 | **Las pruebas exhaustivas son imposibles** | Se usan clases de equivalencia y valores límite (p. ej. 199/200/201 usuarios en la paginación) en vez de probar todas las entradas; los riesgos priorizan dónde profundizar. |
| 3 | **Probar temprano** | El quality gate corre en cada push; los tests de los defectos se escribieron antes del fix (commits rojo → verde). |
| 4 | **Agrupación de defectos** | Los hallazgos se concentraron en la **capa de API y acciones** (DEF-002, 003, 005, 008), la que tenía 0 % de cobertura. Se priorizó ahí. |
| 5 | **Paradoja del pesticida** | Se renuevan los casos: las pruebas unitarias existentes no detectaron los defectos de API; se agregaron técnicas distintas (tablas de decisión, valores límite, E2E real). |
| 6 | **Las pruebas dependen del contexto** | Datos de salud + estudio a ciegas → seguridad primero; app móvil/PWA → componentes y accesibilidad; dependencia de IA → contrato y contingencia. |
| 7 | **Falacia de la ausencia de errores** | Que el 86 % de cobertura "se viera bien" no significaba calidad: medido sobre todo `src/` era 70 % (DEF-006). Pasar los tests no prueba que el sistema sirva al usuario: por eso hay smoke, E2E y una demo con un despliegue nuevo. |

## 12. Trazabilidad requisito → caso → defecto

Los IDs de caso están definidos en [casos-de-prueba.md](casos-de-prueba.md), con el archivo de test de cada uno.

| Requisito | Descripción | Casos | Defectos |
| --- | --- | --- | --- |
| RF-01 | Registro e ingreso (email y Google) | TC-UI-01…10, TC-API-60…63 | DEF-007, DEF-013 |
| RF-02 | Perfil físico y cálculo de TMB/GET/macros | TC-CALC-01…12, TC-DATE-01…14 | DEF-004 |
| RF-03 | Registro de ingestas desde el catálogo | TC-ACT-01…19 | DEF-011, DEF-012 |
| RF-04 | Registro por código de barras (Open Food Facts) | TC-OFF-01…06, TC-E2E-06 | DEF-010, 014, 015, 018 |
| RF-05 | Registro por chat con IA (Gemini) | TC-API-50…59, TC-E2E-01…03 | — (R-01, R-12) |
| RF-06 | Reconocimiento por foto | Tests existentes `food-recognition-*-route.test.ts`, `geminiClient.test.ts` | — |
| RF-07 | Hidratación | TC-ACT-20…30, TC-UI-20…30 | DEF-008 |
| RF-08 | Panel de investigador (cumplimiento, exportación) | TC-LIB-01…08 | — (R-07) |
| RF-09 | Cola de validación de alimentos | Tests existentes `validacion*.test.ts*`, `PendienteDetalle.test.tsx` | DEF-016 |
| RF-10 | Estudio a ciegas | `ocultarMacros*.test.ts`, `AlimentacionSearch.test.tsx` | DEF-017 |
| RF-11 | Eliminación de cuenta | TC-API-20…25 | — |
| RF-12 | Recordatorios por mail | TC-API-10…20 | DEF-002 |
| RNF-01 | Seguridad (RLS, roles, secretos) | TC-API-30…42, TC-E2E-04, TC-SMK-06 | DEF-002, 003, 005, 009, 013 |
| RNF-02 | Desempeño | TC-LOAD-01, TC-LOAD-02 | — |
| RNF-03 | Resiliencia ante caída de dependencias | Tests de `geminiClient`, TC-E2E-01 | — (R-01, R-06) |
