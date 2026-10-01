# Refactor del escáner de código de barras (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactorizar el módulo de escaneo de código de barras: diferenciación estricta móvil/desktop, paso de recorte manual antes de decodificar imágenes, redondeo a 1 decimal, detección y ruteo automático de suplementos, información ampliada de Open Food Facts (Nutri-Score/NOVA/badges), navegación "Volver" en cada pantalla, y un Step 3 rediseñado (Por Paquete vs. Por Porción del Fabricante, con opción de personalizar).

**Architecture:** Extiende el módulo ya en producción (`feat-barcode-scanning-flow`, mergeado) sin tocar su arquitectura base: mismo servicio (`openFoodFacts.ts`), misma tabla (`alimentos_barcode`), mismo server action (`addScannedItemAction`), mismo componente (`BarcodeScannerModal.tsx`). El paso de recorte reutiliza `src/lib/recorteFoto.ts` tal cual existe (ya resolvió este problema para `AIRecognitionModal`) en vez de traer una librería de crop nueva.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase, Tailwind CSS, Vitest + Testing Library, `html5-qrcode` (ya instalado).

**Spec:** `docs/superpowers/specs/2026-09-30-barcode-scanning-refactor-design.md` (y `docs/superpowers/specs/2026-09-28-barcode-scanning-flow-design.md` para el contexto base que no cambia).

## Global Constraints

- Los 4 macros se redondean a 1 decimal en el servicio (`redondear1`), no en la base de datos (esa sigue en 2 decimales, estándar de toda la app).
- Desktop (`!esTactil()`): no existe ninguna forma de activar la cámara — ni pestaña, ni botón. Solo queda la zona de archivo/drag&drop.
- Móvil: el input de "Elegir de galería" **no** lleva `capture="environment"`.
- Toda imagen que entra por archivo (subida o drag&drop) pasa por el stage `cropping` antes de decodificar. La cámara en vivo nunca pasa por acá.
- Las 5 palabras clave de suplemento son exactamente: `suplemento`, `supplement`, `proteina`, `creatina`, `multivitaminico` (sin ampliar la lista).
- Las columnas nuevas de Open Food Facts van a `alimentos_barcode`, nunca a `alimentos`.
- No se reintroduce `onConfirmarAlimento`: el flujo sigue persistiendo directo vía `addScannedItemAction` y cerrando el modal (`onSubmit={handleClose}`).
- Botón `[ ← Volver ]` visible en toda pantalla excepto `source` y `fetching` (la última es una consulta automática sin interacción posible, mismo criterio que `AIRecognitionModal` para su etapa de reconocimiento).

## Review Focus

- `pesoNetoTotal` mal parseado en productos multipack (ej. `"4 x 25 g"`) daría un gramaje total incorrecto en vez de caer a `null` — un valor incorrecto silencioso es peor que el fallback de "Personalizar". → cubierto por un guard explícito + test en Task 1.
- El input de "Personalizar" de la pantalla `paquete` comparte `name="cantidad"` con los botones fijos dentro del mismo `<form>` — si el guard de HTML forms sobre "solo el control de submit activado aporta su name/value" no se respeta en la implementación, se podría enviar dos valores de `cantidad` o el incorrecto. → cubierto por un test que verifica el valor de `cantidad` en el `FormData` según cuál control se usó.
- `esSuplemento` con texto que contiene la palabra clave como substring de otra palabra no relacionada (ej. "proteinas" en una categoría genérica tipo "snacks proteina-free" todavía matchea, que es el comportamiento esperado) — no se intenta excluir falsos positivos de substring, documentado como aceptado en el spec v1/v2, no es un gap nuevo.
- Si `producto.porcionEtiqueta` es una cadena vacía después de trim (OFF a veces manda `serving_size: ""`), no debe tratarse como presente. → cubierto por test en Task 1 (ya sigue el mismo patrón que `nombre`/`marca`).
- El acordeón "Ampliar información" cuando NINGUNO de los 3 bloques (nutriscore/nova/badges) tiene datos debe mostrar el mensaje de fallback, no quedar vacío o romperse iterando sobre `null`s. → cubierto por test en Task 6.

---

## File Structure

- **Modify:** `src/lib/openFoodFacts.ts` — campos nuevos en `ProductoEncontrado`, helpers de redondeo/suplemento/peso neto/info ampliada.
- **Modify:** `testing/openFoodFacts.test.ts` — tests de los campos nuevos.
- **Modify:** `supabase/schema_consolidado.sql` — sección 012, columnas nuevas en `alimentos_barcode`.
- **Modify:** `src/app/alimentacion/actions.ts` — `addScannedItemAction` persiste los campos nuevos.
- **Modify:** `src/app/alimentacion/BarcodeScannerModal.tsx` — diferenciación de dispositivo, stage de recorte, pantalla de confirmación ampliada, stages `mode`/`paquete`/`porcion` (reemplazan al viejo `portion`), navegación Volver.
- **Modify:** `testing/BarcodeScannerModal.test.tsx` — tests de todo lo anterior.

---

### Task 1: Servicio — redondeo, suplementos, peso neto, info ampliada

**Files:**
- Modify: `src/lib/openFoodFacts.ts`
- Modify: `testing/openFoodFacts.test.ts`
- Modify: `testing/BarcodeScannerModal.test.tsx` (solo el fixture `PRODUCTO_OK`, ver Step 5 — necesario para que el typecheck de este mismo task pase)

**Interfaces:**
- Produces: `ProductoEncontrado` extendido con `esSuplemento: boolean`, `porcionEtiqueta: string | null`, `pesoNetoTotal: number | null`, `infoAmpliada: { nutriscore: 'a'|'b'|'c'|'d'|'e'|null; novaGroup: 1|2|3|4|null; sinGluten: boolean; vegano: boolean; vegetariano: boolean }`. Los 4 campos de `nutrientes100g` ahora vienen redondeados a 1 decimal. Tasks 3, 6, 7, 8 consumen estos campos.

- [ ] **Step 1: Escribir los tests nuevos**

Agregar a `testing/openFoodFacts.test.ts`, dentro del `describe('obtenerProductoPorEAN', ...)` existente (antes del cierre del `describe`):

```ts
  it('redondea los 4 macros a 1 decimal', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name: 'Producto con decimales largos',
        nutriments: {
          'energy-kcal_100g': 120.566,
          proteins_100g: 3.249,
          fat_100g: 1.05,
          carbohydrates_100g: 24.84,
        },
      },
    });
    const result = await obtenerProductoPorEAN('7790040000800');
    expect(result.encontrado).toBe(true);
    if (result.encontrado) {
      expect(result.nutrientes100g).toEqual({ kcal: 120.6, proteinas: 3.2, grasas: 1.1, carbs: 24.8 });
    }
  });

  describe('esSuplemento', () => {
    const base = {
      status: 1,
      product: {
        nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
      },
    };

    it.each([
      ['Suplemento Multivitamínico', '', ''],
      ['Whey Protein', 'supplement', ''],
      ['Barrita', 'proteina', ''],
      ['Monohidrato', 'creatina', ''],
      ['Complejo B', 'multivitaminico', ''],
    ])('detecta "%s" / categoria "%s" / marca "%s" como suplemento', async (nombre, categoria, marca) => {
      mockFetchOnce({
        ...base,
        product: { ...base.product, product_name: nombre, categories: categoria, brands: marca },
      });
      const result = await obtenerProductoPorEAN('7790040000900');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.esSuplemento).toBe(true);
    });

    it('un alimento común no se marca como suplemento', async () => {
      mockFetchOnce({
        ...base,
        product: { ...base.product, product_name: 'Arroz blanco', categories: 'Cereales', brands: 'Marca X' },
      });
      const result = await obtenerProductoPorEAN('7790040001000');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.esSuplemento).toBe(false);
    });
  });

  describe('porcionEtiqueta', () => {
    it('toma el texto de serving_size cuando está presente', async () => {
      mockFetchOnce({
        status: 1,
        product: {
          product_name: 'Galletitas',
          serving_size: '2.5 galletitas (30g)',
          nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
        },
      });
      const result = await obtenerProductoPorEAN('7790040001100');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.porcionEtiqueta).toBe('2.5 galletitas (30g)');
    });

    it('es null cuando serving_size está ausente o vacío', async () => {
      mockFetchOnce({
        status: 1,
        product: {
          product_name: 'Producto sin etiqueta de porción',
          serving_size: '   ',
          nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
        },
      });
      const result = await obtenerProductoPorEAN('7790040001200');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.porcionEtiqueta).toBeNull();
    });
  });

  describe('pesoNetoTotal', () => {
    const conQuantity = (quantity?: unknown, product_quantity?: unknown) => ({
      status: 1,
      product: {
        product_name: 'Producto con peso neto',
        quantity,
        product_quantity,
        nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
      },
    });

    it('usa product_quantity numérico cuando está presente', async () => {
      mockFetchOnce(conQuantity('150 g', '150'));
      const result = await obtenerProductoPorEAN('7790040001300');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.pesoNetoTotal).toBe(150);
    });

    it('parsea quantity en gramos cuando falta product_quantity', async () => {
      mockFetchOnce(conQuantity('250 g', undefined));
      const result = await obtenerProductoPorEAN('7790040001400');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.pesoNetoTotal).toBe(250);
    });

    it('convierte quantity en kg a gramos', async () => {
      mockFetchOnce(conQuantity('1.5 kg', undefined));
      const result = await obtenerProductoPorEAN('7790040001500');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.pesoNetoTotal).toBe(1500);
    });

    it('convierte quantity en litros a "gramos" (ml, densidad ~1)', async () => {
      mockFetchOnce(conQuantity('1.5 l', undefined));
      const result = await obtenerProductoPorEAN('7790040001600');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.pesoNetoTotal).toBe(1500);
    });

    it('es null cuando no hay quantity ni product_quantity', async () => {
      mockFetchOnce(conQuantity(undefined, undefined));
      const result = await obtenerProductoPorEAN('7790040001700');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.pesoNetoTotal).toBeNull();
    });

    it('es null para texto de multipack ambiguo (ej. "4 x 25 g") en vez de calcular mal', async () => {
      mockFetchOnce(conQuantity('4 x 25 g', undefined));
      const result = await obtenerProductoPorEAN('7790040001800');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) expect(result.pesoNetoTotal).toBeNull();
    });
  });

  describe('infoAmpliada', () => {
    it('extrae nutriscore, nova group y los 3 labels cuando vienen completos', async () => {
      mockFetchOnce({
        status: 1,
        product: {
          product_name: 'Producto con info completa',
          nutriscore_grade: 'B',
          nova_group: 3,
          labels_tags: ['en:vegan', 'en:gluten-free'],
          nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
        },
      });
      const result = await obtenerProductoPorEAN('7790040001900');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) {
        expect(result.infoAmpliada).toEqual({
          nutriscore: 'b',
          novaGroup: 3,
          sinGluten: true,
          vegano: true,
          vegetariano: true, // vegano implica vegetariano
        });
      }
    });

    it('nutriscore inválido y nova_group fuera de rango caen a null; sin labels, los 3 booleanos son false', async () => {
      mockFetchOnce({
        status: 1,
        product: {
          product_name: 'Producto con info rara',
          nutriscore_grade: 'z',
          nova_group: 7,
          nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
        },
      });
      const result = await obtenerProductoPorEAN('7790040002000');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) {
        expect(result.infoAmpliada).toEqual({
          nutriscore: null,
          novaGroup: null,
          sinGluten: false,
          vegano: false,
          vegetariano: false,
        });
      }
    });

    it('vegetariano true sin ser vegano cuando el label es solo en:vegetarian', async () => {
      mockFetchOnce({
        status: 1,
        product: {
          product_name: 'Producto vegetariano no vegano',
          labels_tags: ['en:vegetarian'],
          nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
        },
      });
      const result = await obtenerProductoPorEAN('7790040002100');
      expect(result.encontrado).toBe(true);
      if (result.encontrado) {
        expect(result.infoAmpliada.vegano).toBe(false);
        expect(result.infoAmpliada.vegetariano).toBe(true);
      }
    });
  });
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run testing/openFoodFacts.test.ts`
Expected: FAIL — `esSuplemento`/`porcionEtiqueta`/`pesoNetoTotal`/`infoAmpliada` no existen en el resultado, y los macros no están redondeados a 1 decimal.

- [ ] **Step 3: Implementar los helpers y extender `obtenerProductoPorEAN`**

Reemplazar el contenido completo de `src/lib/openFoodFacts.ts` por:

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
  esSuplemento: boolean;
  porcionEtiqueta: string | null;
  pesoNetoTotal: number | null;
  infoAmpliada: {
    nutriscore: 'a' | 'b' | 'c' | 'd' | 'e' | null;
    novaGroup: 1 | 2 | 3 | 4 | null;
    sinGluten: boolean;
    vegano: boolean;
    vegetariano: boolean;
  };
}

export interface ProductoNoEncontrado {
  encontrado: false;
  ean: string;
}

export type ProductoOFF = ProductoEncontrado | ProductoNoEncontrado;

const OFF_TIMEOUT_MS = 8000;

// OFF a veces manda los números como string (ej. "450" en vez de 450).
// Parsearlos evita que un macro real se pierda como si estuviese ausente.
function aNumero(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function numeroPositivoONulo(value: unknown): number | null {
  const n = aNumero(value);
  return n != null && n > 0 ? n : null;
}

function redondear1(n: number): number {
  return Math.round(n * 10) / 10;
}

function primeraCategoria(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'Sin categoría';
  const primera = value.split(',')[0]?.trim();
  return primera || 'Sin categoría';
}

const PALABRAS_SUPLEMENTO = ['suplemento', 'supplement', 'proteina', 'creatina', 'multivitaminico'];

function normalizarTexto(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function detectarSuplemento(nombre: string, categoria: string, marca: string | null): boolean {
  const texto = normalizarTexto(`${nombre} ${categoria} ${marca ?? ''}`);
  return PALABRAS_SUPLEMENTO.some((palabra) => texto.includes(palabra));
}

function extraerPorcionEtiqueta(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Gramos del envase completo. Heurística, no un parseo garantizado: OFF no
 * siempre normaliza `quantity`/`product_quantity`. Casos ambiguos (ej.
 * multipacks "4 x 25 g") devuelven null a propósito — un valor incorrecto
 * silencioso sería peor que el fallback de "Personalizar" en el componente.
 */
function parsePesoNetoTotal(product: Record<string, unknown>): number | null {
  const directo = aNumero(product.product_quantity);
  if (directo != null && directo > 0) return directo;

  const texto = product.quantity;
  if (typeof texto !== 'string') return null;
  if (/\d+\s*x\s*\d/i.test(texto)) return null; // multipack ambiguo, no adivinar

  const match = texto.match(/([\d.,]+)\s*(kg|g|l|ml)\b/i);
  if (!match) return null;
  const valor = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(valor) || valor <= 0) return null;
  const unidad = match[2].toLowerCase();
  return unidad === 'kg' || unidad === 'l' ? valor * 1000 : valor;
}

const NUTRISCORE_VALIDOS = ['a', 'b', 'c', 'd', 'e'];

function extraerNutriscore(value: unknown): ProductoEncontrado['infoAmpliada']['nutriscore'] {
  if (typeof value !== 'string') return null;
  const normalizado = value.toLowerCase();
  return NUTRISCORE_VALIDOS.includes(normalizado)
    ? (normalizado as ProductoEncontrado['infoAmpliada']['nutriscore'])
    : null;
}

function extraerNovaGroup(value: unknown): ProductoEncontrado['infoAmpliada']['novaGroup'] {
  const n = aNumero(value);
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : null;
}

function extraerInfoAmpliada(product: Record<string, unknown>): ProductoEncontrado['infoAmpliada'] {
  const labels = Array.isArray(product.labels_tags) ? (product.labels_tags as unknown[]) : [];
  const tieneLabel = (tag: string) => labels.includes(tag);
  const vegano = tieneLabel('en:vegan');
  return {
    nutriscore: extraerNutriscore(product.nutriscore_grade),
    novaGroup: extraerNovaGroup(product.nova_group),
    sinGluten: tieneLabel('en:gluten-free') || tieneLabel('en:no-gluten'),
    vegano,
    vegetariano: vegano || tieneLabel('en:vegetarian'),
  };
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

    const kcalNum = aNumero(n['energy-kcal_100g']);
    const proteinasNum = aNumero(n['proteins_100g']);
    const grasasNum = aNumero(n['fat_100g']);
    const carbsNum = aNumero(n['carbohydrates_100g']);

    const todosAusentes =
      kcalNum === null && proteinasNum === null && grasasNum === null && carbsNum === null;
    if (todosAusentes) return { encontrado: false, ean };

    const nombre =
      typeof product.product_name === 'string' && product.product_name.trim()
        ? product.product_name.trim()
        : 'Producto sin nombre';
    const categoria = primeraCategoria(product.categories);
    const marca =
      typeof product.brands === 'string' && product.brands.trim() ? product.brands.trim() : null;

    return {
      encontrado: true,
      ean,
      nombre,
      categoria,
      marca,
      porcion: numeroPositivoONulo(product.serving_quantity) ?? 100,
      nutrientes100g: {
        kcal: redondear1(kcalNum ?? 0),
        proteinas: redondear1(proteinasNum ?? 0),
        grasas: redondear1(grasasNum ?? 0),
        carbs: redondear1(carbsNum ?? 0),
      },
      imagenUrl: typeof product.image_url === 'string' && product.image_url ? product.image_url : null,
      esSuplemento: detectarSuplemento(nombre, categoria, marca),
      porcionEtiqueta: extraerPorcionEtiqueta(product.serving_size),
      pesoNetoTotal: parsePesoNetoTotal(product),
      infoAmpliada: extraerInfoAmpliada(product),
    };
  } catch {
    return { encontrado: false, ean };
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run testing/openFoodFacts.test.ts`
Expected: PASS — todos los tests (los de la v1 más los nuevos de este task) en verde.

- [ ] **Step 5: Actualizar el fixture `PRODUCTO_OK` en `testing/BarcodeScannerModal.test.tsx`**

`ProductoEncontrado` ahora exige 4 campos nuevos. El fixture `PRODUCTO_OK` que ya existe en `testing/BarcodeScannerModal.test.tsx` (usado por `vi.mocked(obtenerProductoPorEAN).mockResolvedValue(PRODUCTO_OK)` en varios tests) no los tiene — sin este paso, `tsc --noEmit` falla por tipos incompletos aunque no se haya tocado ese archivo todavía.

Reemplazar:

```ts
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
```

por:

```ts
const PRODUCTO_OK = {
  encontrado: true as const,
  ean: '7790040000100',
  nombre: 'Alfajor Triple',
  categoria: 'Snacks dulces',
  marca: 'Havanna',
  porcion: 45,
  nutrientes100g: { kcal: 450, proteinas: 5, grasas: 20, carbs: 60 },
  imagenUrl: null,
  esSuplemento: false,
  porcionEtiqueta: null,
  pesoNetoTotal: null,
  infoAmpliada: { nutriscore: null, novaGroup: null, sinGluten: false, vegano: false, vegetariano: false },
};
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores (incluye `testing/BarcodeScannerModal.test.tsx`, que es parte del proyecto aunque este task no lo modifique salvo el fixture del Step 5).

- [ ] **Step 7: Commit**

```bash
git add src/lib/openFoodFacts.ts testing/openFoodFacts.test.ts testing/BarcodeScannerModal.test.tsx
git commit -m "feat: redondeo a 1 decimal, detección de suplementos, peso neto e info ampliada de OFF"
```

---

### Task 2: Schema — info ampliada en `alimentos_barcode`

**Files:**
- Modify: `supabase/schema_consolidado.sql`

**Interfaces:**
- Produces: columnas `alimentos_barcode.nutriscore_grade`, `.nova_group`, `.is_gluten_free`, `.is_vegan`, `.is_vegetarian`, `.serving_quantity_label`. Task 3 depende de que existan tal cual.

Igual que el schema de la v1 (Task 2 de `docs/superpowers/plans/2026-09-28-barcode-scanning-flow.md`), este repo no tiene infraestructura de tests contra una base Postgres real — este task no lleva tests automatizados, se verifica aplicando el SQL a mano.

- [ ] **Step 1: Agregar la sección de schema**

Agregar al final de `supabase/schema_consolidado.sql` (después de la sección `011` existente):

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

COMMENT ON COLUMN public.alimentos_barcode.nutriscore_grade IS 'Calificación Nutri-Score de A a E (Open Food Facts)';
COMMENT ON COLUMN public.alimentos_barcode.nova_group IS 'Clasificación NOVA de procesamiento (1 a 4, Open Food Facts)';
```

- [ ] **Step 2: Aplicar el SQL contra el proyecto de Supabase y verificar que corre sin errores**

Run (vía Supabase SQL editor o `psql`): pegar y ejecutar el bloque anterior.

Expected: sin errores. `select nutriscore_grade, nova_group, is_gluten_free, is_vegan, is_vegetarian, serving_quantity_label from public.alimentos_barcode limit 1;` corre sin error (devuelve 0 filas si la tabla está vacía, eso es normal).

- [ ] **Step 3: Commit**

```bash
git add supabase/schema_consolidado.sql
git commit -m "feat(db): columnas de info ampliada de OFF en alimentos_barcode"
```

---

### Task 3: Persistir la info ampliada en `addScannedItemAction`

**Files:**
- Modify: `src/app/alimentacion/actions.ts`

**Interfaces:**
- Consumes: `ProductoEncontrado.infoAmpliada` y `.porcionEtiqueta` (Task 1).

Sin tests nuevos — mismo motivo que el resto de `actions.ts` (ver Task 4 del plan v1): no hay infraestructura de tests para server actions en este repo.

- [ ] **Step 1: Agregar los campos nuevos al upsert**

En `src/app/alimentacion/actions.ts`, dentro de `addScannedItemAction`, el objeto que se pasa a `.upsert(...)` contra `alimentos_barcode` agrega 6 campos:

Reemplazar:

```ts
  const { data: alimentoBarcode, error: upsertError } = await admin
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
```

por:

```ts
  const { data: alimentoBarcode, error: upsertError } = await admin
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
        nutriscore_grade: producto.infoAmpliada.nutriscore,
        nova_group: producto.infoAmpliada.novaGroup,
        is_gluten_free: producto.infoAmpliada.sinGluten,
        is_vegan: producto.infoAmpliada.vegano,
        is_vegetarian: producto.infoAmpliada.vegetariano,
        serving_quantity_label: producto.porcionEtiqueta,
      },
      { onConflict: 'codigo_ean' },
    )
```

- [ ] **Step 2: Typecheck y suite completa**

Run: `npx tsc --noEmit && npx vitest run`
Expected: sin errores de tipos, toda la suite en verde (nada mockea el shape exacto del objeto que se le pasa a `.upsert`, así que ningún test existente debería romperse).

- [ ] **Step 3: Commit**

```bash
git add src/app/alimentacion/actions.ts
git commit -m "feat: persistir nutriscore/nova/labels/porcionEtiqueta en alimentos_barcode"
```

---

### Task 4: Diferenciación estricta de dispositivo

**Files:**
- Modify: `src/app/alimentacion/BarcodeScannerModal.tsx`
- Modify: `testing/BarcodeScannerModal.test.tsx`

**Interfaces:**
- Sin cambios de interfaz pública del componente.

Este task renombra las pestañas ("Usar cámara" → "Escanear con cámara", "Subir imagen" → "Elegir de galería", siguiendo el texto exacto del spec) y oculta la pestaña de cámara por completo en desktop — varios tests existentes referencian los nombres viejos y hay que actualizarlos.

- [ ] **Step 1: Actualizar los tests existentes que referencian las pestañas viejas**

En `testing/BarcodeScannerModal.test.tsx`, reemplazar cada ocurrencia de `'Usar cámara'` por `'Escanear con cámara'` y cada ocurrencia de `'Subir imagen'` por `'Elegir de galería'` (son nombres de botón usados en `screen.getByRole('button', { name: ... })` en varios tests existentes — buscar ambas strings literales en el archivo y reemplazar todas sus apariciones).

- [ ] **Step 2: Agregar los tests de la nueva restricción de desktop**

Agregar al `describe('BarcodeScannerModal — captura', ...)` existente:

```tsx
  it('en desktop, la pestaña de cámara no existe (ni como botón)', async () => {
    mockPointerCoarse(false);
    renderModal();
    expect(screen.queryByRole('button', { name: 'Escanear con cámara' })).not.toBeInTheDocument();
    expect(screen.getByText(/arrastrá una imagen/i)).toBeInTheDocument();
  });

  it('en móvil, ambas pestañas existen', async () => {
    mockPointerCoarse(true);
    renderModal();
    expect(screen.getByRole('button', { name: 'Escanear con cámara' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elegir de galería' })).toBeInTheDocument();
  });
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `npx vitest run testing/BarcodeScannerModal.test.tsx`
Expected: FAIL — los nombres de botón todavía son los viejos y la pestaña de cámara todavía existe en desktop.

- [ ] **Step 4: Implementar**

En `src/app/alimentacion/BarcodeScannerModal.tsx`:

Agregar estado para saber si el dispositivo es táctil (reemplaza el `useEffect` que solo setea `activeTab`):

```ts
  const [esDispositivoTactil, setEsDispositivoTactil] = useState(true);

  useEffect(() => {
    if (!open) return;
    const tactil = esTactil();
    setEsDispositivoTactil(tactil);
    setActiveTab(tactil ? 'camara' : 'subir');
  }, [open]);
```

(reemplaza el `useEffect` existente de 3 líneas que solo hacía `setActiveTab`.)

Reemplazar el bloque de pestañas y el input de archivo:

```tsx
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
```

por:

```tsx
            {esDispositivoTactil && (
              <div className="flex gap-2 rounded-xl bg-gray-100 p-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('camara')}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                    activeTab === 'camara' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
                  }`}
                >
                  Escanear con cámara
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('subir')}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                    activeTab === 'subir' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
                  }`}
                >
                  Elegir de galería
                </button>
              </div>
            )}
```

Y el input de archivo (sacarle `capture="environment"`):

```tsx
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
```

por:

```tsx
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              aria-label="Subir imagen del código de barras"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
```

Nota: en desktop, `activeTab` queda fijo en `'subir'` (seteado por el `useEffect` de arriba) y nunca cambia porque no hay botón para cambiarlo — el bloque `{activeTab === 'camara' && ...}` del `<div id={SCANNER_ELEMENT_ID}>` (ver Task 5, que lo mueve de lugar) simplemente nunca se activa en desktop. No hace falta ningún chequeo adicional de `esDispositivoTactil` en el resto del stage `source`.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run testing/BarcodeScannerModal.test.tsx`
Expected: PASS — todos los tests existentes (ya renombrados) más los 2 nuevos.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add src/app/alimentacion/BarcodeScannerModal.tsx testing/BarcodeScannerModal.test.tsx
git commit -m "feat: ocultar cámara por completo en desktop, galería sin capture en móvil"
```

---

### Task 5: Paso de recorte manual (stage `cropping`)

**Files:**
- Modify: `src/app/alimentacion/BarcodeScannerModal.tsx`
- Modify: `testing/BarcodeScannerModal.test.tsx`

**Interfaces:**
- Consumes: `calcularRecorte`, `recortarImagen` de `@/lib/recorteFoto` (ya existen, sin cambios — ver spec §2.2 para su firma).
- Produces: nuevo stage `'cropping'` en el tipo `Stage`; helper `renderVolver(target: Stage): JSX.Element` reutilizado por los tasks siguientes.

**Nota sobre testing:** `recortarImagen` ya se degrada de forma segura en jsdom (sin `canvas.getContext('2d')` real, devuelve el archivo original sin tocar — así está documentado en su propio código). `calcularRecorte` con un `getBoundingClientRect()` de jsdom (todo en 0) hace que el componente use el archivo sin recortar. Ninguno de los dos hace falta mockearlo: los tests de este task verifican el *flujo* (elegir archivo → pantalla de recorte → procesar → decodificar), no el recorte de píxeles en sí (eso ya lo cubre `testing/recorteFoto.test.ts`).

- [ ] **Step 1: Escribir los tests**

Agregar al `describe('BarcodeScannerModal — captura', ...)`:

```tsx
  it('al elegir un archivo, pasa a la pantalla de recorte en vez de decodificar directo', async () => {
    mockPointerCoarse(false);
    const { user } = renderModal();
    const file = new File(['contenido'], 'codigo.jpg', { type: 'image/jpeg' });

    await user.upload(screen.getByLabelText('Subir imagen del código de barras'), file);

    expect(mockScanFileV2).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Procesar código' })).toBeInTheDocument();
  });

  it('"Procesar código" decodifica la imagen y avanza a confirmar', async () => {
    mockPointerCoarse(false);
    mockScanFileV2.mockResolvedValue({ decodedText: '7790040000100' });
    const { user } = renderModal();
    const file = new File(['contenido'], 'codigo.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Subir imagen del código de barras'), file);

    await user.click(await screen.findByRole('button', { name: 'Procesar código' }));

    expect(await screen.findByText('¿Es este tu alimento?')).toBeInTheDocument();
    expect(obtenerProductoPorEAN).toHaveBeenCalledWith('7790040000100');
  });

  it('si no decodifica, muestra error y se queda en la pantalla de recorte', async () => {
    mockPointerCoarse(false);
    mockScanFileV2.mockRejectedValue(new Error('no barcode found'));
    const { user } = renderModal();
    const file = new File(['contenido'], 'codigo.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Subir imagen del código de barras'), file);

    await user.click(await screen.findByRole('button', { name: 'Procesar código' }));

    expect(await screen.findByText(/no pudimos leer un código ean-13/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Procesar código' })).toBeInTheDocument();
  });

  it('"← Volver" desde la pantalla de recorte regresa al origen', async () => {
    mockPointerCoarse(false);
    const { user } = renderModal();
    const file = new File(['contenido'], 'codigo.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Subir imagen del código de barras'), file);
    await screen.findByRole('button', { name: 'Procesar código' });

    await user.click(screen.getByRole('button', { name: /volver/i }));

    expect(screen.getByText(/arrastrá una imagen/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run testing/BarcodeScannerModal.test.tsx`
Expected: FAIL — el stage `cropping` no existe, `handleFile` todavía decodifica directo.

- [ ] **Step 3: Implementar**

En `src/app/alimentacion/BarcodeScannerModal.tsx`:

Agregar el import de recorte junto a los demás imports:

```ts
import { calcularRecorte, recortarImagen } from '@/lib/recorteFoto';
```

Agregar `'cropping'` al tipo `Stage`:

```ts
type Stage = 'source' | 'cropping' | 'fetching' | 'confirm' | 'portion' | 'discarded';
```

Agregar el estado y los refs de recorte (junto a los `useState`/`useRef` existentes):

```ts
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingFileUrl, setPendingFileUrl] = useState<string | null>(null);
  const [zoomRecorte, setZoomRecorte] = useState(1);
  const [panRecorte, setPanRecorte] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const imgSizeRef = useRef<{ w: number; h: number } | null>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const pendingFileUrlRef = useRef<string | null>(null);
```

Agregar el helper de back-navigation (justo antes del `return`):

```ts
  const renderVolver = (target: Stage) => (
    <button
      type="button"
      onClick={() => setStage(target)}
      className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700"
    >
      <span aria-hidden="true">←</span> Volver
    </button>
  );
```

Agregar el setter que libera el object URL anterior y su cleanup al desmontar (junto a `detenerCamara`):

```ts
  const setPendingImage = useCallback((url: string | null) => {
    if (pendingFileUrlRef.current) URL.revokeObjectURL(pendingFileUrlRef.current);
    pendingFileUrlRef.current = url;
    setPendingFileUrl(url);
  }, []);

  useEffect(
    () => () => {
      if (pendingFileUrlRef.current) URL.revokeObjectURL(pendingFileUrlRef.current);
    },
    [],
  );

  const resetEncuadre = () => {
    setZoomRecorte(1);
    setPanRecorte({ x: 0, y: 0 });
    dragRef.current = null;
  };

  const handlePointerDownRecorte = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX - panRecorte.x, y: e.clientY - panRecorte.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const handlePointerMoveRecorte = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPanRecorte({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
  };
  const handlePointerUpRecorte = () => {
    dragRef.current = null;
  };
```

Reemplazar `resetState` para que también limpie el recorte pendiente:

```ts
  const resetState = useCallback(() => {
    setStage('source');
    setProducto(null);
    setCameraError(null);
    setPendingImage(null);
    setPendingFile(null);
    imgSizeRef.current = null;
    resetEncuadre();
  }, [setPendingImage]);
```

Reemplazar `handleFile` (ya no decodifica directo, solo guarda el archivo y pasa a `cropping`):

```ts
  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setPendingFile(file);
    setPendingImage(URL.createObjectURL(file));
    imgSizeRef.current = null;
    resetEncuadre();
    setStage('cropping');
  };
```

(Nota: ya no es `async` — el `onChange`/`onDrop` que la llaman pueden sacarle el `void` ya que no hace falta, pero dejarlo con `void handleFile(...)` tampoco rompe nada si queda.)

Agregar el handler que recorta y decodifica (nueva función, junto a `handleFile`):

```ts
  const handleProcesarCodigo = async () => {
    if (!pendingFile) return;
    const imgSize = imgSizeRef.current;
    const rectView = previewContainerRef.current?.getBoundingClientRect();
    let archivo = pendingFile;
    if (imgSize && rectView && rectView.width > 0) {
      const recorte = calcularRecorte({
        imgW: imgSize.w,
        imgH: imgSize.h,
        viewW: rectView.width,
        viewH: rectView.height,
        zoom: zoomRecorte,
        panX: panRecorte.x,
        panY: panRecorte.y,
      });
      archivo = await recortarImagen(pendingFile, recorte);
    }

    const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
      formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13],
      verbose: false,
    });
    try {
      const resultado = await scanner.scanFileV2(archivo, false);
      handleDecoded(resultado.decodedText);
    } catch {
      setCameraError('No pudimos leer un código EAN-13 en esa imagen. Probá reencuadrar y procesar de nuevo.');
    } finally {
      scanner.clear();
    }
  };
```

Mover el `<div id={SCANNER_ELEMENT_ID}>` fuera del bloque `{stage === 'source' && (...)}` para que exista en el DOM durante `cropping` también (`scanFileV2` lo necesita presente). Reemplazar:

```tsx
            <div
              id={SCANNER_ELEMENT_ID}
              className={activeTab === 'camara' ? 'overflow-hidden rounded-2xl bg-black min-h-56' : 'hidden'}
            />

            {activeTab === 'subir' && (
```

por (saca el `<div id=...>` de acá, lo deja solo el condicional de subir):

```tsx
            {activeTab === 'subir' && (
```

Y agregar, como primer hijo del `<div className="space-y-4">` que envuelve TODO el contenido del modal (antes del `{stage === 'source' && (...)}`), el div persistente:

```tsx
        <div
          id={SCANNER_ELEMENT_ID}
          className={
            stage === 'source' && activeTab === 'camara' ? 'overflow-hidden rounded-2xl bg-black min-h-56' : 'hidden'
          }
        />
```

Agregar el stage `cropping` (nuevo bloque, después del bloque `{stage === 'source' && (...)}` y antes de `{stage === 'fetching' && (...)}`):

```tsx
        {stage === 'cropping' && pendingFileUrl && (
          <div className="space-y-4">
            {renderVolver('source')}
            <div
              ref={previewContainerRef}
              className="relative h-56 overflow-hidden rounded-2xl border border-gray-100 bg-gray-900"
              style={{ touchAction: 'none', cursor: 'grab' }}
              onPointerDown={handlePointerDownRecorte}
              onPointerMove={handlePointerMoveRecorte}
              onPointerUp={handlePointerUpRecorte}
              onPointerCancel={handlePointerUpRecorte}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pendingFileUrl}
                alt="Imagen a recortar"
                draggable={false}
                onLoad={(e) => {
                  imgSizeRef.current = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight };
                }}
                className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
                style={{
                  transform: `translate(${panRecorte.x}px, ${panRecorte.y}px) scale(${zoomRecorte})`,
                  transformOrigin: 'center',
                }}
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <svg viewBox="0 0 250 100" className="h-full w-full" aria-hidden="true">
                  <rect
                    x="10" y="10" width="230" height="80" rx="8"
                    fill="none" stroke="white" strokeWidth="3" strokeDasharray="8 6" opacity="0.9"
                  />
                </svg>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-gray-400" aria-hidden="true">Zoom</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.02}
                value={zoomRecorte}
                onChange={(e) => setZoomRecorte(Number(e.target.value))}
                aria-label="Zoom de la imagen"
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-gray-200 accent-orange-500"
              />
              <button type="button" onClick={resetEncuadre} className="text-xs font-semibold text-orange-600 hover:underline">
                Reencuadrar
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Arrastrá y ajustá el zoom para que el código de barras coincida con el recuadro.
            </p>
            {cameraError && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700" aria-live="polite">
                {cameraError}
              </p>
            )}
            <Button type="button" variant="primary" className="w-full" onClick={() => void handleProcesarCodigo()}>
              Procesar código
            </Button>
          </div>
        )}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run testing/BarcodeScannerModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/app/alimentacion/BarcodeScannerModal.tsx testing/BarcodeScannerModal.test.tsx
git commit -m "feat: paso de recorte manual antes de decodificar imágenes subidas/arrastradas"
```

---

### Task 6: Pantalla de confirmación ampliada + stage `mode`

**Files:**
- Modify: `src/app/alimentacion/BarcodeScannerModal.tsx`
- Modify: `testing/BarcodeScannerModal.test.tsx`

**Interfaces:**
- Consumes: `producto.esSuplemento`, `.porcionEtiqueta`, `.infoAmpliada` (Task 1).
- Produces: `tipoIngestaEfectivo` (derivado, no un nuevo prop) y el stage `'mode'` — Tasks 7 y 8 lo consumen.

- [ ] **Step 1: Escribir los tests**

Agregar un nuevo `describe` a `testing/BarcodeScannerModal.test.tsx`:

```tsx
const PRODUCTO_SUPLEMENTO = {
  ...PRODUCTO_OK,
  nombre: 'Proteína Whey',
  esSuplemento: true,
};

describe('BarcodeScannerModal — confirmación ampliada', () => {
  it('muestra los macros con 1 decimal y la aclaración de base nutricional', async () => {
    renderModal();
    await simularEscaneo();
    await screen.findByText('¿Es este tu alimento?');

    expect(screen.getByText('450.0')).toBeInTheDocument();
    expect(screen.getByText(/valores expresados cada 100g \/ 100ml/i)).toBeInTheDocument();
  });

  it('muestra la porción sugerida en el envoltorio cuando existe', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ ...PRODUCTO_OK, porcionEtiqueta: '2.5 galletitas (30g)' });
    renderModal();
    await simularEscaneo();

    expect(await screen.findByText(/porción sugerida en envoltorio: 2\.5 galletitas \(30g\)/i)).toBeInTheDocument();
  });

  it('no muestra la línea de porción sugerida cuando no hay etiqueta', async () => {
    renderModal();
    await simularEscaneo();
    await screen.findByText('¿Es este tu alimento?');

    expect(screen.queryByText(/porción sugerida en envoltorio/i)).not.toBeInTheDocument();
  });

  it('muestra el aviso de suplemento cuando el producto es un suplemento', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue(PRODUCTO_SUPLEMENTO);
    renderModal();
    await simularEscaneo();

    expect(await screen.findByText(/detectamos que es un suplemento/i)).toBeInTheDocument();
  });

  it('"Ampliar información" muestra Nutri-Score, NOVA y badges cuando hay datos', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({
      ...PRODUCTO_OK,
      infoAmpliada: { nutriscore: 'b', novaGroup: 3, sinGluten: true, vegano: false, vegetariano: true },
    });
    const { user } = renderModal();
    await simularEscaneo();
    await screen.findByText('¿Es este tu alimento?');

    await user.click(screen.getByRole('button', { name: /ampliar información/i }));

    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText(/procesado/i)).toBeInTheDocument();
    expect(screen.getByText('Sin Gluten')).toBeInTheDocument();
    expect(screen.getByText('Vegetariano')).toBeInTheDocument();
    expect(screen.queryByText('Vegano')).not.toBeInTheDocument();
  });

  it('"Ampliar información" muestra el mensaje de fallback cuando no hay ningún dato', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({
      ...PRODUCTO_OK,
      infoAmpliada: { nutriscore: null, novaGroup: null, sinGluten: false, vegano: false, vegetariano: false },
    });
    const { user } = renderModal();
    await simularEscaneo();
    await screen.findByText('¿Es este tu alimento?');

    await user.click(screen.getByRole('button', { name: /ampliar información/i }));

    expect(screen.getByText(/no tiene esta información para este producto/i)).toBeInTheDocument();
  });

  it('"Sí, es correcto" lleva a la pantalla de elegir modo de registro', async () => {
    const { user } = renderModal();
    await simularEscaneo();
    await user.click(await screen.findByRole('button', { name: 'Sí, es correcto' }));

    expect(await screen.findByText(/cómo deseas registrar tu ingesta/i)).toBeInTheDocument();
  });

  it('"← Volver" desde confirmar regresa al origen', async () => {
    const { user } = renderModal();
    await simularEscaneo();
    await screen.findByText('¿Es este tu alimento?');

    await user.click(screen.getByRole('button', { name: /volver/i }));

    expect(screen.getByText(/arrastrá una imagen|escanear con cámara/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run testing/BarcodeScannerModal.test.tsx`
Expected: FAIL — ninguno de estos elementos existe todavía en la pantalla de confirmación, y "Sí, es correcto" sigue yendo a `portion`.

- [ ] **Step 3: Implementar**

En `src/app/alimentacion/BarcodeScannerModal.tsx`:

Agregar las constantes de colores/descripciones (junto a `PORCIONES`, antes del componente):

```ts
const NUTRISCORE_COLORES: Record<'a' | 'b' | 'c' | 'd' | 'e', string> = {
  a: '#038141',
  b: '#85BB2F',
  c: '#FECB02',
  d: '#EE8100',
  e: '#E63E11',
};

const NOVA_DESCRIPCIONES: Record<1 | 2 | 3 | 4, string> = {
  1: 'Sin procesar o mínimamente procesado',
  2: 'Ingrediente culinario procesado',
  3: 'Procesado',
  4: 'Ultraprocesado',
};
```

Agregar `'mode'` al tipo `Stage`:

```ts
type Stage = 'source' | 'cropping' | 'fetching' | 'confirm' | 'mode' | 'portion' | 'discarded';
```

Agregar el estado del acordeón (junto a los demás `useState`):

```ts
  const [mostrarInfoAmpliada, setMostrarInfoAmpliada] = useState(false);
```

Incluirlo en `resetState`:

```ts
    setPendingFile(null);
    imgSizeRef.current = null;
    resetEncuadre();
```

pasa a:

```ts
    setPendingFile(null);
    imgSizeRef.current = null;
    resetEncuadre();
    setMostrarInfoAmpliada(false);
```

Cambiar `handleAceptar` para ir a `mode`:

```ts
  const handleAceptar = () => setStage('portion');
```

por:

```ts
  const handleAceptar = () => setStage('mode');
```

Agregar `tipoIngestaEfectivo` justo antes del `return` (después de que `producto` esté declarado):

```ts
  const tipoIngestaEfectivo = producto?.encontrado && producto.esSuplemento ? 'suplemento' : tipoIngesta;
```

Reemplazar el bloque `{stage === 'confirm' && producto?.encontrado && (...)}` completo por:

```tsx
        {stage === 'confirm' && producto?.encontrado && (
          <div className="space-y-4">
            {renderVolver('source')}
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
                <p className="text-sm font-bold text-gray-900">{producto.nutrientes100g.kcal.toFixed(1)}</p>
                <p className="text-[10px] text-gray-400">kcal/100g</p>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">{producto.nutrientes100g.proteinas.toFixed(1)}g</p>
                <p className="text-[10px] text-gray-400">Proteínas</p>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">{producto.nutrientes100g.grasas.toFixed(1)}g</p>
                <p className="text-[10px] text-gray-400">Grasas</p>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">{producto.nutrientes100g.carbs.toFixed(1)}g</p>
                <p className="text-[10px] text-gray-400">Carbs</p>
              </div>
            </div>
            <p className="text-center text-xs text-gray-400">Valores expresados cada 100g / 100ml.</p>
            {producto.porcionEtiqueta && (
              <p className="text-center text-xs text-gray-500">
                Porción sugerida en envoltorio: {producto.porcionEtiqueta}
              </p>
            )}
            {producto.esSuplemento && (
              <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-center text-sm text-sky-700">
                Detectamos que es un suplemento — se va a guardar en Suplementos.
              </p>
            )}

            <button
              type="button"
              onClick={() => setMostrarInfoAmpliada((v) => !v)}
              className="w-full text-center text-sm font-semibold text-orange-600 hover:underline"
            >
              Ampliar información del producto
            </button>
            {mostrarInfoAmpliada && (() => {
              const { nutriscore, novaGroup, sinGluten, vegano, vegetariano } = producto.infoAmpliada;
              const sinInfo = !nutriscore && !novaGroup && !sinGluten && !vegano && !vegetariano;
              return (
                <div className="space-y-3 rounded-2xl border border-gray-100 bg-gray-50 p-3 text-sm">
                  {sinInfo ? (
                    <p className="text-xs text-gray-400">Open Food Facts no tiene esta información para este producto.</p>
                  ) : (
                    <>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Nutri-Score</span>
                          {nutriscore ? (
                            <span
                              className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white"
                              style={{ backgroundColor: NUTRISCORE_COLORES[nutriscore] }}
                            >
                              {nutriscore.toUpperCase()}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">Sin datos</span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          Nutri-Score: calificación de A a E del perfil nutricional general (calorías, azúcares,
                          grasas saturadas, sodio, proteínas, fibra y frutas/verduras). A es el mejor perfil, E el peor.
                        </p>
                      </div>
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Grupo NOVA</span>
                        <p className="mt-1 text-sm text-gray-700">
                          {novaGroup ? `${novaGroup} — ${NOVA_DESCRIPCIONES[novaGroup]}` : 'Sin datos'}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          Grupo NOVA: mide qué tan procesado está el alimento, de 1 (natural o casi sin procesar) a 4
                          (ultraprocesado — con ingredientes y aditivos industriales).
                        </p>
                      </div>
                      {(sinGluten || vegano || vegetariano) && (
                        <div className="flex flex-wrap gap-1.5">
                          {sinGluten && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                              Sin Gluten
                            </span>
                          )}
                          {vegano && (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                              Vegano
                            </span>
                          )}
                          {vegetariano && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                              Vegetariano
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}

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

        {stage === 'mode' && (
          <div className="space-y-4">
            {renderVolver('confirm')}
            <p className="text-center text-sm font-medium text-gray-700">¿Cómo deseas registrar tu ingesta?</p>
            <div className="grid grid-cols-1 gap-3">
              <button
                type="button"
                onClick={() => setStage('paquete')}
                className="rounded-2xl border border-gray-200 p-4 text-left hover:border-orange-300 hover:bg-orange-50"
              >
                <p className="font-semibold text-gray-900">Por Paquete Completo</p>
                <p className="text-xs text-gray-500">Fracción del envase que consumiste (entero, mitad, etc.)</p>
              </button>
              <button
                type="button"
                onClick={() => setStage('porcion')}
                className="rounded-2xl border border-gray-200 p-4 text-left hover:border-orange-300 hover:bg-orange-50"
              >
                <p className="font-semibold text-gray-900">Por Porción del Fabricante</p>
                <p className="text-xs text-gray-500">Según la porción indicada en la etiqueta del producto</p>
              </button>
            </div>
          </div>
        )}
```

**Importante:** este bloque referencia `setStage('paquete')` y `setStage('porcion')`, que todavía no son valores válidos de `Stage` (hoy sigue siendo `'portion'`). Agregar `'paquete' | 'porcion'` al tipo `Stage` en este mismo task para que compile (`'portion'` se saca recién en el Task 8, cuando se borra su bloque de JSX):

```ts
type Stage = 'source' | 'cropping' | 'fetching' | 'confirm' | 'mode' | 'paquete' | 'porcion' | 'portion' | 'discarded';
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run testing/BarcodeScannerModal.test.tsx`
Expected: PASS. (El viejo stage `portion` sigue existiendo y sus tests viejos — "los botones de porción muestran los gramos...", "al elegir una porción, llama a..." etc. — van a fallar recién en el Task 8, cuando ese bloque se reemplaza; hasta entonces siguen pasando porque nada en este task tocó ese bloque.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/app/alimentacion/BarcodeScannerModal.tsx testing/BarcodeScannerModal.test.tsx
git commit -m "feat: confirmación ampliada (1 decimal, Nutri-Score/NOVA, aviso de suplemento) + stage mode"
```

---

### Task 7: Stage `paquete` — fracción del envase + Personalizar

**Files:**
- Modify: `src/app/alimentacion/BarcodeScannerModal.tsx`
- Modify: `testing/BarcodeScannerModal.test.tsx`

**Interfaces:**
- Consumes: `producto.pesoNetoTotal` (Task 1), `tipoIngestaEfectivo` (Task 6), `renderVolver` (Task 5).

- [ ] **Step 1: Escribir los tests**

Agregar un nuevo `describe`:

```tsx
async function irAModo(user: ReturnType<typeof userEvent.setup>) {
  await simularEscaneo();
  await user.click(await screen.findByRole('button', { name: 'Sí, es correcto' }));
}

describe('BarcodeScannerModal — stage paquete', () => {
  it('botones fijos calculan gramos desde pesoNetoTotal y están habilitados', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ ...PRODUCTO_OK, pesoNetoTotal: 150 });
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Paquete Completo' }));

    const entero = screen.getByRole('button', { name: /entero \(1 envase\)/i });
    expect(entero).toBeEnabled();
    expect(entero).toHaveTextContent('150 g');
    expect(screen.getByRole('button', { name: /mitad \(1\/2\)/i })).toHaveTextContent('75 g');
    expect(screen.getByRole('button', { name: /un cuarto \(1\/4\)/i })).toHaveTextContent('38 g');
    expect(screen.getByRole('button', { name: /un quinto \(1\/5\)/i })).toHaveTextContent('30 g');
  });

  it('botones fijos deshabilitados y nota visible cuando no hay pesoNetoTotal', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ ...PRODUCTO_OK, pesoNetoTotal: null });
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Paquete Completo' }));

    expect(screen.getByRole('button', { name: /entero \(1 envase\)/i })).toBeDisabled();
    expect(screen.getByText(/no pudimos leer el peso del envase/i)).toBeInTheDocument();
  });

  it('"Personalizar fracción/peso" permite ingresar gramos aunque no haya pesoNetoTotal', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ ...PRODUCTO_OK, pesoNetoTotal: null });
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Paquete Completo' }));

    await user.click(screen.getByRole('button', { name: /personalizar fracción\/peso/i }));
    await user.type(screen.getByLabelText(/gramos consumidos/i), '45');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(addScannedItemAction).toHaveBeenCalled());
    const formData = vi.mocked(addScannedItemAction).mock.calls[0][0] as FormData;
    expect(formData.get('cantidad')).toBe('45');
  });

  it('envía tipo_ingesta=suplemento cuando el producto es un suplemento, incluso en otra comida', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ ...PRODUCTO_OK, esSuplemento: true, pesoNetoTotal: 100 });
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Paquete Completo' }));

    await user.click(screen.getByRole('button', { name: /entero \(1 envase\)/i }));

    await waitFor(() => expect(addScannedItemAction).toHaveBeenCalled());
    const formData = vi.mocked(addScannedItemAction).mock.calls[0][0] as FormData;
    expect(formData.get('tipo_ingesta')).toBe('suplemento');
  });

  it('"← Volver" desde paquete regresa a la pantalla de modo', async () => {
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Paquete Completo' }));

    await user.click(screen.getByRole('button', { name: /volver/i }));

    expect(screen.getByText(/cómo deseas registrar tu ingesta/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run testing/BarcodeScannerModal.test.tsx`
Expected: FAIL — el stage `paquete` no tiene contenido todavía (`setStage('paquete')` existe desde el Task 6 pero no hay bloque JSX para ese stage).

- [ ] **Step 3: Implementar**

En `src/app/alimentacion/BarcodeScannerModal.tsx`:

Agregar la constante de fracciones (junto a `PORCIONES`):

```ts
const PAQUETE_FRACCIONES = [
  { label: 'Entero (1 envase)', fraccion: 1 },
  { label: 'Mitad (1/2)', fraccion: 0.5 },
  { label: 'Un cuarto (1/4)', fraccion: 0.25 },
  { label: 'Un quinto (1/5)', fraccion: 0.2 },
] as const;
```

Agregar el estado del input personalizado (junto a `mostrarInfoAmpliada`):

```ts
  const [personalizarPaquete, setPersonalizarPaquete] = useState(false);
```

Incluirlo en `resetState`:

```ts
    setMostrarInfoAmpliada(false);
```

pasa a:

```ts
    setMostrarInfoAmpliada(false);
    setPersonalizarPaquete(false);
```

Agregar el bloque del stage `paquete` (después del bloque `{stage === 'mode' && (...)}`):

```tsx
        {stage === 'paquete' && producto?.encontrado && (
          <form action={addScannedItemAction} onSubmit={handleClose} className="space-y-4">
            {renderVolver('mode')}
            <input type="hidden" name="fecha" value={fecha} />
            <input type="hidden" name="tipo_ingesta" value={tipoIngestaEfectivo} />
            <input type="hidden" name="tipo_item" value="solido" />
            <input type="hidden" name="ean" value={producto.ean} />
            <p className="text-sm font-medium text-gray-700">
              ¿Cuánto del envase de {producto.nombre} consumiste?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PAQUETE_FRACCIONES.map(({ label, fraccion }) => {
                const gramos = producto.pesoNetoTotal != null ? Math.round(producto.pesoNetoTotal * fraccion) : null;
                return (
                  <button
                    key={label}
                    type="submit"
                    name="cantidad"
                    value={gramos ?? ''}
                    disabled={gramos == null}
                    className="rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-700 enabled:hover:border-orange-300 enabled:hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {label}
                    <span className="block text-xs font-normal text-gray-400">{gramos != null ? `${gramos} g` : '— g'}</span>
                  </button>
                );
              })}
            </div>
            {producto.pesoNetoTotal == null && (
              <p className="text-xs text-amber-600">
                No pudimos leer el peso del envase — usá &quot;Personalizar&quot; para ingresar los gramos directamente.
              </p>
            )}
            {!personalizarPaquete ? (
              <Button type="button" variant="outline" className="w-full" onClick={() => setPersonalizarPaquete(true)}>
                Personalizar fracción/peso
              </Button>
            ) : (
              <div className="space-y-2 rounded-xl border border-gray-200 p-3">
                <label htmlFor="paquete-gramos-custom" className="text-xs font-medium text-gray-600">
                  Gramos consumidos
                </label>
                <input
                  id="paquete-gramos-custom"
                  type="number"
                  name="cantidad"
                  min="1"
                  step="any"
                  placeholder="Ej: 45"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
                <Button type="submit" variant="primary" className="w-full">
                  Guardar
                </Button>
              </div>
            )}
          </form>
        )}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run testing/BarcodeScannerModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/app/alimentacion/BarcodeScannerModal.tsx testing/BarcodeScannerModal.test.tsx
git commit -m "feat: stage paquete — fracción del envase completo con Personalizar"
```

---

### Task 8: Stage `porcion` (reemplaza a `portion`) — fracción de la porción del fabricante + Personalizar

**Files:**
- Modify: `src/app/alimentacion/BarcodeScannerModal.tsx`
- Modify: `testing/BarcodeScannerModal.test.tsx`

**Interfaces:**
- Consumes: `producto.porcion`, `.porcionEtiqueta` (Task 1), `tipoIngestaEfectivo` (Task 6), `renderVolver` (Task 5).

- [ ] **Step 1: Borrar los tests viejos del stage `portion`**

En `testing/BarcodeScannerModal.test.tsx`, borrar estos 4 tests del `describe('BarcodeScannerModal — confirmación y porción', ...)` (ya no aplican: la pantalla de porción cambió de botones 25/50/75/100/150/200% a 1/2/1/2/3 + Personalizar, y ahora se llega a través de `mode`, no directo desde `confirm`):

- `'los botones de porción muestran los gramos calculados según la porción del producto'`
- `'al elegir una porción, llama a addScannedItemAction con fecha/tipo_ingesta/ean/cantidad correctos'`
- `'al elegir una porción, cierra el modal (no se queda esperando sobre la pantalla de porción)'`
- `'"Volver" desde la pantalla de porción regresa a la confirmación'`

(Los otros tests de ese `describe` — "No, es otro", "si el producto no se encuentra...", "Escanear otro código..." — no tocan el stage `portion` y quedan igual.)

- [ ] **Step 2: Escribir los tests nuevos**

Agregar un nuevo `describe`:

```tsx
describe('BarcodeScannerModal — stage porción', () => {
  it('muestra la aclaración de a qué equivale 1 porción (porcionEtiqueta)', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ ...PRODUCTO_OK, porcionEtiqueta: '2.5 galletitas (30g)' });
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Porción del Fabricante' }));

    expect(screen.getByText(/1 porción equivale a: 2\.5 galletitas \(30g\)/i)).toBeInTheDocument();
  });

  it('usa "{porcion} g" como fallback cuando no hay porcionEtiqueta', async () => {
    const { user } = renderModal(); // PRODUCTO_OK: porcion=45, sin porcionEtiqueta
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Porción del Fabricante' }));

    expect(screen.getByText(/1 porción equivale a: 45 g/i)).toBeInTheDocument();
  });

  it('los 4 botones fijos (1/2, 1, 2, 3) calculan gramos desde porcion', async () => {
    const { user } = renderModal(); // porcion = 45
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Porción del Fabricante' }));

    expect(screen.getByRole('button', { name: /1\/2 porción/i })).toHaveTextContent('23 g');
    expect(screen.getByRole('button', { name: /^1 porción/ })).toHaveTextContent('45 g');
    expect(screen.getByRole('button', { name: /2 porciones/i })).toHaveTextContent('90 g');
    expect(screen.getByRole('button', { name: /3 porciones/i })).toHaveTextContent('135 g');
  });

  it('al elegir un botón fijo, llama a addScannedItemAction con fecha/tipo_ingesta/ean/cantidad correctos', async () => {
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Porción del Fabricante' }));

    await user.click(screen.getByRole('button', { name: /^1 porción/ }));

    await waitFor(() => expect(addScannedItemAction).toHaveBeenCalled());
    const formData = vi.mocked(addScannedItemAction).mock.calls[0][0] as FormData;
    expect(formData.get('fecha')).toBe('2026-09-21');
    expect(formData.get('tipo_ingesta')).toBe('almuerzo');
    expect(formData.get('ean')).toBe('7790040000100');
    expect(formData.get('cantidad')).toBe('45');
  });

  it('"Personalizar porciones" calcula gramos = porciones × porcion', async () => {
    const { user } = renderModal(); // porcion = 45
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Porción del Fabricante' }));

    await user.click(screen.getByRole('button', { name: /personalizar porciones/i }));
    await user.type(screen.getByLabelText(/cantidad de porciones/i), '1.5');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(addScannedItemAction).toHaveBeenCalled());
    const formData = vi.mocked(addScannedItemAction).mock.calls[0][0] as FormData;
    expect(formData.get('cantidad')).toBe('68'); // round(1.5 * 45)
  });

  it('"Guardar" de Personalizar porciones está deshabilitado sin un valor válido', async () => {
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Porción del Fabricante' }));
    await user.click(screen.getByRole('button', { name: /personalizar porciones/i }));

    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('al elegir una porción, cierra el modal', async () => {
    const { user, onClose } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Porción del Fabricante' }));

    await user.click(screen.getByRole('button', { name: /^1 porción/ }));

    expect(onClose).toHaveBeenCalled();
  });

  it('"← Volver" desde porción regresa a la pantalla de modo', async () => {
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Porción del Fabricante' }));

    await user.click(screen.getByRole('button', { name: /volver/i }));

    expect(screen.getByText(/cómo deseas registrar tu ingesta/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `npx vitest run testing/BarcodeScannerModal.test.tsx`
Expected: FAIL — el stage `porcion` todavía no existe (sigue existiendo el viejo `portion`), y `mode → 'Por Porción del Fabricante'` no lleva a ningún lado nuevo.

- [ ] **Step 4: Implementar**

En `src/app/alimentacion/BarcodeScannerModal.tsx`:

Sacar `'portion'` del tipo `Stage` (ya quedó agregado `'porcion'` en el Task 6):

```ts
type Stage = 'source' | 'cropping' | 'fetching' | 'confirm' | 'mode' | 'paquete' | 'porcion' | 'portion' | 'discarded';
```

pasa a:

```ts
type Stage = 'source' | 'cropping' | 'fetching' | 'confirm' | 'mode' | 'paquete' | 'porcion' | 'discarded';
```

Reemplazar la constante `PORCIONES` (6 fracciones viejas) por `PORCIONES_FABRICANTE` (4 fracciones nuevas):

```ts
const PORCIONES = [
  { label: '1/4 de porción', fraccion: 0.25 },
  { label: '1/2 porción', fraccion: 0.5 },
  { label: '3/4 de porción', fraccion: 0.75 },
  { label: '1 porción', fraccion: 1 },
  { label: '1.5 porciones', fraccion: 1.5 },
  { label: '2 porciones', fraccion: 2 },
] as const;
```

pasa a:

```ts
const PORCIONES_FABRICANTE = [
  { label: '1/2 porción', fraccion: 0.5 },
  { label: '1 porción', fraccion: 1 },
  { label: '2 porciones', fraccion: 2 },
  { label: '3 porciones', fraccion: 3 },
] as const;
```

Agregar el estado del input personalizado (junto a `personalizarPaquete`):

```ts
  const [personalizarPorcion, setPersonalizarPorcion] = useState(false);
  const [porcionesCustomValor, setPorcionesCustomValor] = useState('');
```

Incluirlos en `resetState`:

```ts
    setPersonalizarPaquete(false);
```

pasa a:

```ts
    setPersonalizarPaquete(false);
    setPersonalizarPorcion(false);
    setPorcionesCustomValor('');
```

Reemplazar el bloque completo `{stage === 'portion' && producto?.encontrado && (...)}` por:

```tsx
        {stage === 'porcion' && producto?.encontrado && (
          <form action={addScannedItemAction} onSubmit={handleClose} className="space-y-4">
            {renderVolver('mode')}
            <input type="hidden" name="fecha" value={fecha} />
            <input type="hidden" name="tipo_ingesta" value={tipoIngestaEfectivo} />
            <input type="hidden" name="tipo_item" value="solido" />
            <input type="hidden" name="ean" value={producto.ean} />
            <p className="text-sm font-medium text-gray-700">
              1 porción equivale a: {producto.porcionEtiqueta ?? `${producto.porcion} g`}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PORCIONES_FABRICANTE.map(({ label, fraccion }) => {
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
            {!personalizarPorcion ? (
              <Button type="button" variant="outline" className="w-full" onClick={() => setPersonalizarPorcion(true)}>
                Personalizar porciones
              </Button>
            ) : (
              <div className="space-y-2 rounded-xl border border-gray-200 p-3">
                <label htmlFor="porciones-custom" className="text-xs font-medium text-gray-600">
                  Cantidad de porciones
                </label>
                <input
                  id="porciones-custom"
                  type="number"
                  min="0.1"
                  step="any"
                  value={porcionesCustomValor}
                  onChange={(e) => setPorcionesCustomValor(e.target.value)}
                  placeholder="Ej: 1.5"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
                <input
                  type="hidden"
                  name="cantidad"
                  value={Math.round((Number(porcionesCustomValor) || 0) * producto.porcion)}
                />
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  disabled={!(Number(porcionesCustomValor) > 0)}
                >
                  Guardar
                </Button>
              </div>
            )}
          </form>
        )}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run testing/BarcodeScannerModal.test.tsx`
Expected: PASS — toda la suite del componente en verde.

- [ ] **Step 6: Typecheck y suite completa**

Run: `npx tsc --noEmit && npx vitest run`
Expected: sin errores de tipos, toda la suite del proyecto en verde. (Si `testing/CameraCapture.test.tsx` falla solo en la corrida completa en paralelo, es el flake preexistente documentado en el plan v1 — confirmarlo corriendo `npx vitest run testing/CameraCapture.test.tsx` solo, debería pasar 5/5.)

- [ ] **Step 7: Commit**

```bash
git add src/app/alimentacion/BarcodeScannerModal.tsx testing/BarcodeScannerModal.test.tsx
git commit -m "feat: stage porción del fabricante (1/2,1,2,3 + Personalizar), reemplaza al viejo portion"
```

---

## Verificación final

- [ ] Run: `npx vitest run` (o `npm run test`) — todo en verde (si `CameraCapture.test.tsx` flaquea en la corrida paralela, re-correr; es preexistente y no relacionado a esta rama).
- [ ] Run: `npx tsc --noEmit` — sin errores.
- [ ] Confirmar que la sección 012 de `supabase/schema_consolidado.sql` fue aplicada contra el proyecto de Supabase real (Task 2, Step 2) antes de dar la rama por terminada — igual que con la sección 010, sin esto `addScannedItemAction` va a fallar en runtime al intentar escribir columnas que no existen (aunque el código compile y los tests mockeados pasen).
