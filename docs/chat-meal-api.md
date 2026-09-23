# Chat de comidas con Gemini: `POST /api/chat/meal` (NUT-188 / NUT-190)

El endpoint recibe la conversación del chat y devuelve los alimentos detectados, con su gramaje estimado y sus macros.
- **Stateless:** en cada request hay que mandar el historial completo.
- **No guarda nada** en la base.

## Cómo funciona

1. **Validación (Zod):** si el body es inválido responde 400 sin llamar a Gemini.
2. **Descomposición (Gemini, prompt de NUT-188):** Gemini separa la comida en alimentos individuales y estima los gramos o ml de cada uno.
3. **Búsqueda en SARA2:** cada alimento se busca en el catálogo (`alimentos`, fuente SARA2).
   - Si hay un match obvio (por ejemplo "banana" → `Banana`), se usa directo.
   - Los dudosos, o los que no tienen candidatos, van en **una sola** llamada chica a Gemini. Ahí Gemini elige el id correcto o, si ninguno sirve, estima los valores cada 100 g.
4. **Macros:** se calculan con la misma fórmula que el trigger `calculate_item_nutrients()`: `round(valor_100g × gramos / 100, 2)`.
   - `macroSource: "sara2"` indica que los valores salen del catálogo.
   - `macroSource: "estimado_ia"` indica que los estimó Gemini.

Por request hay como máximo **2 llamadas** a Gemini, más un reintento por llamada si falla.

Archivos: `src/lib/ai/gemini.ts`, `src/lib/chat/*`, `src/app/api/chat/meal/route.ts`.

## Configuración

Variables en `.env.local`. Son solo de servidor: nunca con prefijo `NEXT_PUBLIC_`.

```
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.6-flash   # opcional; es el valor por defecto
```

## Request

```
POST /api/chat/meal
Authorization: Bearer <access_token de Supabase>   (o cookie de sesión de la app)
Content-Type: application/json

{ "messages": [ { "role": "user" | "assistant", "content": "..." } ] }
```

Reglas de validación. Si alguna falla, responde 400 sin gastar tokens:
- entre 1 y 20 mensajes;
- mensajes de usuario no vacíos y de hasta 500 caracteres;
- el último mensaje tiene que ser del usuario.

## Respuesta 200

```json
{
  "status": "complete",
  "assistantMessage": "Te anoté dos tostadas con jamón y queso.",
  "detectedIngredients": [
    {
      "ingredient": "jamón cocido", "type": "carne", "confidence": 0.8,
      "estimatedWeightGrams": 40, "unit": "g", "questionForUser": null,
      "kcal": 42.8, "proteinas_g": 7.36, "grasas_g": 1.32, "carbs_g": 0.4,
      "macroSource": "sara2", "sara2Match": { "id_alimento": 823, "nombre": "Jamón cocido" }
    }
  ],
  "totalEstimatedWeightGrams": 130,
  "totalMacros": { "kcal": 307.2, "proteinas_g": 22.02, "carbs_g": 24.63, "grasas_g": 13.38 }
}
```

Valores de `status`:
- `complete`: ningún ítem tiene preguntas pendientes.
- `needs_clarification`: hay preguntas. Están en `questionForUser` de cada ítem y resumidas en `assistantMessage`. Los macros se calculan igual, sobre la estimación actual.
- `off_topic`: el mensaje no describe comida. Viene con `detectedIngredients` vacío y un mensaje fijo del backend.
- `invalid_input`: texto sin sentido, emojis, "no comí nada" o contenido bloqueado por seguridad. Viene con un mensaje fijo del backend.

Sobre `confidence`:
- `>= 0.85`: alimento y cantidad explícitos.
- entre `0.6` y `0.85`: estimación razonable.
- `< 0.6`: dato incierto; la UI tiene que avisarle al usuario.

## Errores

Formato: `{ "error": { "code": "...", "message": "mensaje en español" } }`

| HTTP | code | Cuándo |
|---|---|---|
| 400 | `BAD_REQUEST` | Body inválido (ver reglas arriba) |
| 401 | `UNAUTHORIZED` | Sin token o sesión, o token vencido (dura 1 h) |
| 429 | `RATE_LIMITED` | Más de 10 requests por minuto del mismo usuario, o Gemini sin cuota |
| 502 | `AI_INVALID_RESPONSE` | Gemini respondió vacío o con JSON inválido dos veces |
| 503 | `AI_UNAVAILABLE` | Timeout (15 s), error 5xx o de red dos veces, o falta `GEMINI_API_KEY` |

## Obtener el `access_token`

Opción A: usuario con email y contraseña. Es lo más simple.

```bash
curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"tu-usuario@ejemplo.com","password":"tu-contraseña"}'
# → copiá el campo "access_token"
```

`SUPABASE_URL` y `SUPABASE_ANON_KEY` son los valores de `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` de tu `.env.local`.

Opción B: usuario de Google, que no tiene contraseña.
1. Iniciá sesión en la app.
2. Abrí DevTools → Application → Cookies y buscá `sb-<proyecto>-auth-token`. Si está partida en `.0` y `.1`, concatenalas.
3. Sacale el prefijo `base64-` y decodificá el resto en base64. Te queda un JSON con `access_token`.

## Ejemplos curl

```bash
TOKEN="pegá-acá-el-access_token"

# Comida completa
curl -s localhost:3000/api/chat/meal -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"200g de arroz con 150g de pollo grillado"}]}'

# Multi-turno: se reenvía todo el historial, incluida la pregunta del asistente
curl -s localhost:3000/api/chat/meal -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"comí empanadas"},{"role":"assistant","content":"¿Cuántas comiste, de qué eran y fueron al horno o fritas?"},{"role":"user","content":"3 de carne al horno"}]}'

# 400 sin gastar tokens
curl -s localhost:3000/api/chat/meal -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"   "}]}'
```

## Paso a paso en Postman

1. Levantá la app con `npm run dev`, con `GEMINI_API_KEY` cargada en `.env.local`.
2. Importá la colección: **Import** → `docs/postman/NutriScan-chat-meal.postman_collection.json`.
3. En la colección, abrí la pestaña **Variables** y completá `supabaseUrl`, `anonKey`, `email` y `password` (o pegá el `accessToken` directamente si usás Google). `baseUrl` ya apunta a `http://localhost:3000`.
4. Mandá las requests en este orden:

| # | Request | Qué esperar |
|---|---|---|
| 0 | Login Supabase | 200 con `access_token`; el test lo guarda solo en `accessToken` |
| 1 | Comida completa | 200, `status: "complete"`, 3 ítems (tostada, jamón, queso) con `macroSource` y `totalMacros` |
| 2a | Ambigua | 200, `status: "needs_clarification"` y `assistantMessage` preguntando relleno y cantidad |
| 2b | Multi-turno | 200, `status: "complete"`, empanada de carne de unos 240 g con `confidence` alta |
| 3 | Off-topic | 200, `status: "off_topic"`, mensaje fijo, sin ítems |
| 4 | Vacío | 400 `BAD_REQUEST` (no gasta cuota) |
| 5 | Último del asistente | 400 `BAD_REQUEST` |
| 6 | Sin token | 401 `UNAUTHORIZED` |

5. Si aparece 401 más tarde, el token venció (dura 1 hora): repetí el paso 0.
6. Si aparece 429 `RATE_LIMITED`, esperá un minuto. Si persiste, se agotó la cuota diaria de Gemini: la terminal de `npm run dev` muestra el detalle en las líneas `[gemini] {... "detail": ...}`.

Cada request que llega a Gemini consume 1 o 2 llamadas de la cuota diaria compartida. Los casos 4, 5 y 6 no consumen cuota.

## Script de pruebas del prompt

```bash
# Corre contra Gemini real y consume cuota (~1,7 llamadas por caso)
npx tsx --env-file=.env.local scripts/test-meal-prompt.ts
npx tsx --env-file=.env.local scripts/test-meal-prompt.ts --only=simple-tostadas,ambiguo-empanadas

# Manejo de errores con un cliente Gemini falso (sin cuota)
npx vitest run testing/chatMeal.test.ts
```
