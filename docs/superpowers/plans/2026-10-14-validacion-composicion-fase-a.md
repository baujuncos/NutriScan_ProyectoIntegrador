# Validación con composición desde el catálogo — Fase A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Dentro de cada tarea aplicar superpowers:test-driven-development (test que falla → implementación → verde → commit).

**Goal:** Que el investigador pueda validar un alimento pendiente describiendo, en gramos reales, qué alimentos del catálogo hay en la foto (con borrador que no pierde nada), con un formulario más simple (pestañas IA / Del catálogo / A mano) y sin grises ilegibles.

**Architecture:** Una columna `composicion jsonb` en la cola guarda los ingredientes y sus gramos; las RPCs `pendiente_modificar` / `pendiente_validar` la reciben y **recalculan en el servidor** los valores por 100 g desde el catálogo y el peso real de la foto de referencia. En la UI, `PendienteDetalle` se reordena en pestañas y plegables, y `ComposicionCatalogo` reemplaza a `MezclaCatalogo` y al "Buscar en el catálogo" de un solo alimento.

**Tech Stack:** Next.js 16 (server actions), React 19, Supabase (Postgres + RPCs `security definer`), zod, vitest + Testing Library, PGlite (sólo para verificar el SQL, fuera del repo).

**Spec:** `docs/superpowers/specs/2026-10-13-validacion-composicion-y-alimentos-propios-design.md` (§3 interfaz, §4 modelo de datos, §5 contraste). **La Fase B (alimentos propios, §6) queda para un plan aparte** que se escribe cuando termine esta fase, con el código real de la Fase A a la vista (decisión D1).

## Global Constraints

- **Gramos reales en la foto:** el investigador carga los gramos de cada ingrediente que hay en la foto; nunca proporciones ni "por 100 g". Valores por 100 g del alimento = Σ(valor_i por 100 g × gramos_i) / peso de la foto. (Spec §3.2)
- **El servidor no confía en el cliente:** en modo `catalogo` recalcula los 4 valores y fija `gramos_foto` leyendo la base; descarta lo que mande el cliente. (Spec §4.2)
- **Vínculo puro:** un solo ingrediente cuyos gramos igualan el peso de la foto (tolerancia 0,5 g) = vincular a esa entrada del catálogo. (Spec §3.2)
- **Aviso de suma no bloquea:** que la suma no dé el peso de la foto es un aviso, no un error. (Spec §3.2.4)
- **Tope de cordura:** cada ingrediente > 0 y ≤ 1 000 g. (Spec §3.2.6)
- **Sin dependencias npm nuevas.** `zod`, `@testing-library/*`, `vitest` ya están.
- **Convenciones del repo:** comentarios en español; ticket `NUT-119` en el header de archivos nuevos o tocados de forma sustancial; migraciones idempotentes en `supabase/0NN_*.sql` **y** la misma sección al final de `supabase/schema_consolidado.sql`; errores de las server actions como `{ error: string }`.
- **Contraste AA:** texto ≥ 4,5:1 (grises de texto: `slate-600`/`gray-600` o más oscuros; placeholders `gray-500`).
- **Escritura de archivos largos:** usar las herramientas Write/Edit, no heredocs del shell (se truncan con comillas y `\n`).
- **Antes de cada commit:** `npx vitest run` y `npx tsc --noEmit` limpios. Commits terminan con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Modelo por tarea (acordado en NUT-119):** Sonnet 5.5 esfuerzo Alto por defecto; **Opus 5.5 sólo en la Task 3** (migración SQL con `security definer` y recálculo en el servidor).

## Review Focus

Lo que el spec implica y las pruebas "felices" no cubren; cada línea tiene su test en la tarea indicada.

1. **Peso de la foto falseado o ocurrencia ajena** (alguien manda `gramos_foto` o un `id_guardado_item` de otro alimento): el servidor lee el peso de la base y rechaza la ocurrencia que no pertenece a esa fila de cola. → Task 3 (SQL).
2. **Ingrediente sin datos nutricionales en el catálogo** (macros `null`): no se puede calcular ni validar; el mensaje nombra al ingrediente. → Tasks 2, 3, 5.
3. **Borrador viejo sin composición** (guardado antes de esta fase, sólo con `final_*`): al reabrir debe abrir en "A mano" con esos valores, no perderse. → Task 6.
4. **Suma de gramos ≠ peso de la foto** (falta o sobra): avisa con los gramos exactos y no bloquea. → Tasks 2, 5.
5. **Cambiar de pestaña no pierde lo cargado en las otras** y "Cambios sin guardar" refleja la realidad. → Task 6.
6. **Borrador en "Del catálogo" sin ingredientes todavía** (recién elegida la pestaña): se puede guardar sin romper la RPC. → Tasks 3, 6.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/lib/macros.ts` (modifica) | `macrosMezcla(componentes, pesoFoto)` con gramos reales |
| `src/lib/composicion.ts` (nuevo) | Tipos + esquema zod de la composición, conversión editable ↔ validada, `resumirComposicion` (valores por 100 g, suma, diferencia, vínculo puro) |
| `supabase/017_composicion_validacion_nut119.sql` (nuevo) + sección en `schema_consolidado.sql` | Columna `composicion`, `calcular_composicion`, `pendiente_modificar`/`pendiente_validar` con `p_composicion`, vistas recreadas |
| `src/app/(researcher)/validacion/actions.ts` (modifica) | `composicion` en `modificar`/`validar`, tipo `PendienteFila.composicion`, error `COMPOSICION_INVALIDA` |
| `src/app/(researcher)/validacion/ComposicionCatalogo.tsx` (nuevo, reemplaza `MezclaCatalogo.tsx`) | Foto de referencia + ingredientes + gramos + avisos + resultado (controlado por el padre) |
| `src/app/(researcher)/validacion/PendienteDetalle.tsx` (reescribe) | Pestañas, plegables, borrador que restaura, indicador de cambios, acciones |
| `src/app/(researcher)/validacion/ValidacionClient.tsx` (modifica) | `onGuardado` refresca el listado |
| `src/components/ui/Input.tsx`, `src/components/ui/Modal.tsx` (modifican) | Contraste |
| `testing/*` | Un archivo de test por unidad (ver cada tarea) |

---

## Task 1: Contraste de `Input` y `Modal`

**Files:**
- Modify: `src/components/ui/Input.tsx` (clase `placeholder-gray-400`)
- Modify: `src/components/ui/Modal.tsx` (botones "Volver" y "Cerrar": `text-gray-400 hover:text-gray-700`)
- Test: `testing/contrasteComponentesUi.test.tsx` (nuevo)

**Interfaces:** ninguna (cambio de clases).

- [ ] **Step 1: Write the failing test**

Crear `testing/contrasteComponentesUi.test.tsx`:

```tsx
/**
 * NUT-119 — Los grises de texto de los componentes compartidos cumplen AA (≥ 4,5:1).
 * jsdom no evalúa contraste: se fijan las clases (gray-500 ≈ 4,8:1, gray-600 ≈ 7:1; gray-400 era 2,5:1).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';

describe('contraste de componentes compartidos', () => {
  it('el placeholder de Input usa gray-500, no gray-400', () => {
    render(<Input aria-label="Buscar" placeholder="Buscar alimento" />);
    const clases = screen.getByPlaceholderText('Buscar alimento').className;
    expect(clases).toContain('placeholder-gray-500');
    expect(clases).not.toContain('placeholder-gray-400');
  });

  it('los botones Volver y Cerrar de Modal usan gray-600, no gray-400', () => {
    render(
      <Modal open onClose={vi.fn()} onBack={vi.fn()} title="Título">
        contenido
      </Modal>,
    );
    for (const nombre of ['Volver', 'Cerrar']) {
      const clases = screen.getByRole('button', { name: nombre }).className;
      expect(clases).toContain('text-gray-600');
      expect(clases).not.toContain('text-gray-400');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run testing/contrasteComponentesUi.test.tsx`
Expected: FAIL (`placeholder-gray-500` no está en las clases).

- [ ] **Step 3: Write minimal implementation**

En `src/components/ui/Input.tsx` reemplazar `placeholder-gray-400` por `placeholder-gray-500` (una ocurrencia, en `inputClass`).
En `src/components/ui/Modal.tsx` reemplazar, en los dos botones (`aria-label="Volver"` y `aria-label="Cerrar"`), `text-gray-400 hover:text-gray-700` por `text-gray-600 hover:text-gray-900`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run testing/contrasteComponentesUi.test.tsx && npx vitest run && npx tsc --noEmit`
Expected: PASS, suite completa verde, tsc sin salida.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Input.tsx src/components/ui/Modal.tsx testing/contrasteComponentesUi.test.tsx
git commit -m "style: placeholder y botones del modal con contraste AA (gray-500/600)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 2: `macrosMezcla` con gramos reales y `src/lib/composicion.ts`

**Files:**
- Modify: `src/lib/macros.ts` (reemplaza `macrosMezcla`)
- Create: `src/lib/composicion.ts`
- Test: `testing/macros.test.ts` (reemplaza el último `describe`), `testing/composicion.test.ts` (nuevo)

**Interfaces:**
- Produces (macros.ts):
  ```ts
  export interface ComponenteMezcla { macros: Macros100; gramos: number }
  export function macrosMezcla(componentes: ComponenteMezcla[], pesoFoto: number): Macros100 | null
  ```
- Produces (composicion.ts):
  ```ts
  export const MODOS_COMPOSICION: readonly ['ia','catalogo','manual']
  export type ModoComposicion = 'ia' | 'catalogo' | 'manual'
  export const GRAMOS_MAX_INGREDIENTE = 1000
  export const TOLERANCIA_GRAMOS = 0.5
  export const componenteSchema, composicionSchema   // zod
  export type ComponenteComposicion = { origen:'catalogo'; id:number; nombre:string; fuente:string; gramos:number; kcal_100g:number; proteinas_100g:number; grasas_100g:number; carbs_100g:number }
  export type Composicion = { modo: ModoComposicion; id_guardado_item: number|null; gramos_foto: number|null; componentes: ComponenteComposicion[] }
  export function restaurarComposicion(raw: unknown): Composicion | null
  export interface ComponenteEditable { id:number; nombre:string; fuente:string; gramos:string; macros: Macros100|null }
  export function aEditables(c: ComponenteComposicion[]): ComponenteEditable[]
  export function aComponentes(e: ComponenteEditable[]): { componentes: ComponenteComposicion[]; problemas: string[] }
  export type EstadoSuma = 'sin_ingredientes'|'completa'|'falta'|'sobra'
  export interface ResumenComposicion { macros: Macros100|null; suma:number; diferencia:number; estado: EstadoSuma; esVinculoPuro:boolean }
  export function resumirComposicion(c: ComponenteComposicion[], pesoFoto: number): ResumenComposicion
  ```

- [ ] **Step 1: Write the failing tests**

En `testing/macros.test.ts`, reemplazar el bloque `describe('macrosMezcla — varios alimentos del catálogo combinados en uno ("aceite y vinagre")', ...)` completo (es el último del archivo) por:

```ts
describe('macrosMezcla — gramos REALES de cada alimento del catálogo sobre el peso de la foto', () => {
  const VINAGRE: Macros100 = { kcal_100g: 19, proteinas_100g: 0, grasas_100g: 0, carbs_100g: 0.6 };
  const PALTA: Macros100 = { kcal_100g: 160, proteinas_100g: 2, grasas_100g: 15, carbs_100g: 8.5 };

  it('15 g de aceite + 5 g de vinagre en una foto de 20 g: valores por 100 g del alimento', () => {
    const r = macrosMezcla([{ macros: ACEITE, gramos: 15 }, { macros: VINAGRE, gramos: 5 }], 20)!;
    expect(r.kcal_100g).toBeCloseTo((884 * 15 + 19 * 5) / 20, 2); // 667,75
    expect(r.grasas_100g).toBeCloseTo(75, 2);
    expect(r.carbs_100g).toBeCloseTo(0.15, 2);
    expect(macrosPlausibles(r)).toBe(true);
  });

  it('equivalencia parcial: 8 g de palta en una foto de 20 g aportan el 40 % (el resto no aporta)', () => {
    const r = macrosMezcla([{ macros: PALTA, gramos: 8 }], 20)!;
    expect(r.kcal_100g).toBeCloseTo(64, 2);
    expect(r.grasas_100g).toBeCloseTo(6, 2);
  });

  it('un solo ingrediente con todo el peso de la foto devuelve ese mismo alimento', () => {
    expect(macrosMezcla([{ macros: POLLO, gramos: 40 }], 40)).toEqual(POLLO);
  });

  it('si los ingredientes pesan más que la foto, igual calcula (el aviso lo da la interfaz)', () => {
    const r = macrosMezcla([{ macros: ARROZ, gramos: 150 }], 100)!;
    expect(r.kcal_100g).toBeCloseTo(195, 2);
  });

  it('sin componentes, peso de la foto inválido o gramos inválidos → null (no inventa)', () => {
    expect(macrosMezcla([], 20)).toBeNull();
    expect(macrosMezcla([{ macros: POLLO, gramos: 10 }], 0)).toBeNull();
    expect(macrosMezcla([{ macros: POLLO, gramos: 10 }], NaN)).toBeNull();
    expect(macrosMezcla([{ macros: POLLO, gramos: 0 }], 20)).toBeNull();
    expect(macrosMezcla([{ macros: POLLO, gramos: 10 }, { macros: ARROZ, gramos: -5 }], 20)).toBeNull();
    expect(macrosMezcla([{ macros: POLLO, gramos: NaN }], 20)).toBeNull();
  });
});
```

Crear `testing/composicion.test.ts`:

```ts
/**
 * NUT-119 — Composición de un alimento pendiente a partir del catálogo.
 */
import { describe, expect, it } from 'vitest';
import {
  aComponentes,
  aEditables,
  composicionSchema,
  resumirComposicion,
  restaurarComposicion,
  type ComponenteComposicion,
  type ComponenteEditable,
} from '@/lib/composicion';

const ACEITE: ComponenteComposicion = {
  origen: 'catalogo', id: 31, nombre: 'Aceite de oliva', fuente: 'SARA2', gramos: 15,
  kcal_100g: 800, proteinas_100g: 0, grasas_100g: 90, carbs_100g: 0,
};
const VINAGRE: ComponenteComposicion = {
  origen: 'catalogo', id: 32, nombre: 'Vinagre', fuente: 'SARA2', gramos: 5,
  kcal_100g: 20, proteinas_100g: 0, grasas_100g: 0, carbs_100g: 4,
};

describe('resumirComposicion', () => {
  it('15 g de aceite + 5 g de vinagre en una foto de 20 g: valores por 100 g, suma completa', () => {
    const r = resumirComposicion([ACEITE, VINAGRE], 20);
    expect(r.macros).toEqual({ kcal_100g: 605, proteinas_100g: 0, grasas_100g: 67.5, carbs_100g: 1 });
    expect(r.suma).toBe(20);
    expect(r.diferencia).toBe(0);
    expect(r.estado).toBe('completa');
    expect(r.esVinculoPuro).toBe(false);
  });

  it('falta peso: informa cuántos gramos restan', () => {
    const r = resumirComposicion([{ ...ACEITE, gramos: 8 }], 20);
    expect(r.estado).toBe('falta');
    expect(r.diferencia).toBe(12);
    expect(r.esVinculoPuro).toBe(false);
  });

  it('sobra peso: diferencia negativa', () => {
    const r = resumirComposicion([{ ...ACEITE, gramos: 25 }], 20);
    expect(r.estado).toBe('sobra');
    expect(r.diferencia).toBe(-5);
  });

  it('tolera 0,5 g de diferencia y un solo ingrediente que iguala el peso es vínculo puro', () => {
    expect(resumirComposicion([{ ...ACEITE, gramos: 19.6 }], 20).estado).toBe('completa');
    expect(resumirComposicion([{ ...ACEITE, gramos: 20 }], 20).esVinculoPuro).toBe(true);
    expect(resumirComposicion([{ ...ACEITE, gramos: 10 }, { ...VINAGRE, gramos: 10 }], 20).esVinculoPuro).toBe(false);
  });

  it('sin ingredientes: estado propio y sin valores', () => {
    const r = resumirComposicion([], 20);
    expect(r).toMatchObject({ estado: 'sin_ingredientes', macros: null, suma: 0, esVinculoPuro: false });
  });

  it('peso de la foto 0: no calcula', () => {
    expect(resumirComposicion([ACEITE], 0).macros).toBeNull();
  });
});

describe('aEditables / aComponentes', () => {
  it('ida y vuelta conserva los datos', () => {
    const editables = aEditables([ACEITE]);
    expect(editables[0]).toMatchObject({ id: 31, nombre: 'Aceite de oliva', gramos: '15' });
    expect(aComponentes(editables)).toEqual({ componentes: [ACEITE], problemas: [] });
  });

  it('un ingrediente sin datos nutricionales se reporta por nombre y no se incluye', () => {
    const sinDatos: ComponenteEditable = { id: 9, nombre: 'Misterio', fuente: 'ANMAT', gramos: '10', macros: null };
    const r = aComponentes([...aEditables([ACEITE]), sinDatos]);
    expect(r.componentes).toHaveLength(1);
    expect(r.problemas).toEqual(['Misterio no tiene datos nutricionales en el catálogo']);
  });

  it.each([['', 'vacío'], ['0', 'cero'], ['-3', 'negativo'], ['abc', 'no numérico'], ['1001', 'sobre el tope']])(
    'gramos %j (%s) se reporta como problema',
    (gramos) => {
      const e = { ...aEditables([ACEITE])[0], gramos };
      const r = aComponentes([e]);
      expect(r.componentes).toHaveLength(0);
      expect(r.problemas).toHaveLength(1);
      expect(r.problemas[0]).toContain('Aceite de oliva');
    },
  );
});

describe('restaurarComposicion / composicionSchema', () => {
  const valida = { modo: 'catalogo', id_guardado_item: 412, gramos_foto: 20, componentes: [ACEITE] };

  it('restaura una composición guardada', () => {
    expect(restaurarComposicion(valida)).toEqual(valida);
  });

  it('modos ia/manual sin componentes y con campos null', () => {
    expect(restaurarComposicion({ modo: 'ia', componentes: [] })).toEqual({
      modo: 'ia', id_guardado_item: null, gramos_foto: null, componentes: [],
    });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['modo inválido', { ...valida, modo: 'otro' }],
    ['gramos cero', { ...valida, componentes: [{ ...ACEITE, gramos: 0 }] }],
    ['gramos sobre el tope', { ...valida, componentes: [{ ...ACEITE, gramos: 1001 }] }],
    ['macro negativo', { ...valida, componentes: [{ ...ACEITE, kcal_100g: -1 }] }],
    ['sin componentes (campo ausente)', { modo: 'catalogo' }],
  ])('%s → null (un borrador viejo o corrupto no rompe la pantalla)', (_n, raw) => {
    expect(restaurarComposicion(raw)).toBeNull();
  });

  it('el esquema acepta composiciones vacías de borrador en modo catálogo', () => {
    expect(composicionSchema.safeParse({ modo: 'catalogo', id_guardado_item: 1, gramos_foto: null, componentes: [] }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run testing/macros.test.ts testing/composicion.test.ts`
Expected: FAIL (`macrosMezcla` con la firma vieja y `@/lib/composicion` inexistente).

- [ ] **Step 3: Write minimal implementation**

En `src/lib/macros.ts` reemplazar la función `macrosMezcla` y su comentario (al final del archivo) por:

```ts
export interface ComponenteMezcla {
  macros: Macros100;
  /** Gramos REALES de este alimento que hay en la foto. */
  gramos: number;
}

/**
 * Valores por 100 g de un alimento que en la foto está compuesto por uno o más
 * alimentos del catálogo. Los gramos son los reales de la foto (no
 * proporciones): valor por 100 g = Σ(valor_i por 100 g × gramos_i) / peso de la
 * foto. Si los ingredientes suman menos que el peso, el resto cuenta sin
 * aporte. null si no hay componentes, el peso de la foto no es positivo o algún
 * gramaje no es válido.
 */
export function macrosMezcla(componentes: ComponenteMezcla[], pesoFoto: number): Macros100 | null {
  if (componentes.length === 0) return null;
  if (!Number.isFinite(pesoFoto) || pesoFoto <= 0) return null;
  if (!componentes.every((c) => Number.isFinite(c.gramos) && c.gramos > 0)) return null;
  const prom = (campo: keyof Macros100) =>
    redondear2(componentes.reduce((acc, c) => acc + c.macros[campo] * c.gramos, 0) / pesoFoto);
  return {
    kcal_100g: prom('kcal_100g'),
    proteinas_100g: prom('proteinas_100g'),
    grasas_100g: prom('grasas_100g'),
    carbs_100g: prom('carbs_100g'),
  };
}
```

Crear `src/lib/composicion.ts`:

```ts
/**
 * NUT-119 — Composición de un alimento pendiente de validación a partir de
 * alimentos del catálogo, con los GRAMOS REALES que hay en la foto (nunca
 * proporciones). Se guarda en `alimentos_pendientes_validacion.composicion` (borrador
 * y validación); el servidor la recalcula desde la base (ver supabase/017).
 */
import { z } from 'zod';
import { macrosMezcla, type Macros100 } from './macros';

export const MODOS_COMPOSICION = ['ia', 'catalogo', 'manual'] as const;
export type ModoComposicion = (typeof MODOS_COMPOSICION)[number];

/** Gramos máximos de un ingrediente (cordura). */
export const GRAMOS_MAX_INGREDIENTE = 1000;
/** Diferencia (g) tolerada entre la suma de ingredientes y el peso de la foto. */
export const TOLERANCIA_GRAMOS = 0.5;

const valorNutricional = z.number().min(0).max(100_000);

export const componenteSchema = z.object({
  origen: z.literal('catalogo'),
  id: z.number().int().positive(),
  nombre: z.string().trim().min(1).max(300),
  fuente: z.string().trim().max(30),
  gramos: z.number().positive().max(GRAMOS_MAX_INGREDIENTE),
  kcal_100g: valorNutricional,
  proteinas_100g: valorNutricional,
  grasas_100g: valorNutricional,
  carbs_100g: valorNutricional,
});

export const composicionSchema = z.object({
  modo: z.enum(MODOS_COMPOSICION),
  id_guardado_item: z.number().int().positive().nullish().transform((v) => v ?? null),
  gramos_foto: z.number().positive().nullish().transform((v) => v ?? null),
  componentes: z.array(componenteSchema).max(30),
});

export type ComponenteComposicion = z.infer<typeof componenteSchema>;
export type Composicion = z.infer<typeof composicionSchema>;

/** Lee una composición guardada; un valor viejo o corrupto devuelve null en vez de romper la pantalla. */
export function restaurarComposicion(raw: unknown): Composicion | null {
  const parsed = composicionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Ingrediente tal como lo edita el investigador (los gramos son el texto del campo). */
export interface ComponenteEditable {
  id: number;
  nombre: string;
  fuente: string;
  gramos: string;
  /** null = el catálogo no tiene valores nutricionales para este alimento. */
  macros: Macros100 | null;
}

export function aEditables(componentes: ComponenteComposicion[]): ComponenteEditable[] {
  return componentes.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    fuente: c.fuente,
    gramos: String(c.gramos),
    macros: {
      kcal_100g: c.kcal_100g,
      proteinas_100g: c.proteinas_100g,
      grasas_100g: c.grasas_100g,
      carbs_100g: c.carbs_100g,
    },
  }));
}

/** Pasa los ingredientes editables a válidos; lo que no sirve se reporta en `problemas` (por nombre). */
export function aComponentes(editables: ComponenteEditable[]): {
  componentes: ComponenteComposicion[];
  problemas: string[];
} {
  const componentes: ComponenteComposicion[] = [];
  const problemas: string[] = [];
  for (const e of editables) {
    if (!e.macros) {
      problemas.push(`${e.nombre} no tiene datos nutricionales en el catálogo`);
      continue;
    }
    const gramos = Number(e.gramos);
    if (e.gramos.trim() === '' || !Number.isFinite(gramos) || gramos <= 0 || gramos > GRAMOS_MAX_INGREDIENTE) {
      problemas.push(`Indicá los gramos de ${e.nombre} (más de 0 y hasta ${GRAMOS_MAX_INGREDIENTE} g)`);
      continue;
    }
    componentes.push({ origen: 'catalogo', id: e.id, nombre: e.nombre, fuente: e.fuente, gramos, ...e.macros });
  }
  return { componentes, problemas };
}

export type EstadoSuma = 'sin_ingredientes' | 'completa' | 'falta' | 'sobra';

export interface ResumenComposicion {
  /** Valores por 100 g del alimento; null si no se puede calcular. */
  macros: Macros100 | null;
  /** Gramos que suman los ingredientes. */
  suma: number;
  /** Peso de la foto − suma: positivo = faltan gramos; negativo = sobran. */
  diferencia: number;
  estado: EstadoSuma;
  /** Un solo ingrediente que iguala el peso de la foto: es ese mismo alimento del catálogo. */
  esVinculoPuro: boolean;
}

const redondear2 = (n: number) => Math.round(n * 100) / 100;

export function resumirComposicion(componentes: ComponenteComposicion[], pesoFoto: number): ResumenComposicion {
  const suma = redondear2(componentes.reduce((acc, c) => acc + c.gramos, 0));
  const diferencia = redondear2(pesoFoto - suma);
  const estado: EstadoSuma =
    componentes.length === 0
      ? 'sin_ingredientes'
      : Math.abs(diferencia) <= TOLERANCIA_GRAMOS
        ? 'completa'
        : diferencia > 0
          ? 'falta'
          : 'sobra';
  const macros = macrosMezcla(
    componentes.map((c) => ({
      macros: {
        kcal_100g: c.kcal_100g,
        proteinas_100g: c.proteinas_100g,
        grasas_100g: c.grasas_100g,
        carbs_100g: c.carbs_100g,
      },
      gramos: c.gramos,
    })),
    pesoFoto,
  );
  return { macros, suma, diferencia, estado, esVinculoPuro: componentes.length === 1 && estado === 'completa' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run testing/macros.test.ts testing/composicion.test.ts`
Expected: PASS. Luego `npx tsc --noEmit`: va a fallar sólo en `MezclaCatalogo.tsx` (usa la firma vieja de `macrosMezcla`); el archivo se borra en la Task 6. **Para dejar el árbol compilable en este commit**, en `MezclaCatalogo.tsx` reemplazar el cálculo de `mezcla`:

```tsx
      ? macrosMezcla(
          componentes.map((c) => ({ macros: aMacros(c.alimento)!, gramos: Number(c.gramos) })),
        )
```

por (equivale a la semántica vieja de proporciones: el "peso de la foto" es la suma de los gramos):

```tsx
      ? macrosMezcla(
          componentes.map((c) => ({ macros: aMacros(c.alimento)!, gramos: Number(c.gramos) })),
          componentes.reduce((acc, c) => acc + Number(c.gramos), 0),
        )
```

y correr `npx vitest run` (los tests viejos de la mezcla en `PendienteDetalle.test.tsx` siguen pasando: 70 g + 30 g sobre 100 g).

- [ ] **Step 5: Commit**

```bash
git add src/lib/macros.ts src/lib/composicion.ts testing/macros.test.ts testing/composicion.test.ts "src/app/(researcher)/validacion/MezclaCatalogo.tsx"
git commit -m "feat: composición con gramos reales de la foto (macrosMezcla y src/lib/composicion.ts)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Migración 017 — columna `composicion` y RPCs que la recalculan (Opus 5.5)

**Files:**
- Create: `supabase/017_composicion_validacion_nut119.sql`
- Modify: `supabase/schema_consolidado.sql` (misma sección al final, contenido idéntico)
- Verify (fuera del repo): arnés PGlite del scratchpad (`m017.mjs`)

**Interfaces:**
- Consumes: tablas `alimentos_pendientes_validacion`, `detecciones_guardados_items`, `alimentos`, `items`, `alimentos_pendientes_auditoria`; funciones `get_my_role()`, `norm_alimento()`.
- Produces (SQL):
  - Columna `alimentos_pendientes_validacion.composicion jsonb`.
  - `public.calcular_composicion(p_id_pendiente bigint, p_composicion jsonb) returns table (kcal numeric, prot numeric, grasas numeric, carbs numeric, id_vinculo integer, composicion_normalizada jsonb)` — interna (sin grants a clientes).
  - `public.pendiente_modificar(p_id bigint, p_nombre text, p_categoria text, p_kcal numeric, p_prot numeric, p_grasas numeric, p_carbs numeric, p_observaciones text, p_composicion jsonb default null) returns void`
  - `public.pendiente_validar(p_id bigint, p_nombre text, p_categoria text, p_kcal numeric, p_prot numeric, p_grasas numeric, p_carbs numeric, p_observaciones text, p_id_alimento_existente int default null, p_composicion jsonb default null) returns jsonb` → `{ id_alimento, items_afectados }`
  - Vistas `v_alimentos_pendientes` y `v_alimentos_validados` con la columna `composicion`.
  - Errores nuevos (`raise exception`): `COMPOSICION_INVALIDA` (con `detail`).

- [ ] **Step 1: Write the failing verification script**

Crear en el scratchpad `pgl/m017_body.mjs` (usa los helpers `q1`, `ok`, `expectErr`, `db`, `readFileSync`, `REPO` que define la cabecera del arnés, igual que `m016_body.mjs`):

```js
console.log('consolidado aplicado (incluye 013 a 017)');
const m017 = readFileSync(REPO + '017_composicion_validacion_nut119.sql', 'utf8');
await db.exec(m017); console.log('017 corrida 2 OK');
await db.exec(m017); console.log('017 corrida 3 OK');

const DEP = '11111111-1111-1111-1111-111111111111', INV = '33333333-3333-3333-3333-333333333333';
const asUser = (uid) => `set role authenticated; set request.jwt.claims = '{"sub":"${uid}","email":"x@x.com"}';`;
await db.exec(`
insert into auth.users values ('${DEP}'),('${INV}');
insert into public.profiles (user_id,nombre,apellido,email,role) values
 ('${DEP}','d','d','d@ucc.edu.ar','deportista_ucc'),('${INV}','i','i','i@x.com','investigador');
insert into public.alimentos (id_alimento,nombre,fuente,kcal_100g,proteinas_100g,grasas_100g,carbs_100g) values
 (31,'Aceite de oliva','SARA2',800,0,90,0),
 (32,'Vinagre','SARA2',20,0,0,4),
 (33,'Palta','SARA2',160,2,15,8.5),
 (34,'Sin datos','ANMAT',null,null,null,null);
insert into public.detecciones_ia (id_usuario,prompt_version,modelo,vajilla_tipo,vajilla_diametro_cm,angulo_captura_grados,total_estimated_weight_grams)
 values ('${DEP}','v','m','plato_playo',26,45,300),('${DEP}','v','m','plato_playo',26,45,300),('${DEP}','v','m','plato_playo',26,45,300);
`);

// 1) firmas viejas eliminadas: una sola función por nombre, y la columna/vistas nuevas
const n = (await q1(`select proname, count(*)::int c from pg_proc where pronamespace='public'::regnamespace and proname in ('pendiente_modificar','pendiente_validar') group by 1 order by 1`));
ok(n.every((r) => r.c === 1), 'sin sobrecargas: ' + JSON.stringify(n));
const col = (await q1(`select count(*)::int c from information_schema.columns where table_name='alimentos_pendientes_validacion' and column_name='composicion'`))[0].c;
ok(col === 1, 'columna composicion');
const vcol = (await q1(`select count(*)::int c from information_schema.columns where table_name in ('v_alimentos_pendientes','v_alimentos_validados') and column_name='composicion'`))[0].c;
ok(vcol === 2, 'las dos vistas exponen composicion');

// 2) setup: dos ocurrencias de "Aliño" (20 g y 40 g) y una de "Otra cosa" (10 g)
const base = { source_item_uuid: null, category: 'cat', ai_grams: null, origin: 'added_manually', answers: [], food_ref: null, score_match: null };
const ia = (k) => ({ kcal_100g: k, proteinas_100g: 1, grasas_100g: 1, carbs_100g: 1 });
const reg = (id, tipo, arr) => q1(`set role service_role; select public.registrar_guardado_deteccion('${DEP}',${id},'2026-10-07','${tipo}','{}','${JSON.stringify(arr)}'::jsonb,'m','v') r;`);
await reg(1, 'cena', [
  { ...base, name: 'Aliño', grams: 20, id_alimento: null, metodo_match: 'gemini', ia: ia(100) },
  { ...base, name: 'Otra cosa', grams: 10, id_alimento: null, metodo_match: 'gemini', ia: ia(50) },
]);
await reg(2, 'almuerzo', [{ ...base, name: 'Aliño', grams: 40, id_alimento: null, metodo_match: 'cola', ia: null }]);
await db.exec('reset role;');
const id = async (n) => (await q1(`select id_pendiente from public.alimentos_pendientes_validacion where nombre_normalizado='${n}'`))[0].id_pendiente;
const gi = async (name, grams) => (await q1(`select id_guardado_item from public.detecciones_guardados_items where name='${name}' and grams=${grams}`))[0].id_guardado_item;
const ALINO = await id('alino'), OTRA = await id('otra cosa');
const REF20 = await gi('Aliño', 20), REF40 = await gi('Aliño', 40), REF_OTRA = await gi('Otra cosa', 10);
const comp = (ref, comps, extra = {}) => JSON.stringify({ modo: 'catalogo', id_guardado_item: ref, gramos_foto: 9999, componentes: comps, ...extra });
const c = (id, gramos, extra = {}) => ({ origen: 'catalogo', id, nombre: 'FORJADO', fuente: 'FORJADA', gramos, kcal_100g: 99999, proteinas_100g: 99999, grasas_100g: 99999, carbs_100g: 99999, ...extra });
const mod = (pend, compJson, k = 'null') => `select public.pendiente_modificar(${pend}, 'Aliño', 'cat', ${k}, null, null, null, 'obs', '${compJson}'::jsonb);`;

// 3) borrador en modo catálogo: el servidor recalcula desde la base (ignora lo que manda el cliente)
await q1(asUser(INV) + mod(ALINO, comp(REF20, [c(31, 15), c(32, 5)]), '12345'));
let q = (await q1(`select * from public.alimentos_pendientes_validacion where id_pendiente=${ALINO}`))[0];
ok(q.estado === 'pendiente' && Number(q.final_kcal_100g) === 605 && Number(q.final_grasas_100g) === 67.5 && Number(q.final_carbs_100g) === 1 && Number(q.final_proteinas_100g) === 0, 'modificar catálogo: valores recalculados por el servidor (605 kcal), no los 12345 del cliente: ' + JSON.stringify([q.final_kcal_100g, q.final_grasas_100g, q.final_carbs_100g]));
ok(q.composicion.modo === 'catalogo' && Number(q.composicion.gramos_foto) === 20 && q.composicion.id_guardado_item === REF20, 'gramos_foto lo fija el servidor (20, no 9999)');
ok(q.composicion.componentes[0].nombre === 'Aceite de oliva' && q.composicion.componentes[0].fuente === 'SARA2' && Number(q.composicion.componentes[0].kcal_100g) === 800 && Number(q.composicion.componentes[0].gramos) === 15, 'el snapshot de los ingredientes sale de la base, no del cliente');
const au = await q1(`select * from public.alimentos_pendientes_auditoria where id_pendiente=${ALINO} and accion='modificar'`);
ok(au.length === 1 && au[0].despues.composicion.modo === 'catalogo', 'la composición queda en la auditoría');

// 4) borrador vacío en modo catálogo / modos ia y manual
await q1(asUser(INV) + mod(OTRA, JSON.stringify({ modo: 'catalogo', id_guardado_item: REF_OTRA, componentes: [] }), '7'));
q = (await q1(`select * from public.alimentos_pendientes_validacion where id_pendiente=${OTRA}`))[0];
ok(q.composicion.modo === 'catalogo' && q.composicion.componentes.length === 0 && Number(q.final_kcal_100g) === 7, 'borrador en catálogo sin ingredientes: se guarda, con los valores del cliente');
await q1(asUser(INV) + mod(OTRA, JSON.stringify({ modo: 'manual', componentes: [] }), '9'));
q = (await q1(`select composicion, final_kcal_100g from public.alimentos_pendientes_validacion where id_pendiente=${OTRA}`))[0];
ok(q.composicion.modo === 'manual' && Number(q.final_kcal_100g) === 9, 'modo manual');
await q1(asUser(INV) + `select public.pendiente_modificar(${OTRA}, 'Otra', null, 1, 1, 1, 1, null);`);
q = (await q1(`select composicion from public.alimentos_pendientes_validacion where id_pendiente=${OTRA}`))[0];
ok(q.composicion.modo === 'manual', 'sin p_composicion se conserva la composición anterior');

// 5) entradas inválidas (Review Focus 1 y 2)
await expectErr(asUser(INV) + mod(ALINO, comp(REF_OTRA, [c(31, 15)])), /COMPOSICION_INVALIDA/, 'ocurrencia de OTRO alimento pendiente rechazada');
await expectErr(asUser(INV) + mod(ALINO, comp(999999, [c(31, 15)])), /COMPOSICION_INVALIDA/, 'ocurrencia inexistente rechazada');
await expectErr(asUser(INV) + mod(ALINO, comp(REF20, [c(777, 15)])), /ALIMENTO_NO_ENCONTRADO/, 'ingrediente inexistente');
await expectErr(asUser(INV) + mod(ALINO, comp(REF20, [c(34, 15)])), /COMPOSICION_INVALIDA/, 'ingrediente sin datos nutricionales');
await expectErr(asUser(INV) + mod(ALINO, comp(REF20, [c(31, 0)])), /COMPOSICION_INVALIDA/, 'gramos 0');
await expectErr(asUser(INV) + mod(ALINO, comp(REF20, [c(31, 1001)])), /COMPOSICION_INVALIDA/, 'gramos sobre el tope');
await expectErr(asUser(INV) + mod(ALINO, JSON.stringify({ modo: 'raro', componentes: [] })), /COMPOSICION_INVALIDA/, 'modo inválido');
await expectErr(asUser(INV) + `select public.pendiente_modificar(${ALINO}, 'x', null, 1,1,1,1,null, '{"modo":"catalogo","id_guardado_item":${REF20},"componentes":[{"id":"abc","gramos":1}]}'::jsonb);`, /COMPOSICION_INVALIDA/, 'JSON malformado');
await expectErr(asUser(DEP) + mod(ALINO, comp(REF20, [c(31, 15)])), /FORBIDDEN/, 'deportista: FORBIDDEN');

// 6) validar con mezcla: ítems con snapshot por 100 g, recalculados por SU cantidad; nada va a alimentos
const nAl = (await q1(`select count(*)::int n from public.alimentos`))[0].n;
const r = (await q1(asUser(INV) + `select public.pendiente_validar(${ALINO}, 'Aliño', 'cat', 1, 1, 1, 1, 'obs', null, '${comp(REF20, [c(31, 15), c(32, 5)])}'::jsonb) r;`))[0].r;
ok(r.id_alimento === null && r.items_afectados === 2, 'validar mezcla: sin id de catálogo, 2 ítems: ' + JSON.stringify(r));
ok((await q1(`select count(*)::int n from public.alimentos`))[0].n === nAl, 'validar mezcla: NO inserta en alimentos');
const its = await q1(`select it.cantidad, it.kcal, it.kcal_100g, it.id_alimento, it.origen_macros from public.items it where it.nombre_manual='Aliño' order by it.cantidad`);
ok(its.length === 2 && its.every((i) => i.id_alimento === null && i.origen_macros === 'validado' && Number(i.kcal_100g) === 605) && Number(its[0].kcal) === 121 && Number(its[1].kcal) === 242, 'ítems de 20 g y 40 g: 605 kcal/100 g → 121 y 242: ' + JSON.stringify(its));
q = (await q1(`select estado, id_alimento_vinculado, composicion from public.alimentos_pendientes_validacion where id_pendiente=${ALINO}`))[0];
ok(q.estado === 'validado' && q.id_alimento_vinculado === null && q.composicion.modo === 'catalogo' && q.composicion.componentes.length === 2, 'la cola queda validada con la composición');
ok((await q1(`select count(*)::int n from public.v_alimentos_validados where id_pendiente=${ALINO}`))[0].n === 1, 'v_alimentos_validados lista el validado');

// 7) vínculo puro: un ingrediente cuyos gramos igualan el peso de la foto
const r2 = (await q1(asUser(INV) + `select public.pendiente_validar(${OTRA}, 'Otra cosa', null, null, null, null, null, null, null, '${comp(REF_OTRA, [c(31, 10)])}'::jsonb) r;`))[0].r;
ok(r2.id_alimento === 31 && r2.items_afectados === 1, 'vínculo puro: id del catálogo 31');
const iv = (await q1(`select it.id_alimento, it.kcal, it.kcal_100g from public.items it where it.nombre_manual='Otra cosa'`))[0];
ok(iv.id_alimento === 31 && Number(iv.kcal_100g) === 800 && Number(iv.kcal) === 80, 'vínculo puro: el ítem toma los valores exactos del catálogo (800 kcal/100 g → 80 kcal en 10 g)');
q = (await q1(`select id_alimento_vinculado, final_kcal_100g from public.alimentos_pendientes_validacion where id_pendiente=${OTRA}`))[0];
ok(q.id_alimento_vinculado === 31 && Number(q.final_kcal_100g) === 800, 'la cola guarda el vínculo');

// 8) otras reglas de validar (modos ia/manual, catálogo vacío, estado, rol, vista)
await reg(3, 'cena', [{ ...base, name: 'Palta chica', grams: 20, id_alimento: null, metodo_match: 'gemini', ia: ia(70) }]);
await db.exec('reset role;');
const PALTA = await id('palta chica'), REF_PALTA = await gi('Palta chica', 20);
const val = (compJson, k = '70, 1, 2, 3') => `select public.pendiente_validar(${PALTA}, 'Palta chica', null, ${k}, null, null, '${compJson}'::jsonb) r;`;
await expectErr(asUser(INV) + val(JSON.stringify({ modo: 'catalogo', id_guardado_item: REF_PALTA, componentes: [] })), /COMPOSICION_INVALIDA/, 'validar en catálogo sin ingredientes');
await expectErr(asUser(INV) + val(JSON.stringify({ modo: 'manual', componentes: [] }), 'null, null, null, null'), /\bINVALID\b/, 'validar a mano sin los 4 valores');
await expectErr(asUser(DEP) + val(JSON.stringify({ modo: 'manual', componentes: [] })), /FORBIDDEN/, 'validar: deportista FORBIDDEN');
const r3 = (await q1(asUser(INV) + val(JSON.stringify({ modo: 'manual', componentes: [] }))))[0].r;
ok(r3.id_alimento === null && r3.items_afectados === 1, 'validar a mano con los 4 valores');
q = (await q1(`select composicion, final_kcal_100g from public.alimentos_pendientes_validacion where id_pendiente=${PALTA}`))[0];
ok(q.composicion.modo === 'manual' && Number(q.final_kcal_100g) === 70, 'la cola guarda modo manual y los valores');
await expectErr(asUser(INV) + val(JSON.stringify({ modo: 'manual', componentes: [] })), /ESTADO_INVALIDO/, 'no se valida dos veces');
await db.exec(asUser(INV));
const vistas = (await db.query(`select (select count(*)::int from public.v_alimentos_validados where composicion is not null) a, (select count(*)::int from public.v_alimentos_pendientes) b`)).rows[0];
await db.exec('reset role;');
ok(vistas.a === 3, 'v_alimentos_validados expone composicion de los 3 validados: ' + JSON.stringify(vistas));
await expectErr(`set role authenticated; select * from public.calcular_composicion(${ALINO}, '{}'::jsonb);`, /permission denied/, 'calcular_composicion no es invocable por clientes');
console.log(fails ? 'FALLAS ' + fails : 'TODO OK');
```

- [ ] **Step 2: Armar el arnés y ver que falla**

Desde el scratchpad `pgl/` (el arnés PGlite de las migraciones 015/016): `m017.mjs` = cabecera de `m016.mjs` (stubs de Supabase, helpers `ok`/`expectErr`/`q1`, aplicación de `schema_consolidado.sql`) + el cuerpo de arriba.

```bash
cd "$SCRATCHPAD/pgl"
sed '/^console.log(.consolidado aplicado/,$d' m016.mjs > m017.mjs
cat m017_body.mjs >> m017.mjs
node m017.mjs
```

Expected: FAIL — `readFileSync` no encuentra `017_composicion_validacion_nut119.sql` (todavía no existe).

- [ ] **Step 3: Write the migration**

Crear `supabase/017_composicion_validacion_nut119.sql` con este contenido **exacto** (y copiar la misma sección, desde el `-- 017` hasta el final, al final de `supabase/schema_consolidado.sql`):

```sql
-- ============================================================
-- Script para correr en el SQL Editor de Supabase.
--
-- Es exactamente la sección "017" ya agregada al final de
-- supabase/schema_consolidado.sql (que sigue siendo la fuente de verdad del
-- esquema completo) — este archivo separado es sólo para pegarlo y correrlo
-- de una sin tener que ubicar la sección en el archivo grande.
--
-- Es seguro re-ejecutar: ADD COLUMN IF NOT EXISTS, DROP IF EXISTS + CREATE OR REPLACE.
-- ============================================================

-- ============================================================
-- 017 (NUT-119) — Composición de un alimento pendiente desde el catálogo
--
-- El investigador describe lo que hay en la foto con los GRAMOS REALES de cada
-- alimento del catálogo (nunca proporciones). La composición se guarda en la
-- cola (`composicion`, borrador y validación) y el servidor recalcula los
-- valores por 100 g leyendo el catálogo y el peso real de la ocurrencia de
-- referencia (`detecciones_guardados_items.grams`): lo que mande el cliente
-- (valores, gramos_foto, nombre del ingrediente) se descarta.
--
-- Valor por 100 g del alimento = Σ(valor_i por 100 g × gramos_i) / peso de la foto.
-- Vínculo puro: un solo ingrediente cuyos gramos igualan el peso de la foto
-- (±0,5 g) = ese mismo alimento del catálogo (id_alimento_vinculado).
--
-- Errores nuevos: COMPOSICION_INVALIDA (detail = motivo). Se mantienen
-- FORBIDDEN, NOT_FOUND, ESTADO_INVALIDO, INVALID y ALIMENTO_NO_ENCONTRADO.
-- ============================================================

alter table public.alimentos_pendientes_validacion
  add column if not exists composicion jsonb;

-- Cálculo interno (sólo la invocan las RPC de abajo, que son security definer).
create or replace function public.calcular_composicion(p_id_pendiente bigint, p_composicion jsonb)
returns table (
  kcal numeric,
  prot numeric,
  grasas numeric,
  carbs numeric,
  id_vinculo integer,
  composicion_normalizada jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref    bigint;
  v_peso   numeric;
  v_comps  jsonb := p_composicion -> 'componentes';
  v_el     jsonb;
  v_id     integer;
  v_g      numeric;
  v_a      public.alimentos%rowtype;
  v_k      numeric := 0;
  v_p      numeric := 0;
  v_gr     numeric := 0;
  v_c      numeric := 0;
  v_out    jsonb := '[]'::jsonb;
  v_n      integer := 0;
  v_vinc   integer := null;
begin
  if jsonb_typeof(p_composicion) is distinct from 'object'
     or p_composicion ->> 'modo' is distinct from 'catalogo'
     or jsonb_typeof(v_comps) is distinct from 'array'
     or jsonb_array_length(v_comps) not between 1 and 30
     or jsonb_typeof(p_composicion -> 'id_guardado_item') is distinct from 'number' then
    raise exception 'COMPOSICION_INVALIDA' using detail = 'Estructura inválida.';
  end if;

  -- La ocurrencia de referencia debe ser de ESTE alimento pendiente; su peso sale de la base.
  select gi.id_guardado_item, gi.grams
  into v_ref, v_peso
  from public.detecciones_guardados_items gi
  where gi.id_pendiente = p_id_pendiente
    and gi.id_guardado_item = (p_composicion ->> 'id_guardado_item')::numeric;
  if not found or v_peso is null or v_peso <= 0 then
    raise exception 'COMPOSICION_INVALIDA' using detail = 'La foto de referencia no corresponde a este alimento.';
  end if;

  for v_el in select e from jsonb_array_elements(v_comps) as t(e) loop
    if jsonb_typeof(v_el -> 'id') is distinct from 'number'
       or jsonb_typeof(v_el -> 'gramos') is distinct from 'number' then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Ingrediente mal formado.';
    end if;
    begin
      v_id := (v_el ->> 'id')::integer;
    exception when others then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Ingrediente mal formado.';
    end;
    v_g := (v_el ->> 'gramos')::numeric;
    if v_g <= 0 or v_g > 1000 then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Los gramos de cada ingrediente deben ser mayores a 0 y hasta 1000.';
    end if;

    select * into v_a from public.alimentos a where a.id_alimento = v_id;
    if not found then
      raise exception 'ALIMENTO_NO_ENCONTRADO' using detail = v_id::text;
    end if;
    if num_nulls(v_a.kcal_100g, v_a.proteinas_100g, v_a.grasas_100g, v_a.carbs_100g) > 0 then
      raise exception 'COMPOSICION_INVALIDA' using detail = v_a.nombre || ' no tiene datos nutricionales en el catálogo.';
    end if;

    v_k  := v_k  + v_a.kcal_100g      * v_g;
    v_p  := v_p  + v_a.proteinas_100g * v_g;
    v_gr := v_gr + v_a.grasas_100g    * v_g;
    v_c  := v_c  + v_a.carbs_100g     * v_g;
    v_n  := v_n + 1;
    v_out := v_out || jsonb_build_object(
      'origen', 'catalogo', 'id', v_a.id_alimento, 'nombre', v_a.nombre, 'fuente', v_a.fuente,
      'gramos', v_g, 'kcal_100g', v_a.kcal_100g, 'proteinas_100g', v_a.proteinas_100g,
      'grasas_100g', v_a.grasas_100g, 'carbs_100g', v_a.carbs_100g);
    if v_n = 1 and abs(v_g - v_peso) <= 0.5 then
      v_vinc := v_a.id_alimento;
    end if;
  end loop;

  -- Vínculo puro: los valores son exactamente los del catálogo (sin redondeos de la cuenta).
  if v_n = 1 and v_vinc is not null then
    return query select v_a.kcal_100g, v_a.proteinas_100g, v_a.grasas_100g, v_a.carbs_100g, v_vinc,
      jsonb_build_object('modo', 'catalogo', 'id_guardado_item', v_ref, 'gramos_foto', v_peso, 'componentes', v_out);
    return;
  end if;

  return query select
    round(v_k / v_peso, 2), round(v_p / v_peso, 2), round(v_gr / v_peso, 2), round(v_c / v_peso, 2),
    null::integer,
    jsonb_build_object('modo', 'catalogo', 'id_guardado_item', v_ref, 'gramos_foto', v_peso, 'componentes', v_out);
end;
$$;

revoke all on function public.calcular_composicion(bigint, jsonb) from public, anon, authenticated;

-- Borrador: guarda final_*, observaciones y la composición sin cambiar el estado.
-- Con modo 'catalogo' e ingredientes, los 4 valores se recalculan en el servidor.
-- Con modo 'catalogo' sin ingredientes (recién elegida la pestaña), con 'ia' o 'manual':
-- se guardan los valores que manda el cliente. Sin p_composicion se conserva la anterior.
drop function if exists public.pendiente_modificar(bigint, text, text, numeric, numeric, numeric, numeric, text);

create or replace function public.pendiente_modificar(
  p_id bigint,
  p_nombre text,
  p_categoria text,
  p_kcal numeric,
  p_prot numeric,
  p_grasas numeric,
  p_carbs numeric,
  p_observaciones text,
  p_composicion jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes   public.alimentos_pendientes_validacion%rowtype;
  v_despues public.alimentos_pendientes_validacion%rowtype;
  v_modo    text := p_composicion ->> 'modo';
  v_k       numeric := p_kcal;
  v_p       numeric := p_prot;
  v_g       numeric := p_grasas;
  v_c       numeric := p_carbs;
  v_comp    jsonb := null;
  v_ref     bigint;
begin
  if coalesce(public.get_my_role() in ('investigador', 'administrador'), false) is false then
    raise exception 'FORBIDDEN';
  end if;

  if p_composicion is not null
     and (jsonb_typeof(p_composicion) is distinct from 'object' or v_modo is null or v_modo not in ('ia', 'catalogo', 'manual')) then
    raise exception 'COMPOSICION_INVALIDA' using detail = 'Modo inválido.';
  end if;

  select * into v_antes
  from public.alimentos_pendientes_validacion c
  where c.id_pendiente = p_id
  for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_antes.estado <> 'pendiente' then
    raise exception 'ESTADO_INVALIDO';
  end if;

  if p_composicion is not null then
    if v_modo = 'catalogo' and jsonb_typeof(p_composicion -> 'componentes') = 'array'
       and jsonb_array_length(p_composicion -> 'componentes') > 0 then
      select r.kcal, r.prot, r.grasas, r.carbs, r.composicion_normalizada
      into v_k, v_p, v_g, v_c, v_comp
      from public.calcular_composicion(p_id, p_composicion) r;
    else
      if v_modo = 'catalogo' and jsonb_typeof(p_composicion -> 'id_guardado_item') = 'number' then
        select gi.id_guardado_item into v_ref
        from public.detecciones_guardados_items gi
        where gi.id_pendiente = p_id
          and gi.id_guardado_item = (p_composicion ->> 'id_guardado_item')::numeric;
      end if;
      v_comp := jsonb_build_object('modo', v_modo, 'id_guardado_item', v_ref, 'gramos_foto', null, 'componentes', '[]'::jsonb);
    end if;
  end if;

  update public.alimentos_pendientes_validacion c
  set nombre_final = nullif(btrim(p_nombre), ''),
      categoria_final = nullif(btrim(p_categoria), ''),
      final_kcal_100g = v_k,
      final_proteinas_100g = v_p,
      final_grasas_100g = v_g,
      final_carbs_100g = v_c,
      observaciones = p_observaciones,
      composicion = coalesce(v_comp, c.composicion)
  where c.id_pendiente = p_id
  returning * into v_despues;

  insert into public.alimentos_pendientes_auditoria (id_pendiente, accion, id_usuario, antes, despues, items_afectados)
  values (p_id, 'modificar', auth.uid(), to_jsonb(v_antes), to_jsonb(v_despues), 0);
end;
$$;

revoke all on function public.pendiente_modificar(bigint, text, text, numeric, numeric, numeric, numeric, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.pendiente_modificar(bigint, text, text, numeric, numeric, numeric, numeric, text, jsonb)
  to authenticated;

-- Validar. Con p_composicion (modo 'catalogo', ≥1 ingrediente) los valores salen del
-- cálculo del servidor; si es vínculo puro se vincula a esa entrada del catálogo. Con
-- modo 'ia' o 'manual' se exigen los 4 valores. p_id_alimento_existente sólo se usa
-- cuando no hay p_composicion (compatibilidad). Sigue sin insertar en `alimentos`.
drop function if exists public.pendiente_validar(bigint, text, text, numeric, numeric, numeric, numeric, text, int);

create or replace function public.pendiente_validar(
  p_id bigint,
  p_nombre text,
  p_categoria text,
  p_kcal numeric,
  p_prot numeric,
  p_grasas numeric,
  p_carbs numeric,
  p_observaciones text,
  p_id_alimento_existente int default null,
  p_composicion jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes   public.alimentos_pendientes_validacion%rowtype;
  v_despues public.alimentos_pendientes_validacion%rowtype;
  v_nombre  text := nullif(btrim(p_nombre), '');
  v_norm    text := public.norm_alimento(p_nombre);
  v_modo    text := p_composicion ->> 'modo';
  v_existente int := case when p_composicion is null then p_id_alimento_existente end;
  v_id      integer;
  v_k       numeric;
  v_p       numeric;
  v_g       numeric;
  v_c       numeric;
  v_comp    jsonb := null;
  v_n       integer;
begin
  if coalesce(public.get_my_role() in ('investigador', 'administrador'), false) is false then
    raise exception 'FORBIDDEN';
  end if;

  if v_nombre is null or v_norm is null then
    raise exception 'INVALID' using detail = 'p_nombre';
  end if;
  if p_composicion is not null
     and (jsonb_typeof(p_composicion) is distinct from 'object' or v_modo is null or v_modo not in ('ia', 'catalogo', 'manual')) then
    raise exception 'COMPOSICION_INVALIDA' using detail = 'Modo inválido.';
  end if;
  if v_existente is null and v_modo is distinct from 'catalogo'
     and (num_nulls(p_kcal, p_prot, p_grasas, p_carbs) > 0 or least(p_kcal, p_prot, p_grasas, p_carbs) < 0) then
    raise exception 'INVALID' using detail = 'Los 4 valores por 100 g son obligatorios y >= 0.';
  end if;

  select * into v_antes
  from public.alimentos_pendientes_validacion c
  where c.id_pendiente = p_id
  for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_antes.estado <> 'pendiente' then
    raise exception 'ESTADO_INVALIDO';
  end if;

  if v_modo = 'catalogo' then
    if jsonb_typeof(p_composicion -> 'componentes') is distinct from 'array'
       or jsonb_array_length(p_composicion -> 'componentes') = 0 then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Elegí al menos un alimento del catálogo.';
    end if;
    select r.kcal, r.prot, r.grasas, r.carbs, r.id_vinculo, r.composicion_normalizada
    into v_k, v_p, v_g, v_c, v_id, v_comp
    from public.calcular_composicion(p_id, p_composicion) r;
  elsif v_modo is not null then
    -- 'ia' o 'manual': los valores los carga el investigador; no se guardan ingredientes.
    v_id := null;
    v_k := p_kcal; v_p := p_prot; v_g := p_grasas; v_c := p_carbs;
    v_comp := jsonb_build_object('modo', v_modo, 'id_guardado_item', null, 'gramos_foto', null, 'componentes', '[]'::jsonb);
  elsif v_existente is not null then
    -- Vinculado a una entrada existente del catálogo: los valores son los del catálogo.
    select a.id_alimento, a.kcal_100g, a.proteinas_100g, a.grasas_100g, a.carbs_100g
    into v_id, v_k, v_p, v_g, v_c
    from public.alimentos a
    where a.id_alimento = v_existente;
    if not found then
      raise exception 'ALIMENTO_NO_ENCONTRADO' using detail = v_existente::text;
    end if;
  else
    -- Alimento nuevo sin composición (compatibilidad): NO se inserta en `alimentos`.
    v_id := null;
    v_k := p_kcal; v_p := p_prot; v_g := p_grasas; v_c := p_carbs;
  end if;

  update public.alimentos_pendientes_validacion c
  set estado = 'validado',
      nombre_final = v_nombre,
      categoria_final = nullif(btrim(p_categoria), ''),
      final_kcal_100g = v_k,
      final_proteinas_100g = v_p,
      final_grasas_100g = v_g,
      final_carbs_100g = v_c,
      id_alimento_vinculado = v_id,
      observaciones = p_observaciones,
      composicion = coalesce(v_comp, c.composicion),
      resuelto_por = auth.uid(),
      resuelto_at = now()
  where c.id_pendiente = p_id
  returning * into v_despues;

  -- Locks en orden: fila de cola → ítems → ingestas (igual que descartar / registrar).
  -- nombre_manual se conserva (trazabilidad: el nombre que cargó el deportista).
  perform 1 from public.items it
  where it.id_guardado_item in (select gi.id_guardado_item from public.detecciones_guardados_items gi where gi.id_pendiente = p_id)
  order by it.id_item
  for update;
  perform 1 from public.ingestas g
  where g.id_ingesta in (
    select it.id_ingesta from public.items it
    where it.id_guardado_item in (select gi.id_guardado_item from public.detecciones_guardados_items gi where gi.id_pendiente = p_id)
  )
  order by g.id_ingesta
  for update;

  -- El trigger recalcula cada ítem con SU cantidad (desde el catálogo si hay id_alimento,
  -- desde el snapshot si no) y el de ingestas ajusta los totales.
  update public.items it
  set id_alimento = v_id,
      kcal_100g = v_k,
      proteinas_100g = v_p,
      grasas_100g = v_g,
      carbs_100g = v_c,
      origen_macros = 'validado'
  where it.id_guardado_item in (select gi.id_guardado_item from public.detecciones_guardados_items gi where gi.id_pendiente = p_id);
  get diagnostics v_n = row_count;

  insert into public.alimentos_pendientes_auditoria (id_pendiente, accion, id_usuario, antes, despues, items_afectados)
  values (p_id, 'validar', auth.uid(), to_jsonb(v_antes), to_jsonb(v_despues), v_n);

  return jsonb_build_object('id_alimento', v_id, 'items_afectados', v_n);
end;
$$;

revoke all on function public.pendiente_validar(bigint, text, text, numeric, numeric, numeric, numeric, text, int, jsonb)
  from public, anon, authenticated;
grant execute on function public.pendiente_validar(bigint, text, text, numeric, numeric, numeric, numeric, text, int, jsonb)
  to authenticated;

-- Las vistas se recrean para exponer `composicion` (p.* se expande al crear la vista).
drop view if exists public.v_alimentos_pendientes;
create view public.v_alimentos_pendientes
with (security_invoker = true)
as
select p.*, o.ocurrencias, o.ultima_ocurrencia
from public.alimentos_pendientes_validacion p
cross join lateral (
  select count(*) as ocurrencias, max(gi.created_at) as ultima_ocurrencia
  from public.detecciones_guardados_items gi
  where gi.id_pendiente = p.id_pendiente
) o;

revoke all on public.v_alimentos_pendientes from anon, authenticated;
grant select on public.v_alimentos_pendientes to authenticated;

drop view if exists public.v_alimentos_validados;
create view public.v_alimentos_validados
with (security_invoker = true)
as
select
  p.id_pendiente,
  p.nombre_final,
  p.categoria_final,
  p.final_kcal_100g,
  p.final_proteinas_100g,
  p.final_grasas_100g,
  p.final_carbs_100g,
  p.id_alimento_vinculado,
  p.observaciones,
  p.resuelto_por,
  p.resuelto_at,
  p.composicion,
  o.ocurrencias
from public.alimentos_pendientes_validacion p
cross join lateral (
  select count(*) as ocurrencias
  from public.detecciones_guardados_items gi
  where gi.id_pendiente = p.id_pendiente
) o
where p.estado = 'validado';

revoke all on public.v_alimentos_validados from anon, authenticated;
grant select on public.v_alimentos_validados to authenticated;
```

- [ ] **Step 4: Run the verification**

```bash
cd "$SCRATCHPAD/pgl" && node m017.mjs
```

Expected: `consolidado aplicado …`, `017 corrida 2 OK`, `017 corrida 3 OK`, todas las líneas `OK`, última línea `TODO OK`. Cualquier `FAIL` se arregla en el SQL (no en el script) salvo que el script contradiga el spec.

- [ ] **Step 5: Commit**

```bash
git add supabase/017_composicion_validacion_nut119.sql supabase/schema_consolidado.sql
git commit -m "feat: migración 017 — composición del alimento pendiente (gramos reales) recalculada en el servidor

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

> **Nota para quien corre las migraciones en Supabase:** pegar y ejecutar `017_…sql` en el SQL Editor **antes** de desplegar el código de las Tasks 4–6 (las acciones llaman a las RPC con el argumento nuevo `p_composicion`).

---

## Task 4: Server actions — `composicion` en modificar / validar

**Files:**
- Modify: `src/app/(researcher)/validacion/actions.ts`
- Modify: `testing/fixtures/validacion.ts` (campo `composicion: null` en `PENDIENTE`)
- Test: `testing/validacionActions.test.ts`

**Interfaces:**
- Consumes: `composicionSchema` (Task 2); RPC `pendiente_modificar` / `pendiente_validar` con `p_composicion` (Task 3).
- Produces:
  - `PendienteFila.composicion: unknown` (jsonb crudo; la UI lo lee con `restaurarComposicion`).
  - `ModificarInput` / `ValidarInput` aceptan `composicion?: Composicion | null`.
  - `ValidarInput.kcal|proteinas|grasas|carbs` pasan a ser opcionales/`null` **sólo** cuando `composicion.modo === 'catalogo'` (los calcula el servidor); en los otros casos siguen siendo obligatorios.
  - `errorDeRpc` mapea `COMPOSICION_INVALIDA` a `La composición no es válida: <motivo del servidor>`.

- [ ] **Step 1: Write the failing tests**

En `testing/validacionActions.test.ts`:

1. En el test `'%s: modificar llama a pendiente_modificar con los args'`, agregar `p_composicion: null` al final del objeto `args` (después de `p_observaciones: 'ok'`).
2. En el test `'%s: validar llama a pendiente_validar'`, agregar `p_composicion: null` después de `p_id_alimento_existente: null`.
3. Agregar este bloque antes de `describe('getPendienteDetalleAction', ...)`:

```ts
describe('composición del catálogo', () => {
  const ACEITE = {
    origen: 'catalogo', id: 31, nombre: 'Aceite de oliva', fuente: 'SARA2', gramos: 15,
    kcal_100g: 800, proteinas_100g: 0, grasas_100g: 90, carbs_100g: 0,
  } as const;
  const COMPOSICION = { modo: 'catalogo', id_guardado_item: 412, gramos_foto: 20, componentes: [ACEITE] } as const;
  const args = () => sb.rpcLlamadas()[0].args as Record<string, unknown>;

  it('modificar pasa la composición a la RPC', async () => {
    comoRol('investigador');
    expect(await modificarPendienteAction({ ...FORM, composicion: COMPOSICION })).toEqual({ ok: true });
    expect(args().p_composicion).toEqual(COMPOSICION);
  });

  it('validar en modo catálogo no exige los 4 valores (los calcula el servidor)', async () => {
    comoRol('investigador');
    sb.mockRpc('pendiente_validar', { data: { id_alimento: 31, items_afectados: 2 }, error: null });
    const r = await validarPendienteAction({
      ...FORM, kcal: null, proteinas: null, grasas: null, carbs: null, composicion: COMPOSICION,
    });
    expect(r).toEqual({ ok: true, idAlimento: 31, itemsAfectados: 2 });
    expect(args().p_composicion).toEqual(COMPOSICION);
    expect(args().p_kcal).toBeNull();
  });

  it('validar en modo ia o manual sigue exigiendo los 4 valores', async () => {
    comoRol('investigador');
    const manual = { modo: 'manual', id_guardado_item: null, gramos_foto: null, componentes: [] } as const;
    const r = await validarPendienteAction({ ...FORM, kcal: null, composicion: manual });
    expect('error' in r).toBe(true);
    expect(sb.rpcLlamadas()).toHaveLength(0);
  });

  it.each([
    ['gramos 0', { ...COMPOSICION, componentes: [{ ...ACEITE, gramos: 0 }] }],
    ['gramos sobre el tope', { ...COMPOSICION, componentes: [{ ...ACEITE, gramos: 1001 }] }],
    ['macro negativo', { ...COMPOSICION, componentes: [{ ...ACEITE, kcal_100g: -1 }] }],
    ['modo inválido', { ...COMPOSICION, modo: 'otro' }],
  ])('composición inválida (%s) no llama a la RPC', async (_caso, composicion) => {
    comoRol('investigador');
    expect('error' in (await modificarPendienteAction({ ...FORM, composicion: composicion as never }))).toBe(true);
    expect('error' in (await validarPendienteAction({ ...FORM, composicion: composicion as never }))).toBe(true);
    expect(sb.rpcLlamadas()).toHaveLength(0);
  });

  it('COMPOSICION_INVALIDA muestra el motivo que da el servidor', async () => {
    comoRol('investigador');
    sb.mockRpc('pendiente_validar', {
      data: null,
      error: { message: 'COMPOSICION_INVALIDA', details: 'La foto de referencia no corresponde a este alimento.' },
    });
    expect(await validarPendienteAction({ ...FORM, composicion: COMPOSICION })).toEqual({
      error: 'La composición no es válida: La foto de referencia no corresponde a este alimento.',
    });
  });

  it('COMPOSICION_INVALIDA sin detalle → mensaje corto', async () => {
    comoRol('investigador');
    sb.mockRpc('pendiente_modificar', { data: null, error: { message: 'COMPOSICION_INVALIDA', details: null } });
    expect(await modificarPendienteAction({ ...FORM, composicion: COMPOSICION })).toEqual({
      error: 'La composición no es válida',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run testing/validacionActions.test.ts`
Expected: FAIL (faltan `p_composicion` en los args, el esquema rechaza `kcal: null` en validar, no existe el mapeo del error).

- [ ] **Step 3: Write the implementation**

En `src/app/(researcher)/validacion/actions.ts`:

(a) Agregar el import junto a los demás:

```ts
import { composicionSchema } from '@/lib/composicion';
```

(b) En `PendienteFila`, después de `observaciones: string | null;` agregar:

```ts
  /** jsonb crudo de la cola; se lee con `restaurarComposicion` (puede ser null o de una versión vieja). */
  composicion: unknown;
```

(c) Reemplazar el bloque de esquemas `const modificarSchema … const validarSchema … });` por:

```ts
const composicion = composicionSchema.nullish().transform((v) => v ?? null);
const valorOpcional = valor.nullish().transform((v) => v ?? null);

const modificarSchema = z.object({
  ...formBase,
  kcal: valor.nullable(),
  proteinas: valor.nullable(),
  grasas: valor.nullable(),
  carbs: valor.nullable(),
  composicion,
});
// En modo catálogo los 4 valores los calcula el servidor; en los demás casos son obligatorios.
const validarSchema = z
  .object({
    ...formBase,
    kcal: valorOpcional,
    proteinas: valorOpcional,
    grasas: valorOpcional,
    carbs: valorOpcional,
    idAlimentoExistente: id.nullish(),
    composicion,
  })
  .refine((f) => f.composicion?.modo === 'catalogo' || [f.kcal, f.proteinas, f.grasas, f.carbs].every((v) => v !== null));
```

(d) En `errorDeRpc`, antes de `case 'INVALID':` agregar:

```ts
    case 'COMPOSICION_INVALIDA':
      return { error: error.details ? `La composición no es válida: ${error.details}` : 'La composición no es válida' };
```

(e) En `modificarPendienteAction`, agregar al objeto de la RPC, después de `p_observaciones: f.observaciones,`:

```ts
    p_composicion: f.composicion,
```

(f) En `validarPendienteAction`, agregar después de `p_id_alimento_existente: f.idAlimentoExistente ?? null,`:

```ts
    p_composicion: f.composicion,
```

(g) En `testing/fixtures/validacion.ts`, en `PENDIENTE`, después de `observaciones: null,` agregar `composicion: null,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run testing/validacionActions.test.ts && npx tsc --noEmit`
Expected: PASS. `tsc` puede quejarse sólo en `PendienteDetalle.tsx` si pasa `kcal: number` a `ValidarInput` (sigue compilando: `number` es asignable a `number | null | undefined`).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(researcher)/validacion/actions.ts" testing/validacionActions.test.ts testing/fixtures/validacion.ts
git commit -m "feat: las acciones de validación llevan la composición y mapean COMPOSICION_INVALIDA

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 5: `ComposicionCatalogo` — foto de referencia, ingredientes y gramos reales

**Files:**
- Create: `src/app/(researcher)/validacion/ComposicionCatalogo.tsx`
- Test: `testing/ComposicionCatalogo.test.tsx` (nuevo)

(`MezclaCatalogo.tsx` se borra en la Task 6, cuando `PendienteDetalle` deja de usarlo.)

**Interfaces:**
- Consumes: `aComponentes`, `resumirComposicion`, `GRAMOS_MAX_INGREDIENTE`, `ComponenteEditable` (Task 2); `OcurrenciaDetalle` (Task 4); `searchAlimentosAction`, `AlimentoOption` (existentes).
- Produces:
  ```ts
  export default function ComposicionCatalogo(props: {
    ocurrencias: OcurrenciaDetalle[];            // para elegir la foto de referencia
    referencia: number | null;                   // idGuardadoItem elegido
    onReferencia: (idGuardadoItem: number) => void;
    ingredientes: ComponenteEditable[];          // estado controlado por el padre
    onIngredientes: (siguiente: ComponenteEditable[]) => void;
    soloLectura?: boolean;                       // sin buscador ni edición
  }): JSX.Element
  ```
  Regiones/etiquetas que usan los tests: región `Resultado de la composición`; buscador `Agregar alimento del catálogo`; botones `Agregar <nombre>` y `Quitar <nombre>`; campos `Gramos de <nombre>`; selector `Foto de referencia` (sólo si hay más de una ocurrencia).

- [ ] **Step 1: Write the failing test**

Crear `testing/ComposicionCatalogo.test.tsx`:

```tsx
/**
 * NUT-119 — Pestaña "Del catálogo": gramos reales de cada alimento sobre el peso
 * de la foto de referencia, avisos de suma y resultado por 100 g.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/app/alimentacion/actions', () => ({ searchAlimentosAction: vi.fn() }));

import ComposicionCatalogo from '@/app/(researcher)/validacion/ComposicionCatalogo';
import { aEditables, type ComponenteComposicion, type ComponenteEditable } from '@/lib/composicion';
import { searchAlimentosAction } from '@/app/alimentacion/actions';
import { OCURRENCIA } from './fixtures/validacion';

const ACEITE = { id_alimento: 31, nombre: 'Aceite de oliva', categoria: 'aceites', fuente: 'SARA2', marca: null, denominacion: null, kcal_100g: 800, proteinas_100g: 0, grasas_100g: 90, carbs_100g: 0 };
const VINAGRE = { id_alimento: 32, nombre: 'Vinagre de alcohol', categoria: 'aderezos', fuente: 'SARA2', marca: null, denominacion: null, kcal_100g: 20, proteinas_100g: 0, grasas_100g: 0, carbs_100g: 4 };
const SIN_DATOS = { ...VINAGRE, id_alimento: 99, nombre: 'Misterio', kcal_100g: null };

const FOTO_20 = { ...OCURRENCIA, idGuardadoItem: 10, gramosFinal: 20 };
const FOTO_40 = { ...OCURRENCIA, idGuardadoItem: 11, gramosFinal: 40, deportista: 'Beto Gómez', fecha: '2026-10-07T12:00:00Z' };

function Wrapper({ ocurrencias = [FOTO_20], inicial = [], soloLectura = false }: {
  ocurrencias?: typeof FOTO_20[]; inicial?: ComponenteEditable[]; soloLectura?: boolean;
}) {
  const [ingredientes, setIngredientes] = useState(inicial);
  const [referencia, setReferencia] = useState<number | null>(ocurrencias[0]?.idGuardadoItem ?? null);
  return (
    <ComposicionCatalogo
      ocurrencias={ocurrencias}
      referencia={referencia}
      onReferencia={setReferencia}
      ingredientes={ingredientes}
      onIngredientes={setIngredientes}
      soloLectura={soloLectura}
    />
  );
}

function mockBusqueda() {
  vi.mocked(searchAlimentosAction).mockImplementation(async (q: string) =>
    q.startsWith('acei') ? [ACEITE] : q.startsWith('vina') ? [VINAGRE] : q.startsWith('mist') ? [SIN_DATOS] : [],
  );
}

async function agregar(user: ReturnType<typeof userEvent.setup>, busqueda: string, nombre: string) {
  await user.type(screen.getByLabelText('Agregar alimento del catálogo'), busqueda);
  await user.click(await screen.findByRole('button', { name: new RegExp(`Agregar ${nombre}`) }));
}

async function gramos(user: ReturnType<typeof userEvent.setup>, nombre: string, valor: string) {
  const campo = screen.getByLabelText(`Gramos de ${nombre}`);
  await user.clear(campo);
  if (valor) await user.type(campo, valor);
}

const resultado = () => screen.getByRole('region', { name: 'Resultado de la composición' });

beforeEach(() => {
  vi.mocked(searchAlimentosAction).mockReset().mockResolvedValue([]);
  mockBusqueda();
});

describe('ComposicionCatalogo', () => {
  it('muestra cuánto pesa el alimento en la foto de referencia', () => {
    render(<Wrapper />);
    expect(screen.getByText(/En la foto de Ana Pérez/)).toHaveTextContent('pesa 20 g');
  });

  it('el primer ingrediente arranca con el peso total de la foto; los siguientes, vacío', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await agregar(user, 'aceite', 'Aceite de oliva');
    expect(screen.getByLabelText('Gramos de Aceite de oliva')).toHaveValue(20);
    await agregar(user, 'vinagre', 'Vinagre de alcohol');
    expect(screen.getByLabelText('Gramos de Vinagre de alcohol')).toHaveValue(null);
  });

  it('15 g de aceite + 5 g de vinagre en una foto de 20 g: valores por 100 g y suma completa', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await agregar(user, 'aceite', 'Aceite de oliva');
    await agregar(user, 'vinagre', 'Vinagre de alcohol');
    await gramos(user, 'Aceite de oliva', '15');
    await gramos(user, 'Vinagre de alcohol', '5');
    expect(within(resultado()).getByText(/Sumás 20 g de 20 g/)).toBeInTheDocument();
    expect(within(resultado()).getByText(/605 kcal/)).toBeInTheDocument();
    expect(within(resultado()).getByText(/G 67\.5 g/)).toBeInTheDocument();
    expect(within(resultado()).queryByText(/restantes/)).not.toBeInTheDocument();
  });

  it('si falta peso avisa cuántos gramos restan, sin bloquear el resultado', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await agregar(user, 'aceite', 'Aceite de oliva');
    await gramos(user, 'Aceite de oliva', '8');
    expect(within(resultado()).getByText(/Sumás 8 g de 20 g/)).toBeInTheDocument();
    expect(within(resultado()).getByText(/12 g restantes se cuentan sin aporte/)).toBeInTheDocument();
    expect(within(resultado()).getByText(/320 kcal/)).toBeInTheDocument(); // 800 × 8 / 20
  });

  it('si se pasa del peso de la foto avisa que revise', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await agregar(user, 'aceite', 'Aceite de oliva');
    await gramos(user, 'Aceite de oliva', '25');
    expect(within(resultado()).getByText(/Superás el peso de la foto por 5 g/)).toBeInTheDocument();
  });

  it('un solo alimento con todo el peso de la foto es el mismo alimento del catálogo', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await agregar(user, 'aceite', 'Aceite de oliva');
    expect(within(resultado()).getByText(/mismo alimento del catálogo/)).toHaveTextContent('Aceite de oliva');
    expect(within(resultado()).getByText(/800 kcal/)).toBeInTheDocument();
  });

  it('sin ingredientes lo dice y no muestra valores', () => {
    render(<Wrapper />);
    expect(within(resultado()).getByText(/Agregá al menos un alimento/)).toBeInTheDocument();
    expect(within(resultado()).queryByText(/kcal/)).not.toBeInTheDocument();
  });

  it('un gramaje vacío se pide por nombre y bloquea el resultado', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await agregar(user, 'aceite', 'Aceite de oliva');
    await gramos(user, 'Aceite de oliva', '');
    expect(within(resultado()).getByText(/Indicá los gramos de Aceite de oliva/)).toBeInTheDocument();
    expect(within(resultado()).queryByText(/kcal/)).not.toBeInTheDocument();
  });

  it('un alimento sin datos nutricionales avisa por nombre y bloquea el resultado', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await agregar(user, 'misterio', 'Misterio');
    expect(within(resultado()).getByText(/Misterio no tiene datos nutricionales en el catálogo/)).toBeInTheDocument();
    expect(within(resultado()).queryByText(/kcal/)).not.toBeInTheDocument();
  });

  it('se puede quitar un ingrediente y no se agrega dos veces el mismo', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await agregar(user, 'aceite', 'Aceite de oliva');
    await user.type(screen.getByLabelText('Agregar alimento del catálogo'), 'aceite');
    await user.click(await screen.findByRole('button', { name: /Agregar Aceite de oliva/ }));
    expect(screen.getAllByLabelText('Gramos de Aceite de oliva')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Quitar Aceite de oliva' }));
    expect(screen.queryByLabelText('Gramos de Aceite de oliva')).not.toBeInTheDocument();
  });

  it('con varias fotos permite elegir la de referencia y el peso cambia', async () => {
    const user = userEvent.setup();
    render(<Wrapper ocurrencias={[FOTO_20, FOTO_40]} />);
    await user.selectOptions(screen.getByLabelText('Foto de referencia'), '11');
    expect(screen.getByText(/En la foto de Beto Gómez/)).toHaveTextContent('pesa 40 g');
  });

  it('con una sola foto no muestra el selector', () => {
    render(<Wrapper />);
    expect(screen.queryByLabelText('Foto de referencia')).not.toBeInTheDocument();
  });

  it('restaura ingredientes guardados y en solo lectura no deja buscar ni editar', () => {
    const guardados: ComponenteComposicion[] = [
      { origen: 'catalogo', id: 31, nombre: 'Aceite de oliva', fuente: 'SARA2', gramos: 15, kcal_100g: 800, proteinas_100g: 0, grasas_100g: 90, carbs_100g: 0 },
    ];
    render(<Wrapper inicial={aEditables(guardados)} soloLectura />);
    expect(screen.getByLabelText('Gramos de Aceite de oliva')).toBeDisabled();
    expect(screen.queryByLabelText('Agregar alimento del catálogo')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar Aceite de oliva' })).not.toBeInTheDocument();
  });

  it('sin fotos con peso avisa que no hay referencia', () => {
    render(<Wrapper ocurrencias={[]} />);
    expect(screen.getByText(/No hay una foto de referencia con peso/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run testing/ComposicionCatalogo.test.tsx`
Expected: FAIL (el componente no existe).

- [ ] **Step 3: Write the implementation**

Crear `src/app/(researcher)/validacion/ComposicionCatalogo.tsx`:

```tsx
'use client';

/**
 * NUT-119 — Pestaña "Del catálogo": el investigador indica los GRAMOS REALES de
 * cada alimento del catálogo que hay en la foto (nunca proporciones). El sistema
 * calcula los valores por 100 g del alimento sobre el peso de la foto de
 * referencia. Cubre un solo alimento (equivalencia o vínculo) y compuestos
 * ("aceite y vinagre"). El estado vive en el padre (para guardarlo en el borrador).
 */
import { useEffect, useState } from 'react';
import Input from '@/components/ui/Input';
import { searchAlimentosAction, type AlimentoOption } from '@/app/alimentacion/actions';
import { formatFechaCorta } from '@/lib/date';
import { aComponentes, GRAMOS_MAX_INGREDIENTE, resumirComposicion, type ComponenteEditable } from '@/lib/composicion';
import type { Macros100 } from '@/lib/macros';
import type { OcurrenciaDetalle } from './actions';

interface Props {
  ocurrencias: OcurrenciaDetalle[];
  referencia: number | null;
  onReferencia: (idGuardadoItem: number) => void;
  ingredientes: ComponenteEditable[];
  onIngredientes: (siguiente: ComponenteEditable[]) => void;
  soloLectura?: boolean;
}

const redondear1 = (n: number) => Math.round(n * 10) / 10;

/** El catálogo puede tener alimentos sin valores nutricionales cargados. */
function aMacros(a: AlimentoOption): Macros100 | null {
  const v = [a.kcal_100g, a.proteinas_100g, a.grasas_100g, a.carbs_100g];
  if (v.some((x) => x == null)) return null;
  return {
    kcal_100g: Number(a.kcal_100g),
    proteinas_100g: Number(a.proteinas_100g),
    grasas_100g: Number(a.grasas_100g),
    carbs_100g: Number(a.carbs_100g),
  };
}

export default function ComposicionCatalogo({
  ocurrencias,
  referencia,
  onReferencia,
  ingredientes,
  onIngredientes,
  soloLectura = false,
}: Props) {
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<AlimentoOption[]>([]);

  // Búsqueda con debounce, igual que el resto de los buscadores.
  useEffect(() => {
    if (busqueda.trim().length < 2) {
      setResultados([]);
      return;
    }
    const timer = setTimeout(async () => {
      setResultados((await searchAlimentosAction(busqueda, '')).slice(0, 6));
    }, 300);
    return () => clearTimeout(timer);
  }, [busqueda]);

  const foto = ocurrencias.find((o) => o.idGuardadoItem === referencia) ?? null;
  const peso = foto && foto.gramosFinal > 0 ? foto.gramosFinal : 0;
  const { componentes, problemas } = aComponentes(ingredientes);
  const r = resumirComposicion(componentes, peso);

  const agregar = (a: AlimentoOption) => {
    setBusqueda('');
    setResultados([]);
    if (ingredientes.some((i) => i.id === a.id_alimento)) return; // el mismo alimento no se repite
    onIngredientes([
      ...ingredientes,
      {
        id: a.id_alimento,
        nombre: a.nombre,
        fuente: a.fuente,
        // El primero arranca con todo el peso de la foto; los demás los completa el investigador.
        gramos: ingredientes.length === 0 && peso > 0 ? String(redondear1(peso)) : '',
        macros: aMacros(a),
      },
    ]);
  };

  const cambiarGramos = (id: number, gramos: string) =>
    onIngredientes(ingredientes.map((i) => (i.id === id ? { ...i, gramos } : i)));

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">
        Indicá cuántos gramos de cada alimento del catálogo hay en la foto. El sistema calcula los valores por 100 g.
      </p>

      {foto && peso > 0 ? (
        <div className="space-y-1 text-sm text-slate-800">
          <p>
            En la foto de {foto.deportista ?? 'un deportista'}, {formatFechaCorta(foto.fecha)}, pesa{' '}
            <strong>{redondear1(peso)} g</strong>.
          </p>
          {ocurrencias.length > 1 && (
            <label className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
              Foto de referencia
              <select
                aria-label="Foto de referencia"
                value={referencia ?? ''}
                disabled={soloLectura}
                onChange={(e) => onReferencia(Number(e.target.value))}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
              >
                {ocurrencias.map((o) => (
                  <option key={o.idGuardadoItem} value={o.idGuardadoItem}>
                    {o.deportista ?? 'Deportista'} · {formatFechaCorta(o.fecha)} · {redondear1(o.gramosFinal)} g
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      ) : (
        <p className="text-sm text-amber-700">No hay una foto de referencia con peso para calcular.</p>
      )}

      {!soloLectura && (
        <>
          <Input
            id="pv-catalogo"
            label="Agregar alimento del catálogo"
            placeholder="Buscar en SARA2 o ANMAT…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          {resultados.length > 0 && (
            <ul className="space-y-1">
              {resultados.map((a) => (
                <li key={a.id_alimento}>
                  <button
                    type="button"
                    aria-label={`Agregar ${a.nombre}`}
                    onClick={() => agregar(a)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    {a.nombre} <span className="text-xs text-slate-600">{a.fuente}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {ingredientes.length > 0 && (
        <ul className="space-y-2">
          {ingredientes.map((i) => (
            <li key={i.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-slate-800">
                {i.nombre} <span className="text-xs text-slate-600">{i.fuente}</span>
              </span>
              <input
                type="number"
                min={0}
                max={GRAMOS_MAX_INGREDIENTE}
                step="0.1"
                aria-label={`Gramos de ${i.nombre}`}
                value={i.gramos}
                disabled={soloLectura}
                onChange={(e) => cambiarGramos(i.id, e.target.value)}
                className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm text-slate-900 disabled:bg-slate-100"
              />
              <span className="text-xs text-slate-600">g en la foto</span>
              {!soloLectura && (
                <button
                  type="button"
                  aria-label={`Quitar ${i.nombre}`}
                  onClick={() => onIngredientes(ingredientes.filter((x) => x.id !== i.id))}
                  className="rounded p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div role="region" aria-label="Resultado de la composición" className="space-y-1 rounded-lg bg-slate-50 p-2 text-sm">
        {ingredientes.length === 0 ? (
          <p className="text-slate-700">Agregá al menos un alimento del catálogo para calcular.</p>
        ) : problemas.length > 0 ? (
          problemas.map((p) => (
            <p key={p} className="text-amber-700">
              {p}
            </p>
          ))
        ) : (
          <>
            <p className="text-slate-800">
              Sumás {redondear1(r.suma)} g de {redondear1(peso)} g de la foto.
            </p>
            {r.estado === 'falta' && (
              <p className="text-amber-700">Los {redondear1(r.diferencia)} g restantes se cuentan sin aporte.</p>
            )}
            {r.estado === 'sobra' && (
              <p className="text-amber-700">
                Superás el peso de la foto por {redondear1(-r.diferencia)} g: revisá los gramos.
              </p>
            )}
            {r.esVinculoPuro && (
              <p className="text-blue-800">
                Es el mismo alimento del catálogo: se vincula a «{componentes[0].nombre}».
              </p>
            )}
            {r.macros && (
              <p className="font-medium text-slate-900">
                Por 100 g del alimento: {redondear1(r.macros.kcal_100g)} kcal · P {redondear1(r.macros.proteinas_100g)} g · C{' '}
                {redondear1(r.macros.carbs_100g)} g · G {redondear1(r.macros.grasas_100g)} g
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run testing/ComposicionCatalogo.test.tsx && npx tsc --noEmit`
Expected: PASS y `tsc` limpio.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(researcher)/validacion/ComposicionCatalogo.tsx" testing/ComposicionCatalogo.test.tsx
git commit -m "feat: ComposicionCatalogo — gramos reales de cada alimento del catálogo sobre el peso de la foto

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 6: `PendienteDetalle` — pestañas, plegables, borrador que restaura

**Files:**
- Rewrite: `src/app/(researcher)/validacion/PendienteDetalle.tsx`
- Delete: `src/app/(researcher)/validacion/MezclaCatalogo.tsx`
- Modify: `src/app/(researcher)/validacion/ValidacionClient.tsx` (pasa `onGuardado`)
- Rewrite: `testing/PendienteDetalle.test.tsx`

**Interfaces:**
- Consumes: `ComposicionCatalogo` (Task 5); `aComponentes`, `aEditables`, `resumirComposicion`, `restaurarComposicion`, `ModoComposicion`, `ComponenteEditable` (Task 2); `PendienteFila.composicion`, `modificarPendienteAction` / `validarPendienteAction` con `composicion` (Task 4).
- Produces: `PendienteDetalle` con la prop nueva `onGuardado?: () => void` (se llama tras guardar un borrador con éxito). Tabs `role="tab"` con nombres `IA`, `Del catálogo`, `A mano`; plegables con `aria-expanded` y nombres `Dónde apareció (N ocurrencias)`, `Cómo queda en cada ocurrencia`, `Más datos (categoría y observaciones)`; región `Resultado por 100 g`; indicador `Cambios sin guardar`; mensaje `Guardado hace un momento`.

- [ ] **Step 1: Write the failing tests**

Reemplazar **todo** `testing/PendienteDetalle.test.tsx` por:

```tsx
/**
 * NUT-119 — Detalle de un alimento de la cola: pestañas IA / Del catálogo / A mano,
 * borrador que restaura (incluida la composición), indicador de cambios, plausibilidad,
 * confirmación y errores.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/app/(researcher)/validacion/actions', () => ({
  getPendienteDetalleAction: vi.fn(),
  modificarPendienteAction: vi.fn(),
  validarPendienteAction: vi.fn(),
  descartarPendienteAction: vi.fn(),
}));
vi.mock('@/app/alimentacion/actions', () => ({ searchAlimentosAction: vi.fn() }));

import PendienteDetalle from '@/app/(researcher)/validacion/PendienteDetalle';
import {
  descartarPendienteAction,
  getPendienteDetalleAction,
  modificarPendienteAction,
  validarPendienteAction,
} from '@/app/(researcher)/validacion/actions';
import { searchAlimentosAction } from '@/app/alimentacion/actions';
import { OCURRENCIA, PENDIENTE } from './fixtures/validacion';

const FOTO_20 = { ...OCURRENCIA, gramosFinal: 20 };
const ACEITE = { id_alimento: 31, nombre: 'Aceite de oliva', categoria: 'aceites', fuente: 'SARA2', marca: null, denominacion: null, kcal_100g: 800, proteinas_100g: 0, grasas_100g: 90, carbs_100g: 0 };
const VINAGRE = { id_alimento: 32, nombre: 'Vinagre de alcohol', categoria: 'aderezos', fuente: 'SARA2', marca: null, denominacion: null, kcal_100g: 20, proteinas_100g: 0, grasas_100g: 0, carbs_100g: 4 };
const IA_VACIA = { modo: 'ia', id_guardado_item: null, gramos_foto: null, componentes: [] };
const COMP_GUARDADA = {
  modo: 'catalogo',
  id_guardado_item: 1,
  gramos_foto: 20,
  componentes: [
    { origen: 'catalogo', id: 31, nombre: 'Aceite de oliva', fuente: 'SARA2', gramos: 15, kcal_100g: 800, proteinas_100g: 0, grasas_100g: 90, carbs_100g: 0 },
    { origen: 'catalogo', id: 32, nombre: 'Vinagre de alcohol', fuente: 'SARA2', gramos: 5, kcal_100g: 20, proteinas_100g: 0, grasas_100g: 0, carbs_100g: 4 },
  ],
};

const detalle = (over: Partial<typeof PENDIENTE> = {}, ocurrencias = [OCURRENCIA]) =>
  ({ ok: true, pendiente: { ...PENDIENTE, ...over }, ocurrencias, totalOcurrencias: 2 }) as const;

async function abrir(over: Partial<typeof PENDIENTE> = {}, ocurrencias = [OCURRENCIA]) {
  vi.mocked(getPendienteDetalleAction).mockResolvedValue(detalle(over, ocurrencias));
  const onClose = vi.fn();
  const onResuelto = vi.fn();
  const onGuardado = vi.fn();
  const user = userEvent.setup();
  render(<PendienteDetalle idPendiente={5} onClose={onClose} onResuelto={onResuelto} onGuardado={onGuardado} />);
  await screen.findByLabelText('Nombre');
  return { user, onClose, onResuelto, onGuardado };
}

const pestana = (nombre: string) => screen.getByRole('tab', { name: nombre });
const resultado = () => screen.getByRole('region', { name: 'Resultado por 100 g' });

async function agregar(user: ReturnType<typeof userEvent.setup>, busqueda: string, nombre: string) {
  await user.type(screen.getByLabelText('Agregar alimento del catálogo'), busqueda);
  await user.click(await screen.findByRole('button', { name: new RegExp(`Agregar ${nombre}`) }));
}

async function gramos(user: ReturnType<typeof userEvent.setup>, nombre: string, valor: string) {
  const campo = screen.getByLabelText(`Gramos de ${nombre}`);
  await user.clear(campo);
  await user.type(campo, valor);
}

async function confirmarValidar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Validar' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }));
}

beforeEach(() => {
  vi.mocked(getPendienteDetalleAction).mockReset();
  vi.mocked(modificarPendienteAction).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(validarPendienteAction)
    .mockReset()
    .mockResolvedValue({ ok: true, idAlimento: null, itemsAfectados: 2 });
  vi.mocked(descartarPendienteAction).mockReset().mockResolvedValue({ ok: true, itemsAfectados: 2 });
  vi.mocked(searchAlimentosAction)
    .mockReset()
    .mockImplementation(async (q: string) =>
      q.startsWith('acei') ? [ACEITE] : q.startsWith('vina') ? [VINAGRE] : [],
    );
});

describe('PendienteDetalle — contexto', () => {
  it('muestra la foto con alt descriptivo y el recuadro del bbox en porcentajes', async () => {
    await abrir();
    expect(screen.getByAltText('Foto del plato de Ana Pérez, 6/10/2026')).toHaveAttribute('src', 'https://signed.example/1.jpg');
    expect(screen.getByTestId('bbox')).toHaveStyle({ left: '10%', top: '20%', width: '30%', height: '40%' });
  });

  it('muestra nombre de la IA vs final, respuestas, gramaje IA vs final y deportista', async () => {
    await abrir();
    expect(screen.getByText('Postre blanco')).toBeInTheDocument();
    expect(screen.getByText('¿Qué es el postre?')).toBeInTheDocument();
    expect(screen.getByText('Flan')).toBeInTheDocument();
    expect(screen.getByText(/IA: 100 g/)).toBeInTheDocument();
    expect(screen.getByText(/final: 120 g/)).toBeInTheDocument();
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
  });

  it('sin foto muestra un aviso en vez de la imagen', async () => {
    await abrir({}, [{ ...OCURRENCIA, fotoUrl: null, bbox: null }]);
    expect(screen.getByText(/Sin foto/)).toBeInTheDocument();
    expect(screen.queryByTestId('bbox')).not.toBeInTheDocument();
  });

  it('muestra los valores originales de Gemini (solo lectura) y el modelo', async () => {
    await abrir();
    const gem = screen.getByRole('region', { name: 'Estimación original de Gemini' });
    expect(within(gem).getByText(/150 kcal/)).toBeInTheDocument();
    expect(within(gem).getByText(/gemini-x/)).toBeInTheDocument();
  });

  it('si hay más ocurrencias de las que se listan dice "y N más"', async () => {
    vi.mocked(getPendienteDetalleAction).mockResolvedValue({ ...detalle(), totalOcurrencias: 25 });
    render(<PendienteDetalle idPendiente={5} onClose={vi.fn()} onResuelto={vi.fn()} />);
    expect(await screen.findByText(/y 24 más/)).toBeInTheDocument();
  });

  it('si la carga falla muestra el error', async () => {
    vi.mocked(getPendienteDetalleAction).mockResolvedValue({ error: 'Acceso denegado' });
    render(<PendienteDetalle idPendiente={5} onClose={vi.fn()} onResuelto={vi.fn()} />);
    expect(await screen.findByText('Acceso denegado')).toBeInTheDocument();
  });

  it('las ocurrencias se pueden plegar', async () => {
    const { user } = await abrir();
    const boton = screen.getByRole('button', { name: /Dónde apareció/ });
    expect(boton).toHaveAttribute('aria-expanded', 'true');
    await user.click(boton);
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Postre blanco')).not.toBeInTheDocument();
  });
});

describe('PendienteDetalle — pestañas y apertura', () => {
  it('abre en IA cuando Gemini dio valores, con su explicación y el resultado', async () => {
    await abrir();
    expect(pestana('IA')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Usa la estimación de Gemini tal cual/)).toBeInTheDocument();
    expect(within(resultado()).getByText(/150 kcal/)).toBeInTheDocument();
  });

  it('abre en A mano cuando Gemini no pudo estimar', async () => {
    await abrir({ gemini_kcal_100g: null, gemini_proteinas_100g: null, gemini_grasas_100g: null, gemini_carbs_100g: null });
    expect(pestana('A mano')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
  });

  it('un borrador viejo sin composición (sólo valores finales) abre en A mano con esos valores', async () => {
    await abrir({ nombre_final: 'Flan de vainilla', final_kcal_100g: 160, final_proteinas_100g: 3, final_grasas_100g: 5, final_carbs_100g: 25 });
    expect(pestana('A mano')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Nombre')).toHaveValue('Flan de vainilla');
    expect(screen.getByLabelText('kcal / 100 g')).toHaveValue(160);
  });

  it('un borrador con composición abre en Del catálogo con sus ingredientes y gramos', async () => {
    await abrir({ composicion: COMP_GUARDADA, final_kcal_100g: 605, final_proteinas_100g: 0, final_grasas_100g: 67.5, final_carbs_100g: 1 }, [FOTO_20]);
    expect(pestana('Del catálogo')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Gramos de Aceite de oliva')).toHaveValue(15);
    expect(screen.getByLabelText('Gramos de Vinagre de alcohol')).toHaveValue(5);
    expect(within(resultado()).getByText(/605 kcal/)).toBeInTheDocument();
  });

  it('una composición corrupta no rompe la pantalla (abre como un borrador común)', async () => {
    await abrir({ composicion: { modo: 'raro' } });
    expect(pestana('IA')).toHaveAttribute('aria-selected', 'true');
  });

  it('cambiar de pestaña no pierde lo cargado en las otras', async () => {
    const { user } = await abrir({}, [FOTO_20]);
    await user.click(pestana('A mano'));
    const kcal = screen.getByLabelText('kcal / 100 g');
    expect(kcal).toHaveValue(150); // arranca con la estimación de Gemini
    await user.clear(kcal);
    await user.type(kcal, '200');

    await user.click(pestana('Del catálogo'));
    await agregar(user, 'aceite', 'Aceite de oliva');

    await user.click(pestana('IA'));
    expect(within(resultado()).getByText(/150 kcal/)).toBeInTheDocument();
    await user.click(pestana('A mano'));
    expect(screen.getByLabelText('kcal / 100 g')).toHaveValue(200);
    await user.click(pestana('Del catálogo'));
    expect(screen.getByLabelText('Gramos de Aceite de oliva')).toHaveValue(20);
  });
});

describe('PendienteDetalle — A mano y vista previa', () => {
  it('editar kcal actualiza la vista previa para el gramaje de cada ocurrencia', async () => {
    const { user } = await abrir();
    await user.click(pestana('A mano'));
    await user.click(screen.getByRole('button', { name: 'Cómo queda en cada ocurrencia' }));
    const preview = screen.getByRole('region', { name: 'Vista previa por ocurrencia' });
    expect(within(preview).getByText(/180 kcal/)).toBeInTheDocument(); // 150 × 120 / 100
    const kcal = screen.getByLabelText('kcal / 100 g');
    await user.clear(kcal);
    await user.type(kcal, '200');
    expect(within(preview).getByText(/240 kcal/)).toBeInTheDocument();
  });

  it('avisa si los valores no son plausibles pero NO bloquea', async () => {
    const { user } = await abrir();
    await user.click(pestana('A mano'));
    const kcal = screen.getByLabelText('kcal / 100 g');
    await user.clear(kcal);
    await user.type(kcal, '800');
    expect(screen.getByText(/no parecen coherentes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validar' })).toBeEnabled();
  });

  it('categoría y observaciones viven en "Más datos"', async () => {
    const { user } = await abrir();
    expect(screen.queryByLabelText('Observaciones')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Más datos/ }));
    expect(screen.getByLabelText('Categoría')).toHaveValue('postre');
    expect(screen.getByLabelText('Observaciones')).toHaveValue('');
  });
});

describe('PendienteDetalle — borrador', () => {
  it('"Guardar borrador" en IA manda la composición, avisa y refresca el listado', async () => {
    const { user, onGuardado } = await abrir();
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(modificarPendienteAction).toHaveBeenCalledWith({
      id: 5, nombre: 'Flan casero', categoria: 'postre', observaciones: null,
      kcal: 150, proteinas: 3, grasas: 5, carbs: 23, composicion: IA_VACIA,
    });
    expect(await screen.findByText('Guardado hace un momento')).toBeInTheDocument();
    expect(onGuardado).toHaveBeenCalledTimes(1);
  });

  it('guarda las observaciones escritas en "Más datos"', async () => {
    const { user } = await abrir();
    await user.click(screen.getByRole('button', { name: /Más datos/ }));
    await user.type(screen.getByLabelText('Observaciones'), 'revisar porción');
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(modificarPendienteAction).toHaveBeenCalledWith(expect.objectContaining({ observaciones: 'revisar porción' }));
  });

  it('indica los cambios sin guardar y lo apaga al guardar', async () => {
    const { user } = await abrir();
    expect(screen.queryByText(/Cambios sin guardar/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Nombre'), ' 2');
    expect(screen.getByText(/Cambios sin guardar/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await screen.findByText('Guardado hace un momento');
    expect(screen.queryByText(/Cambios sin guardar/)).not.toBeInTheDocument();
  });

  it('si el guardado falla muestra el error, mantiene el indicador y no refresca', async () => {
    vi.mocked(modificarPendienteAction).mockResolvedValue({ error: 'No se pudo completar la acción. Probá de nuevo.' });
    const { user, onGuardado } = await abrir();
    await user.type(screen.getByLabelText('Nombre'), ' 2');
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo completar');
    expect(screen.getByText(/Cambios sin guardar/)).toBeInTheDocument();
    expect(onGuardado).not.toHaveBeenCalled();
  });

  it('el borrador en Del catálogo guarda ingredientes, gramos y foto de referencia', async () => {
    const { user } = await abrir({}, [FOTO_20]);
    await user.click(pestana('Del catálogo'));
    await agregar(user, 'aceite', 'Aceite de oliva');
    await agregar(user, 'vinagre', 'Vinagre de alcohol');
    await gramos(user, 'Aceite de oliva', '15');
    await gramos(user, 'Vinagre de alcohol', '5');
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(modificarPendienteAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 5,
        kcal: 605, proteinas: 0, grasas: 67.5, carbs: 1,
        composicion: COMP_GUARDADA,
      }),
    );
  });

  it('en Del catálogo recién abierta (sin ingredientes) se puede guardar el borrador', async () => {
    const { user } = await abrir({}, [FOTO_20]);
    await user.click(pestana('Del catálogo'));
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(modificarPendienteAction).toHaveBeenCalledWith(
      expect.objectContaining({
        kcal: null, proteinas: null, grasas: null, carbs: null,
        composicion: { modo: 'catalogo', id_guardado_item: 1, gramos_foto: 20, componentes: [] },
      }),
    );
  });

  it('con un gramaje vacío no guarda y dice de qué alimento falta', async () => {
    const { user } = await abrir({}, [FOTO_20]);
    await user.click(pestana('Del catálogo'));
    await agregar(user, 'aceite', 'Aceite de oliva');
    await user.clear(screen.getByLabelText('Gramos de Aceite de oliva'));
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Indicá los gramos de Aceite de oliva');
    expect(modificarPendienteAction).not.toHaveBeenCalled();
  });
});

describe('PendienteDetalle — Del catálogo y validación', () => {
  it('aceite 15 g + vinagre 5 g sobre 20 g: valida con la composición y los valores en pantalla (sin guardar antes)', async () => {
    const { user, onResuelto } = await abrir({}, [FOTO_20]);
    await user.click(pestana('Del catálogo'));
    await agregar(user, 'aceite', 'Aceite de oliva');
    await agregar(user, 'vinagre', 'Vinagre de alcohol');
    await gramos(user, 'Aceite de oliva', '15');
    await gramos(user, 'Vinagre de alcohol', '5');
    await confirmarValidar(user);
    expect(validarPendienteAction).toHaveBeenCalledWith({
      id: 5, nombre: 'Flan casero', categoria: 'postre', observaciones: null,
      kcal: 605, proteinas: 0, grasas: 67.5, carbs: 1,
      composicion: COMP_GUARDADA,
    });
    expect(onResuelto).toHaveBeenCalledTimes(1);
  });

  it('un solo alimento con todo el peso de la foto se confirma como vínculo', async () => {
    const { user } = await abrir({}, [FOTO_20]);
    await user.click(pestana('Del catálogo'));
    await agregar(user, 'aceite', 'Aceite de oliva');
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    expect(within(screen.getByRole('alertdialog')).getByText(/vinculado a Aceite de oliva/)).toBeInTheDocument();
  });

  it('sin ingredientes, o con un gramaje vacío, Validar está deshabilitado', async () => {
    const { user } = await abrir({}, [FOTO_20]);
    await user.click(pestana('Del catálogo'));
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
    await agregar(user, 'aceite', 'Aceite de oliva');
    expect(screen.getByRole('button', { name: 'Validar' })).toBeEnabled();
    await user.clear(screen.getByLabelText('Gramos de Aceite de oliva'));
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
  });

  it('un alimento sin datos nutricionales bloquea Validar', async () => {
    vi.mocked(searchAlimentosAction).mockResolvedValue([{ ...VINAGRE, id_alimento: 99, nombre: 'Misterio', kcal_100g: null }]);
    const { user } = await abrir({}, [FOTO_20]);
    await user.click(pestana('Del catálogo'));
    await agregar(user, 'mist', 'Misterio');
    expect(screen.getByText(/Misterio no tiene datos nutricionales/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
  });

  it('un error del servidor sobre la composición se muestra y no cierra', async () => {
    vi.mocked(validarPendienteAction).mockResolvedValue({ error: 'La composición no es válida: ya no existe el alimento' });
    const { user, onResuelto } = await abrir({}, [FOTO_20]);
    await user.click(pestana('Del catálogo'));
    await agregar(user, 'aceite', 'Aceite de oliva');
    await confirmarValidar(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('La composición no es válida');
    expect(onResuelto).not.toHaveBeenCalled();
  });
});

describe('PendienteDetalle — validar y descartar con confirmación', () => {
  it('Validar en IA pide confirmación con la cantidad de ítems y recién ahí llama a la acción', async () => {
    const { user, onResuelto } = await abrir();
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    expect(validarPendienteAction).not.toHaveBeenCalled();
    expect(within(screen.getByRole('alertdialog')).getByText(/2 ítems/)).toBeInTheDocument();

    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }));
    expect(validarPendienteAction).toHaveBeenCalledWith({
      id: 5, nombre: 'Flan casero', categoria: 'postre', observaciones: null,
      kcal: 150, proteinas: 3, grasas: 5, carbs: 23, composicion: IA_VACIA,
    });
    expect(onResuelto).toHaveBeenCalledTimes(1);
  });

  it('Validar a mano manda la composición manual con los valores cargados', async () => {
    const { user } = await abrir();
    await user.click(pestana('A mano'));
    const kcal = screen.getByLabelText('kcal / 100 g');
    await user.clear(kcal);
    await user.type(kcal, '160');
    await confirmarValidar(user);
    expect(validarPendienteAction).toHaveBeenCalledWith(
      expect.objectContaining({ kcal: 160, composicion: { modo: 'manual', id_guardado_item: null, gramos_foto: null, componentes: [] } }),
    );
  });

  it('cancelar la confirmación no llama a nada', async () => {
    const { user } = await abrir();
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(descartarPendienteAction).not.toHaveBeenCalled();
  });

  it('Descartar confirma, avisa que los ítems se conservan y llama a la acción', async () => {
    const { user, onResuelto } = await abrir();
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    const confirm = screen.getByRole('alertdialog');
    expect(within(confirm).getByText(/no se borran/i)).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Confirmar' }));
    expect(descartarPendienteAction).toHaveBeenCalledWith({ id: 5, observaciones: null });
    expect(onResuelto).toHaveBeenCalledTimes(1);
  });

  it('un error de la acción se muestra (aria-live) y no cierra', async () => {
    vi.mocked(validarPendienteAction).mockResolvedValue({ error: 'Este alimento ya fue resuelto por otro investigador' });
    const { user, onResuelto } = await abrir();
    await confirmarValidar(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('ya fue resuelto por otro investigador');
    expect(onResuelto).not.toHaveBeenCalled();
  });

  it('un alimento ya resuelto es de solo lectura (sin Validar/Descartar ni buscador)', async () => {
    const { user } = await abrir({ estado: 'validado', composicion: COMP_GUARDADA }, [FOTO_20]);
    expect(screen.queryByRole('button', { name: 'Validar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Descartar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar borrador' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toBeDisabled();
    expect(pestana('Del catálogo')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Gramos de Aceite de oliva')).toBeDisabled();
    expect(screen.queryByLabelText('Agregar alimento del catálogo')).not.toBeInTheDocument();
    await user.click(pestana('A mano')); // se puede mirar la otra pestaña sin editar
    expect(screen.getByLabelText('kcal / 100 g')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run testing/PendienteDetalle.test.tsx`
Expected: FAIL (no hay pestañas ni plegables; sigue la versión vieja).

- [ ] **Step 3: Write the implementation**

(a) Reemplazar **todo** `src/app/(researcher)/validacion/PendienteDetalle.tsx` por:

```tsx
'use client';

/**
 * NUT-119 — Detalle de un alimento de la cola de validación: contexto de cada
 * ocurrencia (foto + bounding box, nombre IA vs final, respuestas, gramaje) y los
 * valores por 100 g en tres pestañas: IA (la estimación de Gemini), Del catálogo
 * (gramos reales de alimentos del catálogo sobre el peso de la foto) y A mano.
 * El borrador guarda la pestaña y la composición; el resultado y lo que se valida
 * salen de la pestaña activa. Validar / Descartar piden confirmación.
 */
import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import ComposicionCatalogo from './ComposicionCatalogo';
import { formatFechaCorta } from '@/lib/date';
import { macrosItem, macrosPlausibles, type Macros100 } from '@/lib/macros';
import {
  aComponentes,
  aEditables,
  resumirComposicion,
  restaurarComposicion,
  type ComponenteEditable,
  type ModoComposicion,
} from '@/lib/composicion';
import {
  descartarPendienteAction,
  getPendienteDetalleAction,
  modificarPendienteAction,
  validarPendienteAction,
  type OcurrenciaDetalle,
  type PendienteFila,
} from './actions';

interface Props {
  /** null = cerrado. */
  idPendiente: number | null;
  onClose: () => void;
  /** Se llama tras validar o descartar con éxito (la página refresca el listado). */
  onResuelto: () => void;
  /** Se llama tras guardar un borrador con éxito (la página refresca el listado). */
  onGuardado?: () => void;
}

interface Datos {
  pendiente: PendienteFila;
  ocurrencias: OcurrenciaDetalle[];
  totalOcurrencias: number;
}

/** Todo lo editable del detalle; se compara con el último estado guardado para el indicador de cambios. */
interface Form {
  modo: ModoComposicion;
  nombre: string;
  categoria: string;
  obs: string;
  kcal: string;
  prot: string;
  grasas: string;
  carbs: string;
  ingredientes: ComponenteEditable[];
  referencia: number | null;
}

const PESTANIAS: Array<{ modo: ModoComposicion; titulo: string; ayuda: string }> = [
  { modo: 'ia', titulo: 'IA', ayuda: 'Usa la estimación de Gemini tal cual. Elegila si te parece razonable.' },
  {
    modo: 'catalogo',
    titulo: 'Del catálogo',
    ayuda:
      'Tomá los valores de uno o más alimentos de SARA2 o ANMAT e indicá cuántos gramos de cada uno hay en la foto. Sirve para equivalencias ("esto es palta") y para compuestos ("aceite y vinagre").',
  },
  { modo: 'manual', titulo: 'A mano', ayuda: 'Cargá los cuatro valores vos.' },
];

const redondear1 = (n: number) => Math.round(n * 10) / 10;
const aNumero = (s: string): number | null => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));
const plural = (n: number) => `${n} ítem${n === 1 ? '' : 's'}`;
const texto = (n: number | null) => (n == null ? '' : String(n));

/** Estado inicial: el borrador guardado (con su pestaña y composición) o, si no hay, la estimación de Gemini. */
function formInicial(p: PendienteFila, ocurrencias: OcurrenciaDetalle[]): Form {
  const comp = restaurarComposicion(p.composicion);
  const hayGemini = p.gemini_kcal_100g != null;
  const modo: ModoComposicion = comp?.modo ?? (p.final_kcal_100g != null ? 'manual' : hayGemini ? 'ia' : 'manual');
  const refGuardada = comp?.id_guardado_item;
  return {
    modo,
    nombre: p.nombre_final ?? p.nombre_original,
    categoria: p.categoria_final ?? p.categoria_ia ?? '',
    obs: p.observaciones ?? '',
    kcal: texto(p.final_kcal_100g ?? p.gemini_kcal_100g),
    prot: texto(p.final_proteinas_100g ?? p.gemini_proteinas_100g),
    grasas: texto(p.final_grasas_100g ?? p.gemini_grasas_100g),
    carbs: texto(p.final_carbs_100g ?? p.gemini_carbs_100g),
    ingredientes: aEditables(comp?.componentes ?? []),
    referencia:
      refGuardada != null && ocurrencias.some((o) => o.idGuardadoItem === refGuardada)
        ? refGuardada
        : (ocurrencias[0]?.idGuardadoItem ?? null),
  };
}

/** Lo derivado del formulario: valores de cada pestaña y el resultado de la activa. */
function calcular(f: Form, p: PendienteFila, ocurrencias: OcurrenciaDetalle[]) {
  const ia: Macros100 | null =
    p.gemini_kcal_100g == null || p.gemini_proteinas_100g == null || p.gemini_grasas_100g == null || p.gemini_carbs_100g == null
      ? null
      : {
          kcal_100g: p.gemini_kcal_100g,
          proteinas_100g: p.gemini_proteinas_100g,
          grasas_100g: p.gemini_grasas_100g,
          carbs_100g: p.gemini_carbs_100g,
        };
  const [k, pr, g, c] = [f.kcal, f.prot, f.grasas, f.carbs].map(aNumero);
  const manual: Macros100 | null =
    k == null || pr == null || g == null || c == null
      ? null
      : { kcal_100g: k, proteinas_100g: pr, grasas_100g: g, carbs_100g: c };
  const { componentes, problemas } = aComponentes(f.ingredientes);
  const pesoFoto = ocurrencias.find((o) => o.idGuardadoItem === f.referencia)?.gramosFinal ?? 0;
  const resumen = resumirComposicion(componentes, pesoFoto);
  const macros =
    f.modo === 'ia' ? ia : f.modo === 'manual' ? manual : problemas.length === 0 ? resumen.macros : null;
  return { macros, componentes, problemas, pesoFoto, resumen };
}

function FotoOcurrencia({ o }: { o: OcurrenciaDetalle }) {
  if (!o.fotoUrl) {
    return (
      <div className="flex h-40 w-full items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-600 sm:w-40">
        Sin foto
      </div>
    );
  }
  return (
    <div className="relative h-40 w-full shrink-0 overflow-hidden rounded-xl bg-slate-900 sm:w-40">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={o.fotoUrl}
        alt={`Foto del plato de ${o.deportista ?? 'un deportista'}, ${formatFechaCorta(o.fecha)}`}
        className="h-full w-full object-cover"
      />
      {o.bbox && (
        <div
          data-testid="bbox"
          aria-hidden="true"
          className="pointer-events-none absolute rounded border-2 border-amber-400"
          style={{
            left: `${o.bbox.x * 100}%`,
            top: `${o.bbox.y * 100}%`,
            width: `${o.bbox.width * 100}%`,
            height: `${o.bbox.height * 100}%`,
          }}
        />
      )}
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{label}</p>
      {children}
    </div>
  );
}

function Plegable({
  titulo,
  abierto,
  onAlternar,
  children,
}: {
  titulo: string;
  abierto: boolean;
  onAlternar: () => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <button
        type="button"
        aria-expanded={abierto}
        onClick={onAlternar}
        className="flex w-full items-center gap-2 rounded py-1 text-left text-sm font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
      >
        <span aria-hidden="true">{abierto ? '▾' : '▸'}</span>
        {titulo}
      </button>
      {abierto && <div className="mt-2">{children}</div>}
    </section>
  );
}

export default function PendienteDetalle({ idPendiente, onClose, onResuelto, onGuardado }: Props) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  /** Serialización del último estado guardado (o cargado): si difiere del actual hay cambios sin guardar. */
  const [base, setBase] = useState('');
  const [abiertos, setAbiertos] = useState({ ocurrencias: true, preview: false, mas: false });

  const [confirmando, setConfirmando] = useState<'validar' | 'descartar' | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Carga del detalle cada vez que se abre otro alimento.
  useEffect(() => {
    if (idPendiente == null) return;
    let cancelado = false;
    setDatos(null);
    setForm(null);
    setErrorCarga(null);
    setConfirmando(null);
    setError(null);
    setAviso(null);
    setAbiertos({ ocurrencias: true, preview: false, mas: false });
    void getPendienteDetalleAction(idPendiente).then((r) => {
      if (cancelado) return;
      if ('error' in r) {
        setErrorCarga(r.error);
        return;
      }
      const inicial = formInicial(r.pendiente, r.ocurrencias);
      setDatos({ pendiente: r.pendiente, ocurrencias: r.ocurrencias, totalOcurrencias: r.totalOcurrencias });
      setForm(inicial);
      setBase(JSON.stringify(inicial));
    });
    return () => {
      cancelado = true;
    };
  }, [idPendiente]);

  const cambiar = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const alternar = (k: keyof typeof abiertos) => setAbiertos((a) => ({ ...a, [k]: !a[k] }));

  const p = datos?.pendiente;
  const calc = datos && form && p ? calcular(form, p, datos.ocurrencias) : null;
  const macros = calc?.macros ?? null;
  const incoherente = macros != null && !macrosPlausibles(macros);
  const soloLectura = p != null && p.estado !== 'pendiente';
  const sinGuardar = form != null && JSON.stringify(form) !== base;
  const total = datos?.totalOcurrencias ?? 0;
  const puedeResolver = !soloLectura && macros != null && (form?.nombre.trim() ?? '') !== '' && !trabajando;

  const argsForm = () => ({
    id: p!.id_pendiente,
    nombre: form!.nombre.trim(),
    categoria: form!.categoria.trim() || null,
    observaciones: form!.obs.trim() || null,
  });

  /** Valores que se mandan: lo tipeado en A mano; en las otras pestañas, el resultado (o null si todavía no hay). */
  const valores = () =>
    form!.modo === 'manual'
      ? { kcal: aNumero(form!.kcal), proteinas: aNumero(form!.prot), grasas: aNumero(form!.grasas), carbs: aNumero(form!.carbs) }
      : {
          kcal: macros?.kcal_100g ?? null,
          proteinas: macros?.proteinas_100g ?? null,
          grasas: macros?.grasas_100g ?? null,
          carbs: macros?.carbs_100g ?? null,
        };

  const composicion = () =>
    form!.modo === 'catalogo'
      ? {
          modo: 'catalogo' as const,
          id_guardado_item: form!.referencia,
          gramos_foto: calc!.pesoFoto > 0 ? calc!.pesoFoto : null,
          componentes: calc!.componentes,
        }
      : { modo: form!.modo, id_guardado_item: null, gramos_foto: null, componentes: [] };

  const guardarBorrador = async () => {
    if (form!.modo === 'catalogo' && calc!.problemas.length > 0) {
      setError(calc!.problemas[0]);
      return;
    }
    setTrabajando(true);
    setError(null);
    setAviso(null);
    const r = await modificarPendienteAction({ ...argsForm(), ...valores(), composicion: composicion() });
    setTrabajando(false);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    setBase(JSON.stringify(form));
    setAviso('Guardado hace un momento');
    onGuardado?.();
  };

  const validar = async () => {
    setTrabajando(true);
    setError(null);
    const r = await validarPendienteAction({ ...argsForm(), ...valores(), composicion: composicion() });
    setTrabajando(false);
    setConfirmando(null);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    onResuelto();
  };

  const descartar = async () => {
    setTrabajando(true);
    setError(null);
    const r = await descartarPendienteAction({ id: p!.id_pendiente, observaciones: form!.obs.trim() || null });
    setTrabajando(false);
    setConfirmando(null);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    onResuelto();
  };

  const pestaniaActiva = PESTANIAS.find((x) => x.modo === form?.modo);
  const vinculo = form?.modo === 'catalogo' && calc?.resumen.esVinculoPuro ? calc.componentes[0].nombre : null;

  return (
    <Modal open={idPendiente != null} onClose={onClose} title="Revisar alimento" wide>
      {errorCarga && <p className="text-sm text-red-600">{errorCarga}</p>}
      {!datos && !errorCarga && <p className="text-sm text-slate-600">Cargando…</p>}

      {datos && p && form && calc && (
        <div className="space-y-5">
          {soloLectura && (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
              Resuelto como <strong>{p.estado}</strong>
              {p.resuelto_at ? ` el ${formatFechaCorta(p.resuelto_at)}` : ''}. Solo lectura.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Input
              id="pv-nombre"
              label="Nombre"
              value={form.nombre}
              disabled={soloLectura}
              onChange={(e) => cambiar({ nombre: e.target.value })}
            />
            <section aria-label="Estimación original de Gemini" role="region" className="text-sm text-slate-700">
              {p.gemini_kcal_100g == null ? (
                <p>Gemini no pudo estimar este alimento: cargá los valores vos.</p>
              ) : (
                <p>
                  IA estimó (por 100 g): {p.gemini_kcal_100g} kcal · P {p.gemini_proteinas_100g} g · C {p.gemini_carbs_100g} g · G{' '}
                  {p.gemini_grasas_100g} g
                  {p.gemini_modelo ? <span className="text-slate-600"> · {p.gemini_modelo}</span> : null}
                </p>
              )}
            </section>
          </div>

          <Plegable
            titulo={`Dónde apareció (${total} ${total === 1 ? 'ocurrencia' : 'ocurrencias'})`}
            abierto={abiertos.ocurrencias}
            onAlternar={() => alternar('ocurrencias')}
          >
            <ul className="space-y-3">
              {datos.ocurrencias.map((o) => (
                <li key={o.idGuardadoItem} className="flex flex-col gap-3 rounded-xl border border-slate-100 p-3 sm:flex-row">
                  <FotoOcurrencia o={o} />
                  <div className="min-w-0 flex-1 space-y-2 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 text-slate-600">
                      <span className="font-medium text-slate-800">{o.deportista ?? 'Deportista'}</span>
                      <span>{formatFechaCorta(o.fecha)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Campo label="La IA detectó">
                        <span>{o.nombreIa ?? 'Agregado a mano'}</span>
                      </Campo>
                      <Campo label="Nombre final">
                        <span>{o.nombreFinal}</span>
                      </Campo>
                    </div>
                    <p className="text-slate-600">
                      IA: {o.gramosIa != null ? `${redondear1(o.gramosIa)} g` : '—'} · final: {redondear1(o.gramosFinal)} g
                    </p>
                    {o.respuestas.length > 0 && (
                      <ul className="space-y-0.5 text-xs text-slate-600">
                        {o.respuestas.map((r, i) => (
                          <li key={i}>
                            <span>{r.question}</span> → <span className="font-medium text-slate-700">{r.answer ?? 'No sé'}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {total > datos.ocurrencias.length && (
              <p className="mt-2 text-xs text-slate-600">y {total - datos.ocurrencias.length} más</p>
            )}
          </Plegable>

          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Valores por 100 g</h3>
              <div role="tablist" aria-label="Origen de los valores" className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
                {PESTANIAS.map((t) => (
                  <button
                    key={t.modo}
                    type="button"
                    role="tab"
                    id={`pv-tab-${t.modo}`}
                    aria-selected={form.modo === t.modo}
                    aria-controls="pv-panel"
                    onClick={() => cambiar({ modo: t.modo })}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${
                      form.modo === t.modo ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-700 hover:bg-white/60'
                    }`}
                  >
                    {t.titulo}
                  </button>
                ))}
              </div>

              <div id="pv-panel" role="tabpanel" aria-labelledby={`pv-tab-${form.modo}`} className="space-y-3">
                <p className="text-sm text-slate-700">{pestaniaActiva?.ayuda}</p>
                {form.modo === 'ia' && (
                  <p className="text-sm text-slate-800">
                    {calc.macros
                      ? 'Se usan los valores estimados por Gemini (arriba).'
                      : 'Gemini no estimó este alimento: usá "Del catálogo" o "A mano".'}
                  </p>
                )}
                {form.modo === 'catalogo' && (
                  <ComposicionCatalogo
                    ocurrencias={datos.ocurrencias}
                    referencia={form.referencia}
                    onReferencia={(referencia) => cambiar({ referencia })}
                    ingredientes={form.ingredientes}
                    onIngredientes={(ingredientes) => cambiar({ ingredientes })}
                    soloLectura={soloLectura}
                  />
                )}
                {form.modo === 'manual' && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Input id="pv-kcal" label="kcal / 100 g" type="number" min={0} step="0.1" value={form.kcal} disabled={soloLectura} onChange={(e) => cambiar({ kcal: e.target.value })} />
                    <Input id="pv-prot" label="Proteínas (g / 100 g)" type="number" min={0} step="0.1" value={form.prot} disabled={soloLectura} onChange={(e) => cambiar({ prot: e.target.value })} />
                    <Input id="pv-grasas" label="Grasas (g / 100 g)" type="number" min={0} step="0.1" value={form.grasas} disabled={soloLectura} onChange={(e) => cambiar({ grasas: e.target.value })} />
                    <Input id="pv-carbs" label="Carbohidratos (g / 100 g)" type="number" min={0} step="0.1" value={form.carbs} disabled={soloLectura} onChange={(e) => cambiar({ carbs: e.target.value })} />
                  </div>
                )}
              </div>
            </div>

            <div role="region" aria-label="Resultado por 100 g" className="rounded-xl bg-slate-50 p-3 text-sm">
              {macros ? (
                <p className="font-medium text-slate-900">
                  Resultado por 100 g: {redondear1(macros.kcal_100g)} kcal · P {redondear1(macros.proteinas_100g)} g · C{' '}
                  {redondear1(macros.carbs_100g)} g · G {redondear1(macros.grasas_100g)} g
                </p>
              ) : (
                <p className="text-slate-700">Completá los valores de esta pestaña para ver el resultado.</p>
              )}
            </div>

            {incoherente && (
              <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                Estos valores no parecen coherentes (las kcal no cierran con 4/4/9 o algún macro es excesivo). Podés
                validarlos igual: la decisión es tuya.
              </p>
            )}

            <Plegable titulo="Cómo queda en cada ocurrencia" abierto={abiertos.preview} onAlternar={() => alternar('preview')}>
              <section aria-label="Vista previa por ocurrencia" role="region" className="rounded-xl bg-slate-50 p-3 text-sm">
                {macros ? (
                  <ul className="space-y-0.5 text-slate-700">
                    {datos.ocurrencias.map((o) => {
                      const m = macrosItem(macros, o.gramosFinal);
                      return (
                        <li key={o.idGuardadoItem}>
                          {o.deportista ?? 'Deportista'} · {redondear1(o.gramosFinal)} g → {redondear1(m.kcal)} kcal · P{' '}
                          {redondear1(m.proteinas_g)} · C {redondear1(m.carbs_g)} · G {redondear1(m.grasas_g)}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-slate-700">Completá los valores para ver la vista previa.</p>
                )}
              </section>
            </Plegable>

            <Plegable titulo="Más datos (categoría y observaciones)" abierto={abiertos.mas} onAlternar={() => alternar('mas')}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input id="pv-categoria" label="Categoría" value={form.categoria} disabled={soloLectura} onChange={(e) => cambiar({ categoria: e.target.value })} />
                <Input id="pv-obs" label="Observaciones" value={form.obs} disabled={soloLectura} onChange={(e) => cambiar({ obs: e.target.value })} />
              </div>
            </Plegable>

            <div aria-live="polite" className="min-h-5 text-sm">
              {error && (
                <p role="alert" className="text-red-600">
                  {error}
                </p>
              )}
              {aviso && !sinGuardar && <p role="status" className="text-emerald-700">{aviso}</p>}
            </div>

            {confirmando && (
              <div role="alertdialog" aria-label="Confirmar acción" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
                {confirmando === 'validar' ? (
                  <p>
                    Se actualizarán <strong>{plural(total)}</strong> del diario con estos valores
                    {vinculo ? ` (vinculado a ${vinculo})` : ''}, recalculados según el gramaje de cada uno.
                  </p>
                ) : (
                  <p>
                    <strong>{plural(total)}</strong> quedarán marcados como descartados. Los ítems no se borran: se
                    conservan con su nombre y gramos, pero sin kcal ni macros.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    loading={trabajando}
                    onClick={() => (confirmando === 'validar' ? void validar() : void descartar())}
                  >
                    Confirmar
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmando(null)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            {!soloLectura && !confirmando && (
              <div className="flex flex-wrap items-center gap-2">
                {sinGuardar && (
                  <p role="status" className="mr-auto text-sm font-medium text-amber-700">
                    ● Cambios sin guardar
                  </p>
                )}
                <Button type="button" variant="outline" disabled={trabajando} onClick={() => void guardarBorrador()}>
                  Guardar borrador
                </Button>
                <Button type="button" disabled={!puedeResolver} onClick={() => setConfirmando('validar')}>
                  Validar
                </Button>
                <Button type="button" variant="ghost" disabled={trabajando} onClick={() => setConfirmando('descartar')}>
                  Descartar
                </Button>
              </div>
            )}
          </form>
        </div>
      )}
    </Modal>
  );
}
```

(b) Borrar `src/app/(researcher)/validacion/MezclaCatalogo.tsx`:

```bash
git rm "src/app/(researcher)/validacion/MezclaCatalogo.tsx"
```

(c) En `src/app/(researcher)/validacion/ValidacionClient.tsx`, en el montaje de `<PendienteDetalle … />` agregar, después de `onClose={() => setAbierto(null)}`:

```tsx
        onGuardado={() => router.refresh()}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run testing/PendienteDetalle.test.tsx testing/ValidacionClient.test.tsx && npx tsc --noEmit`
Expected: PASS y `tsc` limpio. Si `ValidacionClient.test.tsx` busca el campo `Nombre` del detalle, sigue existiendo (`pv-nombre`).

- [ ] **Step 5: Commit**

```bash
git add -A "src/app/(researcher)/validacion" testing/PendienteDetalle.test.tsx
git commit -m "feat: detalle de validación con pestañas IA / Del catálogo / A mano, plegables y borrador que restaura la composición

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 7: Documentación y verificación completa

**Files:**
- Modify: los documentos que ya listan las migraciones de NUT-119 (buscar con `grep -rn "016_validados_fuera_del_catalogo" --include=*.md .` y agregar la 017 con el mismo formato).
- Modify: `docs/superpowers/specs/2026-10-13-validacion-composicion-y-alimentos-propios-design.md` (marcar la Fase A como implementada).

**Interfaces:** ninguna.

- [ ] **Step 1: Documentar la migración**

Ejecutar `grep -rn "016_validados_fuera_del_catalogo" --include=*.md .` y, en cada documento que la nombra, agregar a continuación una línea para `017_composicion_validacion_nut119.sql` con el mismo formato: "Columna `composicion`; `pendiente_modificar`/`pendiente_validar` reciben `p_composicion` y recalculan en el servidor los valores por 100 g con los gramos reales de la foto; vistas con `composicion`. Correr **antes** de desplegar la UI."

En el spec, en el título de la sección de la Fase A (o al inicio del §4), agregar la línea: `> Estado: Fase A implementada (plan `docs/superpowers/plans/2026-10-14-validacion-composicion-fase-a.md`). Fase B pendiente.`

- [ ] **Step 2: Verificación completa**

```bash
npx tsc --noEmit
npx vitest run
npm run build
```

Expected: `tsc` sin salida; todos los tests verdes (los proyectos node y jsdom); `next build` termina bien. Correr también `node m017.mjs` (Task 3, Step 4) una vez más sobre el árbol final → `TODO OK`.

- [ ] **Step 3: Revisión del Review Focus**

Confirmar con los tests ya escritos, línea por línea: (1) `ocurrencia de OTRO alimento pendiente rechazada` y `gramos_foto lo fija el servidor` (m017); (2) `ingrediente sin datos nutricionales` (m017) y `Misterio no tiene datos nutricionales` (Tasks 5 y 6); (3) `un borrador viejo sin composición … abre en A mano` (Task 6); (4) `falta`/`sobra` (Task 5); (5) `cambiar de pestaña no pierde lo cargado` y `indica los cambios sin guardar` (Task 6); (6) `recién abierta (sin ingredientes) se puede guardar` (Tasks 3 y 6).

- [ ] **Step 4: Commit**

```bash
git add -A docs README.md 2>/dev/null; git add -A
git commit -m "docs: migración 017 y estado de la Fase A de validación con composición

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Publicar (requiere autorización)**

La rama `feat-nut119-matching-macros-validacion` ya está publicada. El `git push` de estos commits lo autoriza la persona dueña del repo; no se hace sin pedirlo. Antes del push (o del despliegue) hay que correr en Supabase, en este orden: `015`, `016` (si falta) y `017`.

---

## Fuera de esta fase (plan aparte, decisión D1)

Fase B del spec: tabla `alimentos_propios`, verificación de campos y evaluación breve, "Retirar", vista `v_alimentos_propios`, etiqueta "PROPIO" en el buscador de "Del catálogo" y el formulario de creación en la pestaña "A mano" (migración 018). Se planifica cuando la Fase A esté mergeada, con el código real a la vista. Decisiones ya tomadas (D2–D4): evaluación del autor con verificación + breve y "Retirar" auditable (sin segundo aprobador), los propios **no** entran al matching automático de la IA, y sólo se crean desde "A mano".
