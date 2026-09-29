# Contrato de detección por IA (épica NUT-119)

## Alcance y no-objetivos

- Una sola llamada a Gemini por foto. No hay una segunda llamada de refinamiento cuando el usuario responde una pregunta aclaratoria — eso se aplica del lado del cliente y se manda todo junto al guardar (`SaveRequest`).
- Sin datos nutricionales (kcal/macros) en ningún endpoint ni tabla de esta épica. Los gramos sí viajan (son un dato físico, no nutricional).
- Ningún endpoint de esta épica escribe en el diario real (`ingestas`/`items`). El punto de integración futuro está documentado como TODO en `src/app/api/food-recognition/save/route.ts` (`registrarEnDiario`).
- No se guarda la foto del plato (fotos de participantes de una investigación). `detecciones_ia.imagen_url` queda nullable y sin poblar.

## Endpoints

### `POST /api/food-recognition`

Requiere sesión (cookie de Supabase). `multipart/form-data`:

| Campo | Tipo | Descripción |
|---|---|---|
| `image` | File | Foto ya recortada por el cliente (NUT-165) |
| `vajilla` | JSON string | `{ tipo: 'plato_playo'\|'plato_postre'\|'plato_hondo', diametroCm: number }` |
| `angulo` | JSON string | `{ beta: number\|null, estado: EstadoAngulo, dentroDeRango: boolean }` |

Respuesta 200 — `{ ok: true, ...DetectionResponse }` (ver `src/lib/deteccion.ts`). Persiste la predicción original en `detecciones_ia`/`detecciones_ia_items` y devuelve `predictionId`.

### `POST /api/food-recognition/save`

Requiere sesión. JSON body: `SaveRequest` (ver `src/lib/deteccion.ts`). Verifica que `predictionId` exista y pertenezca al usuario logueado, persiste el guardado en `detecciones_guardados`/`detecciones_guardados_items`. Respuesta 200 — `{ ok: true, savedId: string }` (forma provisional, no forma parte del contrato fijo).

## Códigos de error

Todos los endpoints devuelven `{ error: string, message: string, field?: string }` con el status HTTP correspondiente.

| Código | Status | Cuándo |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Sin sesión |
| `INVALID` | 400 | Body/campo inválido |
| `IMAGE_REQUIRED` / `IMAGE_TOO_LARGE` / `IMAGE_INVALID_TYPE` | 400 | Problema con la foto |
| `NOT_FOUND` | 404 | `predictionId` inexistente (sólo `/save`) |
| `FORBIDDEN` | 403 | `predictionId` de otro usuario (sólo `/save`) |
| `SERVER_CONFIG` | 500 | Falta `GEMINI_API_KEY` |
| `GEMINI_TIMEOUT` / `GEMINI_RATE_LIMIT` / `GEMINI_UNAVAILABLE` / `GEMINI_INVALID_RESPONSE` / `GEMINI_ERROR` | 502 | Fallos de la llamada a Gemini (ver `src/lib/geminiClient.ts`) |
| `PERSISTENCE_ERROR` | 502 | Falló el insert en Supabase |

## Tipos

`src/lib/deteccion.ts` es la única fuente de verdad de los tipos del contrato (`DetectedItem`, `DetectionResponse`, `ClarifyingQuestion`, `SaveRequest`, `FinalItem`, etc.) — no se duplican acá para evitar que se desincronicen.

## `PROMPT_VERSION`

`src/lib/deteccion.ts` exporta `PROMPT_VERSION`, persistido en `detecciones_ia.prompt_version`. Bumpear manualmente cuando cambie la semántica del prompt (qué se pregunta, cómo se pondera) — no por ajustes de redacción.
