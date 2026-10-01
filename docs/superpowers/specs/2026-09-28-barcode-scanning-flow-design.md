# Escaneo de código de barras + integración con Open Food Facts

Branch: `feat-barcode-scanning-flow`

## 1. Objetivo

Agregar un tercer método de carga de alimentos en `/alimentacion` (junto a la búsqueda en catálogo, el reconocimiento por IA y el chat): escanear el código de barras EAN-13 de un producto envasado, consultar Open Food Facts, confirmar el producto y la porción consumida, y guardar el ítem con sus macros reales — de forma análoga a como hoy se cargan alimentos del catálogo SARA2/ANMAT.

A diferencia de `AIRecognitionModal` y `ChatFoodModal` (que hoy terminan en un stub por falta del módulo de desglose NUT-191), este flujo sí persiste de punta a punta.

## 2. Alcance

**Incluye:**
- Servicio `obtenerProductoPorEAN` contra Open Food Facts API v2.
- Componente `BarcodeScannerModal` con cámara en vivo + carga de imagen (`html5-qrcode`), confirmación de producto y selección de porción por botones fijos.
- Tabla nueva `alimentos_barcode` que se autoalimenta con cada producto nuevo escaneado, integrada a `items`/al cálculo de macros de la ingesta de la misma manera que `alimentos`.
- Botón nuevo en `AlimentacionClient` que abre el modal.

**No incluye (fuera de alcance de esta rama):**
- Cambios al catálogo `alimentos` (SARA2/ANMAT) existente.
- Búsqueda retroactiva de productos ya escaneados por otros usuarios en el buscador principal (queda como efecto colateral gratuito de tener los datos en una tabla consultable, no como feature explícita a testear).
- Formatos de código de barras distintos a EAN-13.

## 3. Servicio — `src/lib/openFoodFacts.ts`

```ts
export type ProductoOFF =
  | {
      encontrado: true;
      ean: string;
      nombre: string;
      categoria: string; // 'Sin categoría' si OFF no la provee
      marca: string | null;
      porcion: number; // gramos/ml de "1 porción"; 100 si OFF no trae serving_quantity
      nutrientes100g: { kcal: number; proteinas: number; grasas: number; carbs: number };
      imagenUrl: string | null;
    }
  | { encontrado: false; ean: string };

export async function obtenerProductoPorEAN(ean: string): Promise<ProductoOFF>;
```

- `GET https://world.openfoodfacts.org/api/v2/product/${ean}.json`, con `AbortSignal.timeout(8000)` (nativo — sin wrapper propio de fetch).
- `status === 0` (o `product` ausente) → `{ encontrado: false, ean }`.
- Error de red/timeout → mismo resultado `{ encontrado: false, ean }` (se trata igual que "no encontrado" en la UI; no se distingue error de red de producto inexistente, para mantener la UI simple).
- **Fallback por datos nutricionales inválidos:** si en la respuesta cruda de OFF los cuatro campos (`nutriments['energy-kcal_100g']`, `proteins_100g`, `fat_100g`, `carbohydrates_100g`) están **los cuatro** ausentes/`null` (antes de aplicar cualquier default), el producto se trata igual que "no encontrado" → `{ encontrado: false, ean }`. Esto evita que un producto con ficha vacía en OFF llegue a la pantalla de confirmación mostrando "0 kcal" como si fuera un dato real, y evita persistir basura en `alimentos_barcode` (el server action reutiliza esta misma función para su re-consulta, así que el filtro aplica también ahí). Si falta *alguno mas no todos* los cuatro campos, esos campos individuales sí caen a `0` y el producto se muestra normalmente — el fallback es solo para el caso de "no hay ninguna info nutricional real".
- `porcion` sale de `product.serving_quantity` (numérico, gramos) si está presente y es un número > 0; si no, `100`.
- Es una función pura, sin `'use client'` ni `'use server'`: se importa tanto desde el componente (preview inmediata al escanear) como desde el server action (re-consulta de confianza antes de persistir — ver §5).

## 4. Componente — `src/app/alimentacion/BarcodeScannerModal.tsx`

Mismo esqueleto que `AIRecognitionModal`/`ChatFoodModal`: `Modal` + máquina de estados con `useState<Stage>`.

```ts
type Stage =
  | 'source'      // elegir cámara / subir imagen (IDLE)
  | 'scanning'    // stream de cámara en vivo (SCANNING)
  | 'file'        // decodificando imagen subida (PROCESSING_FILE)
  | 'fetching'    // consultando Open Food Facts (FETCHING_API)
  | 'confirm'     // "¿es este tu alimento?" (CONFIRMING_PRODUCT)
  | 'portion'     // botones de porción (SELECTING_PORTION)
  | 'discarded'   // "no es mi alimento" → sugerencia de otro método
  | 'not-found'   // EAN válido pero sin datos en OFF
  | 'saving';     // guardando el ítem (server action en curso)
```

**Paso 1 — captura:**
- Pestañas "Usar cámara" / "Subir imagen". Tab activa por defecto: `matchMedia('(pointer: coarse)').matches ? 'camara' : 'subir'` (heurística nativa touch vs. mouse; no se agrega librería de device-detection). En "subir imagen" hay dropzone (drag & drop) + `<input type="file" accept="image/*" capture="environment">` para cámara nativa del SO en mobile.
- Cámara en vivo: `Html5Qrcode.start(...)` restringido a `formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13]`.
- Imagen subida: `Html5Qrcode.scanFileV2(file, false)`.
- Al detectar un EAN-13 (por cualquiera de los dos medios): `stop()`/`clear()` inmediato de la instancia de `Html5Qrcode` (apaga el LED de la cámara), pasa a `fetching`, llama `obtenerProductoPorEAN`.
- Cleanup en `useEffect` de desmontaje y al cerrar el modal — mismo cuidado que ya tiene `CameraCapture` con el `MediaStream`.
- Si `encontrado: false` → `not-found`, con botón para reintentar (`source`).

**Paso 2 — confirmación (`confirm`):** tarjeta con nombre, categoría, marca, imagen (si hay) y macros por 100g/100ml. "¿Es este tu alimento?" → `[Sí, es correcto]` pasa a `portion`; `[No, es otro]` pasa a `discarded` (mensaje sugiriendo búsqueda manual o el chat, mismo tono que el mensaje de "otro" en `AIRecognitionModal`).

**Paso 3 — porción (`portion`):** 6 botones fijos, sin input numérico ni de texto:
`25% · 50% · 75% · 100% · 150% · 200%` de `porcion`, mostrando el gramaje real calculado (ej. "1 porción · 30 g"). Al presionar uno:
- `cantidadGramos = round(fraccion * porcion)`.
- Arma `productoConsumidoCalculado` (nombre, ean, cantidadGramos, macros proporcionales — solo para mostrar/emitir; los macros reales que se guardan los calcula el trigger de la base) y llama `onConfirmarAlimento(productoConsumidoCalculado)`.
- Dispara el server action `addScannedItemAction` (form action, igual que el resto de `AlimentacionClient`) con `ean` + `cantidadGramos` + `fecha` + `tipo_ingesta`; estado `saving` mientras corre.

**Integración en `AlimentacionClient`:** nuevo botón junto a "Reconocimiento por IA" / "Registrar por chat" (mismo estilo, ícono a definir en implementación, ej. 📷 o similar), `showBarcodeModal` state, y el modal se monta al lado de los otros dos.

## 5. Persistencia

### 5.1 Schema (`supabase/schema_consolidado.sql`, nueva sección al final)

```sql
-- ============================================================
-- 010 — Escaneo de código de barras (Open Food Facts)
-- ============================================================

create table if not exists public.alimentos_barcode (
  id_alimento_barcode bigserial primary key,
  codigo_ean       text not null unique check (codigo_ean ~ '^[0-9]{13}$'),
  nombre           text not null,
  categoria        text,
  marca            text,
  porcion          numeric(10,2) not null default 100,
  kcal_100g        numeric(10,2),
  proteinas_100g   numeric(10,2),
  grasas_100g      numeric(10,2),
  carbs_100g       numeric(10,2),
  imagen_url       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger alimentos_barcode_updated_at
  before update on public.alimentos_barcode
  for each row execute function public.handle_updated_at();

alter table public.items
  add column if not exists id_alimento_barcode bigint references public.alimentos_barcode(id_alimento_barcode);

create index if not exists idx_items_alimento_barcode on public.items(id_alimento_barcode);

alter table public.items
  drop constraint if exists items_alimento_or_manual_check;

alter table public.items
  add constraint items_alimento_or_manual_check
  check (
    num_nonnulls(id_alimento, nombre_manual, id_alimento_barcode) >= 1
    and num_nonnulls(id_alimento, id_alimento_barcode) <= 1
  ) not valid;

alter table public.alimentos_barcode enable row level security;

create policy "alimentos_barcode: read"
  on public.alimentos_barcode for select
  using (true);

create policy "alimentos_barcode: authenticated upsert"
  on public.alimentos_barcode for insert
  to authenticated
  with check (true);

create policy "alimentos_barcode: authenticated update"
  on public.alimentos_barcode for update
  to authenticated
  using (true)
  with check (true);

create or replace function public.calculate_item_nutrients()
returns trigger as $$
declare
  kcal_100 numeric(10,2);
  prot_100 numeric(10,2);
  fat_100 numeric(10,2);
  carb_100 numeric(10,2);
begin
  if new.id_alimento_barcode is not null then
    select coalesce(kcal_100g, 0), coalesce(proteinas_100g, 0), coalesce(grasas_100g, 0), coalesce(carbs_100g, 0)
    into kcal_100, prot_100, fat_100, carb_100
    from public.alimentos_barcode
    where id_alimento_barcode = new.id_alimento_barcode;

    if not found then
      raise exception 'Alimento (barcode) no encontrado para id_alimento_barcode=%', new.id_alimento_barcode;
    end if;

    new.kcal = round((kcal_100 * new.cantidad) / 100, 2);
    new.proteinas_g = round((prot_100 * new.cantidad) / 100, 2);
    new.grasas_g = round((fat_100 * new.cantidad) / 100, 2);
    new.carbs_g = round((carb_100 * new.cantidad) / 100, 2);
    return new;
  end if;

  if new.id_alimento is null then
    new.kcal = 0;
    new.proteinas_g = 0;
    new.grasas_g = 0;
    new.carbs_g = 0;
    return new;
  end if;

  select coalesce(a.kcal_100g, 0), coalesce(a.proteinas_100g, 0), coalesce(a.grasas_100g, 0), coalesce(a.carbs_100g, 0)
  into kcal_100, prot_100, fat_100, carb_100
  from public.alimentos a
  where a.id_alimento = new.id_alimento;

  if not found then
    raise exception 'Alimento no encontrado para id_alimento=%', new.id_alimento;
  end if;

  new.kcal = round((kcal_100 * new.cantidad) / 100, 2);
  new.proteinas_g = round((prot_100 * new.cantidad) / 100, 2);
  new.grasas_g = round((fat_100 * new.cantidad) / 100, 2);
  new.carbs_g = round((carb_100 * new.cantidad) / 100, 2);
  return new;
end;
$$ language plpgsql;

drop trigger if exists items_calculate_nutrients on public.items;
create trigger items_calculate_nutrients
  before insert or update of id_alimento, id_alimento_barcode, cantidad
  on public.items
  for each row execute function public.calculate_item_nutrients();
```

Notas:
- `num_nonnulls(...)` es una función nativa de Postgres — evita escribir a mano la combinatoria de nulls.
- La política de update es intencionalmente permisiva (`using (true)`) porque el upsert por `codigo_ean` puede necesitar actualizar un producto insertado por otro usuario; el `codigo_ean` con `unique` + `check` de 13 dígitos acota qué se puede escribir.
- `recalculate_ingesta_totals()` no cambia: sigue sumando `items.kcal/proteinas_g/...`, que ya vienen bien calculados por el trigger de arriba sin importar de qué tabla salieron.

### 5.2 Server action (`src/app/alimentacion/actions.ts`)

```ts
export async function addScannedItemAction(formData: FormData) {
  // valida fecha / tipo_ingesta / tipo_item / cantidad igual que addItemAction
  // valida ean: /^[0-9]{13}$/

  const producto = await obtenerProductoPorEAN(ean); // re-consulta server-side, no confía en el cliente
  if (!producto.encontrado) redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);

  const supabase = await createClient();
  // ... auth igual que addItemAction ...

  const { data: alimentoBarcode, error } = await supabase
    .from('alimentos_barcode')
    .upsert(
      {
        codigo_ean: producto.ean,
        nombre: producto.nombre,
        categoria: producto.categoria,
        marca: producto.marca,
        porcion: producto.porcion,
        kcal_100g: producto.nutrientes100g.kcal,
        proteinas_100g: producto.nutrientes100g.proteinas,
        grasas_100g: producto.nutrientes100g.grasas,
        carbs_100g: producto.nutrientes100g.carbs,
        imagen_url: producto.imagenUrl,
      },
      { onConflict: 'codigo_ean' },
    )
    .select('id_alimento_barcode')
    .single();

  if (error || !alimentoBarcode) redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);

  await upsertIngestaAndInsertItem(supabase, {
    userId: user.id,
    fecha,
    tipoIngesta,
    tipoItem,
    cantidad,
    idAlimentoBarcode: alimentoBarcode.id_alimento_barcode,
  });

  revalidatePath('/alimentacion');
  redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
}
```

`upsertIngestaAndInsertItem`: helper nuevo, privado a `actions.ts`, que extrae el bloque "upsert de `ingestas` + select de `id_ingesta` + insert en `items`" hoy duplicado en `addItemAction` y `addManualItemAction`. Acepta `idAlimento | nombreManual | idAlimentoBarcode` (exactamente uno) y hace el insert correspondiente. Este refactor es el único cambio a las dos acciones existentes — se limita a reemplazar su bloque final por una llamada al helper, sin tocar su lógica de validación previa.

Errores de red/timeout de OFF en el server action se tratan igual que "no encontrado" (redirect), sin distinguir caso — consistente con el servicio.

## 6. Dependencia nueva

`html5-qrcode` (npm). No requiere configuración especial de Next/Turbopack/Serwist — es JS puro orientado a DOM, sin dependencias de Node nativas.

## 7. Testing

- `testing/openFoodFacts.test.ts` (proyecto `node` de vitest, mock de `global.fetch`): producto encontrado con y sin `serving_quantity`/`categoria`/`marca`, `status: 0`, timeout/error de red, producto encontrado con los 4 macros nulos (→ `encontrado: false`), producto con solo *algunos* macros nulos (→ `encontrado: true` con esos campos en `0`).
- `testing/BarcodeScannerModal.test.tsx` (proyecto `jsdom`, mock del módulo `html5-qrcode` — no hay cámara real en jsdom): flujo completo simulando que `Html5Qrcode` "detecta" un EAN, confirmar producto, elegir porción, verificar `onConfirmarAlimento` con el payload correcto; rama "No, es otro"; rama "no encontrado".
- Sin test de integración contra Supabase real ni contra la API de OFF real (sigue la convención del repo: mocks en los tests, sin llamadas de red).

## 8. Riesgos / decisiones abiertas para implementación

- **Formato exacto de `serving_quantity` en OFF:** puede venir ausente, `0`, o como string — el servicio debe validar y caer a `100` en cualquier caso no numérico positivo.
- **Iconografía del botón nuevo** en `AlimentacionClient`: se define en implementación siguiendo el estilo de los otros dos botones (gradiente + emoji), sin bloquear el diseño.
- **Permisos de cámara denegados / sin `getUserMedia`:** `html5-qrcode` expone sus propios errores de `start()`; se muestra el mismo tipo de mensaje que ya usa `CameraCapture` para casos de permiso denegado / cámara no encontrada, cayendo a la pestaña "Subir imagen".
