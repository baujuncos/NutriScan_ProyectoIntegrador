# Informe de pruebas de carga

Generado: 2026-10-23T23:25:44.674Z · k6.exe v2.3.0 (commit/e088784614, go1.26.8, windows/amd64)

## Prueba de stress — ❌ umbrales NO cumplidos

Duración real: 231 s · VUs máximos: 300 · destino: `http://localhost:3100`

| Métrica | Valor |
| --- | --- |
| Solicitudes totales | 23086 (100.1/s) |
| Latencia promedio | 851.3 ms |
| Latencia p90 / p95 / p99 | 2617.7 ms / 2847.9 ms / 3121.7 ms |
| Latencia máxima | 3516.7 ms |
| Tasa de error (5xx, timeouts) | 0.00 % |
| Checks correctos | 100.00 % |

**Umbrales**

| Métrica | Condición | Resultado |
| --- | --- | --- |
| `checks` | `rate>0.95` | ✅ |
| `http_req_failed` | `rate<0.05` | ✅ |
| `http_req_duration{endpoint:home_sin_sesion}` | `p(95)<2000` | ✅ |
| `http_req_duration{endpoint:chat_sin_token}` | `p(95)<2000` | ✅ |
| `http_req_duration` | `p(95)<2000` | ❌ |
| `http_req_duration` | `p(99)<5000` | ✅ |
| `http_req_duration{endpoint:login}` | `p(95)<2000` | ❌ |
| `http_req_duration{endpoint:manifest}` | `p(95)<2000` | ✅ |

**Latencia por endpoint**

| Endpoint | p95 | p99 | máx |
| --- | --- | --- | --- |
| home_sin_sesion | 666.8 ms | 757.5 ms | 1014.2 ms |
| chat_sin_token | 677.0 ms | 800.9 ms | 951.8 ms |
| login | 2988.6 ms | 3220.0 ms | 3516.7 ms |
| manifest | 679.0 ms | 756.8 ms | 855.5 ms |

## Prueba de esfuerzo sostenido — ✅ umbrales cumplidos

Duración real: 601 s · VUs máximos: 20 · destino: `http://localhost:3100`

| Métrica | Valor |
| --- | --- |
| Solicitudes totales | 18107 (30.1/s) |
| Latencia promedio | 9.7 ms |
| Latencia p90 / p95 / p99 | 19.1 ms / 26.6 ms / 50.6 ms |
| Latencia máxima | 161.5 ms |
| Tasa de error (5xx, timeouts) | 0.00 % |
| Checks correctos | 100.00 % |

**Umbrales**

| Métrica | Condición | Resultado |
| --- | --- | --- |
| `http_req_failed` | `rate<0.01` | ✅ |
| `http_req_duration{endpoint:manifest}` | `p(95)<1000` | ✅ |
| `http_req_duration{endpoint:login}` | `p(95)<1000` | ✅ |
| `http_req_duration` | `p(95)<1000` | ✅ |
| `http_req_duration` | `p(99)<2500` | ✅ |
| `http_req_duration{endpoint:chat_sin_token}` | `p(95)<1000` | ✅ |
| `http_req_duration{endpoint:home_sin_sesion}` | `p(95)<1000` | ✅ |
| `checks` | `rate>0.99` | ✅ |

**Latencia por endpoint**

| Endpoint | p95 | p99 | máx |
| --- | --- | --- | --- |
| manifest | 11.2 ms | 21.1 ms | 121.2 ms |
| login | 34.6 ms | 59.9 ms | 161.5 ms |
| chat_sin_token | 14.5 ms | 29.2 ms | 113.2 ms |
| home_sin_sesion | 9.2 ms | 19.7 ms | 123.4 ms |

**Degradación en el tiempo:** p95 del primer cuarto 41.5 ms → p95 del último cuarto 14.4 ms (×0.35) — ✅ sin degradación significativa (≤ 1,5×)
