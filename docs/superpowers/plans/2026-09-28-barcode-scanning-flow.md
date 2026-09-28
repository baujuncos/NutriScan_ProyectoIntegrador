# Escaneo de código de barras Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un tercer método de carga de alimentos en `/alimentacion` — escanear un código de barras EAN-13, confirmar el producto de Open Food Facts, elegir la porción consumida con botones fijos, y guardar el ítem con sus macros reales.

**Architecture:** Un modal (`BarcodeScannerModal`) con `html5-qrcode` para decodificar EAN-13 (cámara en vivo o imagen subida), que consulta `obtenerProductoPorEAN` (servicio contra Open Food Facts API v2) para el preview y luego persiste vía un nuevo server action (`addScannedItemAction`) que **re-consulta el EAN del lado del servidor** (nunca confía en datos del cliente) y hace upsert en una tabla nueva `alimentos_barcode` que se autoalimenta con cada producto nuevo escaneado — integrada a `items`/al trigger de cálculo de macros exactamente como ya está integrada `alimentos`.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TypeScript, Supabase (Postgres + RLS), Tailwind CSS, Vitest + Testing Library, `html5-qrcode` (nueva dependencia).

**Spec:** `docs/superpowers/specs/2026-09-28-barcode-scanning-flow-design.md`

## Global Constraints

- Formato de escaneo restringido exclusivamente a `Html5QrcodeSupportedFormats.EAN_13`.
- Timeout de red de 8000ms (`AbortSignal.timeout(8000)`) en `obtenerProductoPorEAN` — sin wrapper de fetch propio.
- Paso de selección de porción: **sin input numérico ni de texto**, solo los 6 botones fijos (25/50/75/100/150/200% de la `porcion` del producto).
- `addScannedItemAction` nunca confía en nombre/categoría/marca/macros que mande el cliente: siempre vuelve a llamar `obtenerProductoPorEAN(ean)` del lado del servidor antes de escribir en `alimentos_barcode`.
- Si los 4 macros clave (`energy-kcal_100g`, `proteins_100g`, `fat_100g`, `carbohydrates_100g`) vienen todos ausentes/`null` en la respuesta cruda de OFF, se trata como `encontrado: false` — nunca llega a la pantalla de confirmación con ceros falsos.
- `html5-qrcode` debe `stop()` + `clear()` al detectar un código, al cerrar el modal (cualquier vía: botón, Escape, backdrop) y al desmontar — nunca dejar la cámara/LED encendida.
- Pestaña activa por defecto: "Usar cámara" en dispositivos táctiles (`matchMedia('(pointer: coarse)')`), "Subir imagen" en desktop; la cámara nunca arranca sola en desktop.
- No se modifica el catálogo `alimentos` (SARA2/ANMAT) existente ni su trigger para el camino `id_alimento`.

## Review Focus

- OFF devuelve los macros como strings (ej. `"450"`) en vez de `number` — deben normalizarse a `0`, no propagarse como string ni romper el cálculo. → cubierto por test nuevo en Task 3.
- `serving_quantity` de OFF es `0` o negativo — debe caer a `porcion: 100`, no arrastrar un `0` que generaría botones de "0 g". → cubierto por test nuevo en Task 3.
- `categories` de OFF viene con espacios/comas irregulares (ej. `" Snacks , Alfajores "`) — debe tomarse solo la primera categoría, trimeada. → cubierto por test nuevo en Task 3.
- Doble click en un botón de porción antes de que el `redirect()` del server action complete podría insertar el ítem dos veces — limitación preexistente igual que el resto de los formularios de `AlimentacionClient` (ninguno deshabilita su submit hoy); no se corrige en este plan para no desviarse del alcance.
- Re-escaneo del mismo EAN por dos usuarios en simultáneo — el `upsert(..., { onConflict: 'codigo_ean' })` es atómico a nivel de Postgres (sin condición de carrera), pero no hay forma de testear esto sin una base real en este repo (no hay infraestructura de test contra Supabase). Queda como punto de revisión manual al aplicar el schema.

---

## File Structure

- **Modify:** `package.json` — nueva dependencia `html5-qrcode`.
- **Modify:** `supabase/schema_consolidado.sql` — tabla `alimentos_barcode`, columna `items.id_alimento_barcode`, trigger extendido.
- **Create:** `src/lib/openFoodFacts.ts` — `obtenerProductoPorEAN` + tipos `ProductoOFF`.
- **Create:** `testing/openFoodFacts.test.ts`.
- **Modify:** `src/app/alimentacion/actions.ts` — helper privado `upsertIngestaAndInsertItem`, refactor de `addItemAction`/`addManualItemAction`, nuevo `addScannedItemAction`.
- **Create:** `src/app/alimentacion/BarcodeScannerModal.tsx`.
- **Create:** `testing/BarcodeScannerModal.test.tsx`.
- **Modify:** `src/app/alimentacion/AlimentacionClient.tsx` — botón + modal nuevo.
- **Modify:** `testing/AlimentacionSearch.test.tsx` — mock del componente nuevo para no romper el resto de la suite.

---

### Task 1: Agregar la dependencia `html5-qrcode`

**Files:**
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Produces: paquete `html5-qrcode` (v2.3.8) instalado y resoluble por TypeScript/Vitest para todas las tareas siguientes.

- [ ] **Step 1: Instalar el paquete**

Run: `npm install html5-qrcode`

Expected: `package.json` gana `"html5-qrcode": "^2.3.8"` en `dependencies`, y `package-lock.json` se actualiza.

- [ ] **Step 2: Verificar que el proyecto sigue compilando**

Run: `npx tsc --noEmit`

Expected: sin errores nuevos relacionados a `html5-qrcode` (todavía no se usa en ningún archivo).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: agregar dependencia html5-qrcode para escaneo de EAN-13"
```

---

### Task 2: Schema — tabla `alimentos_barcode` e integración con `items`

**Files:**
- Modify: `supabase/schema_consolidado.sql` (agregar sección al final del archivo)

**Interfaces:**
- Produces: tabla `public.alimentos_barcode(id_alimento_barcode, codigo_ean, nombre, categoria, marca, porcion, kcal_100g, proteinas_100g, grasas_100g, carbs_100g, imagen_url, created_at, updated_at)`; columna `public.items.id_alimento_barcode`; trigger `calculate_item_nutrients()` actualizado para calcular macros desde `alimentos_barcode` cuando corresponde. Task 4 depende de que estos nombres de tabla/columna existan tal cual.

Este repo no tiene infraestructura de tests contra una base Postgres real (confirmado: no hay carpeta `supabase/migrations` con tooling de CI, y `testing/anmat-schema.test.ts` solo testea contratos de TypeScript, no SQL en vivo). Este task no lleva tests automatizados — se verifica aplicando el SQL a mano contra el proyecto de Supabase antes de mergear, igual que el resto del archivo `schema_consolidado.sql`.

- [ ] **Step 1: Agregar la sección de schema**

Agregar al final de `supabase/schema_consolidado.sql`:

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

- [ ] **Step 2: Aplicar el SQL contra el proyecto de Supabase (staging o local) y verificar que corre sin errores**

Run (vía Supabase SQL editor o `psql`, apuntando a la base del proyecto): pegar y ejecutar el bloque anterior.

Expected: sin errores. `select * from public.alimentos_barcode limit 1;` devuelve una tabla vacía sin error.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema_consolidado.sql
git commit -m "feat(db): tabla alimentos_barcode + integracion con items y trigger de macros"
```

---

### Task 3: Servicio Open Food Facts — `src/lib/openFoodFacts.ts`

**Files:**
- Create: `src/lib/openFoodFacts.ts`
- Test: `testing/openFoodFacts.test.ts`

**Interfaces:**
- Produces: `obtenerProductoPorEAN(ean: string): Promise<ProductoOFF>`, tipos `ProductoOFF`, `ProductoEncontrado`, `ProductoNoEncontrado`. Task 4 y Task 5 importan `obtenerProductoPorEAN` y `ProductoOFF` desde `@/lib/openFoodFacts`.

- [ ] **Step 1: Escribir los tests**

Crear `testing/openFoodFacts.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { obtenerProductoPorEAN } from '@/lib/openFoodFacts';

function mockFetchOnce(response: unknown, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(response),
  }) as unknown as typeof fetch;
}

describe('obtenerProductoPorEAN', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normaliza un producto con todos los campos presentes', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Alfajor Triple',
        categories: 'Snacks dulces, Alfajores',
        brands: 'Havanna',
        serving_quantity: 45,
        nutriments: {
          'energy-kcal_100g': 450,
          proteins_100g: 5,
          fat_100g: 20,
          carbohydrates_100g: 60,
        },
        image_url: 'https://example.com/img.jpg',
      },
    });

    const result = await obtenerProductoPorEAN('7790040000100');

    expect(result).toEqual({
      encontrado: true,
      ean: '7790040000100',
      nombre: 'Alfajor Triple',
      categoria: 'Snacks dulces',
      marca: 'Havanna',
      porcion: 45,
      nutrientes100g: { kcal: 450, proteinas: 5, grasas: 20, carbs: 60 },
      imagenUrl: 'https://example.com/img.jpg',
    });
  });

  it('usa porcion=100 cuando OFF no trae serving_quantity', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Agua saborizada',
        nutriments: { 'energy-kcal_100g': 2, proteins_100g: 0, fat_100g: 0, carbohydrates_100g: 0.5 },
      },
    });

    const result = await obtenerProductoPorEAN('7790040000200');
    expect(result.encontrado).toBe(true);
    if (result.encontrado) expect(result.porcion).toBe(100);
  });

  it('usa porcion=100 cuando serving_quantity es 0 o negativo', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Producto con serving_quantity inválido',
        serving_quantity: 0,
        nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
      },
    });

    const result = await obtenerProductoPorEAN('7790040000210');
    expect(result.encontrado).toBe(true);
    if (result.encontrado) expect(result.porcion).toBe(100);
  });

  it('usa categoria "Sin categoría" y marca null cuando faltan', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Producto genérico',
        nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
      },
    });

    const result = await obtenerProductoPorEAN('7790040000300');
    expect(result.encontrado).toBe(true);
    if (result.encontrado) {
      expect(result.categoria).toBe('Sin categoría');
      expect(result.marca).toBeNull();
    }
  });

  it('toma solo la primera categoría, trimeada, cuando vienen varias separadas por coma', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Producto con categorías raras',
        categories: '  Snacks dulces ,Alfajores , Otros ',
        nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
      },
    });

    const result = await obtenerProductoPorEAN('7790040000350');
    expect(result.encontrado).toBe(true);
    if (result.encontrado) expect(result.categoria).toBe('Snacks dulces');
  });

  it('devuelve encontrado:false cuando status es 0', async () => {
    mockFetchOnce({ status: 0 });
    const result = await obtenerProductoPorEAN('0000000000000');
    expect(result).toEqual({ encontrado: false, ean: '0000000000000' });
  });

  it('devuelve encontrado:false cuando los 4 macros son null (ficha vacía)', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Producto sin datos nutricionales',
        nutriments: {},
      },
    });
    const result = await obtenerProductoPorEAN('7790040000400');
    expect(result).toEqual({ encontrado: false, ean: '7790040000400' });
  });

  it('devuelve encontrado:true con 0 en los campos que falten cuando NO faltan los 4', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Producto con datos parciales',
        nutriments: { 'energy-kcal_100g': 200, proteins_100g: 3 },
      },
    });
    const result = await obtenerProductoPorEAN('7790040000500');
    expect(result.encontrado).toBe(true);
    if (result.encontrado) {
      expect(result.nutrientes100g).toEqual({ kcal: 200, proteinas: 3, grasas: 0, carbs: 0 });
    }
  });

  it('normaliza a 0 cuando los macros vienen como string en vez de number', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Producto con macros mal tipados',
        nutriments: {
          'energy-kcal_100g': '450',
          proteins_100g: '5',
          fat_100g: '20',
          carbohydrates_100g: '60',
        },
      },
    });
    const result = await obtenerProductoPorEAN('7790040000550');
    expect(result.encontrado).toBe(true);
    if (result.encontrado) {
      expect(result.nutrientes100g).toEqual({ kcal: 0, proteinas: 0, grasas: 0, carbs: 0 });
    }
  });

  it('devuelve encontrado:false ante un error de red', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await obtenerProductoPorEAN('7790040000600');
    expect(result).toEqual({ encontrado: false, ean: '7790040000600' });
  });

  it('devuelve encontrado:false cuando la respuesta HTTP no es ok', async () => {
    mockFetchOnce({}, false);
    const result = await obtenerProductoPorEAN('7790040000700');
    expect(result).toEqual({ encontrado: false, ean: '7790040000700' });
  });
});
```

Nota sobre el test de "macros como string": como los 4 campos están *presentes* (no `null`/`undefined`), el chequeo de "ficha vacía" no dispara — pero como ninguno es `typeof value === 'number'`, cada uno cae individualmente a `0` vía `numeroOCero`. Es el comportamiento correcto: preferimos macros en `0` (visibles y corregibles) antes que un `NaN` o un string en un campo tipado `number`.

- [ ] **Step 2: Correr los tests y verificar que fallan por "Cannot find module"**

Run: `npx vitest run testing/openFoodFacts.test.ts`
Expected: FAIL — `Cannot find module '@/lib/openFoodFacts'`.

- [ ] **Step 3: Implementar el servicio**

Crear `src/lib/openFoodFacts.ts`:

```ts
export interface ProductoEncontrado {
  encontrado: true;
  ean: string;
  nombre: string;
  categoria: string;
  marca: string | null;
  porcion: number;
  nutrientes100g: {
    kcal: number;
    proteinas: number;
    grasas: number;
    carbs: number;
  };
  imagenUrl: string | null;
}

export interface ProductoNoEncontrado {
  encontrado: false;
  ean: string;
}

export type ProductoOFF = ProductoEncontrado | ProductoNoEncontrado;

const OFF_TIMEOUT_MS = 8000;

function numeroOCero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function numeroPositivoONulo(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function primeraCategoria(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'Sin categoría';
  const primera = value.split(',')[0]?.trim();
  return primera || 'Sin categoría';
}

export async function obtenerProductoPorEAN(ean: string): Promise<ProductoOFF> {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${ean}.json`, {
      signal: AbortSignal.timeout(OFF_TIMEOUT_MS),
    });
    if (!res.ok) return { encontrado: false, ean };

    const data = await res.json();
    if (data?.status === 0 || !data?.product) return { encontrado: false, ean };

    const product = data.product;
    const n = product.nutriments ?? {};

    const kcalRaw = n['energy-kcal_100g'];
    const proteinasRaw = n['proteins_100g'];
    const grasasRaw = n['fat_100g'];
    const carbsRaw = n['carbohydrates_100g'];

    const todosAusentes =
      kcalRaw == null && proteinasRaw == null && grasasRaw == null && carbsRaw == null;
    if (todosAusentes) return { encontrado: false, ean };

    return {
      encontrado: true,
      ean,
      nombre:
        typeof product.product_name === 'string' && product.product_name.trim()
          ? product.product_name.trim()
          : 'Producto sin nombre',
      categoria: primeraCategoria(product.categories),
      marca: typeof product.brands === 'string' && product.brands.trim() ? product.brands.trim() : null,
      porcion: numeroPositivoONulo(product.serving_quantity) ?? 100,
      nutrientes100g: {
        kcal: numeroOCero(kcalRaw),
        proteinas: numeroOCero(proteinasRaw),
        grasas: numeroOCero(grasasRaw),
        carbs: numeroOCero(carbsRaw),
      },
      imagenUrl: typeof product.image_url === 'string' && product.image_url ? product.image_url : null,
    };
  } catch {
    return { encontrado: false, ean };
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run testing/openFoodFacts.test.ts`
Expected: PASS — 12 tests verdes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/openFoodFacts.ts testing/openFoodFacts.test.ts
git commit -m "feat: servicio obtenerProductoPorEAN contra Open Food Facts API v2"
```

---

### Task 4: Server actions — helper compartido y `addScannedItemAction`

**Files:**
- Modify: `src/app/alimentacion/actions.ts:1-146` (imports, `addItemAction`), `:150-223` (`addManualItemAction`)

**Interfaces:**
- Consumes: `obtenerProductoPorEAN` y `ProductoOFF` de `@/lib/openFoodFacts` (Task 3).
- Produces: `addScannedItemAction(formData: FormData): Promise<void>` — form action que Task 5 usa en `<form action={addScannedItemAction}>`, con campos de `FormData` esperados: `fecha`, `tipo_ingesta`, `tipo_item`, `ean`, `cantidad`.

Sin tests automatizados en este task: el repo no testea ninguna de las server actions existentes de `actions.ts` (confirmado — no hay ningún archivo en `testing/` que mockee `@/lib/supabase/server` o llame estas funciones directamente; `AlimentacionSearch.test.tsx` mockea el *módulo* `./actions` entero en vez de ejercitar su lógica). Este task sigue esa misma convención.

- [ ] **Step 1: Agregar el import del servicio OFF**

En `src/app/alimentacion/actions.ts`, agregar tras el import de `@/lib/date` (línea 7):

```ts
import { obtenerProductoPorEAN } from '@/lib/openFoodFacts';
```

- [ ] **Step 2: Agregar el helper privado y el tipo `ItemSource`**

Insertar antes de `export async function addItemAction` (línea 63), justo después de `getStringField`:

```ts
const EAN_REGEX = /^[0-9]{13}$/;

type ItemSource =
  | { kind: 'catalogo'; idAlimento: number }
  | { kind: 'manual'; nombreManual: string }
  | { kind: 'barcode'; idAlimentoBarcode: number };

async function upsertIngestaAndInsertItem(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    userId: string;
    fecha: string;
    tipoIngesta: string;
    tipoItem: string;
    cantidad: number;
    source: ItemSource;
  },
): Promise<boolean> {
  const { userId, fecha, tipoIngesta, tipoItem, cantidad, source } = params;

  const { error: upsertError } = await supabase.from('ingestas').upsert(
    [{ id_usuario: userId, fecha, tipo: tipoIngesta }],
    { onConflict: 'id_usuario,fecha,tipo' },
  );
  if (upsertError) return false;

  const { data: ingesta, error: ingestaError } = await supabase
    .from('ingestas')
    .select('id_ingesta')
    .eq('id_usuario', userId)
    .eq('fecha', fecha)
    .eq('tipo', tipoIngesta)
    .single();
  if (ingestaError || !ingesta) return false;

  const itemFields =
    source.kind === 'catalogo'
      ? { id_alimento: source.idAlimento }
      : source.kind === 'manual'
        ? { id_alimento: null, nombre_manual: source.nombreManual }
        : { id_alimento_barcode: source.idAlimentoBarcode };

  const { error: insertError } = await supabase.from('items').insert({
    id_ingesta: ingesta.id_ingesta,
    tipo_item: tipoItem,
    cantidad: toFixed2(cantidad),
    ...itemFields,
  });

  return !insertError;
}
```

- [ ] **Step 3: Refactorizar `addItemAction` para usar el helper**

Reemplazar el bloque final de `addItemAction` (desde `const { error: upsertError } = await supabase.from('ingestas').upsert(` hasta el `redirect` posterior al insert de `items`, líneas ~106-142 del archivo original) por:

```ts
  const ok = await upsertIngestaAndInsertItem(supabase, {
    userId: user.id,
    fecha,
    tipoIngesta,
    tipoItem,
    cantidad,
    source: { kind: 'catalogo', idAlimento },
  });
  if (!ok) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }
```

La función queda así completa (sin cambios antes de este bloque, y conservando el `revalidatePath`/`redirect` finales tal cual):

```ts
export async function addItemAction(formData: FormData) {
  const fecha = getStringField(formData, 'fecha');
  const tipoIngesta = getStringField(formData, 'tipo_ingesta');
  const tipoItem = getStringField(formData, 'tipo_item');
  const alimentoIdRaw = getStringField(formData, 'id_alimento');
  const cantidadRaw = getStringField(formData, 'cantidad');

  if (!isValidDateInput(fecha)) redirect('/alimentacion');
  if (!isWithinEditableRange(fecha)) redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  if (!INGESTA_TIPOS.includes(tipoIngesta as (typeof INGESTA_TIPOS)[number])) {
    redirect(`/alimentacion?fecha=${fecha}`);
  }
  if (!ITEM_TIPOS.includes(tipoItem as (typeof ITEM_TIPOS)[number])) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const idAlimento = Number.parseInt(alimentoIdRaw, 10);
  const cantidad = Number.parseFloat(cantidadRaw);

  if (
    !Number.isFinite(idAlimento) || idAlimento <= 0 ||
    !Number.isFinite(cantidad) || cantidad <= 0 || cantidad > MAX_CANTIDAD
  ) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: alimento, error: alimentoError } = await supabase
    .from('alimentos')
    .select('id_alimento')
    .eq('id_alimento', idAlimento)
    .single();

  if (alimentoError || !alimento) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const ok = await upsertIngestaAndInsertItem(supabase, {
    userId: user.id,
    fecha,
    tipoIngesta,
    tipoItem,
    cantidad,
    source: { kind: 'catalogo', idAlimento },
  });
  if (!ok) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  revalidatePath('/alimentacion');
  redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
}
```

- [ ] **Step 4: Refactorizar `addManualItemAction` de la misma forma**

Reemplazar su bloque final (el mismo patrón upsert-ingesta + select + insert) por:

```ts
  const ok = await upsertIngestaAndInsertItem(supabase, {
    userId: user.id,
    fecha,
    tipoIngesta,
    tipoItem,
    cantidad,
    source: { kind: 'manual', nombreManual },
  });
  if (!ok) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  revalidatePath('/alimentacion');
  redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
```

manteniendo intacta toda su lógica de validación previa (nombre manual, cantidad, rango de fecha, etc.).

- [ ] **Step 5: Verificar que el resto de la suite sigue pasando**

Run: `npx vitest run`
Expected: PASS — ningún test existente depende del cuerpo interno de estas dos funciones (se mockean como módulo completo), así que la suite sigue verde.

- [ ] **Step 6: Agregar `addScannedItemAction`**

Agregar al final de `src/app/alimentacion/actions.ts`:

```ts
export async function addScannedItemAction(formData: FormData) {
  const fecha = getStringField(formData, 'fecha');
  const tipoIngesta = getStringField(formData, 'tipo_ingesta');
  const tipoItem = getStringField(formData, 'tipo_item');
  const ean = getStringField(formData, 'ean');
  const cantidadRaw = getStringField(formData, 'cantidad');

  if (!isValidDateInput(fecha)) redirect('/alimentacion');
  if (!isWithinEditableRange(fecha)) redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  if (!INGESTA_TIPOS.includes(tipoIngesta as (typeof INGESTA_TIPOS)[number])) {
    redirect(`/alimentacion?fecha=${fecha}`);
  }
  if (!ITEM_TIPOS.includes(tipoItem as (typeof ITEM_TIPOS)[number])) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }
  if (!EAN_REGEX.test(ean)) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const cantidad = Number.parseFloat(cantidadRaw);
  if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > MAX_CANTIDAD) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  // Re-consulta a Open Food Facts del lado del servidor: nunca confiamos en
  // nombre/marca/macros que pueda mandar el cliente, solo en el EAN.
  const producto = await obtenerProductoPorEAN(ean);
  if (!producto.encontrado) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: alimentoBarcode, error: upsertError } = await supabase
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

  if (upsertError || !alimentoBarcode) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  const ok = await upsertIngestaAndInsertItem(supabase, {
    userId: user.id,
    fecha,
    tipoIngesta,
    tipoItem,
    cantidad,
    source: { kind: 'barcode', idAlimentoBarcode: alimentoBarcode.id_alimento_barcode },
  });
  if (!ok) {
    redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
  }

  revalidatePath('/alimentacion');
  redirect(`/alimentacion?fecha=${fecha}&tipo=${tipoIngesta}`);
}
```

- [ ] **Step 7: Verificar tipos y suite completa**

Run: `npx tsc --noEmit && npx vitest run`
Expected: sin errores de tipos, toda la suite en verde.

- [ ] **Step 8: Commit**

```bash
git add src/app/alimentacion/actions.ts
git commit -m "feat: addScannedItemAction + helper compartido de ingesta/item en actions.ts"
```

---

### Task 5: Componente `BarcodeScannerModal`

**Files:**
- Create: `src/app/alimentacion/BarcodeScannerModal.tsx`
- Test: `testing/BarcodeScannerModal.test.tsx`

**Interfaces:**
- Consumes: `obtenerProductoPorEAN`, `ProductoOFF` de `@/lib/openFoodFacts` (Task 3); `addScannedItemAction` de `./actions` (Task 4); `Modal` de `@/components/ui/Modal`; `Button` de `@/components/ui/Button`; `Html5Qrcode`, `Html5QrcodeSupportedFormats` de `html5-qrcode` (Task 1).
- Produces: `export default function BarcodeScannerModal({ open, onClose, fecha, tipoIngesta }: { open: boolean; onClose: () => void; fecha: string; tipoIngesta: string })`. Task 6 monta este componente con esas 4 props.

- [ ] **Step 1: Escribir los tests base (pestaña por defecto, arranque de cámara, cleanup)**

Crear `testing/BarcodeScannerModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BarcodeScannerModal from '@/app/alimentacion/BarcodeScannerModal';
import { obtenerProductoPorEAN } from '@/lib/openFoodFacts';
import { addScannedItemAction } from '@/app/alimentacion/actions';

const mockStart = vi.fn().mockResolvedValue(null);
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockClear = vi.fn();
const mockScanFileV2 = vi.fn();

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: vi.fn().mockImplementation(() => ({
    start: mockStart,
    stop: mockStop,
    clear: mockClear,
    scanFileV2: mockScanFileV2,
  })),
  Html5QrcodeSupportedFormats: { EAN_13: 9 },
}));

vi.mock('@/lib/openFoodFacts', () => ({
  obtenerProductoPorEAN: vi.fn(),
}));

vi.mock('@/app/alimentacion/actions', () => ({
  addScannedItemAction: vi.fn().mockResolvedValue(undefined),
}));

const PRODUCTO_OK = {
  encontrado: true as const,
  ean: '7790040000100',
  nombre: 'Alfajor Triple',
  categoria: 'Snacks dulces',
  marca: 'Havanna',
  porcion: 45,
  nutrientes100g: { kcal: 450, proteinas: 5, grasas: 20, carbs: 60 },
  imagenUrl: null,
};

function mockPointerCoarse(coarse: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(pointer: coarse)' ? coarse : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function renderModal(props: Partial<React.ComponentProps<typeof BarcodeScannerModal>> = {}) {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    <BarcodeScannerModal open onClose={onClose} fecha="2026-09-21" tipoIngesta="almuerzo" {...props} />,
  );
  return { onClose, user };
}

async function simularEscaneo() {
  await waitFor(() => expect(mockStart).toHaveBeenCalled());
  const successCallback = mockStart.mock.calls[0][2] as (decodedText: string) => void;
  await act(async () => successCallback('7790040000100'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPointerCoarse(true);
  vi.mocked(obtenerProductoPorEAN).mockResolvedValue(PRODUCTO_OK);
});

describe('BarcodeScannerModal — captura', () => {
  it('en dispositivo táctil, la pestaña "Usar cámara" está activa por defecto y arranca restringida a EAN_13', async () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Usar cámara' })).toHaveClass('bg-white');
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    const { Html5Qrcode } = await import('html5-qrcode');
    expect(vi.mocked(Html5Qrcode).mock.calls[0][1]).toMatchObject({
      formatsToSupport: [9],
    });
  });

  it('en desktop (sin pointer coarse), la pestaña "Subir imagen" está activa por defecto y no arranca la cámara', async () => {
    mockPointerCoarse(false);
    renderModal();
    expect(screen.getByRole('button', { name: 'Subir imagen' })).toHaveClass('bg-white');
    await new Promise((r) => setTimeout(r, 0));
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('detiene la cámara (stop + clear) al cerrar el modal', async () => {
    const { user } = renderModal();
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    await user.click(screen.getByLabelText('Cerrar'));

    await waitFor(() => expect(mockStop).toHaveBeenCalled());
    expect(mockClear).toHaveBeenCalled();
  });

  it('al detectar un EAN por cámara, detiene el escaneo y consulta obtenerProductoPorEAN', async () => {
    renderModal();
    await simularEscaneo();

    await waitFor(() => expect(mockStop).toHaveBeenCalled());
    expect(obtenerProductoPorEAN).toHaveBeenCalledWith('7790040000100');
    expect(await screen.findByText('¿Es este tu alimento?')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan por módulo inexistente**

Run: `npx vitest run testing/BarcodeScannerModal.test.tsx`
Expected: FAIL — `Cannot find module '@/app/alimentacion/BarcodeScannerModal'`.

- [ ] **Step 3: Implementar el esqueleto del componente (pestañas, cámara, subir imagen, fetching, confirm)**

Crear `src/app/alimentacion/BarcodeScannerModal.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { obtenerProductoPorEAN, type ProductoOFF } from '@/lib/openFoodFacts';
import { addScannedItemAction } from './actions';

type Stage = 'source' | 'fetching' | 'confirm' | 'portion' | 'discarded';
type CaptureTab = 'camara' | 'subir';

const SCANNER_ELEMENT_ID = 'barcode-scanner-region';

const PORCIONES = [
  { label: '1/4 de porción', fraccion: 0.25 },
  { label: '1/2 porción', fraccion: 0.5 },
  { label: '3/4 de porción', fraccion: 0.75 },
  { label: '1 porción', fraccion: 1 },
  { label: '1.5 porciones', fraccion: 1.5 },
  { label: '2 porciones', fraccion: 2 },
] as const;

function esTactil(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

type ScannerInstance = InstanceType<typeof import('html5-qrcode').Html5Qrcode>;

export default function BarcodeScannerModal({
  open,
  onClose,
  fecha,
  tipoIngesta,
}: {
  open: boolean;
  onClose: () => void;
  fecha: string;
  tipoIngesta: string;
}) {
  const [stage, setStage] = useState<Stage>('source');
  const [activeTab, setActiveTab] = useState<CaptureTab>('camara');
  const [producto, setProducto] = useState<ProductoOFF | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRef = useRef<ScannerInstance | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setActiveTab(esTactil() ? 'camara' : 'subir');
  }, [open]);

  const detenerCamara = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      await scanner.stop();
    } catch {
      // Ya estaba detenida
    }
    scanner.clear();
  }, []);

  const resetState = useCallback(() => {
    setStage('source');
    setProducto(null);
    setCameraError(null);
  }, []);

  const handleClose = useCallback(() => {
    void detenerCamara();
    resetState();
    onClose();
  }, [detenerCamara, resetState, onClose]);

  const buscarProducto = useCallback(async (ean: string) => {
    setStage('fetching');
    const resultado = await obtenerProductoPorEAN(ean);
    setProducto(resultado);
    setStage(resultado.encontrado ? 'confirm' : 'discarded');
  }, []);

  const handleDecoded = useCallback(
    (ean: string) => {
      void detenerCamara();
      void buscarProducto(ean);
    },
    [detenerCamara, buscarProducto],
  );

  // Cámara en vivo: arranca solo en la pantalla inicial con la pestaña "cámara" activa.
  useEffect(() => {
    if (!open || stage !== 'source' || activeTab !== 'camara') return;
    let cancelado = false;

    (async () => {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      if (cancelado) return;
      const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
        formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13],
        verbose: false,
      });
      scannerRef.current = scanner;
      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 280, height: 140 } },
          (decodedText) => handleDecoded(decodedText),
          () => {},
        );
      } catch (err) {
        if (cancelado) return;
        const name = err instanceof DOMException ? err.name : '';
        setCameraError(
          name === 'NotAllowedError'
            ? 'No diste permiso para la cámara. Subí una imagen en su lugar.'
            : name === 'NotFoundError'
              ? 'No encontramos una cámara. Subí una imagen en su lugar.'
              : 'No pudimos acceder a la cámara. Subí una imagen en su lugar.',
        );
        setActiveTab('subir');
      }
    })();

    return () => {
      cancelado = true;
      void detenerCamara();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stage, activeTab]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
      formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13],
      verbose: false,
    });
    try {
      const resultado = await scanner.scanFileV2(file, false);
      handleDecoded(resultado.decodedText);
    } catch {
      setCameraError('No pudimos leer un código EAN-13 en esa imagen. Probá con otra foto.');
    } finally {
      scanner.clear();
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRechazar = () => setStage('discarded');
  const handleAceptar = () => setStage('portion');
  const handleEscanearOtro = () => {
    setProducto(null);
    setCameraError(null);
    setStage('source');
  };

  return (
    <Modal open={open} onClose={handleClose} title="📷 Escanear código de barras">
      <div className="space-y-4">
        {stage === 'source' && (
          <>
            <div className="flex gap-2 rounded-xl bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setActiveTab('camara')}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  activeTab === 'camara' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
                }`}
              >
                Usar cámara
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('subir')}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  activeTab === 'subir' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
                }`}
              >
                Subir imagen
              </button>
            </div>

            <div
              id={SCANNER_ELEMENT_ID}
              className={activeTab === 'camara' ? 'overflow-hidden rounded-2xl bg-black min-h-56' : 'hidden'}
            />

            {activeTab === 'subir' && (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void handleFile(e.dataTransfer.files?.[0]);
                }}
                className="flex h-56 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 text-center hover:border-orange-300"
              >
                <span className="text-3xl" aria-hidden="true">🖼️</span>
                <p className="text-sm font-medium text-gray-600">
                  Arrastrá una imagen del código de barras o hacé click para elegir un archivo
                </p>
              </div>
            )}

            {cameraError && (
              <p
                className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700"
                aria-live="polite"
              >
                {cameraError}
              </p>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
          </>
        )}

        {stage === 'fetching' && (
          <div className="flex h-56 items-center justify-center">
            <svg className="h-8 w-8 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}

        {stage === 'confirm' && producto?.encontrado && (
          <div className="space-y-4">
            <div className="flex gap-3">
              {producto.imagenUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={producto.imagenUrl}
                  alt={producto.nombre}
                  className="h-20 w-20 rounded-xl object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900">{producto.nombre}</p>
                {producto.marca && <p className="text-xs text-gray-500">{producto.marca}</p>}
                <p className="text-xs text-gray-400">{producto.categoria}</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 rounded-2xl bg-gray-50 p-3 text-center">
              <div>
                <p className="text-sm font-bold text-gray-900">{producto.nutrientes100g.kcal}</p>
                <p className="text-[10px] text-gray-400">kcal/100g</p>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">{producto.nutrientes100g.proteinas}g</p>
                <p className="text-[10px] text-gray-400">Proteínas</p>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">{producto.nutrientes100g.grasas}g</p>
                <p className="text-[10px] text-gray-400">Grasas</p>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">{producto.nutrientes100g.carbs}g</p>
                <p className="text-[10px] text-gray-400">Carbs</p>
              </div>
            </div>
            <p className="text-center text-sm font-medium text-gray-700">¿Es este tu alimento?</p>
            <div className="flex gap-2">
              <Button type="button" variant="primary" className="flex-1" onClick={handleAceptar}>
                Sí, es correcto
              </Button>
              <Button type="button" variant="outline" className="flex-1" onClick={handleRechazar}>
                No, es otro
              </Button>
            </div>
          </div>
        )}

        {stage === 'portion' && producto?.encontrado && (
          <form action={addScannedItemAction} className="space-y-4">
            <input type="hidden" name="fecha" value={fecha} />
            <input type="hidden" name="tipo_ingesta" value={tipoIngesta} />
            <input type="hidden" name="tipo_item" value="solido" />
            <input type="hidden" name="ean" value={producto.ean} />
            <p className="text-sm font-medium text-gray-700">¿Cuánto comiste de {producto.nombre}?</p>
            <div className="grid grid-cols-2 gap-2">
              {PORCIONES.map(({ label, fraccion }) => {
                const gramos = Math.round(producto.porcion * fraccion);
                return (
                  <button
                    key={label}
                    type="submit"
                    name="cantidad"
                    value={gramos}
                    className="rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-700 hover:border-orange-300 hover:bg-orange-50"
                  >
                    {label}
                    <span className="block text-xs font-normal text-gray-400">{gramos} g</span>
                  </button>
                );
              })}
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={() => setStage('confirm')}>
              Volver
            </Button>
          </form>
        )}

        {stage === 'discarded' && (
          <div className="space-y-4">
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {producto?.encontrado === false
                ? 'No pudimos encontrar datos nutricionales confiables para este código de barras. '
                : ''}
              Te sugerimos usar otro método de registro: búsqueda manual por nombre o registro por chat.
            </p>
            <Button type="button" variant="primary" className="w-full" onClick={handleEscanearOtro}>
              Escanear otro código
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Correr los tests base y verificar que pasan**

Run: `npx vitest run testing/BarcodeScannerModal.test.tsx`
Expected: PASS — los 4 tests del Step 1 en verde.

- [ ] **Step 5: Commit**

```bash
git add src/app/alimentacion/BarcodeScannerModal.tsx testing/BarcodeScannerModal.test.tsx
git commit -m "feat: BarcodeScannerModal — captura por cámara/imagen y consulta a OFF"
```

- [ ] **Step 6: Agregar los tests de confirmación, descarte y porción**

Agregar a `testing/BarcodeScannerModal.test.tsx`, dentro de un nuevo `describe`:

```tsx
describe('BarcodeScannerModal — confirmación y porción', () => {
  it('"No, es otro" pasa a la pantalla de descarte sugiriendo otro método', async () => {
    const { user } = renderModal();
    await simularEscaneo();
    await screen.findByText('¿Es este tu alimento?');

    await user.click(screen.getByRole('button', { name: 'No, es otro' }));

    expect(
      await screen.findByText(/te sugerimos usar otro método de registro/i),
    ).toBeInTheDocument();
  });

  it('si el producto no se encuentra (o sin datos nutricionales), va directo a la pantalla de descarte', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ encontrado: false, ean: '0000000000000' });
    renderModal();
    await simularEscaneo();

    expect(
      await screen.findByText(/no pudimos encontrar datos nutricionales confiables/i),
    ).toBeInTheDocument();
  });

  it('"Escanear otro código" vuelve a la pantalla inicial', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ encontrado: false, ean: '0000000000000' });
    const { user } = renderModal();
    await simularEscaneo();
    await screen.findByText(/no pudimos encontrar datos nutricionales confiables/i);

    await user.click(screen.getByRole('button', { name: 'Escanear otro código' }));

    expect(screen.getByRole('button', { name: 'Usar cámara' })).toBeInTheDocument();
  });

  it('los botones de porción muestran los gramos calculados según la porción del producto', async () => {
    const { user } = renderModal();
    await simularEscaneo();
    await user.click(await screen.findByRole('button', { name: 'Sí, es correcto' }));

    expect(screen.getByRole('button', { name: /1\/4 de porción/ })).toHaveTextContent('11 g'); // 45 * 0.25 ≈ 11
    expect(screen.getByRole('button', { name: /^1 porción/ })).toHaveTextContent('45 g');
    expect(screen.getByRole('button', { name: /2 porciones/ })).toHaveTextContent('90 g');
  });

  it('al elegir una porción, llama a addScannedItemAction con fecha/tipo_ingesta/ean/cantidad correctos', async () => {
    const { user } = renderModal();
    await simularEscaneo();
    await user.click(await screen.findByRole('button', { name: 'Sí, es correcto' }));

    await user.click(screen.getByRole('button', { name: /^1 porción/ }));

    await waitFor(() => expect(addScannedItemAction).toHaveBeenCalled());
    const formData = vi.mocked(addScannedItemAction).mock.calls[0][0] as FormData;
    expect(formData.get('fecha')).toBe('2026-09-21');
    expect(formData.get('tipo_ingesta')).toBe('almuerzo');
    expect(formData.get('ean')).toBe('7790040000100');
    expect(formData.get('cantidad')).toBe('45');
  });

  it('"Volver" desde la pantalla de porción regresa a la confirmación', async () => {
    const { user } = renderModal();
    await simularEscaneo();
    await user.click(await screen.findByRole('button', { name: 'Sí, es correcto' }));

    await user.click(screen.getByRole('button', { name: 'Volver' }));

    expect(await screen.findByText('¿Es este tu alimento?')).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Correr todos los tests del componente y verificar que pasan**

Run: `npx vitest run testing/BarcodeScannerModal.test.tsx`
Expected: PASS — 10 tests en verde.

- [ ] **Step 8: Correr la suite completa y typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: sin errores de tipos, toda la suite en verde.

- [ ] **Step 9: Commit**

```bash
git add testing/BarcodeScannerModal.test.tsx
git commit -m "test: confirmación, descarte y selección de porción en BarcodeScannerModal"
```

---

### Task 6: Integración en `AlimentacionClient`

**Files:**
- Modify: `src/app/alimentacion/AlimentacionClient.tsx`
- Modify: `testing/AlimentacionSearch.test.tsx`

**Interfaces:**
- Consumes: `BarcodeScannerModal` (Task 5) con props `{ open, onClose, fecha, tipoIngesta }`.

- [ ] **Step 1: Actualizar el mock de módulos en el test de integración existente**

En `testing/AlimentacionSearch.test.tsx`, agregar junto a los otros dos mocks de modales (línea 26):

```tsx
vi.mock('@/app/alimentacion/BarcodeScannerModal', () => ({ default: () => null }));
```

- [ ] **Step 2: Correr la suite existente y verificar que sigue pasando (antes de tocar el componente real)**

Run: `npx vitest run testing/AlimentacionSearch.test.tsx`
Expected: PASS — el mock no cambia ningún comportamiento todavía porque `AlimentacionClient` no importa `BarcodeScannerModal` aún.

- [ ] **Step 3: Agregar el botón y montar el modal en `AlimentacionClient`**

En `src/app/alimentacion/AlimentacionClient.tsx`:

Agregar el import junto a los otros dos modales (línea 23):

```tsx
import BarcodeScannerModal from './BarcodeScannerModal';
```

Agregar el estado junto a `showChatModal` (línea 99):

```tsx
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
```

Agregar el botón después del botón "Registrar por chat" (tras la línea 292, dentro del mismo `div` de botones):

```tsx
        {/* Barcode scanner button */}
        <button
          type="button"
          onClick={() => setShowBarcodeModal(true)}
          className="flex-shrink-0 flex items-center gap-1.5 rounded-2xl px-4 py-3.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03] active:scale-[0.98]"
          style={{
            backgroundImage: 'linear-gradient(135deg, #f97316 0%, #f59e0b 100%)',
            boxShadow: '0 8px 20px rgba(249,115,22,0.35)',
          }}
        >
          <span aria-hidden="true">📷</span>
          <span className="hidden sm:inline">Escanear código</span>
        </button>
```

Montar el modal junto a los otros dos (tras el cierre de `</ChatFoodModal>` en línea 409):

```tsx
      {/* Barcode scanner modal */}
      <BarcodeScannerModal
        open={showBarcodeModal}
        onClose={() => setShowBarcodeModal(false)}
        fecha={fecha}
        tipoIngesta={tipoIngesta}
      />
```

- [ ] **Step 4: Correr la suite de integración y verificar que sigue pasando**

Run: `npx vitest run testing/AlimentacionSearch.test.tsx`
Expected: PASS.

- [ ] **Step 5: Correr toda la suite y el typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: sin errores, toda la suite en verde.

- [ ] **Step 6: Commit**

```bash
git add src/app/alimentacion/AlimentacionClient.tsx testing/AlimentacionSearch.test.tsx
git commit -m "feat: integrar BarcodeScannerModal como tercer método de carga en AlimentacionClient"
```

---

## Verificación final

- [ ] Run: `npm run test` (equivale a `vitest run`, ambos proyectos node+jsdom) — todo en verde.
- [ ] Run: `npx tsc --noEmit` — sin errores.
- [ ] Confirmar que la sección 010 de `supabase/schema_consolidado.sql` fue aplicada contra el proyecto de Supabase real (Task 2, Step 2) antes de dar el branch por terminado — sin esto, `addScannedItemAction` fallará en runtime aunque el código compile y los tests (mockeados) pasen.
