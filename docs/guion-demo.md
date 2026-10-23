# Guion de la demostración

Objetivo (lo que pide el TP): mostrar **un despliegue nuevo** con sus **integraciones**, **pruebas** y **cargas**, y que todo se ejecuta solo. Duración estimada: **15–20 minutos**.

## 0. Preparación (hacer el día anterior)

| # | Tarea | Cómo verificar |
| --- | --- | --- |
| 1 | Cargar los secrets de GitHub y `CRON_SECRET` en Vercel ([SETUP_SECRETS.md](SETUP_SECRETS.md)) | Settings → Secrets muestra los nombres |
| 2 | Ejecutar en Supabase la sentencia de DEF-009 **o** dejarla pendiente para mostrarla en vivo (ver paso 7) | `npm run test:e2e` |
| 3 | Mergear `tp-calidad` a la rama principal (los workflows de `deployment_status` y *Run workflow* solo se activan desde ahí) | Pestaña Actions lista "CI" y "Verificar despliegue" |
| 4 | Haber corrido el pipeline al menos una vez en verde y tener **una corrida roja** que detectó un problema real (push del commit de test rojo de DEF-002, `c220b12`, antes del fix) | Historial de Actions |
| 5 | Tener k6 instalado o `K6_BIN` configurado; Node 24; `npm ci` hecho | `k6 version`, `node -v` |
| 6 | Pestañas abiertas: Actions, Vercel, Supabase, VS Code con `docs/` | — |
| 7 | **Plan B** sin internet: la evidencia ya generada está en `docs/evidencia/` (rojo/verde, smoke, E2E, carga) | — |

## 1. Presentación (2 min)

- Una frase: "NutriScan: app de nutrición deportiva con IA; nivel 3 declarado".
- Mostrar `docs/plan-de-pruebas.md`: matriz ISO 25010 (top 3: seguridad, adecuación funcional, fiabilidad) y tabla de riesgos.
- Mostrar el mapa del pipeline: [integracion-externa.md §6](integracion-externa.md).

## 2. Las pruebas, en vivo y rápido (3 min)

```bash
npm run test:unit -- testing/proxy.test.ts testing/sendRemindersRoute.test.ts   # segundos
npm run qa:gate                                                                   # imprime el quality gate con los reportes ya generados
```

Mostrar el resumen del gate (errores de ESLint 0, duplicación, cobertura global y de código nuevo). La suite completa (`npm run test:coverage`) tarda unos 3–5 minutos: **no correrla en vivo**; mostrar su resultado en la última ejecución del CI.

## 3. El pipeline de CI (2 min)

1. En Actions, abrir la ejecución **roja** (commit `test(def-002): ROJO`): "el pipeline detectó un problema real: el endpoint del cron respondía 200 sin autenticación". Mostrar el paso que falló y el mensaje `expected 200 to be 401`.
2. Abrir la siguiente ejecución **verde** (commit del fix): mostrar el resumen con la tabla del quality gate y descargar el artefacto `reportes-calidad-*` (cobertura HTML, ESLint, jscpd).

## 4. Despliegue nuevo con verificación automática (5 min) — el punto central

1. Hacer un cambio trivial visible (p. ej. un texto de la pantalla de login) y mergear el PR → **Vercel despliega solo**.
2. Ir a Actions → **Verificar despliegue**: se disparó por `deployment_status`. Seguir en vivo:
   - **Smoke** (segundos): login, manifiesto, redirección del proxy, API sin credenciales, `send-reminders` protegido, Supabase Auth y catálogo.
   - **E2E**: Gemini real, RLS de Supabase, flujo completo (login → chat con IA → guardar en el diario → limpieza), Open Food Facts.
   - **Carga** (k6): stress y sostenido; el resumen del job muestra el informe.
3. Alternativa si el evento no llega: *Run workflow* con la URL del despliegue (`base_url`) y `soak_duration=2m` para acortar.

## 5. Mostrar los reportes (2 min)

- Resumen del job → tablas de smoke, E2E y carga; artefactos `smoke`, `e2e`, `carga`.
- [pruebas-de-carga.md](pruebas-de-carga.md): umbrales, p95, qué pasó a 100 y a 300 usuarios.

## 6. Contraste rojo → verde (2 min)

```bash
git show c220b12 --stat      # commit del test rojo de DEF-002
git show da001fb --stat      # commit del fix
```

Mostrar `docs/evidencia/def002-rojo.txt` (10 tests fallan) y `def002-verde.txt` (23 pasan).

## 7. El E2E encontró un defecto real en producción (DEF-009) (2 min)

1. Si todavía no se aplicó el fix: correr `npm run test:e2e` → un test en rojo: *"RLS: sin sesión NO se pueden leer perfiles"*. Explicar: "ninguna prueba con mocks lo habría visto".
2. En Supabase → SQL Editor ejecutar `drop policy if exists "public read for reminders" on public.profiles;`.
3. Repetir `npm run test:e2e` → ahora verde.

## 8. Cierre (1 min)

- [defectos.md](defectos.md): 19 defectos registrados, todos con caso de prueba; formato listo para Jira (`defectos.csv`).
- Métricas antes/después: [metricas.md](metricas.md) (cobertura real 70 % → más de 80 %, errores de ESLint 35 → 0, vulnerabilidades críticas 1 → 0).
- Reconocer lo que queda abierto: DEF-004 (decisión del equipo) y, si no se aplicó, DEF-009.

## Plan B si algo falla en vivo

| Falla | Qué hacer |
| --- | --- |
| No llega el evento de Vercel | *Run workflow* con la URL |
| Gemini sin cuota (429) | El E2E del chat lo informa; mostrar `docs/evidencia/e2e-local.txt` y explicar el plan de contingencia ([plan-de-pruebas.md §9](plan-de-pruebas.md)) |
| Sin internet | Mostrar `docs/evidencia/` y correr local: `npm run build && npm start`, luego `BASE_URL=http://localhost:3000 npm run smoke` |
| La carga tarda | Correr con `STRESS_STEP=15s SOAK_DURATION=1m` |

## Comandos de respaldo (todos locales)

```bash
npm ci
npm test                                   # suite completa, sin red
npm run test:coverage                      # con cobertura -> coverage/index.html
npm run qa                                 # lint + tipos + cobertura + análisis + gate
npm run build && npm start                 # app local en :3000
BASE_URL=http://localhost:3000 npm run smoke
npm run test:e2e                           # integraciones reales (necesita .env.local)
K6_BIN=<ruta a k6> BASE_URL=http://localhost:3000 STRESS_STEP=20s npm run load:stress
K6_BIN=<ruta a k6> BASE_URL=http://localhost:3000 SOAK_DURATION=2m npm run load:soak
```
