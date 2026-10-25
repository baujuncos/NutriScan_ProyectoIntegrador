# Evidencia: ejecuciones en GitHub Actions

Datos tomados de la API pública de GitHub (`/repos/baujuncos/NutriScan_ProyectoIntegrador/actions/runs`) el 25/10/2026. Cada fila se puede abrir en `https://github.com/baujuncos/NutriScan_ProyectoIntegrador/actions/runs/<id>`.

## CI (compilación, pruebas, análisis estático, quality gate)

| Corrida | Rama · commit | Resultado | Paso que decidió | Duración |
| --- | --- | --- | --- | --- |
| 40147988808 | `tp-demo-rojo` · `2de9f38` | ❌ rojo | **Compilar (`next build`)**: la versión vulnerable de `/api/send-reminders` crea el cliente admin al importarse y exige `SUPABASE_SERVICE_ROLE_KEY`, que el CI no tenía. Hallazgo del propio pipeline; corregido en `f961aa1` | 59 s |
| 40149003238 | `tp-demo-rojo` · `69359b8` | ❌ **rojo (el buscado)** | **Pruebas unitarias + de integración con cobertura**: 10 aserciones falladas en `testing/sendRemindersRoute.test.ts` (200 en lugar de 401 sin credenciales, emails en la respuesta, detalle interno de la base expuesto, HTML sin escapar en el nombre, formato de respuesta). Compilación ✅ | 2 min 48 s |
| 40149581795 | `tp-calidad` · `f961aa1` | ✅ verde | Todos los pasos, incluido el quality gate | 2 min 10 s |
| 40150057208 | PR `tp-calidad` · `f961aa1` | ✅ verde | idem | 2 min 56 s |
| 40150072946 | `main` · `9fbc7fc` (merge del PR #39) | ✅ verde | idem | 2 min 58 s |

Observación: en la corrida roja el paso *Quality gate* terminó en éxito aunque las pruebas fallaron. El gate evalúa errores de ESLint, duplicación y cobertura, no el resultado de las pruebas; lo que bloquea es el paso de pruebas. Son dos barreras distintas.

## Verificación posterior al despliegue (`deploy-verify.yml`, evento `deployment_status`)

| Corrida | Rama | Resultado | Detalle |
| --- | --- | --- | --- |
| 40149178946, 40148234566 | `tp-demo-rojo` | omitidas | Despliegues de ramas de prueba que no se verifican a propósito |
| 40150281237 | `tp-calidad` | ❌ | Smoke: el despliegue *preview* estaba protegido por Vercel (*Deployment Protection*) y todas las respuestas fueron 401/302 al login de Vercel. Fallo de configuración, no de la app. Se agregó al smoke un chequeo previo que lo diagnostica (`36c1438`) y se documentó el secret `VERCEL_BYPASS_SECRET`. E2E y carga se saltearon por depender del smoke |
| 40150497052 | `main` | ✅ | Smoke test ✅ (8 s) → E2E contra integraciones reales ✅ (33 s) → stress y esfuerzo sostenido con k6 ✅ (15 min 40 s). Los pasos de k6 terminan con código 99 si se cruza un umbral, así que el éxito indica umbrales cumplidos. Cifras detalladas: artefactos de esa corrida |
