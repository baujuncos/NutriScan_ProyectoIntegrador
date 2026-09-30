# Refactor del escáner de código de barras (v2)

Branch: `fix-barcode-scanning-flow`

Este spec extiende el módulo entregado en `docs/superpowers/specs/2026-09-28-barcode-scanning-flow-design.md` (branch `feat-barcode-scanning-flow`, ya mergeada). No repite lo que no cambia (servicio base, tabla `alimentos_barcode`, `addScannedItemAction`, trigger de macros); documenta solo lo que se agrega o se modifica.

## 1. Decisiones que reemplazan al spec anterior

Estas tres reemplazan explícitamente decisiones tomadas en el spec de la v1, a pedido del usuario:

1. **Entrada manual permitida como escape hatch.** La v1 prohibía estrictamente que el usuario tipeara números. Esta versión agrega un input numérico, pero solo detrás de un botón "Personalizar" — los botones fijos siguen siendo la vía principal.
2. **Campos de Open Food Facts ampliados van a `alimentos_barcode`, no a `alimentos`.** `alimentos` es el catálogo SARA2/ANMAT; mezclar ahí columnas que solo aplican a productos escaneados dejaría esas columnas siempre `null` para el resto del catálogo.
3. **Sigue sin existir `onConfirmarAlimento`.** El flujo persiste directo vía `addScannedItemAction` y cierra el modal (ver v1 §4); no se reintroduce el callback.

## 2. Captura — diferenciación de dispositivo + recorte manual

### 2.1 Desktop vs. móvil

- **Desktop** (`!esTactil()`): la pestaña "Usar cámara" no se renderiza. Solo existe la vista de subir/arrastrar imagen. Hoy la pestaña existe pero no es la default; pasa a no existir en absoluto.
- **Móvil** (`esTactil()`): se mantienen las dos pestañas. El `<input type="file">` de la pestaña "Subir imagen" pierde el atributo `capture="environment"` (hoy lo tiene) — sin ese atributo, el selector de archivos del sistema ofrece la fototeca en vez de abrir la cámara nativa directamente.

### 2.2 Paso de recorte manual (nuevo stage `cropping`)

Se dispara para **toda** imagen que entra por archivo (subida o drag & drop), nunca para la cámara en vivo (esa ya decodifica en tiempo real desde el stream).

Reutiliza `src/lib/recorteFoto.ts` tal cual existe — `calcularRecorte({imgW, imgH, viewW, viewH, zoom, panX, panY}): Recorte` y `recortarImagen(file, recorte): Promise<File>` — sin modificarlo. Es el mismo mecanismo que ya usa `AIRecognitionModal` para el encuadre de fotos de comida (pan + zoom de la imagen debajo de una guía fija, recorte a canvas al confirmar). Cambia únicamente la guía visual: un rectángulo ancho (proporción ~2.5:1) en vez de la elipse de plato, dibujado inline como un `<svg>` chico dentro de `BarcodeScannerModal.tsx` (no amerita un componente aparte, se usa una sola vez).

Flujo: elegir/soltar archivo → `pendingFile` se guarda, `stage = 'cropping'` → usuario ajusta zoom (slider 1–3, igual que `AIRecognitionModal`) y arrastra la imagen bajo la guía → botón **`[ Procesar Código ]`** → `calcularRecorte` + `recortarImagen(pendingFile, recorte)` → el archivo recortado se pasa a `Html5Qrcode.scanFileV2(...)`. Si no decodifica, se muestra un error inline y se **permanece en `cropping`** (el usuario puede reencuadrar y reintentar) en vez de volver a `source`.

## 3. Servicio — `src/lib/openFoodFacts.ts`

### 3.1 Redondeo a 1 decimal

Nuevo helper `redondear1(n: number): number` (`Math.round(n * 10) / 10`), aplicado a los 4 macros antes de devolverlos. No cambia el redondeo a 2 decimales que ya usa la base de datos (`toFixed2` en `nutrition.ts`) — ese es el estándar de toda la app, no algo específico de este módulo. El punto de este cambio es que `nutrientes100g` (y por lo tanto lo que se ve en pantalla) ya venga limpio; `AlimentacionClient` ya muestra macros con `.toFixed(1)` en otras partes de la UI, así que esto alinea el servicio con un estilo que ya existe.

### 3.2 Tipo `ProductoEncontrado` extendido

```ts
export interface ProductoEncontrado {
  // ...campos existentes sin cambios (encontrado, ean, nombre, categoria, marca, porcion, nutrientes100g, imagenUrl)
  esSuplemento: boolean;
  porcionEtiqueta: string | null;   // texto crudo de OFF, ej. "2.5 galletitas (30g)"
  pesoNetoTotal: number | null;     // gramos del envase completo; null si no se pudo parsear
  infoAmpliada: {
    nutriscore: 'a' | 'b' | 'c' | 'd' | 'e' | null;
    novaGroup: 1 | 2 | 3 | 4 | null;
    sinGluten: boolean;
    vegano: boolean;
    vegetariano: boolean;
  };
}
```

`ProductoNoEncontrado` no cambia.

### 3.3 Extracción de los campos nuevos

- **`esSuplemento`:** normaliza `nombre + ' ' + categoria + ' ' + (marca ?? '')` (minúsculas, sin acentos vía `.normalize('NFD').replace(/[̀-ͯ]/g, '')`) y busca alguna de estas 5 palabras clave (las que pidió el usuario, sin ampliar la lista): `suplemento`, `supplement`, `proteina`, `creatina`, `multivitaminico`.
- **`porcionEtiqueta`:** `product.serving_size` (string) si viene y no está vacío; si no, `null`. Es un campo de OFF distinto de `serving_quantity` (que ya alimenta `porcion`).
- **`pesoNetoTotal`:** intenta `product.product_quantity` primero (numérico o string numérico en gramos); si no sirve, hace regex sobre `product.quantity` (ej. `"150 g"`, `"1.5 kg"`, `"500 ml"`) tomando el primer número + unidad, convirtiendo `kg`→×1000 y `l`→×1000 (se asume densidad ≈ 1 para líquidos, aproximación documentada, no exacta). Si nada de esto da un número > 0, `pesoNetoTotal = null`.
- **`infoAmpliada`:** `nutriscore` = `product.nutriscore_grade` si es una letra `a`–`e` (si no, `null`). `novaGroup` = `product.nova_group` si es 1–4 (si no, `null`). `sinGluten`/`vegano`/`vegetariano` = presencia de `en:gluten-free`/`en:no-gluten`, `en:vegan`, `en:vegetarian` en `product.labels_tags` (array de strings; vegano implica vegetariano).

Estos campos nuevos **no participan** del chequeo de "ficha vacía" (§3 del spec v1, "los 4 macros ausentes ⇒ no encontrado") — ese chequeo sigue siendo solo sobre los 4 macros.

## 4. Schema — nueva sección en `alimentos_barcode`

Nueva sección al final de `supabase/schema_consolidado.sql` (numerada `012`: `010` es este módulo, `011` está reservado por un rename pendiente de otra rama — detección de alimentos por IA — que no se toca):

```sql
-- ============================================================
-- 012 — Info ampliada de Open Food Facts en alimentos_barcode
-- ============================================================

ALTER TABLE public.alimentos_barcode
  ADD COLUMN IF NOT EXISTS nutriscore_grade text CHECK (nutriscore_grade IN ('a','b','c','d','e')),
  ADD COLUMN IF NOT EXISTS nova_group smallint CHECK (nova_group BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS is_gluten_free boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_vegan boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_vegetarian boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS serving_quantity_label text;
```

`addScannedItemAction` agrega estos 6 campos al `upsert(...)` existente contra `alimentos_barcode` (mismo cliente admin, mismo trust boundary — sin cambios de seguridad). `pesoNetoTotal` **no se persiste**: solo se usa en el momento de elegir la porción/paquete (§5), no hace falta recuperarlo después.

## 5. Step 3 rediseñado — modo de consumo

Reemplaza la pantalla única de 6 botones fijos (v1) por dos pantallas nuevas.

### 5.1 Máquina de estados

```ts
type Stage =
  | 'source'
  | 'cropping'
  | 'fetching'
  | 'confirm'
  | 'discarded'
  | 'mode'      // nuevo: "¿Cómo deseas registrar tu ingesta?"
  | 'paquete'   // nuevo: fracción del envase completo
  | 'porcion';  // reemplaza al viejo stage 'portion'
```

Botón `[ ← Volver ]` visible arriba a la izquierda en todas las pantallas **excepto** `source` y `fetching` (esta última es una consulta automática de ~1 request, sin interacción posible mientras corre — mismo criterio que ya usa `AIRecognitionModal` para su etapa `recognizing`). Mapa de destino fijo, sin pila de historial (el grafo es lineal salvo la única bifurcación en `mode`):

```ts
const BACK_TARGET: Partial<Record<Stage, Stage>> = {
  cropping: 'source',
  confirm: 'source',
  discarded: 'source',
  mode: 'confirm',
  paquete: 'mode',
  porcion: 'mode',
};
```

### 5.2 Pantalla `confirm` — cambios

- Los 4 valores de `nutrientes100g` se muestran con `.toFixed(1)`.
- Caption fija debajo de la tarjeta: *"Valores expresados cada 100g / 100ml."*
- Si `producto.porcionEtiqueta` existe, línea secundaria: *"Porción sugerida en envoltorio: {porcionEtiqueta}"*.
- Si `producto.esSuplemento`, aviso inline: *"Detectamos que es un suplemento — se va a guardar en Suplementos."* (ver §5.5).
- Nuevo botón/toggle **"Ampliar información del producto"**: expande un bloque inline (no un modal anidado) con:
  - Badge de Nutri-Score (si `infoAmpliada.nutriscore` no es `null`), colores oficiales aproximados: a `#038141`, b `#85BB2F`, c `#FECB02`, d `#EE8100`, e `#E63E11`.
  - Grupo NOVA (si no es `null`): número + descripción corta (`1`: "Sin procesar o mínimamente procesado", `2`: "Ingrediente culinario procesado", `3`: "Procesado", `4`: "Ultraprocesado").
  - Chips "Sin Gluten"/"Vegano"/"Vegetariano" — solo los que sean `true`.
  - Si ninguno de los tres bloques tiene datos, el toggle igual aparece pero el contenido dice "Open Food Facts no tiene esta información para este producto." (no se oculta el botón — sería inconsistente que a veces exista y a veces no).
- `[Sí, es correcto]` ahora navega a `mode` (antes iba directo a la pantalla de porciones).

### 5.3 Pantalla `mode`

Pregunta *"¿Cómo deseas registrar tu ingesta?"* con dos tarjetas grandes: **"Por Paquete Completo"** → `stage = 'paquete'`; **"Por Porción del Fabricante"** → `stage = 'porcion'`.

### 5.4 Pantalla `paquete`

Botones fijos — fracción × `producto.pesoNetoTotal`:

| Botón | Fracción |
|---|---|
| Entero (1 envase) | 1 |
| Mitad (1/2) | 0.5 |
| Un cuarto (1/4) | 0.25 |
| Un quinto (1/5) | 0.2 |

Cada uno es `<button type="submit" name="cantidad" value={gramos}>` dentro del mismo `<form action={addScannedItemAction} onSubmit={handleClose}>` que ya existe (mismos hidden inputs `fecha`/`tipo_item`/`ean`, más el `tipo_ingesta` efectivo — ver §5.5).

Si `producto.pesoNetoTotal === null`: estos 4 botones se muestran **deshabilitados** (`disabled`, estilo gris) con una nota debajo: *"No pudimos leer el peso del envase — usá 'Personalizar' para ingresar los gramos directamente."*

**`[ Personalizar fracción/peso ]`:** botón `type="button"` que revela inline (mismo stage, sin navegar) un `<input type="number" name="cantidad" placeholder="Gramos consumidos">` + botón `[Guardar]` (`type="submit"`, deshabilitado si el input está vacío o ≤ 0). Este input, al ser directamente gramos, no necesita transformación — se nombra `cantidad` directamente y viaja en el mismo `<form>`. **Siempre habilitado**, con o sin `pesoNetoTotal` conocido.

### 5.5 Pantalla `porcion`

Aclaración fija arriba: *"1 porción equivale a: {producto.porcionEtiqueta ?? `${producto.porcion} g`}"*.

Botones fijos — fracción × `producto.porcion` (que ya tiene fallback a 100 si OFF no trae `serving_quantity`, sin cambios respecto a v1):

| Botón | Fracción |
|---|---|
| 1/2 porción | 0.5 |
| 1 porción | 1 |
| 2 porciones | 2 |
| 3 porciones | 3 |

Mismo patrón de botones-submit que v1 (`type="submit" name="cantidad" value={gramos}`), nunca deshabilitados (`porcion` nunca es `null`).

**`[ Personalizar porciones ]`:** revela inline un input numérico de **cantidad de porciones** (no gramos) — a diferencia de §5.4, acá sí hace falta transformar: el input visible es un `useState` controlado (`personalizarPorcionesValor`), y un `<input type="hidden" name="cantidad" value={Math.round(Number(personalizarPorcionesValor || 0) * producto.porcion)}>` es el que realmente viaja en el form. Botón `[Guardar]` deshabilitado si el valor no es un número > 0.

### 5.6 Ruteo automático a Suplementos

El campo oculto `tipo_ingesta` de **ambos** formularios (`paquete` y `porcion`) usa el valor efectivo, no el prop `tipoIngesta` crudo:

```ts
const tipoIngestaEfectivo = producto.esSuplemento ? 'suplemento' : tipoIngesta;
```

`addScannedItemAction` no cambia: ya acepta `'suplemento'` como valor válido de `INGESTA_TIPOS` (viene de antes, no es nuevo). El aviso en `confirm` (§5.2) es solo informativo — la lógica real de ruteo vive en este único punto donde se arma el hidden input.

## 6. Testing

- `testing/openFoodFacts.test.ts`: casos nuevos para `esSuplemento` (positivo por cada una de las 5 keywords, negativo), `pesoNetoTotal` (via `product_quantity` numérico, via `quantity` texto con `kg`/`g`/`ml`/`l`, ausente → `null`), `porcionEtiqueta` (presente/ausente), `infoAmpliada` (nutriscore válido/inválido/ausente, novaGroup válido/fuera de rango/ausente, cada label true/false), y que los macros salgan redondeados a 1 decimal.
- `testing/BarcodeScannerModal.test.tsx`: pestaña "Usar cámara" ausente en desktop; input de galería sin `capture` en móvil; flujo completo `source→cropping→fetching→confirm` para un archivo (con `Html5Qrcode.scanFileV2` mockeado); botón Volver en cada stage navega al destino correcto; `mode→paquete` con botones deshabilitados cuando `pesoNetoTotal` es `null` y habilitados cuando no; `mode→porcion` con la aclaración de porción mostrando `porcionEtiqueta` o el fallback en gramos; "Personalizar" en ambas pantallas calcula/envía el `cantidad` correcto; aviso y `tipo_ingesta` efectivo cuando `esSuplemento`; acordeón de información ampliada muestra badge/NOVA/chips o el mensaje de "sin información".

## 7. Riesgos / decisiones documentadas

- **`pesoNetoTotal` es una heurística, no un parseo garantizado.** OFF no siempre normaliza `quantity`/`product_quantity`; casos raros (rangos, "x2 100g", etc.) van a caer a `null` y mostrar el fallback de "Personalizar", que es el comportamiento seguro por diseño.
- **Colores de Nutri-Score "aproximados":** no se garantiza matcheo pixel-perfecto con el asset oficial de OFF, son los valores hex más comúnmente documentados para ese badge.
- **`fetching` y el stage inicial no llevan botón Volver**, a diferencia del resto — documentado arriba, no es un olvido.
