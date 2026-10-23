# Métricas y análisis estático

Todas las cifras salen de ejecuciones reales del 23/10/2026; al lado de cada una está el comando o el archivo que la produce. "Antes" es el repositorio tal como estaba en `origin/main` (commit `f251f0e`); "después" es la rama `tp-calidad`.

## 1. Análisis estático: herramientas

| Herramienta | Qué mide | Cómo se ejecuta | Reporte | Quién decide |
| --- | --- | --- | --- | --- |
| **ESLint** (config de Next + TypeScript) | Errores de código, malas prácticas, accesibilidad | `npx eslint . -f json -o reports/eslint.json` | `reports/eslint.json` | Gate: 0 errores |
| **TypeScript** (`tsc --noEmit`, modo estricto) | Errores de tipos | `npm run typecheck` | consola | Paso del CI |
| **jscpd** | Código duplicado (≥ 5 líneas / 50 tokens) | `npx jscpd` (config `.jscpd.json`) | `reports/jscpd/jscpd-report.json` | Gate: ≤ 5 % |
| **Vitest + V8** | Cobertura de sentencias, ramas (decisiones), funciones y líneas sobre todo `src/` | `npm run test:coverage` | `coverage/coverage-summary.json`, `lcov.info`, `index.html` | Gate: ≥ 80 % |
| **npm audit** | Vulnerabilidades conocidas en dependencias | `npm audit --omit=dev --json` | `reports/npm-audit.json` | Aviso (no bloquea) |

El **quality gate** (`npm run qa:gate`) lee esos reportes y, además, calcula la cobertura **del código nuevo** cruzando `git diff` con `lcov.info`. Su salida: [evidencia/quality-gate.md](evidencia/quality-gate.md).

## 2. Tabla de métricas interpretadas

| Métrica | Valor | Umbral | Interpretación |
| --- | --- | --- | --- |
| Código fuente (`src/`) | 25 610 líneas en 180 archivos (`.ts`/`.tsx`) | — | Tamaño mediano; permite densidad de defectos |
| Pruebas automáticas | **1884** (933 unitarias, 603 de componentes, 331 de API/acciones, 17 de integración) en 123 archivos + 15 E2E | — | Pirámide sana: base ancha de unitarias y componentes, capa de API, pocas E2E |
| Cobertura de sentencias (todo `src/`) | **84,82 %** (5624/6630) | ≥ 80 % | Cumple. Las 4 de cada 5 líneas de lógica se ejecutan en tests |
| Cobertura de decisiones/ramas | **81,21 %** (4549/5601) | ≥ 80 % (objetivo propio) | Cumple. Es la más exigente: cada `if`/`?:`/`&&` recorrido por ambos lados |
| Cobertura de funciones | 83,02 % (1301/1567) | — | Pocas funciones sin ejecutar |
| Cobertura de líneas | 85,90 % (4967/5782) | — | Coherente con sentencias |
| Cobertura del código nuevo | **98,57 %** (69/70 líneas) | ≥ 80 % | Los cambios del TP nacen probados |
| Errores de ESLint | **0** | 0 | Sin bugs críticos detectables estáticamente |
| Warnings de ESLint | 18 (13 de reglas del React Compiler, 2 de `<img>`, 1 de accesibilidad, 2 varios) | — | Deuda técnica visible, sin riesgo funcional conocido |
| Duplicación | **2,62 %** (670 líneas en 55 bloques) | ≤ 5 % | Aceptable; los bloques más grandes son formularios hermanos (`AcademicForm`/`PhysicalForm`) |
| Complejidad ciclomática > 15 | 46 funciones (máx. 124 en `generateExcelAction`, 106 en `PendienteDetalle`) | ≤ 15 (referencia) | **Principal punto de mantenibilidad a mejorar**: funciones largas que mezclan consulta, transformación y armado. Están cubiertas por tests, lo que permite refactorizarlas con red de seguridad |
| Vulnerabilidades de dependencias (producción) | 8 (0 críticas, 6 altas, 2 moderadas) | 0 críticas | Sin críticas; quedan `exceljs`, `nodemailer` y `@serwist/*`, que requieren cambios mayores de versión |

## 3. Métrica de proceso y métrica de proyecto

### Métrica de proceso: eficacia de las prácticas de QA

| Indicador | Valor | Cómo se calcula |
| --- | --- | --- |
| **Cobertura del código nuevo por cambio** | 98,57 % | líneas ejecutables nuevas cubiertas / líneas ejecutables nuevas (gate) |
| **Defectos corregidos con prueba de regresión** | 100 % de los 17 corregidos (el único sin test, DEF-010, recibió el suyo en este trabajo) | defectos corregidos con test / defectos corregidos |
| **Tests intermitentes** | 1 de 1416 al comienzo → 0 de 1884 en las corridas de cobertura posteriores | DEF-001 |
| **Defectos hallados por técnica** (de los 11 hallados en este TP) | API/tablas de decisión: 3 · valores límite/particiones: 3 · E2E real: 1 · revisión contra la fuente: 1 · medición de proceso: 3 | ver [defectos.md](defectos.md) |

Lectura: las técnicas "sistemáticas" (tablas de decisión y valores límite) encontraron la mitad de los defectos; el E2E contra el servicio real encontró el más grave (DEF-009), que ningún test con mocks podía ver.

### Métrica de proyecto: calidad del producto y avance

| Indicador | Valor |
| --- | --- |
| Defectos registrados | 19 (11 hallados en este TP + 8 históricos documentados) |
| **Densidad de defectos** | 19 / 25,6 KLOC = **0,74 defectos por KLOC** |
| Por severidad | 3 críticas · 5 altas · 9 medias · 2 bajas |
| Estado | 17 corregidos (89 %) · 2 abiertos: DEF-004 (decisión del equipo) y DEF-009 (acción en Supabase) |
| Defectos críticos o altos abiertos | 1 (DEF-009), con el SQL de corrección listo |

Lectura: la densidad es una cota inferior (solo cuentan los defectos que se encontraron); la concentración de defectos graves en la capa de API/acciones, que tenía 0 % de cobertura, es la evidencia del principio de "agrupación de defectos".

## 4. Mejoras medidas antes y después

| Métrica | Antes (`f251f0e`) | Después | Cambio | Cómo se midió |
| --- | --- | --- | --- | --- |
| Cobertura de sentencias, **todo `src/`** | 70,34 % (4668/6636) | **84,82 %** (5624/6630) | **+14,48 pp** | `vitest --coverage` con `coverage.include: src/**` |
| Cobertura de ramas, todo `src/` | 68,16 % (3816/5598) | **81,21 %** (4549/5601) | **+13,05 pp** | idem |
| Cobertura "visible" que reportaba el repo original | 86,11 % sentencias / 80,46 % ramas | (se reemplaza por la medición completa) | — | solo contaba archivos importados por tests (DEF-006) |
| Errores de ESLint | 35 (34 en código del proyecto + 1 en el `sw.js` generado) | **0** | −35 | `eslint . -f json` |
| Warnings de ESLint | 99 (85 en el `sw.js` generado) | 18 | −81 | idem; el archivo generado se excluyó (no es código del proyecto) |
| Vulnerabilidades críticas (producción) | 1 | **0** | −1 | `npm audit --omit=dev` |
| Vulnerabilidades totales (producción) | 16 | 8 | −8 | idem; `next` 16.2.4 → 16.4.3, `zod` y dependencias transitivas |
| Duplicación | 2,67 % (680 líneas) | 2,62 % (670 líneas) | −0,05 pp | `jscpd` (unificación de `findUserByEmail` y `supabaseQuery.ts`) |
| Tests | 1416 | 1884 + 15 E2E | +468 (+33 %) | `vitest list` |
| Rutas de API con 0 % de cobertura | 7 (`send-reminders`, `delete-account`, `delete-account-by-email`, `chat/meal`, `provider-hint`, `validate-investigator`, `proxy.ts`) | 0 | −7 | `coverage-summary.json` |
| Tests intermitentes | 1 | 0 | −1 | DEF-001 |

La mejora que se destaca en el informe es la **cobertura real (+14,48 pp) junto con la caída a 0 de errores de ESLint y de vulnerabilidades críticas**: las tres salen del mismo comando (`npm run qa`) y se verifican en cada push.

## 5. Análisis crítico de las métricas

- **Lo que las métricas no dicen.** El 84,82 % no implica que se verifique todo lo importante: hay pantallas de servidor sin tests (`home/page.tsx`, `perfil/page.tsx`, `elegir-uso`, `encuesta-psicologica`), todas con 0 %. Son composiciones de componentes ya probados, pero el riesgo existe.
- **La cobertura de ramas es la que más vale.** Subió menos que la de sentencias en los archivos con muchas condiciones (`deportistas/actions.ts` 70 % de ramas, `AIRecognitionModal` 63 %).
- **Las excepciones a ESLint están justificadas, no escondidas.** 13 reglas del React Compiler se bajaron a *warning* (no a *off*) y 3 interfaces conservan un `any` con comentario; todo queda en el reporte.
- **Duplicación baja, pero con dos SDK de Gemini conviviendo** (`@google/generative-ai` deprecado y `@google/genai`): no la detecta jscpd porque no es copia de código sino de responsabilidad; está registrada como deuda (R-09).
- **Qué se haría con más tiempo:** refactorizar las 5 funciones de mayor complejidad, subir la cobertura de las pantallas de servidor, paginar la consulta de cumplimiento (R-07) y reemplazar `exceljs`/`nodemailer` por versiones sin vulnerabilidades.
