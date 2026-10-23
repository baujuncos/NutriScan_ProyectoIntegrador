# Pruebas de carga: stress y esfuerzo sostenido

Herramienta: **k6 v2.3.0** ([por qué k6](herramienta-k6.md)). Scripts: [`load/common.js`](../load/common.js), [`load/stress.js`](../load/stress.js), [`load/soak.js`](../load/soak.js). Runner e informe: [`scripts/load/`](../scripts/load/). Resultados crudos (JSON de k6): [`docs/evidencia/carga/`](evidencia/carga/).

## Cómo ejecutar

```bash
# 1) Tener k6 (https://grafana.com/docs/k6/latest/set-up/install-k6/) o apuntar K6_BIN al ejecutable
# 2) Contra un despliegue o contra la app local (npm run build && npm start)
BASE_URL=https://mi-app.vercel.app npm run load:stress       # rampa hasta el pico
BASE_URL=https://mi-app.vercel.app npm run load:soak         # carga constante
# Parámetros: STRESS_PEAK (100), STRESS_STEP (1m), SOAK_VUS (20), SOAK_DURATION (10m)
```

Cada corrida escribe `reports/load/<escenario>-summary.json` y **`reports/load/informe-carga.md`** (lo genera `scripts/load/report.mjs` leyendo únicamente el JSON de k6). El código de salida es el de k6: **99 si algún umbral se cruzó**, y el job del pipeline falla.

## Qué se carga (y qué no)

Mezcla de tráfico por usuario virtual (VU), con 0,3–1,0 s de "tiempo de lectura" entre pedidos:

| % | Pedido | Qué ejercita | Respuesta esperada |
| --- | --- | --- | --- |
| 50 | `GET /login` | Renderizado del servidor de la pantalla de entrada | 200 |
| 10 | `GET /manifest.webmanifest` | Manifiesto PWA | 200 |
| 20 | `GET /home` sin sesión | El `proxy` (middleware) y la redirección | 3xx a `/login` |
| 20 | `POST /api/chat/meal` sin token | Ruta de API + autenticación | 401 |

**No se carga** el flujo con Gemini ni escrituras en la base: consumiría cuota y costo de un tercero y ensuciaría datos reales. Esa capacidad está limitada por Gemini (10 pedidos/min por usuario) y se verifica funcionalmente en el E2E. Los 401 y las redirecciones son respuestas **esperadas**: solo los 5xx y los timeouts cuentan como error (`http.expectedStatuses`).

## Umbrales y de dónde salen

| Métrica | Stress | Sostenido | Fundamento |
| --- | --- | --- | --- |
| Tasa de error (5xx/timeouts) | < 5 % | < 1 % | En stress se tolera algo de degradación; en uso normal no |
| Latencia p95 (global y por endpoint) | < 2000 ms | < 1000 ms | 1–2 s es el límite en que el usuario percibe que "la página tarda" |
| Latencia p99 | < 5000 ms | < 2500 ms | Cola de los peores casos |
| Checks (la respuesta es la esperada) | > 95 % | > 99 % | Que no solo responda, sino que responda lo correcto |
| Degradación en el tiempo | — | último cuarto ≤ 1,5× el primero (alerta en el informe) | Detecta pérdidas de recursos |

## Entorno de las corridas documentadas

| | |
| --- | --- |
| Fecha | 23/10/2026 |
| Destino | App compilada en producción (`next build` + `next start`, **una sola instancia de Node**) en `localhost:3100` |
| Máquina | Notebook AMD Ryzen 7 3700U (8 hilos), 24 GB, Windows 11 — **k6 y el servidor compartían la máquina** |
| Versiones | k6 2.3.0, Next 16.4.3, Node 24 |
| Qué representa | La capacidad de **una instancia** y los límites del código. **No** es la capacidad de Vercel (serverless, escala horizontalmente, con CDN): esa se mide con el pipeline de verificación de despliegue (`deploy-verify.yml`) contra la URL real, y sus números se agregan al informe cuando se ejecute |

## Resultados

### Stress 1 — pico de 100 usuarios (escalones de 45 s, 4 min 15 s) — **umbrales cumplidos**

| Métrica | Valor |
| --- | --- |
| Solicitudes | 16 771 (65,7/s) |
| Latencia promedio | 110,7 ms |
| p90 / p95 / p99 / máx | 322,0 / 463,4 / 796,9 / 1113,3 ms |
| Error (5xx, timeouts) | 0,00 % |
| Checks correctos | 100,00 % |

| Endpoint | p95 | p99 | máx |
| --- | --- | --- | --- |
| `home_sin_sesion` | 130,5 ms | 204,9 ms | 292,2 ms |
| `chat_sin_token` | 139,8 ms | 217,8 ms | 308,5 ms |
| `manifest` | 135,5 ms | 208,6 ms | 274,1 ms |
| `login` | 611,7 ms | 856,3 ms | 1113,3 ms |

### Stress 2 — pico de 300 usuarios (escalones de 40 s, 3 min 50 s) — **umbrales NO cumplidos (esperado: busca el límite)**

| Métrica | Valor |
| --- | --- |
| Solicitudes | 23 086 (100,1/s) |
| Latencia promedio | 851,3 ms |
| p90 / p95 / p99 / máx | 2617,7 / **2847,9** / 3121,7 / 3516,7 ms |
| Error (5xx, timeouts) | 0,00 % |
| Checks correctos | 100,00 % |

| Endpoint | p95 | Umbral (2000 ms) |
| --- | --- | --- |
| `home_sin_sesion` | 667 ms | ✅ |
| `chat_sin_token` | 677 ms | ✅ |
| `manifest` | 679 ms | ✅ |
| `login` | **2989 ms** | ❌ |
| global | **2848 ms** | ❌ |

### Esfuerzo sostenido — 20 usuarios durante 10 minutos — **umbrales cumplidos**

| Métrica | Valor |
| --- | --- |
| Solicitudes | 18 107 (30,1/s) |
| Latencia promedio | 9,7 ms |
| p90 / p95 / p99 / máx | 19,1 / 26,6 / 50,6 / 161,5 ms |
| Error | 0,00 % |
| Checks correctos | 100,00 % |
| **Degradación** | p95 del primer cuarto 41,5 ms → p95 del último cuarto 14,4 ms (×0,35): **sin degradación** (el primer cuarto incluye el calentamiento del servidor) |

## Interpretación

1. **Con 100 usuarios simultáneos** la instancia cumple todos los umbrales con holgura (p95 global 463 ms). Con la carga esperada del proyecto (decenas de deportistas) el margen es amplio.
2. **El límite de una instancia está entre 100 y 300 usuarios simultáneos** para esta mezcla: el promedio de la corrida llegó a ~100 pedidos/s (contra 65,7 con 100 usuarios) pero con 3× los usuarios, es decir que el servidor ya no acompaña el aumento: el exceso no genera errores sino **cola**; la latencia crece (p95 2,8 s) pero todas las respuestas siguen siendo correctas. Es una degradación gradual (buena señal: no hay caídas ni 5xx), típica de saturación de CPU de un solo proceso.
3. **El cuello de botella es el renderizado de `/login`** (≈ 4,5× más lento que cualquier otro pedido en el pico): es una página dinámica que se renderiza en el servidor en cada visita. Mejora propuesta (no implementada): que la parte estática de la pantalla no pase por el render dinámico, o cachearla en el borde. En Vercel este costo se reparte entre instancias.
4. **La API rechaza rápido:** `chat_sin_token` y `home_sin_sesion` se mantienen en ~670 ms de p95 aun en el pico, lo que importa porque los intentos no autenticados no deberían poder tumbar el servicio.
5. **Esfuerzo sostenido:** 10 minutos a carga normal sin errores y sin crecimiento de latencia (no hay señales de pérdida de memoria en ese lapso). 10 minutos es el tiempo de la demostración; para detectar fugas lentas conviene correrlo más tiempo (`SOAK_DURATION=30m`), y el workflow acepta ese parámetro.

## Limitaciones honestas

- Las corridas locales comparten CPU con k6: subestiman la capacidad real del servidor.
- Se carga un subconjunto de la aplicación (sin Gemini ni escrituras), a propósito.
- Falta la corrida contra la URL de Vercel desde GitHub Actions: se ejecutará con `deploy-verify.yml` cuando el workflow esté en la rama principal y se carguen los secrets; sus números reemplazan o complementan a estos en el informe.
