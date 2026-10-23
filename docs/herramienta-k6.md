# Herramienta incorporada: k6 (pruebas de carga)

Se incorporó **k6** (Grafana k6, v2.3.0) con el proceso de cinco pasos: requisitos → mercado → prueba de concepto → matriz de decisión → despliegue incremental. Es la herramienta con la que se hacen las pruebas de **stress** y de **esfuerzo sostenido** ([pruebas-de-carga.md](pruebas-de-carga.md)).

## Mapa de herramientas del ecosistema

| Necesidad | Herramienta | Estado |
| --- | --- | --- |
| Framework de tests | Vitest + React Testing Library | Existente |
| Cobertura | `@vitest/coverage-v8` | Existente (reconfigurado, DEF-006) |
| Análisis estático | ESLint, TypeScript (`tsc`) | Existente (ESLint pasó de 35 errores a 0) |
| Duplicación de código | **jscpd** | Incorporada en este trabajo |
| Quality gate | `scripts/qa/quality-gate.mjs` (propio) | Incorporada |
| Vulnerabilidades de dependencias | `npm audit` | Incorporada al gate (aviso) |
| CI/CD | GitHub Actions (`ci.yml`, `deploy-verify.yml`) | Incorporada |
| Despliegue | Vercel | Existente |
| **Pruebas de carga** | **k6** | **Incorporada con el proceso de 5 pasos (este documento)** |
| Gestión de defectos | Jira (importación de `defectos.csv`) | Formato listo |
| Análisis complementario opcional | SonarCloud (`sonar-project.properties`) | Opcional, desactivado por defecto |

## Paso 1 — Requisitos

| # | Requisito | Por qué |
| --- | --- | --- |
| Q1 | Escenarios de **stress** (rampa) y **sostenido** (carga constante) | Lo pide el TP y responde a riesgo R-13 |
| Q2 | Umbrales (latencia, tasa de error) definidos **como código** que hagan fallar el pipeline | Que la decisión no dependa de mirar un gráfico |
| Q3 | Se ejecuta en GitHub Actions y en una notebook Windows sin instalar servicios | Corre en el pipeline y en la demo |
| Q4 | Scripts en un lenguaje que el equipo ya domine (JS/TS) y versionables en el repo | Todo el equipo tiene que poder explicarlos |
| Q5 | Resultados exportables en JSON para generar el informe automáticamente | "Reportes generados por el pipeline" |
| Q6 | Bajo consumo del generador de carga (para que no sea el cuello de botella) | La máquina de pruebas es una notebook |
| Q7 | Gratuita y mantenida | Proyecto académico sin presupuesto |

## Paso 2 — Mercado (alternativas consideradas)

| Herramienta | Lenguaje / formato | Licencia | Observaciones |
| --- | --- | --- | --- |
| **k6** | JavaScript, binario en Go | AGPL-3.0 | Umbrales nativos que devuelven código de salida ≠ 0; `handleSummary` para JSON; action oficial `grafana/setup-k6-action` |
| Artillery | YAML + JS, Node | MPL-2.0 | Se instala con npm; umbrales vía plugin; más pesado por Node |
| Apache JMeter | GUI / XML, Java | Apache-2.0 | Muy completo; los planes `.jmx` son XML difíciles de revisar y de explicar |
| Locust | Python | MIT | Escenarios como código; requiere Python; umbrales hay que programarlos |
| autocannon | CLI de Node | MIT | Ideal para un solo endpoint; sin escenarios ni umbrales propios |

## Paso 3 — Prueba de concepto

Objetivo: comprobar que k6 cumple Q1–Q6 contra la aplicación real, sin comprometerse todavía.

1. **Instalación sin privilegios (Q3):** se descargó el binario de Windows de la release oficial `v2.3.0` y se **verificó su SHA-256** contra `k6-v2.3.0-checksums.txt` (coincidió); se ejecuta con la variable `K6_BIN`, sin instalador ni modificar el PATH.
2. **Guion mínimo** con 2 usuarios virtuales y 3 s para inspeccionar el formato de salida: confirmó que `handleSummary` entrega las métricas con percentiles (`p(95)`, `p(99)`) y el estado de cada umbral (`ok: true/false`), y que las **sub-métricas por etiqueta** (`http_req_duration{endpoint:login}`) aparecen cuando tienen umbral (Q2, Q5). Con un destino inaccesible, k6 terminó con el mensaje `thresholds on metrics 'http_req_failed' have been crossed` y salió con código distinto de cero, que es lo que necesita el pipeline.
3. **Escenario real** (el definitivo de `load/stress.js`) contra la app compilada en producción en local: 16 771 solicitudes con 100 usuarios virtuales, sin errores. El generador no fue el cuello de botella para ese nivel (Q6).
4. **Resultado de la PoC:** cumple Q1–Q7. Hallazgo útil para el diseño: los códigos 401 y las redirecciones son respuestas **esperadas** en nuestro tráfico, por lo que se usó `http.expectedStatuses` para que solo los 5xx cuenten como error.

## Paso 4 — Matriz de decisión

Puntaje de 1 (malo) a 5 (excelente), asignado por el equipo a partir de la documentación de cada herramienta y de la prueba de concepto de k6 (los puntajes de las demás herramientas son estimaciones por documentación, no se probaron todas). Total = Σ puntaje × peso / 100.

| Criterio (peso) | k6 | Artillery | JMeter | Locust | autocannon |
| --- | --- | --- | --- | --- | --- |
| Umbrales como código que cortan el pipeline (25) | 5 | 4 | 3 | 3 | 1 |
| Integración con CI (20) | 5 | 4 | 3 | 3 | 3 |
| Curva de aprendizaje: el equipo usa JS/TS (15) | 4 | 5 | 2 | 2 | 5 |
| Consumo de recursos del generador (10) | 5 | 3 | 2 | 3 | 5 |
| Reportes exportables (10) | 5 | 3 | 3 | 3 | 2 |
| Licencia y costo (10) | 4 | 4 | 5 | 5 | 5 |
| Comunidad y mantenimiento (10) | 5 | 4 | 5 | 4 | 3 |
| **Total ponderado** | **4,75** | 3,95 | 3,15 | 3,15 | 3,10 |

**Decisión:** k6. Pesaron sobre todo los umbrales como código y la integración con CI, que son lo que convierte la prueba de carga en un control automático. **Riesgo asumido:** la licencia AGPL no afecta a este uso (se usa como herramienta de prueba, no se distribuye ni se integra en el producto).

## Paso 5 — Despliegue incremental

| Etapa | Qué se hizo | Estado |
| --- | --- | --- |
| 1. Uso local manual | Binario con `K6_BIN`, guion de prueba | Hecho |
| 2. Scripts en el repo | `load/common.js`, `load/stress.js`, `load/soak.js`, `npm run load:stress` y `load:soak`, informe automático (`scripts/load/report.mjs`) | Hecho |
| 3. Corridas reales con umbrales | Stress a 100 y a 300 usuarios, sostenido de 10 min — resultados en [pruebas-de-carga.md](pruebas-de-carga.md) | Hecho (local) |
| 4. Pipeline, ejecución manual | Job `carga` de `deploy-verify.yml` con `workflow_dispatch` | Configurado; primera corrida en GitHub pendiente de que el workflow esté en la rama principal |
| 5. Pipeline, automática tras cada despliegue | Mismo job, disparado por `deployment_status` | Configurado |
| 6. (Futuro) corrida nocturna con histórico | `schedule` + guardado de tendencias | No implementado |

**Reversión:** si diera problemas (falsos positivos, costos en Vercel), se quita el job `carga` del workflow; los scripts siguen sirviendo de forma manual. No hay dependencias en el código de la aplicación.

## Lo que hay que saber explicar de k6

- Un **VU** (usuario virtual) repite en bucle la función `default`; `sleep` simula el tiempo de lectura.
- `ramping-vus` sube/baja la cantidad de VUs por etapas (stress); `constant-vus` la mantiene (sostenido).
- Un **umbral** es una condición sobre una métrica (`http_req_duration: ['p(95)<2000']`); si no se cumple, k6 termina con código 99 y el job falla.
- `p(95)` = el 95 % de las respuestas tardó eso o menos; es más representativo que el promedio, porque un promedio bueno puede esconder que algunos usuarios esperan mucho.
