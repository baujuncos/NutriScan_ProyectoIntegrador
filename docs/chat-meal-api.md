# Chat de comidas con Gemini: `POST /api/chat/meal` (NUT-188 / NUT-190)

El endpoint recibe la conversación del chat y devuelve los alimentos detectados, con su gramaje estimado y sus macros.
- **Stateless:** en cada request hay que mandar el historial completo.
- **No guarda nada** en la base.

## Cómo funciona

1. **Validación (Zod):** si el body es inválido responde 400 sin llamar a Gemini.
2. **Una sola llamada a Gemini (prompt de NUT-188):** descompone la comida en alimentos individuales y, para cada uno, devuelve el gramaje estimado y **su propia estimación de macros** (respaldo).
3. **Matching contra SARA2, en el backend y sin IA** (`src/lib/chat/sara2Matcher.ts`):
   - Compara el nombre del ingrediente con cada alimento del catálogo, ignorando mayúsculas, tildes, plural y género ("papas" ~ "papa", "blanca" ~ "blanco"). **No hay comparación difusa**: en comida una letra cambia el alimento ("cerveza" ≠ "cereza").
   - Puntaje = coeficiente de Dice sobre palabras: `2 × palabras en común / (palabras del ingrediente + palabras del candidato)`. Penaliza lo que el ingrediente dice y el candidato no, y lo que el candidato agrega.
   - Se acepta solo si el mejor candidato tiene **puntaje ≥ 0,85** y le saca **≥ 0,10** al segundo (salvo que ambos tengan exactamente los mismos valores). Si no, **no hay match**.
4. **Macros:**
   - Match confiable → macros de SARA2 para el gramaje, con la misma fórmula que el trigger `calculate_item_nutrients()`: `round(valor_100g × gramos / 100, 2)`. `macroSource: "sara2"`.
   - Sin match confiable → la estimación que Gemini ya devolvió en la misma respuesta, acotada a lo físicamente posible. `macroSource: "estimado_ia"`.

Cada request hace **una sola llamada** a Gemini (más un reintento si falla). El log del servidor muestra cada decisión de matching: `[sara2-match] {"ingredient":..., "result":"accepted|low_score|ambiguous|no_candidates", "best":..., "second":...}`.

Para ver cómo decide el matcher sin gastar cuota (solo lee SARA2 de Supabase) y ajustar los umbrales:

```bash
npx tsx --env-file=.env.local scripts/preview-sara2-matching.ts "pan blanco" "banana"
npx tsx --env-file=.env.local scripts/preview-sara2-matching.ts --min-score=0.8 --min-margin=0.05
```

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

Cada request que llega a Gemini consume 1 llamada de la cuota diaria compartida (2 si hubo que reintentar). Los casos 4, 5 y 6 no consumen cuota.

## Script de pruebas del prompt

```bash
# Corre contra Gemini real y consume cuota (1 llamada por caso)
npx tsx --env-file=.env.local scripts/test-meal-prompt.ts
npx tsx --env-file=.env.local scripts/test-meal-prompt.ts --only=simple-tostadas,ambiguo-empanadas

# Manejo de errores con un cliente Gemini falso (sin cuota)
npx vitest run testing/chatMeal.test.ts
```

---

# Guardado: `POST /api/chat/meal/confirm` (NUT-191)

Es lo que hace el botón **"Confirmar y guardar registro"**. Guarda **todo en una sola transacción** (función SQL `confirmar_chat_ia_registro`): si algo falla, no queda nada guardado a medias.

| Dónde | Qué se guarda |
|---|---|
| **Diario** (`ingestas` / `items`) | Todos los alimentos confirmados, **excepto el agua**. Los líquidos que no son agua (café, mate, jugo, gaseosa) van acá como cualquier alimento. |
| **Hidratación** (`hidratacion`) | El agua, sumada a los `ml_total` del día. Se considera agua solo si el nombre es: agua, agua mineral, agua con/sin gas, agua de la canilla/red/potable/filtrada o soda. *Agua saborizada*, *agua de coco*, etc. **no** cuentan. |
| **Auditoría** (`chat_ia_registros` / `chat_ia_registros_items`) | Una cabecera por confirmación y una fila por alimento, incluidos los **quitados**: lo que estimó la IA (`*_ia`), lo que quedó (`*_final`), `origin`, `destino`, fuente de macros, confianza y alimento del catálogo. Solo INSERT; el usuario ve lo suyo e investigadores/administradores ven todo. |

**Macros de un ítem sin catálogo (`estimado_ia`):** el trigger `calculate_item_nutrients` los deja en 0 al insertar. La función hace, justo después, un `UPDATE` **solo de kcal/proteínas/grasas/carbs** sobre esa fila recién insertada (por `id_item`). Ese UPDATE no nombra `id_alimento`, `id_alimento_barcode` ni `cantidad`, que son las columnas que disparan el trigger, así que los valores reales quedan guardados. *Ojo:* si después el usuario edita la cantidad de ese ítem desde `/alimentacion`, el trigger vuelve a ponerlo en 0 (ya pasa hoy con los ítems de carga manual).

## Antes de usarlo: aplicar el SQL

Correr `supabase/schema_consolidado.sql` (sección «012 (NUT-191) chat IA») en el SQL Editor de Supabase (es re-ejecutable). Sin eso, el endpoint responde `500 PERSISTENCE_ERROR` y el log del servidor dice `Could not find the function ... confirmar_chat_ia_registro`.

## Request

```json
{
  "requestId": "3f2b8c1e-7d4a-4e0b-9a55-0c1d2e3f4a5b",
  "fecha": "2026-10-08",
  "tipoIngesta": "almuerzo",
  "items": [
    { "ingrediente": "Empanada de carne", "tipo": "otro", "unidad": "g", "origin": "edited",
      "macroSource": "estimado_ia", "idAlimento": null, "confidence": 0.7,
      "gramosIa": 240, "gramosFinal": 120,
      "macrosIa": { "kcal": 600, "proteinas_g": 25.2, "carbs_g": 64.8, "grasas_g": 26.4 } },
    { "ingrediente": "Banana", "tipo": "fruta", "unidad": "g", "origin": "removed",
      "macroSource": "sara2", "idAlimento": 375, "confidence": 0.9,
      "gramosIa": 120, "gramosFinal": null,
      "macrosIa": { "kcal": 110.4, "proteinas_g": 1.44, "carbs_g": 24.48, "grasas_g": 0.24 } },
    { "ingrediente": "Agua", "tipo": "bebida", "unidad": "ml", "origin": "ai",
      "macroSource": "estimado_ia", "idAlimento": null, "confidence": 0.9,
      "gramosIa": 250, "gramosFinal": 250,
      "macrosIa": { "kcal": 0, "proteinas_g": 0, "carbs_g": 0, "grasas_g": 0 } }
  ]
}
```

- `tipoIngesta`: `desayuno | almuerzo | merienda | cena | colacion | suplemento` (el mismo enum que `ingestas.tipo`). `fecha`: de hoy hasta 7 días atrás.
- `origin`: `ai` (sin tocar, `gramosFinal` = `gramosIa`) · `edited` (cambió la cantidad) · `removed` (`gramosFinal` = `null`) · `added_manually` (sin datos de IA).
- `requestId` se genera **una vez por confirmación**. Reintentar con el mismo id no duplica nada (`yaGuardado: true`).
- Los macros finales **los recalcula el servidor**: los de SARA2 con el catálogo (misma fórmula que el trigger) y los `estimado_ia` escalando proporcionalmente `macrosIa`. Lo que mande el cliente como "final" no se usa.

## Respuesta

`200` → `{ "ok": true, "idRegistro": 7, "idIngesta": 3, "itemsDiario": 1, "mlAgua": 250, "yaGuardado": false }`

Errores (`{ "error": { "code", "message" } }`): `400 BAD_REQUEST` (payload inválido, fecha fuera de rango, ítem > 2000), `401 UNAUTHORIZED`, `500 PERSISTENCE_ERROR`.

## Probarlo de punta a punta

El chat de la app **siempre usa Gemini** (no hay variable para cambiarlo), así que cada mensaje gasta cuota. Para verificar el guardado sin gastar nada de Gemini, mandá la request **7. Guardar registro (confirm)** de la colección de Postman: no llama a Gemini y arma el mismo guardado que hace el botón.

1. Aplicá `supabase/schema_consolidado.sql` (sección «012 (NUT-191) chat IA»).
2. Para probar con la interfaz: `npm run dev`, en `/alimentacion` (elegí fecha y comida) → **Registrar por chat** → por ejemplo "comí empanadas" y, al preguntar, "3 de carne al horno" (2 llamadas a Gemini).
3. Probá: **Editar** una cantidad, **Quitar** un ítem, **Confirmar y guardar registro**. (La request 7 de Postman equivale a editar la empanada a 120 g, quitar la banana y dejar el agua: Empanada de carne `estimado_ia`, Banana de SARA2 y Agua 250 ml.)
5. Verificá en el SQL Editor (reemplazá el uuid por el de tu usuario, en Authentication → Users):

```sql
-- Diario: la empanada (id_alimento nulo) debe tener kcal = 300 (no 0). La banana no debe estar. El agua tampoco.
select i.fecha, i.tipo, i.kcal_total, it.nombre_manual, it.id_alimento, it.cantidad, it.kcal, it.proteinas_g, it.grasas_g, it.carbs_g
from public.ingestas i join public.items it using (id_ingesta)
where i.id_usuario = 'TU-UUID' order by it.id_item desc limit 5;

-- Hidratación: ml_total del día debe haber subido 250.
select * from public.hidratacion where id_usuario = 'TU-UUID' order by fecha desc limit 3;

-- Auditoría: cabecera + 3 filas (edited / removed / ai) con lo de la IA y lo final.
select * from public.chat_ia_registros where id_usuario = 'TU-UUID' order by id_registro desc limit 1;
select ingrediente, origin, destino, gramos_ia, gramos_final, kcal_ia, kcal_final, macro_source, id_alimento
from public.chat_ia_registros_items
where id_registro = (select max(id_registro) from public.chat_ia_registros where id_usuario = 'TU-UUID');
```

Para confirmar el comportamiento del trigger en tu base (la versión vigente debe ser `before insert or update of id_alimento, id_alimento_barcode, cantidad`):

```sql
select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.items'::regclass and not tgisinternal;
```
