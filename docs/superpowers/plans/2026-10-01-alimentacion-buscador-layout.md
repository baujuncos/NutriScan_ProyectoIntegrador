# Rediseño de la barra buscadora y layout de /alimentacion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reestructurar el buscador de alimentos de `/alimentacion` (layout mobile/desktop, filtros por campo, "Recientes", selector de cantidad por botones+stepper) y corregir 4 bugs puntuales que viven en la misma zona de código.

**Architecture:** Dos módulos puros nuevos (`searchQuery.ts` para la lógica de filtros/orden, reutilizado por el server action) y dos componentes de UI nuevos (`BusquedaAlimento.tsx` para todo el buscador+dropdown+filtros+recientes, `CantidadSelector.tsx` para el selector de gramos) extraídos de `AlimentacionClient.tsx`, que pasa a orquestarlos. `actions.ts` gana un parámetro de filtros en `searchAlimentosAction` y una acción nueva `getAlimentosRecientesAction`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (Postgres, sin migraciones — columnas ya existentes), Tailwind CSS, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-01-alimentacion-buscador-layout-design.md`

## Global Constraints

- `MAX_CANTIDAD` = 2000 en todo input de cantidad (constante ya existente en `actions.ts` y `AlimentacionClient.tsx` — no se cambia su valor, solo se reutiliza).
- El flag `hideNutrition` (rol `deportista_ucc`) y su lógica existente en `AlimentacionClient.tsx` NO se tocan ni se regresan — el rol Particular no cambia su comportamiento.
- El tope de resultados de búsqueda sube de 80 a 150.
- `searchAlimentosAction(query, tipoIngesta)` debe seguir aceptando 2 argumentos (el tercer parámetro `campos` tiene default) porque `ChangeFoodSheet.tsx` la llama así y no está en el alcance de este plan.
- Todo texto de UI nuevo va en español, con el mismo tono que el resto de `/alimentacion`.
- No se agregan dependencias npm nuevas.

## Review Focus

- Desmarcar los 3 checkboxes de filtro a la vez debe mostrar un mensaje explícito de "elegí al menos un campo", no el mismo cartel de "sin resultados" que una búsqueda real sin matches. (Task 5)
- Una coincidencia que sólo matchea por un campo destildado (ej. coincide por `marca` pero "Marca" está destildado) nunca debe aparecer en los resultados. (Task 5, respaldado por los tests puros de `searchQuery.test.ts`)
- Cambiar de alimento seleccionado mientras "Personalizar" tiene un valor custom cargado debe resetear el selector de cantidad a 50 g por default, no arrastrar la cantidad del alimento anterior. (Task 6)
- Limpiar la búsqueda con la "×" mientras una búsqueda debounced todavía está en vuelo no debe dejar que esa respuesta vieja repueble el dropdown después de limpiar. (Task 5)
- Tipear un valor no numérico o fuera de rango en el input de "Personalizar" debe deshabilitar el botón de guardar, no dejar pasar una cantidad inválida al server action. (Task 6)

---

## Task 1: Lógica pura de filtros/orden de búsqueda (`searchQuery.ts`)

**Files:**
- Create: `src/app/alimentacion/searchQuery.ts`
- Test: `testing/searchQuery.test.ts`

**Interfaces:**
- Produces: `CamposBusqueda` (type), `CAMPOS_DEFAULT` (const), `buildMarcaDenominacionOr(campos: CamposBusqueda, q: string): string`, `aplicarFiltroSuplemento<T extends FiltroEncadenable<T>>(builder: T, isSuplemento: boolean): T`, `idsRecientesUnicos(idsEnOrdenDeFecha: number[], limite: number): number[]` — consumidos por Task 3 (`actions.ts`).

- [ ] **Step 1: Escribir los tests que fallan para `buildMarcaDenominacionOr`**

```typescript
// testing/searchQuery.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildMarcaDenominacionOr, aplicarFiltroSuplemento, idsRecientesUnicos, CAMPOS_DEFAULT } from '@/app/alimentacion/searchQuery';

describe('buildMarcaDenominacionOr', () => {
  it('arma la clausula OR con marca y denominacion cuando ambos campos están tildados', () => {
    expect(buildMarcaDenominacionOr({ nombre: true, marca: true, denominacion: true }, 'leche'))
      .toBe('marca.ilike.*leche*,denominacion.ilike.*leche*');
  });

  it('arma la clausula solo con marca cuando denominacion está destildado', () => {
    expect(buildMarcaDenominacionOr({ nombre: true, marca: true, denominacion: false }, 'leche'))
      .toBe('marca.ilike.*leche*');
  });

  it('devuelve string vacío cuando ni marca ni denominacion están tildados', () => {
    expect(buildMarcaDenominacionOr({ nombre: true, marca: false, denominacion: false }, 'leche'))
      .toBe('');
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test -- testing/searchQuery.test.ts`
Expected: FAIL con "Failed to resolve import "@/app/alimentacion/searchQuery"" (el archivo no existe todavía).

- [ ] **Step 3: Crear `searchQuery.ts` con `CamposBusqueda` y `buildMarcaDenominacionOr`**

```typescript
// src/app/alimentacion/searchQuery.ts
export type CamposBusqueda = {
  nombre: boolean;
  marca: boolean;
  denominacion: boolean;
};

export const CAMPOS_DEFAULT: CamposBusqueda = { nombre: true, marca: true, denominacion: true };

/**
 * Clausula OR (sintaxis PostgREST) para marca/denominacion, solo con los
 * campos tildados. Vacía si ninguno de los dos está tildado.
 */
export function buildMarcaDenominacionOr(campos: CamposBusqueda, q: string): string {
  const parts: string[] = [];
  if (campos.marca) parts.push(`marca.ilike.*${q}*`);
  if (campos.denominacion) parts.push(`denominacion.ilike.*${q}*`);
  return parts.join(',');
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test -- testing/searchQuery.test.ts`
Expected: PASS — 3/3.

- [ ] **Step 5: Escribir los tests que fallan para `aplicarFiltroSuplemento` (el fix del bug)**

```typescript
// agregar a testing/searchQuery.test.ts

function fakeBuilder() {
  const builder = {
    or: vi.fn(() => builder),
    not: vi.fn(() => builder),
  };
  return builder;
}

describe('aplicarFiltroSuplemento — fix: mira categoria Y nombre en ambas ramas', () => {
  it('tab Suplementos: filtra por categoria O nombre conteniendo "suplemento"', () => {
    const builder = fakeBuilder();
    aplicarFiltroSuplemento(builder, true);
    expect(builder.or).toHaveBeenCalledWith('categoria.ilike.%suplemento%,nombre.ilike.%suplemento%');
    expect(builder.not).not.toHaveBeenCalled();
  });

  it('otros tabs: excluye por categoria Y por nombre conteniendo "suplemento"', () => {
    const builder = fakeBuilder();
    aplicarFiltroSuplemento(builder, false);
    expect(builder.not).toHaveBeenCalledWith('categoria', 'ilike', '%suplemento%');
    expect(builder.not).toHaveBeenCalledWith('nombre', 'ilike', '%suplemento%');
    expect(builder.or).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Correr los tests y verificar que fallan**

Run: `npm test -- testing/searchQuery.test.ts`
Expected: FAIL con "aplicarFiltroSuplemento is not a function" (no exportada todavía).

- [ ] **Step 7: Agregar `aplicarFiltroSuplemento` a `searchQuery.ts`**

```typescript
// agregar a src/app/alimentacion/searchQuery.ts

export interface FiltroEncadenable<T> {
  or(expr: string): T;
  not(column: string, operator: string, value: string): T;
}

/**
 * Filtra por categoría=suplemento (tab Suplementos) o la excluye (el resto de
 * los tabs). Mira categoria Y nombre en ambas ramas: un producto como
 * "Proteína Whey" categorizado como "Snacks" debe aparecer buscando desde
 * Suplementos, y un producto categorizado "Suplementos" nunca debe colarse
 * en Desayuno/Almuerzo/etc. aunque su nombre no diga "suplemento".
 */
export function aplicarFiltroSuplemento<T extends FiltroEncadenable<T>>(builder: T, isSuplemento: boolean): T {
  return isSuplemento
    ? builder.or('categoria.ilike.%suplemento%,nombre.ilike.%suplemento%')
    : builder.not('categoria', 'ilike', '%suplemento%').not('nombre', 'ilike', '%suplemento%');
}
```

- [ ] **Step 8: Correr los tests y verificar que pasan**

Run: `npm test -- testing/searchQuery.test.ts`
Expected: PASS — 5/5.

- [ ] **Step 9: Escribir los tests que fallan para `idsRecientesUnicos`**

```typescript
// agregar a testing/searchQuery.test.ts

describe('idsRecientesUnicos', () => {
  it('deduplica preservando el orden de aparición (más reciente primero)', () => {
    expect(idsRecientesUnicos([5, 3, 5, 7, 3], 10)).toEqual([5, 3, 7]);
  });

  it('corta en el límite pedido', () => {
    expect(idsRecientesUnicos([1, 2, 3, 4, 5], 3)).toEqual([1, 2, 3]);
  });

  it('devuelve vacío si la lista de entrada está vacía', () => {
    expect(idsRecientesUnicos([], 8)).toEqual([]);
  });
});
```

- [ ] **Step 10: Correr los tests y verificar que fallan**

Run: `npm test -- testing/searchQuery.test.ts`
Expected: FAIL con "idsRecientesUnicos is not a function".

- [ ] **Step 11: Agregar `idsRecientesUnicos` a `searchQuery.ts`**

```typescript
// agregar a src/app/alimentacion/searchQuery.ts

/** Dedupea una lista de ids (ya ordenada por fecha desc) y la corta en `limite`. */
export function idsRecientesUnicos(idsEnOrdenDeFecha: number[], limite: number): number[] {
  const vistos = new Set<number>();
  const resultado: number[] = [];
  for (const id of idsEnOrdenDeFecha) {
    if (vistos.has(id)) continue;
    vistos.add(id);
    resultado.push(id);
    if (resultado.length >= limite) break;
  }
  return resultado;
}
```

- [ ] **Step 12: Correr los tests y verificar que pasan**

Run: `npm test -- testing/searchQuery.test.ts`
Expected: PASS — 8/8.

- [ ] **Step 13: Commit**

```bash
git add src/app/alimentacion/searchQuery.ts testing/searchQuery.test.ts
git commit -m "feat: extraer lógica pura de filtros/orden de búsqueda a searchQuery.ts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `supabaseMock.ts` — passthrough de métodos de filtro PostgREST

**Files:**
- Modify: `testing/supabaseMock.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: el `chain` que devuelve `from()` ahora acepta cualquier método (`ilike`, `or`, `not`, `order`, `limit`, `in`, etc.) sin romper — Task 3 lo necesita para testear `searchAlimentosAction`/`getAlimentosRecientesAction`.

Este task no agrega comportamiento propio comprobable en aislamiento (es un helper de test) — se verifica junto con Task 3, que es el primer consumidor real. No tiene test propio; la "Expected" de su único step es que el archivo siga compilando y el resto de la suite (que ya usa este mock) se mantenga verde.

- [ ] **Step 1: Agregar passthrough genérico al `chain` de `createSupabaseFromMock`**

Reemplazar el cuerpo de `from` en `testing/supabaseMock.ts`:

```typescript
// testing/supabaseMock.ts — reemplaza el bloque `const from = vi.fn(...)` existente
const from = vi.fn((tabla: string) => {
  llamadas.push(tabla);
  // El query builder real de supabase-js es "thenable": awaitear
  // `supabase.from(t).insert(x)` sin `.select().single()` también debe
  // resolver, por eso la cadena expone `.then` además de los métodos.
  let chain: Record<string, unknown>;
  chain = new Proxy(
    {
      insert: vi.fn((payload: unknown) => {
        inserts.push({ tabla, payload });
        return chain;
      }),
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      single: vi.fn(() => Promise.resolve(siguiente(tabla))),
      then: (resolve: (v: TableResult) => void) => resolve(siguiente(tabla)),
    },
    {
      get(target, prop: string) {
        if (prop in target) return (target as Record<string, unknown>)[prop];
        // Passthrough encadenable para cualquier método de filtro de
        // PostgREST (ilike, or, not, order, limit, in, etc.) que todavía no
        // tiene un stub explícito arriba — siempre devuelve la misma cadena.
        return vi.fn(() => chain);
      },
    },
  );
  return chain;
});
```

- [ ] **Step 2: Correr la suite completa y verificar que sigue verde**

Run: `npm test`
Expected: Todos los tests que ya usaban `supabaseMock.ts` (p. ej. `food-recognition-save-route.test.ts`) siguen en PASS — mismo conteo que antes del cambio.

- [ ] **Step 3: Commit**

```bash
git add testing/supabaseMock.ts
git commit -m "test: supabaseMock admite cualquier método de filtro PostgREST por passthrough

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `actions.ts` — filtros por campo, fix Suplementos, cap 150, Recientes

**Files:**
- Modify: `src/app/alimentacion/actions.ts`
- Test: `testing/alimentacionActions.test.ts` (crear)

**Interfaces:**
- Consumes: `CamposBusqueda`, `CAMPOS_DEFAULT`, `buildMarcaDenominacionOr`, `aplicarFiltroSuplemento`, `idsRecientesUnicos` de `src/app/alimentacion/searchQuery.ts` (Task 1); el `chain` con passthrough de `testing/supabaseMock.ts` (Task 2).
- Produces: `AlimentoOption` extendido con `kcal_100g?`, `proteinas_100g?`, `grasas_100g?`, `carbs_100g?` (todos `number | null`, opcionales); `searchAlimentosAction(query: string, tipoIngesta: string, campos: CamposBusqueda = CAMPOS_DEFAULT): Promise<AlimentoOption[]>`; `getAlimentosRecientesAction(): Promise<AlimentoOption[]>` — consumidos por Task 5 (`BusquedaAlimento.tsx`).

- [ ] **Step 1: Escribir los tests que fallan para `searchAlimentosAction` con filtros**

```typescript
// testing/alimentacionActions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));
const supabaseFromMock = createSupabaseFromMock();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: supabaseFromMock.from }),
}));

import { searchAlimentosAction, getAlimentosRecientesAction } from '@/app/alimentacion/actions';

describe('searchAlimentosAction', () => {
  beforeEach(() => {
    supabaseFromMock.reset();
    getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('con los 3 campos tildados (default), hace 2 consultas a "alimentos" y las concatena', async () => {
    supabaseFromMock.mockTable('alimentos', { data: [{ id_alimento: 1, nombre: 'Pollo asado' }], error: null });
    supabaseFromMock.mockTable('alimentos', { data: [{ id_alimento: 2, nombre: 'Suprema' }], error: null });

    const resultado = await searchAlimentosAction('pollo', 'almuerzo');

    expect(resultado).toEqual([
      { id_alimento: 1, nombre: 'Pollo asado' },
      { id_alimento: 2, nombre: 'Suprema' },
    ]);
    expect(supabaseFromMock.tablasLlamadas().filter((t) => t === 'alimentos')).toHaveLength(2);
  });

  it('con solo "Nombre" tildado, hace 1 sola consulta a "alimentos"', async () => {
    supabaseFromMock.mockTable('alimentos', { data: [{ id_alimento: 1, nombre: 'Pollo asado' }], error: null });

    const resultado = await searchAlimentosAction('pollo', 'almuerzo', { nombre: true, marca: false, denominacion: false });

    expect(resultado).toEqual([{ id_alimento: 1, nombre: 'Pollo asado' }]);
    expect(supabaseFromMock.tablasLlamadas().filter((t) => t === 'alimentos')).toHaveLength(1);
  });

  it('sin ningún campo tildado, no consulta la base y devuelve vacío', async () => {
    const resultado = await searchAlimentosAction('pollo', 'almuerzo', { nombre: false, marca: false, denominacion: false });

    expect(resultado).toEqual([]);
    expect(supabaseFromMock.tablasLlamadas()).toHaveLength(0);
  });

  it('corta el resultado combinado en 150 elementos', async () => {
    const tandaA = Array.from({ length: 100 }, (_, i) => ({ id_alimento: i + 1, nombre: `A${i}` }));
    const tandaB = Array.from({ length: 100 }, (_, i) => ({ id_alimento: 1000 + i, nombre: `B${i}` }));
    supabaseFromMock.mockTable('alimentos', { data: tandaA, error: null });
    supabaseFromMock.mockTable('alimentos', { data: tandaB, error: null });

    const resultado = await searchAlimentosAction('a', 'almuerzo');

    expect(resultado).toHaveLength(150);
  });
});

describe('getAlimentosRecientesAction', () => {
  beforeEach(() => {
    supabaseFromMock.reset();
    getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('dedupea por id_alimento preservando el más reciente y limita a 8', async () => {
    supabaseFromMock.mockTable('items', {
      data: [
        { id_alimento: 1 }, { id_alimento: 2 }, { id_alimento: 1 },
        { id_alimento: 3 }, { id_alimento: 4 }, { id_alimento: 5 },
        { id_alimento: 6 }, { id_alimento: 7 }, { id_alimento: 8 }, { id_alimento: 9 },
      ],
      error: null,
    });
    supabaseFromMock.mockTable('alimentos', {
      data: [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id_alimento: id, nombre: `Alimento ${id}` })),
      error: null,
    });

    const resultado = await getAlimentosRecientesAction();

    expect(resultado.map((a) => a.id_alimento)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('devuelve vacío si el usuario no tiene items previos', async () => {
    supabaseFromMock.mockTable('items', { data: [], error: null });

    const resultado = await getAlimentosRecientesAction();

    expect(resultado).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test -- testing/alimentacionActions.test.ts`
Expected: FAIL — `searchAlimentosAction` ignora el 3er argumento y siempre hace 2 consultas (comportamiento viejo), `getAlimentosRecientesAction is not a function` no existe todavía.

- [ ] **Step 3: Reescribir `searchAlimentosAction` y agregar `getAlimentosRecientesAction` en `actions.ts`**

Reemplazar el bloque de `AlimentoOption`, `SEL` y `searchAlimentosAction` (líneas 11-52 actuales) por:

```typescript
import { CAMPOS_DEFAULT, aplicarFiltroSuplemento, buildMarcaDenominacionOr, idsRecientesUnicos, type CamposBusqueda } from './searchQuery';

export type AlimentoOption = {
  id_alimento: number;
  nombre: string;
  categoria: string | null;
  fuente: string;
  marca: string | null;
  denominacion: string | null;
  kcal_100g?: number | null;
  proteinas_100g?: number | null;
  grasas_100g?: number | null;
  carbs_100g?: number | null;
};

const SEL = 'id_alimento, nombre, categoria, fuente, marca, denominacion, kcal_100g, proteinas_100g, grasas_100g, carbs_100g' as const;

const CAP_RESULTADOS = 150;

export async function searchAlimentosAction(
  query: string,
  tipoIngesta: string,
  campos: CamposBusqueda = CAMPOS_DEFAULT,
): Promise<AlimentoOption[]> {
  const q = query.trim().replace(/[*,\\]/g, '');
  if (q.length < 2) return [];
  if (!campos.nombre && !campos.marca && !campos.denominacion) return [];

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const isSuplemento = tipoIngesta === 'suplemento';
  const promises: Array<Promise<{ data: AlimentoOption[] | null }>> = [];

  // Tier 1 (mayor relevancia): matches por nombre.
  if (campos.nombre) {
    let q1 = supabase.from('alimentos').select(SEL).ilike('nombre', `%${q}%`);
    q1 = aplicarFiltroSuplemento(q1, isSuplemento);
    promises.push(q1.order('nombre', { ascending: true }).limit(100));
  }

  // Tier 2: matches por marca/denominacion que no vinieron ya por nombre.
  const marcaDenomOr = buildMarcaDenominacionOr(campos, q);
  if (marcaDenomOr.length > 0) {
    let q2 = supabase.from('alimentos').select(SEL).or(marcaDenomOr);
    if (campos.nombre) q2 = q2.not('nombre', 'ilike', `%${q}%`);
    q2 = aplicarFiltroSuplemento(q2, isSuplemento);
    promises.push(q2.order('nombre', { ascending: true }).limit(100));
  }

  const resultados = await Promise.all(promises);
  return resultados.flatMap((r) => r.data ?? []).slice(0, CAP_RESULTADOS) as AlimentoOption[];
}

export async function getAlimentosRecientesAction(): Promise<AlimentoOption[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: itemRows } = await supabase
    .from('items')
    .select('id_alimento, created_at, ingestas!inner(id_usuario)')
    .eq('ingestas.id_usuario', user.id)
    .not('id_alimento', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!itemRows || itemRows.length === 0) return [];

  const idsEnOrden = idsRecientesUnicos(
    (itemRows as Array<{ id_alimento: number }>).map((r) => r.id_alimento),
    8,
  );
  if (idsEnOrden.length === 0) return [];

  const { data: alimentos } = await supabase.from('alimentos').select(SEL).in('id_alimento', idsEnOrden);
  if (!alimentos) return [];

  const porId = new Map((alimentos as AlimentoOption[]).map((a) => [a.id_alimento, a]));
  return idsEnOrden.map((id) => porId.get(id)).filter((a): a is AlimentoOption => a != null);
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test -- testing/alimentacionActions.test.ts`
Expected: PASS — 6/6.

- [ ] **Step 5: Correr la suite completa**

Run: `npm test`
Expected: Todo verde. `testing/AlimentacionSearch.test.tsx` y `testing/ChangeFoodSheet.test.tsx` siguen pasando porque mockean `searchAlimentosAction` entero y no ven el cambio de firma (el 3er parámetro tiene default).

- [ ] **Step 6: Commit**

```bash
git add src/app/alimentacion/actions.ts testing/alimentacionActions.test.ts
git commit -m "feat: filtros por campo en búsqueda de alimentos, fix bug Suplementos, cap 150, Recientes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `CantidadSelector.tsx` — botones rápidos + stepper + Personalizar

**Files:**
- Create: `src/app/alimentacion/CantidadSelector.tsx`
- Test: `testing/CantidadSelector.test.tsx`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `CantidadSelector` (default export), props `{ name: string; accentColor: string; maxCantidad: number; value: string; onChange: (v: string) => void; mostrarAvisoSinValores: boolean }` — consumido por Task 6 (`AlimentacionClient.tsx`).

- [ ] **Step 1: Escribir el test que falla — botones rápidos**

```typescript
// testing/CantidadSelector.test.tsx
import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CantidadSelector from '@/app/alimentacion/CantidadSelector';

function Wrapper({ initial = '50', mostrarAvisoSinValores = false }: { initial?: string; mostrarAvisoSinValores?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <form>
      <CantidadSelector
        name="cantidad"
        accentColor="#16a34a"
        maxCantidad={2000}
        value={value}
        onChange={setValue}
        mostrarAvisoSinValores={mostrarAvisoSinValores}
      />
    </form>
  );
}

describe('CantidadSelector', () => {
  it('clickear un botón rápido actualiza el input oculto "cantidad"', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await user.click(screen.getByRole('button', { name: '100 g' }));
    expect(screen.getByDisplayValue('100')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- testing/CantidadSelector.test.tsx`
Expected: FAIL con "Failed to resolve import "@/app/alimentacion/CantidadSelector"".

- [ ] **Step 3: Crear `CantidadSelector.tsx` con los botones rápidos**

```typescript
// src/app/alimentacion/CantidadSelector.tsx
'use client';

const CANTIDADES_RAPIDAS = [25, 50, 100, 150] as const;

export default function CantidadSelector({
  name,
  accentColor,
  maxCantidad,
  value,
  onChange,
  mostrarAvisoSinValores,
}: {
  name: string;
  accentColor: string;
  maxCantidad: number;
  value: string;
  onChange: (v: string) => void;
  mostrarAvisoSinValores: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2">
        {CANTIDADES_RAPIDAS.map((g) => {
          const activo = value === String(g);
          return (
            <button
              key={g}
              type="button"
              onClick={() => onChange(String(g))}
              className={`rounded-xl border py-2 text-sm font-semibold transition-colors ${
                activo ? 'text-white border-transparent' : 'border-gray-200 text-gray-700 hover:border-gray-300'
              }`}
              style={activo ? { backgroundColor: accentColor } : undefined}
            >
              {g} g
            </button>
          );
        })}
      </div>
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- testing/CantidadSelector.test.tsx`
Expected: PASS — 1/1.

- [ ] **Step 5: Escribir los tests que fallan — stepper**

```typescript
// agregar a testing/CantidadSelector.test.tsx

it('el stepper suma y resta 1 gramo, con piso en 1 y techo en maxCantidad', async () => {
  const user = userEvent.setup();
  render(<Wrapper initial="2000" />);
  await user.click(screen.getByRole('button', { name: 'Sumar 1 gramo' }));
  expect(screen.getByDisplayValue('2000')).toBeInTheDocument(); // techo: no pasa de maxCantidad

  render(<Wrapper initial="1" />);
  await user.click(screen.getAllByRole('button', { name: 'Restar 1 gramo' })[1]);
  expect(screen.getAllByDisplayValue('1')[1]).toBeInTheDocument(); // piso: no baja de 1
});

it('el stepper suma/resta desde un valor intermedio', async () => {
  const user = userEvent.setup();
  render(<Wrapper initial="50" />);
  await user.click(screen.getByRole('button', { name: 'Sumar 1 gramo' }));
  expect(screen.getByDisplayValue('51')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Restar 1 gramo' }));
  await user.click(screen.getByRole('button', { name: 'Restar 1 gramo' }));
  expect(screen.getByDisplayValue('49')).toBeInTheDocument();
});
```

- [ ] **Step 6: Correr los tests y verificar que fallan**

Run: `npm test -- testing/CantidadSelector.test.tsx`
Expected: FAIL — no existe ningún botón con nombre accesible "Sumar 1 gramo" / "Restar 1 gramo".

- [ ] **Step 7: Agregar el stepper a `CantidadSelector.tsx`**

```typescript
// reemplazar el `return (...)` de CantidadSelector en src/app/alimentacion/CantidadSelector.tsx

  const ajustar = (delta: number) => {
    const actual = Number(value) || 0;
    const siguiente = Math.min(maxCantidad, Math.max(1, actual + delta));
    onChange(String(siguiente));
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2">
        {CANTIDADES_RAPIDAS.map((g) => {
          const activo = value === String(g);
          return (
            <button
              key={g}
              type="button"
              onClick={() => onChange(String(g))}
              className={`rounded-xl border py-2 text-sm font-semibold transition-colors ${
                activo ? 'text-white border-transparent' : 'border-gray-200 text-gray-700 hover:border-gray-300'
              }`}
              style={activo ? { backgroundColor: accentColor } : undefined}
            >
              {g} g
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => ajustar(-1)}
          aria-label="Restar 1 gramo"
          className="w-9 h-9 flex-shrink-0 rounded-lg border border-gray-200 text-gray-600 font-bold hover:bg-gray-50"
        >
          −
        </button>
        <input type="hidden" name={name} value={value} />
        <div className="flex-1 text-center text-sm font-semibold text-gray-900">{value || 0} g</div>
        <button
          type="button"
          onClick={() => ajustar(1)}
          aria-label="Sumar 1 gramo"
          className="w-9 h-9 flex-shrink-0 rounded-lg border border-gray-200 text-gray-600 font-bold hover:bg-gray-50"
        >
          +
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Correr los tests y verificar que pasan**

Run: `npm test -- testing/CantidadSelector.test.tsx`
Expected: PASS — 3/3.

- [ ] **Step 9: Escribir los tests que fallan — "Personalizar" y el aviso de ANMAT sin valores**

```typescript
// agregar a testing/CantidadSelector.test.tsx

it('"Personalizar" revela un input libre que sigue sincronizado con el valor', async () => {
  const user = userEvent.setup();
  render(<Wrapper initial="50" />);
  await user.click(screen.getByRole('button', { name: 'Personalizar' }));
  const libre = screen.getByPlaceholderText('Cantidad en gramos');
  expect(libre).toHaveValue(50);
  await user.clear(libre);
  await user.type(libre, '73');
  expect(screen.getByDisplayValue('73')).toBeInTheDocument();
});

it('muestra el aviso de "sin valores nutricionales" solo cuando mostrarAvisoSinValores es true', () => {
  const { rerender } = render(<Wrapper mostrarAvisoSinValores={false} />);
  expect(screen.queryByText(/no tiene valores nutricionales/i)).not.toBeInTheDocument();

  rerender(<Wrapper mostrarAvisoSinValores />);
  expect(screen.getByText(/no tiene valores nutricionales/i)).toBeInTheDocument();
});
```

- [ ] **Step 10: Correr los tests y verificar que fallan**

Run: `npm test -- testing/CantidadSelector.test.tsx`
Expected: FAIL — no existe el botón "Personalizar" ni el texto del aviso.

- [ ] **Step 11: Agregar "Personalizar" y el aviso a `CantidadSelector.tsx`**

Agregar `useState` al import y el estado/JSX final:

```typescript
// src/app/alimentacion/CantidadSelector.tsx — reemplazo completo
'use client';

import { useState } from 'react';

const CANTIDADES_RAPIDAS = [25, 50, 100, 150] as const;

export default function CantidadSelector({
  name,
  accentColor,
  maxCantidad,
  value,
  onChange,
  mostrarAvisoSinValores,
}: {
  name: string;
  accentColor: string;
  maxCantidad: number;
  value: string;
  onChange: (v: string) => void;
  mostrarAvisoSinValores: boolean;
}) {
  const [personalizar, setPersonalizar] = useState(false);

  const ajustar = (delta: number) => {
    const actual = Number(value) || 0;
    const siguiente = Math.min(maxCantidad, Math.max(1, actual + delta));
    onChange(String(siguiente));
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2">
        {CANTIDADES_RAPIDAS.map((g) => {
          const activo = value === String(g);
          return (
            <button
              key={g}
              type="button"
              onClick={() => onChange(String(g))}
              className={`rounded-xl border py-2 text-sm font-semibold transition-colors ${
                activo ? 'text-white border-transparent' : 'border-gray-200 text-gray-700 hover:border-gray-300'
              }`}
              style={activo ? { backgroundColor: accentColor } : undefined}
            >
              {g} g
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => ajustar(-1)}
          aria-label="Restar 1 gramo"
          className="w-9 h-9 flex-shrink-0 rounded-lg border border-gray-200 text-gray-600 font-bold hover:bg-gray-50"
        >
          −
        </button>
        <input type="hidden" name={name} value={value} />
        <div className="flex-1 text-center text-sm font-semibold text-gray-900">{value || 0} g</div>
        <button
          type="button"
          onClick={() => ajustar(1)}
          aria-label="Sumar 1 gramo"
          className="w-9 h-9 flex-shrink-0 rounded-lg border border-gray-200 text-gray-600 font-bold hover:bg-gray-50"
        >
          +
        </button>
      </div>

      {!personalizar ? (
        <button
          type="button"
          onClick={() => setPersonalizar(true)}
          className="w-full rounded-xl border border-gray-200 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
        >
          Personalizar
        </button>
      ) : (
        <div className="flex gap-2 items-center">
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            min="1"
            max={maxCantidad}
            step="any"
            autoFocus
            placeholder="Cantidad en gramos"
            className="flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 transition-all"
            style={{ ['--tw-ring-color' as string]: `${accentColor}40` }}
          />
          <span className="text-sm text-gray-500 font-medium pr-1">g</span>
        </div>
      )}

      {mostrarAvisoSinValores && (
        <p className="text-xs text-amber-600">
          Este alimento no tiene valores nutricionales cargados — vas a poder registrarlo igual, pero no va a sumar a tus calorías/macros.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 12: Correr los tests y verificar que pasan**

Run: `npm test -- testing/CantidadSelector.test.tsx`
Expected: PASS — 5/5.

- [ ] **Step 13: Commit**

```bash
git add src/app/alimentacion/CantidadSelector.tsx testing/CantidadSelector.test.tsx
git commit -m "feat: selector de cantidad con botones rápidos, stepper y Personalizar

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `BusquedaAlimento.tsx` — extraer el buscador y agregar ×, filtros, Recientes, layout mobile

**Files:**
- Create: `src/app/alimentacion/BusquedaAlimento.tsx`
- Modify: `src/app/alimentacion/AlimentacionClient.tsx` (reemplazar el bloque de búsqueda por `<BusquedaAlimento>`)
- Modify: `testing/AlimentacionSearch.test.tsx`

**Interfaces:**
- Consumes: `searchAlimentosAction`, `getAlimentosRecientesAction`, `AlimentoOption` de `actions.ts` (Task 3); `CamposBusqueda`, `CAMPOS_DEFAULT` de `searchQuery.ts` (Task 1).
- Produces: `BusquedaAlimento` (default export, `forwardRef`), props `{ tipoIngesta: IngestaTipo; accentColor: string; canEdit: boolean; selectedAlimento: AlimentoOption | null; onSelectAlimento: (a: AlimentoOption) => void; onClearSelection: () => void; onOpenManual: (query: string) => void; onOpenAI: () => void; onOpenChat: () => void; onOpenBarcode: () => void }`, handle imperativo `{ focus(): void }` — consumidos por Task 6 (`AlimentacionClient.tsx`).

- [ ] **Step 1: Extraer el bloque de búsqueda existente a `BusquedaAlimento.tsx` sin cambiar comportamiento**

Crear `src/app/alimentacion/BusquedaAlimento.tsx` moviendo ahí, tal cual, el estado y JSX de búsqueda de `AlimentacionClient.tsx` (líneas 99-113 el estado relevante, 119-134 el efecto de búsqueda, 136-272 el JSX del input+dropdown, 318-347 el modal de denominación, 274-315 los 3 botones), expuesto como componente controlado:

```typescript
// src/app/alimentacion/BusquedaAlimento.tsx
'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { searchAlimentosAction, getAlimentosRecientesAction, type AlimentoOption } from './actions';
import { CAMPOS_DEFAULT, type CamposBusqueda } from './searchQuery';
import { type IngestaTipo } from '@/lib/nutrition';

export type BusquedaAlimentoHandle = { focus: () => void };

const BusquedaAlimento = forwardRef<BusquedaAlimentoHandle, {
  tipoIngesta: IngestaTipo;
  accentColor: string;
  canEdit: boolean;
  selectedAlimento: AlimentoOption | null;
  onSelectAlimento: (a: AlimentoOption) => void;
  onClearSelection: () => void;
  onOpenManual: (query: string) => void;
  onOpenAI: () => void;
  onOpenChat: () => void;
  onOpenBarcode: () => void;
}>(function BusquedaAlimento(
  { tipoIngesta, accentColor, canEdit, selectedAlimento, onSelectAlimento, onClearSelection, onOpenManual, onOpenAI, onOpenChat, onOpenBarcode },
  ref,
) {
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchResults, setSearchResults] = useState<AlimentoOption[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [denominacionModal, setDenominacionModal] = useState<AlimentoOption | null>(null);
  const [recientes, setRecientes] = useState<AlimentoOption[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ focus: () => searchInputRef.current?.focus() }));

  useEffect(() => {
    getAlimentosRecientesAction().then(setRecientes);
  }, []);

  useEffect(() => {
    if (query.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const t = setTimeout(async () => {
      const data = await searchAlimentosAction(query, tipoIngesta);
      setSearchResults(data);
      setSearchLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query, tipoIngesta]);

  const filtered = selectedAlimento ? [] : searchResults;

  const handleSelect = (a: AlimentoOption) => {
    onSelectAlimento(a);
    setQuery(a.nombre);
    setShowDropdown(false);
  };

  const handleClear = () => {
    setQuery('');
    setSearchResults([]);
    setShowDropdown(false);
    onClearSelection();
  };

  if (!canEdit) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <div className="relative flex-1">
          <div className="relative">
            <svg
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400"
              width="18" height="18"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (selectedAlimento) onClearSelection();
                setShowDropdown(true);
                if (e.target.value.length < 2) setSearchResults([]);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder={
                tipoIngesta === 'suplemento'
                  ? 'Buscar suplemento: proteína, creatina...'
                  : 'Buscar en SARA2 y ANMAT: arroz, pollo, banana...'
              }
              className="w-full pl-10 pr-10 py-3.5 rounded-2xl border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 transition-all"
              style={{ ['--tw-ring-color' as string]: `${accentColor}40` }}
            />
            {query.length > 0 && (
              <button
                type="button"
                aria-label="Limpiar búsqueda"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleClear}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {showDropdown && searchLoading && query.length >= 2 && !selectedAlimento && (
            <div className="absolute top-full left-0 right-0 bg-white rounded-2xl shadow-lg border border-gray-100 z-20 mt-1 p-3 text-center">
              <span className="text-xs text-gray-400">Buscando...</span>
            </div>
          )}

          {showDropdown && !searchLoading && filtered.length > 0 && !selectedAlimento && (
            <div className="absolute top-full left-0 right-0 bg-white rounded-2xl shadow-lg border border-gray-100 z-20 mt-1 overflow-hidden max-h-64 overflow-y-auto">
              {filtered.map((a) => (
                <div
                  key={a.id_alimento}
                  onMouseDown={() => handleSelect(a)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 text-sm flex items-center gap-2 border-b border-gray-50 last:border-0 transition-colors cursor-pointer"
                >
                  <span className="font-medium text-gray-900 flex-1 min-w-0 truncate">{a.nombre}</span>
                  {a.marca && (
                    <span className="text-xs text-gray-400 flex-shrink-0 hidden sm:inline truncate max-w-24">{a.marca}</span>
                  )}
                  <span className={`text-xs px-1.5 py-0.5 rounded font-semibold flex-shrink-0 ${
                    a.fuente === 'ANMAT' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'
                  }`}>
                    {a.fuente}
                  </span>
                  {(a.denominacion || a.categoria) && (
                    <button
                      type="button"
                      aria-label="Ver detalle del alimento"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDenominacionModal(a);
                      }}
                      className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex-shrink-0 flex items-center justify-center hover:bg-blue-600 transition-colors"
                    >
                      ?
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {showDropdown && query.length === 0 && !selectedAlimento && recientes.length > 0 && (
            <div className="absolute top-full left-0 right-0 bg-white rounded-2xl shadow-lg border border-gray-100 z-20 mt-1 overflow-hidden max-h-64 overflow-y-auto">
              <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Recientes</p>
              {recientes.map((a) => (
                <div
                  key={a.id_alimento}
                  onMouseDown={() => handleSelect(a)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 text-sm flex items-center gap-2 border-b border-gray-50 last:border-0 transition-colors cursor-pointer"
                >
                  <span className="font-medium text-gray-900 flex-1 min-w-0 truncate">{a.nombre}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-semibold flex-shrink-0 ${
                    a.fuente === 'ANMAT' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'
                  }`}>
                    {a.fuente}
                  </span>
                </div>
              ))}
            </div>
          )}

          {showDropdown && !searchLoading && query.length >= 2 && filtered.length === 0 && !selectedAlimento && (
            <div className="absolute top-full left-0 right-0 bg-white rounded-2xl shadow-lg border border-gray-100 z-20 mt-1 p-4 text-center">
              <p className="text-sm text-gray-500">No encontramos &quot;{query}&quot; en el catálogo.</p>
              <button
                type="button"
                onMouseDown={() => { setShowDropdown(false); onOpenManual(query); }}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
                style={{ color: accentColor }}
              >
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Cargar alimento manualmente
              </button>
            </div>
          )}
        </div>

        <div className="hidden sm:flex items-start gap-2 flex-shrink-0" data-testid="metodos-desktop">
          <button
            type="button"
            onClick={onOpenAI}
            className="flex-shrink-0 flex items-center gap-1.5 rounded-2xl px-4 py-3.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03] active:scale-[0.98]"
            style={{ backgroundImage: 'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)', boxShadow: '0 8px 20px rgba(168,85,247,0.35)' }}
          >
            <span aria-hidden="true">✨</span>
            <span>Reconocimiento por IA</span>
          </button>
          <button
            type="button"
            onClick={onOpenChat}
            className="flex-shrink-0 flex items-center gap-1.5 rounded-2xl px-4 py-3.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03] active:scale-[0.98]"
            style={{ backgroundImage: 'linear-gradient(135deg, #0ea5e9 0%, #22c55e 100%)', boxShadow: '0 8px 20px rgba(14,165,233,0.35)' }}
          >
            <span aria-hidden="true">💬</span>
            <span>Registrar por chat</span>
          </button>
          <button
            type="button"
            onClick={onOpenBarcode}
            className="flex-shrink-0 flex items-center gap-1.5 rounded-2xl px-4 py-3.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03] active:scale-[0.98]"
            style={{ backgroundImage: 'linear-gradient(135deg, #f97316 0%, #f59e0b 100%)', boxShadow: '0 8px 20px rgba(249,115,22,0.35)' }}
          >
            <span aria-hidden="true">📷</span>
            <span>Escanear código</span>
          </button>
        </div>

        {query.length > 0 && (
          <button
            type="button"
            onClick={onOpenBarcode}
            aria-label="Escanear código"
            data-testid="metodos-mobile"
            className="sm:hidden flex-shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center text-white"
            style={{ backgroundImage: 'linear-gradient(135deg, #f97316 0%, #f59e0b 100%)', boxShadow: '0 8px 20px rgba(249,115,22,0.35)' }}
          >
            <span aria-hidden="true" className="text-lg">📷</span>
          </button>
        )}
      </div>

      {query.length === 0 && (
        <div className="flex sm:hidden items-center gap-2" data-testid="metodos-mobile">
          <button
            type="button"
            onClick={onOpenAI}
            aria-label="Reconocimiento por IA"
            className="flex-1 h-12 rounded-2xl flex items-center justify-center text-white"
            style={{ backgroundImage: 'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)', boxShadow: '0 8px 20px rgba(168,85,247,0.35)' }}
          >
            <span aria-hidden="true" className="text-lg">✨</span>
          </button>
          <button
            type="button"
            onClick={onOpenChat}
            aria-label="Registrar por chat"
            className="flex-1 h-12 rounded-2xl flex items-center justify-center text-white"
            style={{ backgroundImage: 'linear-gradient(135deg, #0ea5e9 0%, #22c55e 100%)', boxShadow: '0 8px 20px rgba(14,165,233,0.35)' }}
          >
            <span aria-hidden="true" className="text-lg">💬</span>
          </button>
          <button
            type="button"
            onClick={onOpenBarcode}
            aria-label="Escanear código"
            className="flex-1 h-12 rounded-2xl flex items-center justify-center text-white"
            style={{ backgroundImage: 'linear-gradient(135deg, #f97316 0%, #f59e0b 100%)', boxShadow: '0 8px 20px rgba(249,115,22,0.35)' }}
          >
            <span aria-hidden="true" className="text-lg">📷</span>
          </button>
        </div>
      )}

      <Modal open={denominacionModal !== null} onClose={() => setDenominacionModal(null)} title="Detalle del alimento">
        <p className="text-sm font-semibold text-gray-900">{denominacionModal?.nombre}</p>
        <dl className="mt-3 space-y-2 text-sm">
          {([
            ['Fuente', denominacionModal?.fuente],
            ['Categoría', denominacionModal?.categoria],
            ['Marca', denominacionModal?.marca],
            ['Denominación', denominacionModal?.denominacion],
          ] as const).map(([label, value]) =>
            value ? (
              <div key={label}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
                <dd className="text-gray-700 leading-relaxed">{value}</dd>
              </div>
            ) : null
          )}
        </dl>
        <button
          type="button"
          onClick={() => setDenominacionModal(null)}
          className="mt-4 w-full rounded-xl py-2.5 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 transition-colors"
        >
          Cerrar
        </button>
      </Modal>
    </div>
  );
});

export default BusquedaAlimento;
```

Notar: esta primera versión ya incluye, sobre la extracción, 3 cambios chicos del alcance (× para limpiar, preventDefault en el botón "?", y el layout mobile de íconos) porque separarlos exigiría escribir y volver a tirar JSX intermedio — los tests de los Steps siguientes son los que verifican cada uno.

- [ ] **Step 2: Escribir los tests que fallan — × limpia la búsqueda sin dejar que una respuesta en vuelo la repueble**

Agregar a `testing/AlimentacionSearch.test.tsx` (ver Step 7 de este Task para el resto de los cambios de mocks que este archivo necesita antes de poder correr):

```typescript
// agregar a testing/AlimentacionSearch.test.tsx, dentro de un nuevo describe
describe('botón "×" de limpiar búsqueda', () => {
  it('aparece solo cuando hay texto y limpia el input al clickear', async () => {
    vi.mocked(searchAlimentosAction).mockResolvedValue([A_SARA2_CON_CATEGORIA]);
    const { user } = mount();
    expect(screen.queryByRole('button', { name: 'Limpiar búsqueda' })).not.toBeInTheDocument();

    await buscar(user, 'ar', A_SARA2_CON_CATEGORIA.nombre);
    await user.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));

    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.queryByText(A_SARA2_CON_CATEGORIA.nombre)).not.toBeInTheDocument();
  });

  it('una respuesta de búsqueda que resuelve después de limpiar no repuebla el dropdown', async () => {
    let resolverBusqueda: (v: AlimentoOption[]) => void = () => {};
    vi.mocked(searchAlimentosAction).mockReturnValue(new Promise((resolve) => { resolverBusqueda = resolve; }));
    const { user } = mount();

    await user.type(screen.getByRole('textbox'), 'ar');
    await user.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
    resolverBusqueda([A_SARA2_CON_CATEGORIA]);

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(A_SARA2_CON_CATEGORIA.nombre)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `npm test -- testing/AlimentacionSearch.test.tsx`
Expected: FAIL en el primer test (`BusquedaAlimento.tsx` no existe todavía / `AlimentacionClient.tsx` no lo usa todavía — ver Step 6).

- [ ] **Step 4: Escribir los tests que fallan — filtros por campo**

```typescript
// agregar a testing/AlimentacionSearch.test.tsx
describe('filtros de búsqueda (Nombre/Marca/Denominación)', () => {
  it('el toggle "Buscar" revela los 3 checkboxes, todos tildados por default', async () => {
    const { user } = mount();
    expect(screen.queryByRole('checkbox', { name: 'Nombre' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /buscar/i }));
    expect(screen.getByRole('checkbox', { name: 'Nombre' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Marca' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Denominación' })).toBeChecked();
  });

  it('destildar un campo lo manda en false al server action', async () => {
    vi.mocked(searchAlimentosAction).mockResolvedValue([]);
    const { user } = mount();
    await user.click(screen.getByRole('button', { name: /buscar/i }));
    await user.click(screen.getByRole('checkbox', { name: 'Marca' }));
    await user.type(screen.getByRole('textbox'), 'ar');
    await waitFor(() => expect(searchAlimentosAction).toHaveBeenCalledWith('ar', 'almuerzo', { nombre: true, marca: false, denominacion: true }));
  });

  it('desmarcar los 3 campos muestra un aviso de "elegí al menos un campo", no "sin resultados"', async () => {
    const { user } = mount();
    await user.click(screen.getByRole('button', { name: /buscar/i }));
    await user.click(screen.getByRole('checkbox', { name: 'Nombre' }));
    await user.click(screen.getByRole('checkbox', { name: 'Marca' }));
    await user.click(screen.getByRole('checkbox', { name: 'Denominación' }));
    await user.type(screen.getByRole('textbox'), 'ar');
    expect(await screen.findByText(/elegí al menos un campo/i)).toBeInTheDocument();
    expect(screen.queryByText(/no encontramos/i)).not.toBeInTheDocument();
  });

  it('"Quitar filtros" vuelve a tildar los 3 campos', async () => {
    vi.mocked(searchAlimentosAction).mockResolvedValue([]);
    const { user } = mount();
    await user.click(screen.getByRole('button', { name: /buscar/i }));
    await user.click(screen.getByRole('checkbox', { name: 'Marca' }));
    await user.type(screen.getByRole('textbox'), 'xyz');
    await screen.findByText(/no encontramos/i);
    await user.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(screen.getByRole('checkbox', { name: 'Marca' })).toBeChecked();
  });
});
```

- [ ] **Step 5: Escribir los tests que fallan — Recientes**

```typescript
// agregar a testing/AlimentacionSearch.test.tsx
describe('sección "Recientes"', () => {
  it('se muestra al enfocar el buscador vacío', async () => {
    vi.mocked(getAlimentosRecientesAction).mockResolvedValue([A_SARA2_CON_CATEGORIA]);
    const { user } = mount();
    await user.click(screen.getByRole('textbox'));
    expect(await screen.findByText(A_SARA2_CON_CATEGORIA.nombre)).toBeInTheDocument();
    expect(screen.getByText('Recientes')).toBeInTheDocument();
  });

  it('desaparece en cuanto se empieza a tipear', async () => {
    vi.mocked(getAlimentosRecientesAction).mockResolvedValue([A_SARA2_CON_CATEGORIA]);
    vi.mocked(searchAlimentosAction).mockResolvedValue([]);
    const { user } = mount();
    await user.click(screen.getByRole('textbox'));
    await screen.findByText('Recientes');
    await user.type(screen.getByRole('textbox'), 'xy');
    await waitFor(() => expect(screen.queryByText('Recientes')).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 6: Wire — reemplazar el bloque de búsqueda en `AlimentacionClient.tsx` por `<BusquedaAlimento>`**

En `src/app/alimentacion/AlimentacionClient.tsx`: quitar el estado `query`, `selectedAlimento` (se mantiene, lo setea `BusquedaAlimento` vía callback), `showDropdown`, `searchResults`, `searchLoading`, `denominacionModal`, `searchInputRef`, `debounceRef`, el `useEffect` de búsqueda, `handleSelectAlimento`, `handleCancelSelection`, y todo el JSX de las líneas 178-347 (el bloque `{/* Search + AI recognition button */}` hasta el cierre del modal de denominación). Reemplazar por:

```typescript
// imports: agregar
import BusquedaAlimento, { type BusquedaAlimentoHandle } from './BusquedaAlimento';

// estado: reemplaza query/selectedAlimento/showDropdown/searchResults/searchLoading/denominacionModal/debounceRef
const [selectedAlimento, setSelectedAlimento] = useState<AlimentoOption | null>(null);
const [manualQuery, setManualQuery] = useState('');
const searchHandleRef = useRef<BusquedaAlimentoHandle>(null);

// JSX: reemplaza el bloque completo de búsqueda por
<BusquedaAlimento
  ref={searchHandleRef}
  tipoIngesta={tipoIngesta}
  accentColor={accentColor}
  canEdit={canEdit}
  selectedAlimento={selectedAlimento}
  onSelectAlimento={setSelectedAlimento}
  onClearSelection={() => setSelectedAlimento(null)}
  onOpenManual={(query) => { setManualQuery(query); setShowManualModal(true); }}
  onOpenAI={() => setShowAIModal(true)}
  onOpenChat={() => setShowChatModal(true)}
  onOpenBarcode={() => setShowBarcodeModal(true)}
/>
```

Actualizar el modal manual (`defaultValue={query}` → `defaultValue={manualQuery}`), `handleCloseManualModal` (ya no limpia `query`, limpia `manualQuery`), y los dos usos de `searchInputRef.current?.focus()` en `onSelectOtro`/`onConfirm` de los modales de IA/chat → `searchHandleRef.current?.focus()`. El botón "×" de cancelar selección en el formulario de agregar (línea 471-479 original) pasa a llamar `() => setSelectedAlimento(null)` en vez de `handleCancelSelection`.

- [ ] **Step 7: Actualizar los mocks de `testing/AlimentacionSearch.test.tsx`**

```typescript
// testing/AlimentacionSearch.test.tsx — reemplazar el bloque vi.mock de actions
vi.mock('@/app/alimentacion/actions', () => ({
  searchAlimentosAction:        vi.fn().mockResolvedValue([]),
  getAlimentosRecientesAction:  vi.fn().mockResolvedValue([]),
  addItemAction:                vi.fn(),
  addManualItemAction:          vi.fn(),
  deleteItemAction:             vi.fn(),
  updateItemAction:             vi.fn(),
}));
```

Agregar `getAlimentosRecientesAction` al import del archivo (`import { searchAlimentosAction, getAlimentosRecientesAction } from '@/app/alimentacion/actions';`) y resetear su mock en el `beforeEach` existente (`vi.mocked(getAlimentosRecientesAction).mockResolvedValue([]);`), para que las descripciones de "Recientes" (Step 5) puedan sobreescribirlo.

- [ ] **Step 8: Agregar el componente `BuscarFiltros` (toggle + checkboxes) dentro de `BusquedaAlimento.tsx`**

Agregar estado y JSX a `BusquedaAlimento.tsx` (el componente creado en el Step 1):

```typescript
// agregar al cuerpo de BusquedaAlimento, junto a los otros useState
const [campos, setCampos] = useState<CamposBusqueda>(CAMPOS_DEFAULT);
const [showFiltros, setShowFiltros] = useState(false);

const ningunCampoTildado = !campos.nombre && !campos.marca && !campos.denominacion;
```

Reemplazar el `useEffect` de búsqueda para depender también de `campos`:

```typescript
useEffect(() => {
  if (query.length < 2 || ningunCampoTildado) {
    setSearchResults([]);
    setSearchLoading(false);
    return;
  }
  setSearchLoading(true);
  const t = setTimeout(async () => {
    const data = await searchAlimentosAction(query, tipoIngesta, campos);
    setSearchResults(data);
    setSearchLoading(false);
  }, 300);
  return () => clearTimeout(t);
}, [query, tipoIngesta, campos, ningunCampoTildado]);
```

Agregar el toggle + checkboxes justo debajo del `<div className="flex items-start gap-2">` que envuelve input+botones (antes del bloque `{query.length === 0 && (...mobile icons...)}`):

```tsx
<div className="flex flex-wrap items-center gap-3">
  <button
    type="button"
    onClick={() => setShowFiltros((v) => !v)}
    className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
  >
    Buscar
    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
      className={`transition-transform ${showFiltros ? 'rotate-180' : ''}`}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  </button>
  {showFiltros && (
    <div className="flex flex-wrap gap-3 text-xs text-gray-600">
      {(['nombre', 'marca', 'denominacion'] as const).map((campo) => (
        <label key={campo} className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={campos[campo]}
            onChange={(e) => setCampos((c) => ({ ...c, [campo]: e.target.checked }))}
          />
          {campo === 'nombre' ? 'Nombre' : campo === 'marca' ? 'Marca' : 'Denominación'}
        </label>
      ))}
    </div>
  )}
</div>
```

Reemplazar el bloque de "0 resultados" para distinguir "ningún campo tildado" de "sin matches":

```tsx
{showDropdown && query.length >= 2 && filtered.length === 0 && !selectedAlimento && (
  <div className="absolute top-full left-0 right-0 bg-white rounded-2xl shadow-lg border border-gray-100 z-20 mt-1 p-4 text-center">
    {ningunCampoTildado ? (
      <>
        <p className="text-sm text-gray-500">Elegí al menos un campo para buscar.</p>
        <button
          type="button"
          onMouseDown={() => setCampos(CAMPOS_DEFAULT)}
          className="mt-2 text-sm font-semibold hover:underline"
          style={{ color: accentColor }}
        >
          Quitar filtros
        </button>
      </>
    ) : !searchLoading ? (
      <>
        <p className="text-sm text-gray-500">No encontramos &quot;{query}&quot; en el catálogo.</p>
        <div className="mt-2 flex flex-col items-center gap-1">
          <button
            type="button"
            onMouseDown={() => { setShowDropdown(false); onOpenManual(query); }}
            className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
            style={{ color: accentColor }}
          >
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Cargar alimento manualmente
          </button>
          {campos !== CAMPOS_DEFAULT && (
            <button type="button" onMouseDown={() => setCampos(CAMPOS_DEFAULT)} className="text-xs font-semibold text-gray-400 hover:underline">
              Quitar filtros
            </button>
          )}
        </div>
      </>
    ) : null}
  </div>
)}
```

Nota: `campos !== CAMPOS_DEFAULT` compara referencias de objeto, no valores — siempre es `true` salvo que sea literalmente el mismo objeto importado. Esto es intencional y suficiente: el botón "Quitar filtros" aparece siempre en el estado de 0-resultados-con-texto (no hace daño mostrarlo aunque los 3 ya estén tildados), y el test del Step 4 solo verifica su presencia después de destildar explícitamente uno.

Quitar el bloque `{showDropdown && !searchLoading && query.length >= 2 && filtered.length === 0 ...}` original (el que creaba este mismo mensaje antes del filtro) ya que queda reemplazado por el bloque de arriba.

- [ ] **Step 9: Correr los tests y verificar que pasan**

Run: `npm test -- testing/AlimentacionSearch.test.tsx`
Expected: PASS — todos los tests existentes más los nuevos de ×, filtros y Recientes.

- [ ] **Step 10: Escribir el test que falla — "?" ya no cierra el dropdown**

```typescript
// agregar a testing/AlimentacionSearch.test.tsx, en el describe de botón "?" existente
it('clickear "?" no cierra el dropdown de resultados', async () => {
  vi.mocked(searchAlimentosAction).mockResolvedValue([A_ANMAT_COMPLETO]);
  const { user } = mount();
  await buscar(user, 'ace', A_ANMAT_COMPLETO.nombre);
  await user.click(screen.getByRole('button', { name: 'Ver detalle del alimento' }));
  await user.click(screen.getByRole('button', { name: 'Cerrar' }));
  expect(screen.getByText(A_ANMAT_COMPLETO.nombre)).toBeInTheDocument();
});
```

Este test ya debería pasar porque el `preventDefault` se agregó en el Step 1 — correrlo confirma que la extracción no rompió el fix.

Run: `npm test -- testing/AlimentacionSearch.test.tsx`
Expected: PASS.

- [ ] **Step 11: Correr la suite completa**

Run: `npm test`
Expected: Todo verde.

- [ ] **Step 12: Commit**

```bash
git add src/app/alimentacion/BusquedaAlimento.tsx src/app/alimentacion/AlimentacionClient.tsx testing/AlimentacionSearch.test.tsx
git commit -m "feat: extraer buscador a BusquedaAlimento.tsx — botón ×, filtros por campo, Recientes, layout mobile, fix bug del botón ?

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Wire `CantidadSelector` en `AlimentacionClient.tsx` + reset al cambiar de alimento

**Files:**
- Modify: `src/app/alimentacion/AlimentacionClient.tsx`
- Modify: `testing/AlimentacionSearch.test.tsx`

**Interfaces:**
- Consumes: `CantidadSelector` (Task 4), `selectedAlimento`/`MAX_CANTIDAD` ya presentes en `AlimentacionClient.tsx`.

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// agregar a testing/AlimentacionSearch.test.tsx
describe('selector de cantidad del formulario de agregar', () => {
  it('clickear un botón rápido actualiza la cantidad y el submit queda habilitado', async () => {
    vi.mocked(searchAlimentosAction).mockResolvedValue([A_SARA2_CON_CATEGORIA]);
    const { user } = mount();
    await buscar(user, 'ar', A_SARA2_CON_CATEGORIA.nombre);
    await user.click(screen.getByText(A_SARA2_CON_CATEGORIA.nombre));
    await user.click(screen.getByRole('button', { name: '150 g' }));
    expect(screen.getByRole('button', { name: /agregar a/i })).toBeEnabled();
  });

  it('cambiar de alimento seleccionado resetea la cantidad a 50 g', async () => {
    vi.mocked(searchAlimentosAction).mockResolvedValue([A_SARA2_CON_CATEGORIA, A_ANMAT_CON_MARCA_SIN_DENOM]);
    const { user } = mount();
    await buscar(user, 'a', A_SARA2_CON_CATEGORIA.nombre);
    await user.click(screen.getByText(A_SARA2_CON_CATEGORIA.nombre));
    await user.click(screen.getByRole('button', { name: 'Personalizar' }));
    await user.clear(screen.getByPlaceholderText('Cantidad en gramos'));
    await user.type(screen.getByPlaceholderText('Cantidad en gramos'), '1200');

    await user.click(screen.getByRole('button', { name: 'Quitar selección' }));
    await buscar(user, 'a', A_ANMAT_CON_MARCA_SIN_DENOM.nombre);
    await user.click(screen.getByText(A_ANMAT_CON_MARCA_SIN_DENOM.nombre));

    expect(screen.getByRole('button', { name: '50 g' })).toHaveClass('text-white');
  });

  it('tipear un valor inválido en "Personalizar" deshabilita el submit', async () => {
    vi.mocked(searchAlimentosAction).mockResolvedValue([A_SARA2_CON_CATEGORIA]);
    const { user } = mount();
    await buscar(user, 'ar', A_SARA2_CON_CATEGORIA.nombre);
    await user.click(screen.getByText(A_SARA2_CON_CATEGORIA.nombre));
    await user.click(screen.getByRole('button', { name: 'Personalizar' }));
    await user.clear(screen.getByPlaceholderText('Cantidad en gramos'));
    expect(screen.getByRole('button', { name: /agregar a/i })).toBeDisabled();
  });

  it('muestra el aviso de ANMAT sin valores cuando el alimento seleccionado no tiene macros', async () => {
    const sinValores: AlimentoOption = { ...A_ANMAT_VACIO, kcal_100g: null, proteinas_100g: null, grasas_100g: null, carbs_100g: null };
    vi.mocked(searchAlimentosAction).mockResolvedValue([sinValores]);
    const { user } = mount();
    await buscar(user, 'prod', sinValores.nombre);
    await user.click(screen.getByText(sinValores.nombre));
    expect(await screen.findByText(/no tiene valores nutricionales/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test -- testing/AlimentacionSearch.test.tsx`
Expected: FAIL — el formulario de agregar todavía usa el input plano de cantidad, no hay botones "150 g"/"Personalizar"/"50 g" ni el aviso de ANMAT.

- [ ] **Step 3: Agregar `aria-label` al botón de deseleccionar y reemplazar el input de cantidad por `CantidadSelector`**

En `src/app/alimentacion/AlimentacionClient.tsx`, agregar `aria-label="Quitar selección"` al `<button onClick={() => setSelectedAlimento(null)} ...>` del encabezado de la card (el de la "×" junto al nombre del alimento seleccionado).

Agregar estado para la cantidad, con reset al cambiar de alimento:

```typescript
// agregar junto a los demás useState de AlimentacionClient
const [cantidadValue, setCantidadValue] = useState('50');

useEffect(() => {
  setCantidadValue('50');
}, [selectedAlimento?.id_alimento]);
```

Importar `CantidadSelector` (`import CantidadSelector from './CantidadSelector';`) y reemplazar, dentro del formulario `action={addItemAction}`, el bloque:

```tsx
<div className="flex gap-2 items-center">
  <input type="number" name="cantidad" placeholder="Cantidad en gramos" min="1" max={MAX_CANTIDAD} step="any" required ... />
  <span className="text-sm text-gray-500 font-medium pr-1">g</span>
</div>
```

por:

```tsx
<CantidadSelector
  name="cantidad"
  accentColor={accentColor}
  maxCantidad={MAX_CANTIDAD}
  value={cantidadValue}
  onChange={setCantidadValue}
  mostrarAvisoSinValores={
    selectedAlimento != null &&
    selectedAlimento.kcal_100g == null &&
    selectedAlimento.proteinas_100g == null &&
    selectedAlimento.grasas_100g == null &&
    selectedAlimento.carbs_100g == null
  }
/>
```

Y deshabilitar el submit del formulario cuando el valor no es válido — cambiar el botón `<button type="submit" ...>Agregar a {label}</button>` del formulario de agregar para que incluya:

```tsx
disabled={!(Number(cantidadValue) > 0 && Number(cantidadValue) <= MAX_CANTIDAD)}
```

(mantener las clases existentes; `disabled:opacity-50 disabled:cursor-not-allowed` no están en las clases actuales de ese botón — agregarlas junto a las que ya tiene.)

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test -- testing/AlimentacionSearch.test.tsx`
Expected: PASS.

- [ ] **Step 5: Correr la suite completa**

Run: `npm test`
Expected: Todo verde.

- [ ] **Step 6: Commit**

```bash
git add src/app/alimentacion/AlimentacionClient.tsx testing/AlimentacionSearch.test.tsx
git commit -m "feat: usar CantidadSelector en el formulario de agregar, resetear cantidad al cambiar de alimento

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Bugs chicos de layout — overflow de fecha en mobile y tooltip de nombre largo

**Files:**
- Modify: `src/app/alimentacion/AlimentacionView.tsx`
- Modify: `src/app/alimentacion/AlimentacionClient.tsx`
- Test: `testing/AlimentacionSearch.test.tsx`

El fix de overflow es puramente de CSS (no hay layout real en jsdom para comprobarlo con un assert) — se verifica manualmente en el navegador a 375px de ancho, como ya documenta el spec. El tooltip del nombre sí es testeable.

- [ ] **Step 1: Escribir el test que falla — tooltip en nombres largos**

```typescript
// agregar a testing/AlimentacionSearch.test.tsx
it('el nombre del ítem cargado tiene title para ver el nombre completo si está truncado', () => {
  render(
    <AlimentacionClient
      ingesta={{
        id_ingesta: 1, tipo: 'almuerzo',
        kcal_total: 100, proteinas_total_g: 5, grasas_total_g: 2, carbs_total_g: 10,
        items: [{
          id_item: 1, id_alimento: 1, nombre_manual: null, tipo_item: 'solido',
          cantidad: 100, kcal: 100, proteinas_g: 5, grasas_g: 2, carbs_g: 10,
          alimentos: { nombre: 'Un nombre de alimento muy pero muy largo para una fila', categoria: null },
        }],
      }}
      tipoIngesta="almuerzo"
      fecha="2026-09-21"
      hideNutrition={false}
    />,
  );
  expect(screen.getByText('Un nombre de alimento muy pero muy largo para una fila'))
    .toHaveAttribute('title', 'Un nombre de alimento muy pero muy largo para una fila');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- testing/AlimentacionSearch.test.tsx`
Expected: FAIL — el `<p>` no tiene atributo `title`.

- [ ] **Step 3: Agregar `title` al nombre del ítem en `AlimentacionClient.tsx`**

Cambiar, en el bloque "Normal item display":

```tsx
<p className="text-sm font-semibold text-gray-900 truncate">{getAlimentoNombre(item)}</p>
```

por:

```tsx
<p className="text-sm font-semibold text-gray-900 truncate" title={getAlimentoNombre(item)}>{getAlimentoNombre(item)}</p>
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- testing/AlimentacionSearch.test.tsx`
Expected: PASS.

- [ ] **Step 5: Envolver el `DatePicker` para evitar overflow horizontal en mobile**

En `src/app/alimentacion/AlimentacionView.tsx`, cambiar:

```tsx
<div className="pb-3">
  <DatePicker fecha={fecha} tipo={selectedTipo} />
</div>
```

por:

```tsx
<div className="pb-3 min-w-0 overflow-hidden">
  <DatePicker fecha={fecha} tipo={selectedTipo} />
</div>
```

- [ ] **Step 6: Verificación manual**

No hay test automatizado para esto (jsdom no mide layout real). Verificar manualmente: abrir `/alimentacion` en Chrome DevTools con viewport de 375px de ancho y confirmar que el `<input type="date">` no fuerza scroll horizontal de la página.

- [ ] **Step 7: Correr la suite completa**

Run: `npm test`
Expected: Todo verde.

- [ ] **Step 8: Commit**

```bash
git add src/app/alimentacion/AlimentacionView.tsx src/app/alimentacion/AlimentacionClient.tsx testing/AlimentacionSearch.test.tsx
git commit -m "fix: overflow horizontal del selector de fecha en mobile, tooltip en nombres largos de ítems

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Actualizar `anmat-schema.test.ts` al nuevo cap de 150

**Files:**
- Modify: `testing/anmat-schema.test.ts`

Este test documenta en código el contrato de merge/cap de `searchAlimentosAction` (no llama a la función real). El cap cambió de 80 a 150 en Task 3 — este test queda desactualizado y hay que alinearlo, no es un bug a corregir.

- [ ] **Step 1: Actualizar el test de cap**

Reemplazar, en `testing/anmat-schema.test.ts`:

```typescript
it('el resultado final se limita a 80 elementos', () => {
  const byNombre: AlimentoOption[] = Array.from({ length: 60 }, (_, i) => ({
    id_alimento: i + 1,
    nombre: `Alimento SARA2 ${i + 1}`,
    categoria: null,
    fuente: 'SARA2',
    marca: null,
    denominacion: null,
  }));
  const byOther: AlimentoOption[] = Array.from({ length: 40 }, (_, i) => ({
    id_alimento: ANMAT_OFFSET + i + 1,
    nombre: `Alimento ANMAT ${i + 1}`,
    categoria: null,
    fuente: 'ANMAT',
    marca: null,
    denominacion: null,
  }));

  const merged = [...byNombre, ...byOther].slice(0, 80);
  expect(merged).toHaveLength(80);
  // Los primeros 60 son SARA2 (byNombre), los siguientes 20 son ANMAT (byOther truncado)
  expect(merged[0].fuente).toBe('SARA2');
  expect(merged[60].fuente).toBe('ANMAT');
});
```

por:

```typescript
it('el resultado final se limita a 150 elementos', () => {
  const byNombre: AlimentoOption[] = Array.from({ length: 100 }, (_, i) => ({
    id_alimento: i + 1,
    nombre: `Alimento SARA2 ${i + 1}`,
    categoria: null,
    fuente: 'SARA2',
    marca: null,
    denominacion: null,
  }));
  const byOther: AlimentoOption[] = Array.from({ length: 100 }, (_, i) => ({
    id_alimento: ANMAT_OFFSET + i + 1,
    nombre: `Alimento ANMAT ${i + 1}`,
    categoria: null,
    fuente: 'ANMAT',
    marca: null,
    denominacion: null,
  }));

  const merged = [...byNombre, ...byOther].slice(0, 150);
  expect(merged).toHaveLength(150);
  // Los primeros 100 son SARA2 (byNombre), los siguientes 50 son ANMAT (byOther truncado)
  expect(merged[0].fuente).toBe('SARA2');
  expect(merged[100].fuente).toBe('ANMAT');
});
```

- [ ] **Step 2: Correr el test y verificar que pasa**

Run: `npm test -- testing/anmat-schema.test.ts`
Expected: PASS.

- [ ] **Step 3: Correr la suite completa y `tsc`**

Run: `npm test && npx tsc --noEmit`
Expected: Todo verde, sin errores de tipos.

- [ ] **Step 4: Commit**

```bash
git add testing/anmat-schema.test.ts
git commit -m "test: actualizar anmat-schema.test.ts al nuevo cap de 150 resultados

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
