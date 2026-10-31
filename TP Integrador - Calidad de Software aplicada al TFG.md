## TP Integrador Calidad de Software

## Contexto

Este trabajo integra todo lo visto en la materia en un único proyecto continuo. Consiste en aplicar a la Tesis un proceso de calidad completo, que acompañe el desarrollo desde hoy hasta la entrega y no se agregue al final.

Al concluir, cada grupo deberá demostrar que su sistema se prueba automáticamente en cada despliegue, que sus integraciones externas funcionan o están controladas, y que sus decisiones de calidad se apoyan en datos.

## Modalidad

Al inicio, cada grupo declara en qué etapa se encuentra su Tesis. Aun así, todos deben cumplir con la entrega completa, con mayor o menor profundidad según lo que ya exista.

Dado que el el proyecto debe conectarse con al menos un sistema externo (por ejemplo, un servidor MCP, una API de terceros, una plataforma cloud, una base de datos como servicio o un proveedor de autenticación), las pruebas de esa integración son una parte central del trabajo.

## Temas que se integran

Se pide un eje por cada tema trabajado en clase y un eje transversal de documentación. En cada uno, el grupo puede demostrar lo siguiente:

| Tema | Resumen guía |
| --- | --- |
| Introducción a la calidad | Objetivos de calidad medibles desde el usuario, el equipo y la organización, con las prácticas de proceso que los sostienen, y un plan de contingencia ante la caída de una dependencia crítica. |
| Fundamentos del testing | Pruebas unitarias en Arrange–Act–Assert, criterio de aceptación fijado antes de ejecutar, un defecto real con contraste rojo/verde y los siete principios aplicados al proyecto. |
| Modelos de calidad y niveles de prueba | Matriz de las 8 características de ISO/IEC 25010 con evidencia, top 3 justificado, mapa de niveles de prueba y despliegue verificado en cada instancia. |
| Métricas y análisis estático | Análisis estático, tabla de métricas interpretadas, una métrica de proceso y una de proyecto, y una mejora medida antes y después. |
| Pruebas dinámicas | Casos de prueba documentados con clases de equivalencia, valores límite y tablas de decisión; cobertura de sentencia y de decisión. |
| Aseguramiento de la calidad | Plan de pruebas, riesgos (probabilidad × impacto), prácticas de QA distinguidas de las de QC y plantillas de caso y de defecto con trazabilidad. |
| Automatización del testing | Pirámide de pruebas automatizadas, pruebas de API e integración con el MCP o la plataforma externa, smoke en cada despliegue, pipeline de CI/CD y una prueba de regresión por cada defecto corregido. |


| Tema | Resumen guía |
| --- | --- |
| Herramientas del ecosistema | Mapa de herramientas, una herramienta nueva incorporada con el proceso de cinco pasos, registro en Jira u otra, y pruebas de stress y de esfuerzo sostenido. |
| Documentación y análisis | Transversal |

## Metas de calidad

Cada grupo declara su nivel al inicio y se trabaja con la siguiente tabla. Cada aspecto se evalúa contra lo exigido para el nivel declarado.

| Aspecto | Nivel 1: inicial | Nivel 2: prototipo parcial | Nivel 3: prototipo avanzado |
| --- | --- | --- | --- |
| Pipeline |   | Compilación, pruebas, análisis estático, cobertura, quality gate y reporte automático. |   |
| Quality gate |   | Bloquea ante bugs críticos, duplicación mayor a 5 % y cobertura sobre código nuevo menor al 80 % |   |
| Cobertura sobre código nuevo |   | 80 % |   |
| Plan de pruebas y riesgos |   | Plan versionado con criterios de entrada y salida, riesgos priorizados por probabilidad × impacto y trazabilidad requisito → caso → defecto |   |
| Defectos |   | Registrados con pasos, esperado y obtenido, vinculados a su caso de prueba en Jira u otra herramienta |   |
| Herramienta nueva |   | Incorporada con el proceso de cinco pasos: requisitos, mercado, prueba de concepto, matriz de decisión y despliegue incremental |   |
|   | Nivel de avance |   |   |
| Cobertura mínima sobre el código existente | 50 % | 60 % | 80 % |
| Smoke test | Definido y ejecutable a mano | Ejecutado por el pipeline tras el despliegue | Ejecutado por el pipeline tras el despliegue |
| Integración externa (MCP o plataforma) | Contrato y pruebas con dobles de prueba | Una integración probada contra entorno real | Flujo E2E automatizado en cada despliegue |
| Stress y esfuerzo sostenido | Plan y un script de carga ejecutado | Stress ejecutado, con resultados y umbrales | Stress ejecutado, con resultados y umbrales. |


## Entregables

Todo debe quedar automatizado y documentado en un repositorio; se entrega junto con un informe en PDF. Los números del informe deben coincidir con los del pipeline y la herramienta de análisis. Se debe contar al menos con:

- Plan de pruebas versionado, con la matriz ISO 25010 y la trazabilidad.

- Código de las pruebas: unitarias, integración, smoke, stress y esfuerzo; todas ejecutables con un comando.

- Pipeline de integración continua como archivo de configuración dentro del repositorio, con al menos una ejecución completa en verde y una ejecución fallida que haya detectado un problema real.

- Reportes automáticos de cobertura, análisis estático y resultados de stress, generados por el pipeline.

- Documentación de la integración externa (MCP o plataforma).

- Registro de defectos con los datos completos de cada uno.

- Documento de la herramienta incorporada y la matriz de decisión.

- Informe en PDF con el nivel declarado, las metas cumplidas y no cumplidas, la evolución de las métricas, el análisis crítico y las conclusiones.

- Demostración con un despliegue nuevo, con las integraciones, pruebas y cargas exigidas.

## Fecha de presentación

La fecha de presentación es: 26 de octubre de 2026

## Reglas prácticas

- Aporte individual trazable. En la defensa se hacen preguntas individuales sobre cualquier parte del trabajo; la nota individual puede diferir de la grupal.

- Uso de IA permitido responsablemente. Se puede usar IA para generar pruebas, scripts o texto, pero el grupo debe entender, ejecutar y poder explicar todo lo entregado.

- Las métricas, capturas y reportes provienen de ejecuciones del propio proyecto.
