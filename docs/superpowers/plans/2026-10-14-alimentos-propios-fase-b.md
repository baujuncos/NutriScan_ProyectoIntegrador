# Alimentos propios (catálogo propio) — Fase B — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Dentro de cada tarea aplicar superpowers:test-driven-development (test que falla → implementación → verde → commit).

**Goal:** Que el investigador, desde la pestaña "A mano", pueda crear un alimento propio reutilizable (tabla nueva `alimentos_propios`) después de una verificación automática de campos y una evaluación breve, usarlo como ingrediente en "Del catálogo" (etiqueta PROPIO) y retirarlo con motivo auditado.

**Architecture:** Una tabla nueva sin escritura directa; toda alta/baja pasa por RPCs `security definer` que verifican en el servidor (la interfaz sólo previsualiza). Crear un propio es la misma transacción que validar el pendiente (`pendiente_validar_como_propio` llama a `pendiente_validar` de la Fase A). La composición ya existente admite ingredientes `origen: 'propio'`. Los propios NO entran al matching automático de la IA (D3).

**Tech Stack:** Next.js 16 (server actions), React 19, Supabase (Postgres + RLS + RPCs, `pg_trgm`), zod, vitest + Testing Library, PGlite (sólo para verificar el SQL, fuera del repo).

**Spec:** `docs/superpowers/specs/2026-10-13-validacion-composicion-y-alimentos-propios-design.md` (§6 = esta fase). Decisiones ya tomadas: D1 (fases separadas), D2 (el autor evalúa + "Retirar" auditable, sin segundo aprobador), D3 (los propios no entran al matching de la IA), D4 (se crean sólo desde "A mano"). La migración es la **019** (la 018 es la de la foto de referencia).

## Global Constraints

- **Nadie escribe directo** en `alimentos_propios`: sin `insert/update/delete` para `authenticated`; sólo las RPCs definer. Sólo investigadores/administradores leen (RLS). (Spec §6.1)
- **El servidor es la autoridad:** repite todas las verificaciones de §6.2; la interfaz sólo las previsualiza para guiar. Si falla cualquier verificación no se valida nada ni se crea nada (una sola transacción). (Spec §6.3)
- **Reglas de §6.2:** bloquean — nombre vacío, 4 valores ≥ 0 obligatorios, cada macro ≤ 100 g, proteínas + grasas + carbs ≤ 105 g, kcal ≤ 900, nombre idéntico (normalizado) a una entrada de `alimentos` o a un propio `activo`. Advierten y exigen confirmación explícita — kcal incoherentes con 4/4/9 (tolerancia `max(25 kcal, 35 %)`), nombre con similitud trigram ≥ 0,85 a SARA2 o a un propio `activo`.
- **Evaluación breve (obligatoria):** fuente del dato (`etiqueta_producto` · `tabla_composicion` · `calculo_propio` · `estimacion_ia_revisada` · `otra`), justificación ≥ 10 caracteres y las tres confirmaciones (`revise_fuente`, `valores_por_100g`, `busque_existente`); todo queda en la auditoría.
- **Retirar:** motivo obligatorio (≥ 10 caracteres), auditado; deja el propio `retirado` (deja de aparecer en el buscador y de bloquear el nombre); no borra nada ni cambia ítems ya validados.
- **Los propios no entran al matching automático** (`match_alimentos` no se toca).
- **Sin dependencias npm nuevas.**
- **Convenciones del repo:** comentarios en español; ticket `NUT-119` en el header de archivos nuevos; migración idempotente en `supabase/019_alimentos_propios_nut119.sql` **y** la misma sección al final de `supabase/schema_consolidado.sql` (CRLF); errores de server actions como `{ error: string }`.
- **Contraste AA:** texto `slate-600` o más oscuro; avisos `amber-700` sobre `amber-50`; errores `red-700`.
- **Archivos largos:** usar Write/Edit, no heredocs del shell.
- **Antes de cada commit:** `npx vitest run` y `npx tsc --noEmit` limpios. Commits terminan con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Modelo por tarea:** Sonnet 5.5 esfuerzo Alto por defecto; **Opus 5.5 sólo en la Task 2** (migración con RLS y RPCs definer).

## Review Focus

Lo que el spec implica y las pruebas "felices" no cubren; cada línea tiene su test en la tarea indicada.

1. **Escritura directa o lectura de un deportista** (insert/update desde la sesión, o un deportista leyendo propios o llamando a las RPC). → Task 2 (SQL).
2. **Falla a mitad de camino** (duplicado, advertencia sin confirmar, evaluación incompleta): el pendiente tiene que seguir `pendiente`, sin propio creado ni ítems tocados. → Task 2.
3. **Dos investigadores crean el mismo nombre a la vez / desde otro pendiente:** el índice único parcial lo frena con un error claro (no un 500). → Task 2.
4. **Propio retirado que sigue en un borrador:** al guardar/validar con ese ingrediente el servidor lo rechaza con un mensaje que se entiende, y el nombre queda libre para crearlo de nuevo. → Tasks 2 y 5.
5. **Mismo `id` en `alimentos` y en `alimentos_propios`** (espacios de ids distintos): la composición los distingue por `origen`; agregar los dos no los confunde. → Tasks 3 y 4.
6. **Pedir "agregar al catálogo propio" y cambiar de pestaña / editar valores después de verificar:** la verificación vuelve a correr y no deja validar con una vieja. → Task 5.
7. **El buscador de propios no debe verse en el diario de los deportistas** (`searchAlimentosAction` no se toca). → Task 4.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/lib/macros.ts` (modifica) | Exporta `kcalCoherentes` (la usa `macrosPlausibles` y la verificación) |
| `src/lib/verificacionAlimento.ts` (nuevo) | Reglas de §6.2 que no necesitan la base, códigos, mensajes y lista de fuentes del dato |
| `supabase/019_alimentos_propios_nut119.sql` (nuevo) + sección en `schema_consolidado.sql` | Tabla, RLS, vista, `propio_verificar`, `pendiente_validar_como_propio`, `propio_retirar`, `calcular_composicion` con `origen: 'propio'`, vistas con `id_alimento_propio` |
| `src/lib/composicion.ts` (modifica) | `origen: 'catalogo' \| 'propio'` en el esquema y en los ingredientes editables |
| `src/app/(researcher)/validacion/actions.ts` (modifica) | `verificarAlimentoPropioAction`, `validarComoPropioAction`, `retirarAlimentoPropioAction`, `buscarAlimentosPropiosAction`, `propio` en el detalle |
| `src/app/(researcher)/validacion/ComposicionCatalogo.tsx` (modifica) | El buscador incluye los propios (etiqueta PROPIO); los ingredientes se distinguen por origen |
| `src/app/(researcher)/validacion/NuevoAlimentoPropio.tsx` (nuevo) | Casilla, fuente, justificación, confirmaciones y verificación en vivo |
| `src/app/(researcher)/validacion/PendienteDetalle.tsx` (modifica) | Integra la creación en "A mano" y el "Retirar" en el detalle de sólo lectura |
| `testing/*` | Un archivo de test por unidad |

---

## Task 1: `kcalCoherentes` y `verificacionAlimento.ts` (reglas sin base)

**Files:**
- Modify: `src/lib/macros.ts`
- Create: `src/lib/verificacionAlimento.ts`
- Test: `testing/verificacionAlimento.test.ts` (nuevo); el comportamiento de `macrosPlausibles` ya está cubierto por `testing/macros.test.ts` (no debe cambiar)

**Interfaces:**
- Produces (macros.ts): `export function kcalCoherentes(m: Macros100): boolean` — `|kcal − (4P + 4C + 9G)| ≤ max(25, 0,35 × kcal)`.
- Produces (verificacionAlimento.ts):
  ```ts
  export const JUSTIFICACION_MIN = 10
  export const MOTIVO_RETIRO_MIN = 10
  export const FUENTES_DATO: ReadonlyArray<{ valor: FuenteDato; etiqueta: string }>
  export type FuenteDato = 'etiqueta_producto' | 'tabla_composicion' | 'calculo_propio' | 'estimacion_ia_revisada' | 'otra'
  export type CodigoBloqueo = 'NOMBRE_VACIO' | 'VALORES_INVALIDOS' | 'MACRO_MAYOR_100' | 'SUMA_MACROS' | 'KCAL_MAYOR_900' | 'DUPLICADO'
  export type CodigoAdvertencia = 'KCAL_INCOHERENTE' | 'SIMILAR'
  export const MENSAJE_BLOQUEO: Record<CodigoBloqueo, string>
  export const MENSAJE_ADVERTENCIA: Record<CodigoAdvertencia, string>
  export interface ValoresPropio { kcal: number | null; proteinas: number | null; grasas: number | null; carbs: number | null }
  export function verificarValores(nombre: string, v: ValoresPropio): { bloqueos: CodigoBloqueo[]; advertencias: CodigoAdvertencia[] }
  ```

- [ ] **Step 1: Write the failing test**

Crear `testing/verificacionAlimento.test.ts`:

```ts
/**
 * NUT-119 — Reglas de §6.2 que no necesitan la base (el servidor repite todas).
 */
import { describe, expect, it } from 'vitest';
import { kcalCoherentes } from '@/lib/macros';
import { FUENTES_DATO, MENSAJE_ADVERTENCIA, MENSAJE_BLOQUEO, verificarValores } from '@/lib/verificacionAlimento';

const OK = { kcal: 165, proteinas: 31, grasas: 3.6, carbs: 0 };

describe('kcalCoherentes', () => {
  it('pollo (165 kcal, 31/3,6/0) es coherente', () => {
    expect(kcalCoherentes({ kcal_100g: 165, proteinas_100g: 31, grasas_100g: 3.6, carbs_100g: 0 })).toBe(true);
  });
  it('800 kcal con 5 g de proteína no lo es', () => {
    expect(kcalCoherentes({ kcal_100g: 800, proteinas_100g: 5, grasas_100g: 0, carbs_100g: 0 })).toBe(false);
  });
  it('tolera hasta 25 kcal de diferencia en valores bajos (y no más)', () => {
    expect(kcalCoherentes({ kcal_100g: 29, proteinas_100g: 0, grasas_100g: 0, carbs_100g: 1 })).toBe(true); // |29 − 4| = 25
    expect(kcalCoherentes({ kcal_100g: 30, proteinas_100g: 0, grasas_100g: 0, carbs_100g: 1 })).toBe(false); // |30 − 4| = 26
  });
});

describe('verificarValores', () => {
  it('valores razonables: sin bloqueos ni advertencias', () => {
    expect(verificarValores('Pollo grillado', OK)).toEqual({ bloqueos: [], advertencias: [] });
  });

  it('nombre vacío o de espacios bloquea', () => {
    expect(verificarValores('   ', OK).bloqueos).toContain('NOMBRE_VACIO');
  });

  it.each([
    ['falta un valor', { ...OK, grasas: null }],
    ['valor negativo', { ...OK, carbs: -1 }],
    ['NaN', { ...OK, kcal: Number.NaN }],
  ])('%s bloquea como valores inválidos (y no sigue con el resto)', (_n, v) => {
    expect(verificarValores('Algo', v)).toEqual({ bloqueos: ['VALORES_INVALIDOS'], advertencias: [] });
  });

  it('un macro mayor a 100 g bloquea', () => {
    expect(verificarValores('Algo', { kcal: 500, proteinas: 101, grasas: 0, carbs: 0 }).bloqueos).toContain('MACRO_MAYOR_100');
  });

  it('proteínas + grasas + carbs mayor a 105 g bloquea', () => {
    const r = verificarValores('Algo', { kcal: 800, proteinas: 40, grasas: 40, carbs: 30 });
    expect(r.bloqueos).toContain('SUMA_MACROS');
    expect(r.bloqueos).not.toContain('MACRO_MAYOR_100');
  });

  it('exactamente 105 g y 900 kcal NO bloquean (los límites son inclusivos)', () => {
    const r = verificarValores('Algo', { kcal: 900, proteinas: 35, grasas: 35, carbs: 35 });
    expect(r.bloqueos).toEqual([]);
  });

  it('más de 900 kcal bloquea', () => {
    expect(verificarValores('Algo', { kcal: 901, proteinas: 0, grasas: 100, carbs: 0 }).bloqueos).toContain('KCAL_MAYOR_900');
  });

  it('kcal incoherentes con 4/4/9 advierten (no bloquean)', () => {
    const r = verificarValores('Algo', { kcal: 800, proteinas: 5, grasas: 0, carbs: 0 });
    expect(r.bloqueos).toEqual([]);
    expect(r.advertencias).toEqual(['KCAL_INCOHERENTE']);
  });
});

describe('textos y fuentes', () => {
  it('hay un mensaje para cada código y las 5 fuentes del spec', () => {
    expect(Object.keys(MENSAJE_BLOQUEO).sort()).toEqual(
      ['DUPLICADO', 'KCAL_MAYOR_900', 'MACRO_MAYOR_100', 'NOMBRE_VACIO', 'SUMA_MACROS', 'VALORES_INVALIDOS'],
    );
    expect(Object.keys(MENSAJE_ADVERTENCIA).sort()).toEqual(['KCAL_INCOHERENTE', 'SIMILAR']);
    expect(FUENTES_DATO.map((f) => f.valor)).toEqual([
      'etiqueta_producto', 'tabla_composicion', 'calculo_propio', 'estimacion_ia_revisada', 'otra',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run testing/verificacionAlimento.test.ts`
Expected: FAIL (no existen `kcalCoherentes` ni `@/lib/verificacionAlimento`).

- [ ] **Step 3: Write minimal implementation**

En `src/lib/macros.ts`, reemplazar las dos últimas líneas del cuerpo de `macrosPlausibles` (`const calculado = 4 * p + 4 * c + 9 * g;` y `return Math.abs(kcal - calculado) <= Math.max(25, 0.35 * kcal);`) por `return kcalCoherentes(m);` y agregar **justo antes** del comentario `/** ¿Son creíbles estos valores…` de `macrosPlausibles`:

```ts
/** kcal coherentes con 4/4/9: |kcal − (4P + 4C + 9G)| ≤ max(25, 35 % de las kcal). */
export function kcalCoherentes(m: Macros100): boolean {
  const calculado = 4 * m.proteinas_100g + 4 * m.carbs_100g + 9 * m.grasas_100g;
  return Math.abs(m.kcal_100g - calculado) <= Math.max(25, 0.35 * m.kcal_100g);
}
```

Crear `src/lib/verificacionAlimento.ts`:

```ts
/**
 * NUT-119 — Verificación de los valores de un alimento propio (spec §6.2): lo que se
 * puede revisar sin la base (rangos y coherencia). El servidor repite TODO y además
 * revisa duplicados y nombres parecidos contra el catálogo (RPC `propio_verificar`).
 */
import { kcalCoherentes } from './macros';

export const JUSTIFICACION_MIN = 10;
export const MOTIVO_RETIRO_MIN = 10;

export type FuenteDato =
  | 'etiqueta_producto'
  | 'tabla_composicion'
  | 'calculo_propio'
  | 'estimacion_ia_revisada'
  | 'otra';

export const FUENTES_DATO: ReadonlyArray<{ valor: FuenteDato; etiqueta: string }> = [
  { valor: 'etiqueta_producto', etiqueta: 'Etiqueta del producto' },
  { valor: 'tabla_composicion', etiqueta: 'Tabla de composición' },
  { valor: 'calculo_propio', etiqueta: 'Cálculo propio' },
  { valor: 'estimacion_ia_revisada', etiqueta: 'Estimación de la IA revisada' },
  { valor: 'otra', etiqueta: 'Otra' },
];

export type CodigoBloqueo =
  | 'NOMBRE_VACIO'
  | 'VALORES_INVALIDOS'
  | 'MACRO_MAYOR_100'
  | 'SUMA_MACROS'
  | 'KCAL_MAYOR_900'
  | 'DUPLICADO';
export type CodigoAdvertencia = 'KCAL_INCOHERENTE' | 'SIMILAR';

export const MENSAJE_BLOQUEO: Record<CodigoBloqueo, string> = {
  NOMBRE_VACIO: 'Ingresá el nombre del alimento.',
  VALORES_INVALIDOS: 'Los cuatro valores por 100 g son obligatorios y no pueden ser negativos.',
  MACRO_MAYOR_100: 'Un macronutriente no puede superar los 100 g por cada 100 g de alimento.',
  SUMA_MACROS: 'Proteínas + grasas + carbohidratos no pueden superar los 105 g por cada 100 g.',
  KCAL_MAYOR_900: 'Las kcal no pueden superar las 900 por cada 100 g.',
  DUPLICADO: 'Ya existe un alimento con ese nombre. Usalo desde "Del catálogo".',
};

export const MENSAJE_ADVERTENCIA: Record<CodigoAdvertencia, string> = {
  KCAL_INCOHERENTE:
    'Las kcal no cierran con 4 kcal/g de proteínas y carbohidratos y 9 kcal/g de grasas. Si el valor es correcto, explicalo en la justificación y confirmalo.',
  SIMILAR: 'Hay alimentos con un nombre muy parecido. Confirmá que el tuyo es distinto.',
};

export interface ValoresPropio {
  kcal: number | null;
  proteinas: number | null;
  grasas: number | null;
  carbs: number | null;
}

export function verificarValores(
  nombre: string,
  v: ValoresPropio,
): { bloqueos: CodigoBloqueo[]; advertencias: CodigoAdvertencia[] } {
  const bloqueos: CodigoBloqueo[] = [];
  const advertencias: CodigoAdvertencia[] = [];
  if (nombre.trim() === '') bloqueos.push('NOMBRE_VACIO');

  const valores = [v.kcal, v.proteinas, v.grasas, v.carbs];
  if (valores.some((x) => x == null || !Number.isFinite(x) || x < 0)) {
    bloqueos.push('VALORES_INVALIDOS');
    return { bloqueos, advertencias };
  }
  const [kcal, proteinas, grasas, carbs] = valores as number[];
  if (Math.max(proteinas, grasas, carbs) > 100) bloqueos.push('MACRO_MAYOR_100');
  if (proteinas + grasas + carbs > 105) bloqueos.push('SUMA_MACROS');
  if (kcal > 900) bloqueos.push('KCAL_MAYOR_900');
  if (!kcalCoherentes({ kcal_100g: kcal, proteinas_100g: proteinas, grasas_100g: grasas, carbs_100g: carbs })) {
    advertencias.push('KCAL_INCOHERENTE');
  }
  return { bloqueos, advertencias };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run testing/verificacionAlimento.test.ts testing/macros.test.ts && npx tsc --noEmit`
Expected: PASS; `tsc` limpio.

- [ ] **Step 5: Commit**

```bash
git add src/lib/macros.ts src/lib/verificacionAlimento.ts testing/verificacionAlimento.test.ts
git commit -m "feat: reglas de verificación de un alimento propio (sin base) y kcalCoherentes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Migración 019 — `alimentos_propios`, RPCs y composición con ingredientes propios (Opus 5.5)

**Files:**
- Create: `supabase/019_alimentos_propios_nut119.sql`
- Modify: `supabase/schema_consolidado.sql` (misma sección al final, contenido idéntico, CRLF)
- Verify (fuera del repo): arnés PGlite del scratchpad (`m019.mjs`)

**Interfaces:**
- Consumes: `alimentos`, `alimentos_pendientes_validacion`, `alimentos_pendientes_auditoria`, `detecciones_guardados_items`, `norm_alimento()`, `get_my_role()`, `pendiente_validar(...)` (017), `calcular_composicion` (018), `extensions.similarity` (pg_trgm).
- Produces (SQL):
  - Tabla `public.alimentos_propios` (columnas de §6.1; `id_alimento_propio bigserial`; `estado` ∈ `activo|retirado`; índice único parcial sobre `nombre_normalizado` donde `estado = 'activo'`).
  - Columna `alimentos_pendientes_validacion.id_alimento_propio bigint references alimentos_propios`.
  - Acciones de auditoría nuevas: `crear_propio`, `retirar_propio`.
  - `public.propio_verificar(p_nombre text, p_kcal numeric, p_prot numeric, p_grasas numeric, p_carbs numeric) returns jsonb` → `{ "bloqueos": [{ "codigo": "...", "existente": { "origen": "catalogo|propio", "id": n, "nombre": "...", "fuente": "..." } }], "advertencias": [{ "codigo": "KCAL_INCOHERENTE" } | { "codigo": "SIMILAR", "similares": [{ "origen", "id", "nombre", "fuente", "similitud" }] }] }`. Grant a `authenticated` (chequea el rol adentro).
  - `public.pendiente_validar_como_propio(p_id bigint, p_nombre text, p_categoria text, p_kcal numeric, p_prot numeric, p_grasas numeric, p_carbs numeric, p_observaciones text, p_propio jsonb) returns jsonb` → `{ "id_alimento_propio": n, "items_afectados": n }`. `p_propio` = `{ "fuente_dato": "...", "justificacion": "...", "confirmaciones": { "revise_fuente": true, "valores_por_100g": true, "busque_existente": true }, "confirma_incoherente": bool, "confirma_distinto": bool }`.
  - `public.propio_retirar(p_id bigint, p_motivo text) returns void`.
  - Errores nuevos: `PROPIO_BLOQUEADO` (detail = JSON de bloqueos), `PROPIO_ADVERTENCIA` (detail = `KCAL_INCOHERENTE` o `SIMILAR`), `PROPIO_EVALUACION` (detail = `fuente` | `justificacion` | `confirmaciones`), `PROPIO_DUPLICADO` (carrera con otro alta), y los existentes `FORBIDDEN`, `NOT_FOUND`, `ESTADO_INVALIDO`.
  - `calcular_composicion` acepta ingredientes con `"origen": "propio"` (lee de `alimentos_propios` con `estado = 'activo'`; un propio nunca es "vínculo puro").
  - Vista `public.v_alimentos_propios` (`security_invoker`): columnas de la tabla + `usos_como_ingrediente`. Vistas `v_alimentos_pendientes` y `v_alimentos_validados` recreadas con `id_alimento_propio`.

- [ ] **Step 1: Write the failing verification script**

Crear en el scratchpad `pgl/m019_body.mjs` (usa los helpers `q1`, `ok`, `expectErr`, `db`, `readFileSync`, `REPO`, `fails` que define la cabecera del arnés de las migraciones anteriores, igual que `m018_body.mjs`):

```js
console.log('consolidado aplicado (incluye 013 a 019)');
for (const f of ['017_composicion_validacion_nut119.sql', '018_foto_referencia_primera_nut119.sql', '019_alimentos_propios_nut119.sql']) {
  const sql = readFileSync(REPO + f, 'utf8');
  await db.exec(sql); console.log(f + ' corrida 2 OK');
  if (f.startsWith('019')) { await db.exec(sql); console.log(f + ' corrida 3 OK'); }
}

const DEP = '11111111-1111-1111-1111-111111111111', INV = '33333333-3333-3333-3333-333333333333', INV2 = '44444444-4444-4444-4444-444444444444';
const asUser = (uid) => `set role authenticated; set request.jwt.claims = '{"sub":"${uid}","email":"x@x.com"}';`;
await db.exec(`
insert into auth.users values ('${DEP}'),('${INV}'),('${INV2}');
insert into public.profiles (user_id,nombre,apellido,email,role) values
 ('${DEP}','d','d','d@ucc.edu.ar','deportista_ucc'),('${INV}','i','i','i@x.com','investigador'),('${INV2}','j','j','j@x.com','investigador');
insert into public.alimentos (id_alimento,nombre,fuente,kcal_100g,proteinas_100g,grasas_100g,carbs_100g) values
 (1,'Pollo a la plancha','SARA2',165,31,3.6,0),
 (31,'Aceite de oliva','SARA2',800,0,90,0),
 (1000900,'Huevo','ANMAT',540,7,30,56);
insert into public.detecciones_ia (id_usuario,prompt_version,modelo,vajilla_tipo,vajilla_diametro_cm,angulo_captura_grados,total_estimated_weight_grams)
 select '${DEP}','v','m','plato_playo',26,45,300 from generate_series(1,6);
`);

const base = { source_item_uuid: null, category: 'cat', ai_grams: null, origin: 'added_manually', answers: [], food_ref: null, score_match: null };
const ia = (k) => ({ kcal_100g: k, proteinas_100g: 1, grasas_100g: 1, carbs_100g: 1 });
const reg = (n, nombre, grams) => q1(`set role service_role; select public.registrar_guardado_deteccion('${DEP}',${n},'2026-10-07','cena','{}','${JSON.stringify([{ ...base, name: nombre, grams, id_alimento: null, metodo_match: 'gemini', ia: ia(70) }])}'::jsonb,'m','v') r;`);
await reg(1, 'Pan casero', 50); await reg(2, 'Dulce raro', 30); await reg(3, 'Salsa verde', 20); await reg(4, 'Pan casero', 80); await reg(5, 'Mix de semillas', 25); await reg(6, 'Crema rara', 40);
await db.exec('reset role;');
const pid = async (n) => (await q1(`select id_pendiente from public.alimentos_pendientes_validacion where nombre_normalizado='${n}'`))[0].id_pendiente;
const PAN = await pid('pan casero'), DULCE = await pid('dulce raro'), SALSA = await pid('salsa verde'), MIX = await pid('mix de semillas'), CREMA = await pid('crema rara');
const propio = (extra = {}) => JSON.stringify({ fuente_dato: 'etiqueta_producto', justificacion: 'Etiqueta del envase, 100 g.', confirmaciones: { revise_fuente: true, valores_por_100g: true, busque_existente: true }, ...extra });
const crear = (pend, nombre, k, p, g, c, prop = propio()) => `select public.pendiente_validar_como_propio(${pend}, '${nombre}', 'panes', ${k}, ${p}, ${g}, ${c}, 'obs', '${prop}'::jsonb) r;`;
const estadoCola = async (pend) => (await q1(`select estado, id_alimento_propio from public.alimentos_pendientes_validacion where id_pendiente=${pend}`))[0];
const nPropios = async () => (await q1(`select count(*)::int n from public.alimentos_propios`))[0].n;

// 1) estructura y permisos (Review Focus 1)
ok((await q1(`select count(*)::int n from information_schema.columns where table_name='alimentos_pendientes_validacion' and column_name='id_alimento_propio'`))[0].n === 1, 'columna id_alimento_propio en la cola');
ok((await q1(`select count(*)::int n from information_schema.columns where table_name in ('v_alimentos_pendientes','v_alimentos_validados') and column_name='id_alimento_propio'`))[0].n === 2, 'las dos vistas exponen id_alimento_propio');
await expectErr(asUser(INV) + `insert into public.alimentos_propios (nombre, kcal_100g, proteinas_100g, grasas_100g, carbs_100g, fuente_dato, justificacion, creado_por) values ('X',1,1,1,1,'otra','xxxxxxxxxx','${INV}');`, /permission denied|row-level security/, 'nadie inserta directo');
await expectErr(asUser(INV) + `update public.alimentos_propios set kcal_100g = 1;`, /permission denied/, 'nadie actualiza directo');
await expectErr(asUser(INV) + `delete from public.alimentos_propios;`, /permission denied/, 'nadie borra directo');
await expectErr(`set role anon; select * from public.alimentos_propios;`, /permission denied/, 'anon no lee');

// 2) propio_verificar
const ver = async (uid, n, k, p, g, c) => (await q1(asUser(uid) + `select public.propio_verificar('${n}', ${k}, ${p}, ${g}, ${c}) r;`))[0].r;
let v = await ver(INV, 'Galletita nueva', 450, 6, 18, 65);
ok(v.bloqueos.length === 0 && v.advertencias.length === 0, 'verificar: valores razonables sin avisos: ' + JSON.stringify(v));
v = await ver(INV, 'Huevo', 450, 6, 18, 65);
ok(v.bloqueos.some((b) => b.codigo === 'DUPLICADO' && b.existente.origen === 'catalogo' && b.existente.id === 1000900), 'verificar: nombre idéntico a una entrada de alimentos (ANMAT) bloquea y devuelve la existente: ' + JSON.stringify(v.bloqueos));
v = await ver(INV, 'Pollo a la planchas', 165, 31, 3.6, 0);
ok(v.bloqueos.length === 0 && v.advertencias.some((a) => a.codigo === 'SIMILAR' && a.similares[0].id === 1), 'verificar: nombre parecido a SARA2 advierte con la lista: ' + JSON.stringify(v.advertencias));
v = await ver(INV, 'Algo raro', 800, 5, 0, 0);
ok(v.advertencias.some((a) => a.codigo === 'KCAL_INCOHERENTE'), 'verificar: kcal incoherentes advierte');
for (const [n, k, p, g, c, cod] of [['A', 500, 101, 0, 0, 'MACRO_MAYOR_100'], ['A', 800, 40, 40, 30, 'SUMA_MACROS'], ['A', 901, 0, 100, 0, 'KCAL_MAYOR_900'], ['   ', 100, 1, 1, 1, 'NOMBRE_VACIO']]) {
  v = await ver(INV, n, k, p, g, c);
  ok(v.bloqueos.some((b) => b.codigo === cod), 'verificar: bloquea ' + cod);
}
v = await ver(INV, 'A', 100, 1, 1, -1);
ok(v.bloqueos.length === 1 && v.bloqueos[0].codigo === 'VALORES_INVALIDOS', 'verificar: negativo = VALORES_INVALIDOS');
await expectErr(asUser(DEP) + `select public.propio_verificar('A', 1, 1, 1, 1);`, /FORBIDDEN/, 'verificar: deportista FORBIDDEN');

// 3) crear: evaluación incompleta, bloqueos y advertencias NO dejan nada hecho (Review Focus 2)
const intacto = async (pend, m) => { const c = await estadoCola(pend); ok(c.estado === 'pendiente' && c.id_alimento_propio === null && (await nPropios()) === 0, 'sin efectos tras el error: ' + m); };
await expectErr(asUser(INV) + crear(PAN, 'Pan casero', 250, 8, 3, 48, propio({ fuente_dato: 'cualquiera' })), /PROPIO_EVALUACION/, 'fuente inválida');
await intacto(PAN, 'fuente inválida');
await expectErr(asUser(INV) + crear(PAN, 'Pan casero', 250, 8, 3, 48, propio({ justificacion: 'corta' })), /PROPIO_EVALUACION/, 'justificación corta');
await expectErr(asUser(INV) + crear(PAN, 'Pan casero', 250, 8, 3, 48, propio({ confirmaciones: { revise_fuente: true, valores_por_100g: true, busque_existente: false } })), /PROPIO_EVALUACION/, 'falta una confirmación');
await expectErr(asUser(INV) + crear(PAN, 'Huevo', 250, 8, 3, 48), /PROPIO_BLOQUEADO/, 'nombre duplicado en alimentos');
await expectErr(asUser(INV) + crear(PAN, 'Pan casero', 250, 8, 3, 130), /PROPIO_BLOQUEADO/, 'macro > 100');
await expectErr(asUser(INV) + crear(PAN, 'Pan casero', 900, 8, 3, 48), /PROPIO_ADVERTENCIA/, 'kcal incoherentes sin confirmar');
await expectErr(asUser(INV) + crear(PAN, 'Pollo a la planchas', 165, 31, 3.6, 0), /PROPIO_ADVERTENCIA/, 'nombre parecido sin confirmar');
await expectErr(asUser(DEP) + crear(PAN, 'Pan casero', 250, 8, 3, 48), /FORBIDDEN/, 'deportista FORBIDDEN');
await intacto(PAN, 'bloqueos y advertencias');

// 4) crear OK (misma transacción: valida el pendiente + crea el propio)
const r = (await q1(asUser(INV) + crear(PAN, 'Pan casero', 250, 8, 3, 48)))[0].r;
await db.exec('reset role;');
ok(r.id_alimento_propio > 0 && r.items_afectados === 2, 'crear OK: ' + JSON.stringify(r));
const prop = (await q1(`select * from public.alimentos_propios where id_alimento_propio=${r.id_alimento_propio}`))[0];
ok(prop.nombre === 'Pan casero' && prop.nombre_normalizado === 'pan casero' && prop.estado === 'activo' && prop.creado_por === INV && prop.id_pendiente_origen === PAN && Number(prop.kcal_100g) === 250 && prop.fuente_dato === 'etiqueta_producto', 'el propio queda con sus datos: ' + JSON.stringify(prop).slice(0, 160));
const col = await estadoCola(PAN);
ok(col.estado === 'validado' && col.id_alimento_propio === r.id_alimento_propio, 'la cola queda validada y apuntando al propio');
const its = await q1(`select it.cantidad, it.kcal, it.origen_macros, it.id_alimento from public.items it where nombre_manual='Pan casero' order by cantidad`);
ok(its.length === 2 && its.every((i) => i.origen_macros === 'validado' && i.id_alimento === null) && Number(its[0].kcal) === 125 && Number(its[1].kcal) === 200, 'los ítems guardan el snapshot (250 kcal/100 g → 125 y 200): ' + JSON.stringify(its));
const aud = await q1(`select despues from public.alimentos_pendientes_auditoria where id_pendiente=${PAN} and accion='crear_propio'`);
ok(aud.length === 1 && aud[0].despues.evaluacion.fuente_dato === 'etiqueta_producto' && aud[0].despues.evaluacion.confirmaciones.busque_existente === true && aud[0].despues.propio.nombre === 'Pan casero', 'la evaluación (fuente, justificación, confirmaciones) queda en la auditoría');
ok((await q1(`select count(*)::int n from public.alimentos_pendientes_auditoria where id_pendiente=${PAN} and accion='validar'`))[0].n === 1, 'y también la auditoría de "validar"');

// 5) advertencias confirmadas + duplicado propio (Review Focus 3)
const r2 = (await q1(asUser(INV) + crear(DULCE, 'Dulce raro', 900, 8, 3, 48, propio({ confirma_incoherente: true, justificacion: 'Valor de la etiqueta, aceite de palma.' }))))[0].r;
ok(r2.id_alimento_propio > 0, 'kcal incoherentes confirmadas + justificación: se crea');
await expectErr(asUser(INV2) + crear(SALSA, 'PAN casero!', 250, 8, 3, 48), /PROPIO_BLOQUEADO/, 'nombre idéntico (normalizado) a un propio activo, desde otro pendiente');
const r3 = (await q1(asUser(INV2) + crear(SALSA, 'Pollo a la planchas', 165, 31, 3.6, 0, propio({ confirma_distinto: true }))))[0].r;
ok(r3.id_alimento_propio > 0, 'nombre parecido confirmado: se crea');

// 6) composición con ingrediente propio (Review Focus 5) — el id del propio colisiona a propósito con uno de alimentos
const REF_MIX = (await q1(`select id_guardado_item from public.detecciones_guardados_items where id_pendiente=${MIX}`))[0].id_guardado_item;
const comp = (comps) => JSON.stringify({ modo: 'catalogo', id_guardado_item: null, gramos_foto: 9999, componentes: comps });
const ing = (origen, id, gramos) => ({ origen, id, nombre: 'FORJADO', fuente: 'FORJADA', gramos, kcal_100g: 99999, proteinas_100g: 99999, grasas_100g: 99999, carbs_100g: 99999 });
await q1(asUser(INV) + `select public.pendiente_modificar(${MIX}, 'Mix', null, null, null, null, null, null, '${comp([ing('propio', r.id_alimento_propio, 10), ing('catalogo', 31, 5)])}'::jsonb);`);
let q = (await q1(`select composicion, final_kcal_100g from public.alimentos_pendientes_validacion where id_pendiente=${MIX}`))[0];
// peso de la foto 25 g: (250×10 + 800×5) / 25 = 260
ok(Number(q.final_kcal_100g) === 260 && q.composicion.componentes[0].origen === 'propio' && q.composicion.componentes[0].nombre === 'Pan casero' && q.composicion.componentes[0].fuente === 'PROPIO' && q.composicion.componentes[1].origen === 'catalogo', 'ingredientes propio + catálogo: cuenta correcta y snapshot desde la base: ' + JSON.stringify([q.final_kcal_100g, q.composicion.componentes.map((c) => [c.origen, c.nombre, c.fuente])]));
await q1(asUser(INV) + `select public.pendiente_modificar(${MIX}, 'Mix', null, null, null, null, null, null, '${comp([ing('propio', 31, 10)])}'::jsonb);`).then(
  () => ok(false, 'un id de propio inexistente debería fallar'),
  (e) => ok(/ALIMENTO_NO_ENCONTRADO/.test(e.message), 'el id 31 como PROPIO no existe aunque exista en alimentos -> ' + e.message));
await db.exec('reset role;');
const rv = (await q1(asUser(INV) + `select public.pendiente_validar(${MIX}, 'Mix de semillas', null, null, null, null, null, null, null, '${comp([ing('propio', r.id_alimento_propio, 25)])}'::jsonb) r;`))[0].r;
ok(rv.id_alimento === null, 'un propio solo con todo el peso NO es vínculo a alimentos (id_alimento null): ' + JSON.stringify(rv));
const imx = (await q1(`select kcal_100g, id_alimento from public.items where nombre_manual='Mix de semillas'`))[0];
ok(Number(imx.kcal_100g) === 250 && imx.id_alimento === null, 'y el ítem toma los valores exactos del propio');

// 7) vista de propios y usos
await db.exec(asUser(INV));
const vp = (await db.query(`select nombre, usos_como_ingrediente from public.v_alimentos_propios order by id_alimento_propio`)).rows;
await db.exec('reset role;');
ok(vp.length === 3 && Number(vp[0].usos_como_ingrediente) === 1, 'v_alimentos_propios lista los 3 con sus usos como ingrediente: ' + JSON.stringify(vp));
await db.exec(asUser(DEP));
ok((await db.query(`select count(*)::int n from public.alimentos_propios`)).rows[0].n === 0 && (await db.query(`select count(*)::int n from public.v_alimentos_propios`)).rows[0].n === 0, 'un deportista ve 0 propios (RLS)');
await db.exec('reset role;');

// 8) retirar (Review Focus 4)
await expectErr(asUser(INV) + `select public.propio_retirar(${r.id_alimento_propio}, 'corto');`, /PROPIO_EVALUACION/, 'retirar: motivo corto');
await expectErr(asUser(DEP) + `select public.propio_retirar(${r.id_alimento_propio}, 'motivo suficiente largo');`, /FORBIDDEN/, 'retirar: deportista FORBIDDEN');
await expectErr(asUser(INV) + `select public.propio_retirar(999999, 'motivo suficiente largo');`, /NOT_FOUND/, 'retirar: inexistente');
await q1(asUser(INV) + `select public.propio_retirar(${r.id_alimento_propio}, 'Los valores de la etiqueta estaban mal.');`);
q = (await q1(`select estado, retirado_por, motivo_retiro, retirado_at is not null as con_fecha from public.alimentos_propios where id_alimento_propio=${r.id_alimento_propio}`))[0];
ok(q.estado === 'retirado' && q.retirado_por === INV && q.motivo_retiro.startsWith('Los valores') && q.con_fecha, 'retirado con quién, cuándo y por qué');
ok((await q1(`select count(*)::int n from public.alimentos_pendientes_auditoria where id_pendiente=${PAN} and accion='retirar_propio'`))[0].n === 1, 'retirar queda en la auditoría');
await expectErr(asUser(INV) + `select public.propio_retirar(${r.id_alimento_propio}, 'Los valores de la etiqueta estaban mal.');`, /ESTADO_INVALIDO/, 'retirar dos veces');
ok((await q1(`select kcal from public.items where nombre_manual='Pan casero' order by cantidad limit 1`))[0].kcal !== null, 'los ítems ya validados no cambian al retirar');
await expectErr(asUser(INV) + `select public.pendiente_modificar(${CREMA}, 'Crema', null, null, null, null, null, null, '${comp([ing('propio', r.id_alimento_propio, 10)])}'::jsonb);`, /ALIMENTO_NO_ENCONTRADO/, 'un propio retirado ya no se puede usar como ingrediente (aunque siga en un borrador)');
v = await ver(INV, 'Pan casero', 250, 8, 3, 48);
ok(!v.bloqueos.some((b) => b.codigo === 'DUPLICADO'), 'al retirarlo el nombre queda libre');
await db.exec(asUser(INV));
ok((await db.query(`select count(*)::int n from public.v_alimentos_propios where estado='retirado'`)).rows[0].n === 1, 'el retirado sigue en la vista (para trazabilidad)');
await db.exec('reset role;');

// 9) permisos de las funciones internas
await expectErr(`set role authenticated; select * from public.calcular_composicion(${MIX}, '{}'::jsonb);`, /permission denied/, 'calcular_composicion sigue sin ser invocable por clientes');
console.log(fails ? 'FALLAS ' + fails : 'TODO OK');
```

- [ ] **Step 2: Armar el arnés y ver que falla**

```bash
cd "$SCRATCHPAD/pgl"
sed '/^console.log(.consolidado aplicado/,$d' m016.mjs > m019.mjs
cat m019_body.mjs >> m019.mjs
node m019.mjs
```

Expected: FAIL — `readFileSync` no encuentra `019_alimentos_propios_nut119.sql` (todavía no existe).

- [ ] **Step 3: Write the migration**

Crear `supabase/019_alimentos_propios_nut119.sql` con este contenido **exacto** (y copiar la misma sección, desde el `-- 019` hasta el final, al final de `supabase/schema_consolidado.sql`, con CRLF):

```sql
-- ============================================================
-- Script para correr en el SQL Editor de Supabase.
--
-- Es exactamente la sección "019" ya agregada al final de
-- supabase/schema_consolidado.sql (que sigue siendo la fuente de verdad del
-- esquema completo) — este archivo separado es sólo para pegarlo y correrlo
-- de una sin tener que ubicar la sección en el archivo grande.
--
-- Es seguro re-ejecutar: IF NOT EXISTS, DROP IF EXISTS + CREATE OR REPLACE.
-- ============================================================

-- ============================================================
-- 019 (NUT-119) — Alimentos propios (catálogo propio) — Fase B
--
-- Desde "A mano" el investigador puede crear un alimento reutilizable. Entra tras
-- una verificación automática de campos y una evaluación breve (fuente, justificación
-- y tres confirmaciones). Nadie escribe directo en la tabla: sólo estas RPC definer,
-- que repiten TODAS las verificaciones en el servidor. Crear un propio es la misma
-- transacción que validar el pendiente. Los propios NO entran al matching automático
-- de la IA (match_alimentos no se toca): se usan a mano y como ingredientes de una
-- composición (origen 'propio').
--
-- Errores: PROPIO_BLOQUEADO (detail = JSON de bloqueos), PROPIO_ADVERTENCIA
-- (detail = KCAL_INCOHERENTE | SIMILAR), PROPIO_EVALUACION (detail = fuente |
-- justificacion | confirmaciones | motivo), PROPIO_DUPLICADO (carrera entre dos altas);
-- además FORBIDDEN, NOT_FOUND, ESTADO_INVALIDO y los de la composición.
-- ============================================================

create table if not exists public.alimentos_propios (
  id_alimento_propio  bigserial primary key,
  nombre              text not null check (btrim(nombre) <> ''),
  nombre_normalizado  text generated always as (public.norm_alimento(nombre)) stored,
  categoria           text,
  kcal_100g           numeric(10,2) not null check (kcal_100g between 0 and 900),
  proteinas_100g      numeric(10,2) not null check (proteinas_100g between 0 and 100),
  grasas_100g         numeric(10,2) not null check (grasas_100g between 0 and 100),
  carbs_100g          numeric(10,2) not null check (carbs_100g between 0 and 100),
  fuente_dato         text not null check (fuente_dato in ('etiqueta_producto', 'tabla_composicion', 'calculo_propio', 'estimacion_ia_revisada', 'otra')),
  justificacion       text not null check (length(btrim(justificacion)) >= 10),
  composicion         jsonb,
  id_pendiente_origen bigint references public.alimentos_pendientes_validacion(id_pendiente),
  creado_por          uuid references auth.users(id) on delete set null,
  creado_at           timestamptz not null default now(),
  estado              text not null default 'activo' check (estado in ('activo', 'retirado')),
  retirado_por        uuid references auth.users(id) on delete set null,
  retirado_at         timestamptz,
  motivo_retiro       text,
  check (nombre_normalizado is not null),
  check (proteinas_100g + grasas_100g + carbs_100g <= 105),
  check ((estado = 'retirado') = (retirado_at is not null))
);

-- Un solo propio ACTIVO por nombre normalizado (un retirado libera el nombre).
create unique index if not exists uq_alimentos_propios_nombre_activo
  on public.alimentos_propios (nombre_normalizado) where estado = 'activo';
create index if not exists idx_alimentos_propios_trgm
  on public.alimentos_propios using gin (nombre_normalizado extensions.gin_trgm_ops) where estado = 'activo';

alter table public.alimentos_propios enable row level security;
revoke all on public.alimentos_propios from anon, authenticated;
grant select on public.alimentos_propios to authenticated;
revoke all on sequence public.alimentos_propios_id_alimento_propio_seq from anon, authenticated;

drop policy if exists "alimentos_propios: investigador read" on public.alimentos_propios;
create policy "alimentos_propios: investigador read"
  on public.alimentos_propios for select to authenticated
  using ((select public.get_my_role()) in ('investigador', 'administrador'));

alter table public.alimentos_pendientes_validacion
  add column if not exists id_alimento_propio bigint references public.alimentos_propios(id_alimento_propio);

-- Acciones nuevas de auditoría.
alter table public.alimentos_pendientes_auditoria
  drop constraint if exists alimentos_pendientes_auditoria_accion_check;
alter table public.alimentos_pendientes_auditoria
  add constraint alimentos_pendientes_auditoria_accion_check
  check (accion in ('modificar', 'validar', 'descartar', 'crear_propio', 'retirar_propio'));

-- ------------------------------------------------------------
-- Verificación (única fuente de verdad de las reglas de §6.2 en el servidor)
-- ------------------------------------------------------------
create or replace function public.propio_verificar(
  p_nombre text,
  p_kcal numeric,
  p_prot numeric,
  p_grasas numeric,
  p_carbs numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_norm      text := public.norm_alimento(p_nombre);
  v_bloqueos  jsonb := '[]'::jsonb;
  v_adv       jsonb := '[]'::jsonb;
  v_ex        jsonb;
  v_sim       jsonb;
begin
  if coalesce(public.get_my_role() in ('investigador', 'administrador'), false) is false then
    raise exception 'FORBIDDEN';
  end if;

  if v_norm is null or btrim(coalesce(p_nombre, '')) = '' then
    v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'NOMBRE_VACIO');
  end if;

  if num_nulls(p_kcal, p_prot, p_grasas, p_carbs) > 0 or least(p_kcal, p_prot, p_grasas, p_carbs) < 0 then
    v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'VALORES_INVALIDOS');
  else
    if greatest(p_prot, p_grasas, p_carbs) > 100 then
      v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'MACRO_MAYOR_100');
    end if;
    if p_prot + p_grasas + p_carbs > 105 then
      v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'SUMA_MACROS');
    end if;
    if p_kcal > 900 then
      v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'KCAL_MAYOR_900');
    end if;
    if abs(p_kcal - (4 * p_prot + 4 * p_carbs + 9 * p_grasas)) > greatest(25, 0.35 * p_kcal) then
      v_adv := v_adv || jsonb_build_object('codigo', 'KCAL_INCOHERENTE');
    end if;
  end if;

  if v_norm is not null then
    -- Duplicado exacto (normalizado) con alimentos (SARA2/ANMAT) o con un propio activo.
    select jsonb_build_object('origen', 'catalogo', 'id', a.id_alimento, 'nombre', a.nombre, 'fuente', a.fuente)
    into v_ex
    from public.alimentos a
    where a.nombre_normalizado = v_norm
    order by a.fuente desc, a.id_alimento
    limit 1;
    if v_ex is null then
      select jsonb_build_object('origen', 'propio', 'id', p.id_alimento_propio, 'nombre', p.nombre, 'fuente', 'PROPIO')
      into v_ex
      from public.alimentos_propios p
      where p.estado = 'activo' and p.nombre_normalizado = v_norm
      limit 1;
    end if;
    if v_ex is not null then
      v_bloqueos := v_bloqueos || jsonb_build_object('codigo', 'DUPLICADO', 'existente', v_ex);
    else
      -- Parecidos (trigram >= 0,85) a SARA2 o a propios activos.
      select coalesce(jsonb_agg(x order by (x ->> 'similitud')::numeric desc), '[]'::jsonb)
      into v_sim
      from (
        select jsonb_build_object('origen', 'catalogo', 'id', a.id_alimento, 'nombre', a.nombre, 'fuente', a.fuente,
                 'similitud', round(extensions.similarity(a.nombre_normalizado, v_norm)::numeric, 2)) as x
        from public.alimentos a
        where a.fuente = 'SARA2' and extensions.similarity(a.nombre_normalizado, v_norm) >= 0.85
        union all
        select jsonb_build_object('origen', 'propio', 'id', p.id_alimento_propio, 'nombre', p.nombre, 'fuente', 'PROPIO',
                 'similitud', round(extensions.similarity(p.nombre_normalizado, v_norm)::numeric, 2))
        from public.alimentos_propios p
        where p.estado = 'activo' and extensions.similarity(p.nombre_normalizado, v_norm) >= 0.85
        limit 5
      ) s;
      if jsonb_array_length(v_sim) > 0 then
        v_adv := v_adv || jsonb_build_object('codigo', 'SIMILAR', 'similares', v_sim);
      end if;
    end if;
  end if;

  return jsonb_build_object('bloqueos', v_bloqueos, 'advertencias', v_adv);
end;
$$;

revoke all on function public.propio_verificar(text, numeric, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.propio_verificar(text, numeric, numeric, numeric, numeric) to authenticated;

-- ------------------------------------------------------------
-- Validar un pendiente "A mano" Y crear el propio, en una sola transacción.
-- ------------------------------------------------------------
create or replace function public.pendiente_validar_como_propio(
  p_id bigint,
  p_nombre text,
  p_categoria text,
  p_kcal numeric,
  p_prot numeric,
  p_grasas numeric,
  p_carbs numeric,
  p_observaciones text,
  p_propio jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fuente  text := p_propio ->> 'fuente_dato';
  v_just    text := btrim(coalesce(p_propio ->> 'justificacion', ''));
  v_conf    jsonb := p_propio -> 'confirmaciones';
  v_ver     jsonb;
  v_res     jsonb;
  v_id      bigint;
  v_cola    public.alimentos_pendientes_validacion%rowtype;
begin
  if coalesce(public.get_my_role() in ('investigador', 'administrador'), false) is false then
    raise exception 'FORBIDDEN';
  end if;
  if jsonb_typeof(p_propio) is distinct from 'object' then
    raise exception 'PROPIO_EVALUACION' using detail = 'fuente';
  end if;

  -- Evaluación breve: fuente + justificación + las tres confirmaciones.
  if v_fuente is null or v_fuente not in ('etiqueta_producto', 'tabla_composicion', 'calculo_propio', 'estimacion_ia_revisada', 'otra') then
    raise exception 'PROPIO_EVALUACION' using detail = 'fuente';
  end if;
  if length(v_just) < 10 then
    raise exception 'PROPIO_EVALUACION' using detail = 'justificacion';
  end if;
  if jsonb_typeof(v_conf) is distinct from 'object'
     or v_conf -> 'revise_fuente' is distinct from 'true'::jsonb
     or v_conf -> 'valores_por_100g' is distinct from 'true'::jsonb
     or v_conf -> 'busque_existente' is distinct from 'true'::jsonb then
    raise exception 'PROPIO_EVALUACION' using detail = 'confirmaciones';
  end if;

  -- Verificación de campos: bloqueos y advertencias sin confirmar frenan todo.
  v_ver := public.propio_verificar(p_nombre, p_kcal, p_prot, p_grasas, p_carbs);
  if jsonb_array_length(v_ver -> 'bloqueos') > 0 then
    raise exception 'PROPIO_BLOQUEADO' using detail = (v_ver -> 'bloqueos')::text;
  end if;
  if exists (select 1 from jsonb_array_elements(v_ver -> 'advertencias') a where a ->> 'codigo' = 'KCAL_INCOHERENTE')
     and p_propio -> 'confirma_incoherente' is distinct from 'true'::jsonb then
    raise exception 'PROPIO_ADVERTENCIA' using detail = 'KCAL_INCOHERENTE';
  end if;
  if exists (select 1 from jsonb_array_elements(v_ver -> 'advertencias') a where a ->> 'codigo' = 'SIMILAR')
     and p_propio -> 'confirma_distinto' is distinct from 'true'::jsonb then
    raise exception 'PROPIO_ADVERTENCIA' using detail = 'SIMILAR';
  end if;

  -- Validar el pendiente (Fase A): bloquea la fila, chequea el estado y re-apunta los ítems.
  v_res := public.pendiente_validar(
    p_id, p_nombre, p_categoria, p_kcal, p_prot, p_grasas, p_carbs, p_observaciones, null,
    jsonb_build_object('modo', 'manual', 'id_guardado_item', null, 'gramos_foto', null, 'componentes', '[]'::jsonb)
  );

  begin
    insert into public.alimentos_propios (
      nombre, categoria, kcal_100g, proteinas_100g, grasas_100g, carbs_100g,
      fuente_dato, justificacion, id_pendiente_origen, creado_por
    )
    values (
      btrim(p_nombre), nullif(btrim(p_categoria), ''), p_kcal, p_prot, p_grasas, p_carbs,
      v_fuente, v_just, p_id, auth.uid()
    )
    returning id_alimento_propio into v_id;
  exception when unique_violation then
    raise exception 'PROPIO_DUPLICADO';
  end;

  update public.alimentos_pendientes_validacion c
  set id_alimento_propio = v_id
  where c.id_pendiente = p_id
  returning * into v_cola;

  insert into public.alimentos_pendientes_auditoria (id_pendiente, accion, id_usuario, antes, despues, items_afectados)
  values (
    p_id, 'crear_propio', auth.uid(), to_jsonb(v_cola),
    jsonb_build_object(
      'propio', (select to_jsonb(p) - 'nombre_normalizado' from public.alimentos_propios p where p.id_alimento_propio = v_id),
      'evaluacion', jsonb_build_object(
        'fuente_dato', v_fuente,
        'justificacion', v_just,
        'confirmaciones', v_conf,
        'confirma_incoherente', coalesce(p_propio -> 'confirma_incoherente', 'false'::jsonb),
        'confirma_distinto', coalesce(p_propio -> 'confirma_distinto', 'false'::jsonb),
        'advertencias', v_ver -> 'advertencias'
      )
    ),
    (v_res ->> 'items_afectados')::integer
  );

  return jsonb_build_object('id_alimento_propio', v_id, 'items_afectados', (v_res ->> 'items_afectados')::integer);
end;
$$;

revoke all on function public.pendiente_validar_como_propio(bigint, text, text, numeric, numeric, numeric, numeric, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.pendiente_validar_como_propio(bigint, text, text, numeric, numeric, numeric, numeric, text, jsonb)
  to authenticated;

-- ------------------------------------------------------------
-- Retirar un propio (motivo obligatorio, auditado). No toca ítems ya validados.
-- ------------------------------------------------------------
create or replace function public.propio_retirar(p_id bigint, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes   public.alimentos_propios%rowtype;
  v_despues public.alimentos_propios%rowtype;
  v_motivo  text := btrim(coalesce(p_motivo, ''));
begin
  if coalesce(public.get_my_role() in ('investigador', 'administrador'), false) is false then
    raise exception 'FORBIDDEN';
  end if;
  if length(v_motivo) < 10 then
    raise exception 'PROPIO_EVALUACION' using detail = 'motivo';
  end if;

  select * into v_antes from public.alimentos_propios p where p.id_alimento_propio = p_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_antes.estado <> 'activo' then
    raise exception 'ESTADO_INVALIDO';
  end if;

  update public.alimentos_propios p
  set estado = 'retirado', retirado_por = auth.uid(), retirado_at = now(), motivo_retiro = v_motivo
  where p.id_alimento_propio = p_id
  returning * into v_despues;

  insert into public.alimentos_pendientes_auditoria (id_pendiente, accion, id_usuario, antes, despues, items_afectados)
  values (v_antes.id_pendiente_origen, 'retirar_propio', auth.uid(), to_jsonb(v_antes) - 'nombre_normalizado', to_jsonb(v_despues) - 'nombre_normalizado', 0);
end;
$$;

revoke all on function public.propio_retirar(bigint, text) from public, anon, authenticated;
grant execute on function public.propio_retirar(bigint, text) to authenticated;

-- ------------------------------------------------------------
-- calcular_composicion: los ingredientes pueden ser del catálogo ('catalogo', por
-- defecto) o propios ('propio'). Un propio nunca es "vínculo puro" (no hay entrada en
-- `alimentos` a la que apuntar): se usan sus valores exactos y el ítem guarda el snapshot.
-- ------------------------------------------------------------
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
  v_origen text;
  v_id     bigint;
  v_g      numeric;
  v_nombre text;
  v_fuente text;
  v_k100   numeric;
  v_p100   numeric;
  v_g100   numeric;
  v_c100   numeric;
  v_k      numeric := 0;
  v_p      numeric := 0;
  v_gr     numeric := 0;
  v_c      numeric := 0;
  v_out    jsonb := '[]'::jsonb;
  v_n      integer := 0;
  v_vinc   integer := null;
  v_ult_k  numeric; v_ult_p numeric; v_ult_g numeric; v_ult_c numeric;
begin
  if jsonb_typeof(p_composicion) is distinct from 'object'
     or p_composicion ->> 'modo' is distinct from 'catalogo'
     or jsonb_typeof(v_comps) is distinct from 'array'
     or jsonb_array_length(v_comps) not between 1 and 30 then
    raise exception 'COMPOSICION_INVALIDA' using detail = 'Estructura inválida.';
  end if;

  -- Foto de referencia: la primera ocurrencia de ESTE pendiente; su peso sale de la base.
  select gi.id_guardado_item, gi.grams
  into v_ref, v_peso
  from public.detecciones_guardados_items gi
  where gi.id_pendiente = p_id_pendiente
  order by gi.id_guardado_item
  limit 1;
  if not found or v_peso is null or v_peso <= 0 then
    raise exception 'COMPOSICION_INVALIDA' using detail = 'El alimento no tiene una foto con peso para tomar de referencia.';
  end if;

  for v_el in select e from jsonb_array_elements(v_comps) as t(e) loop
    if jsonb_typeof(v_el -> 'id') is distinct from 'number'
       or jsonb_typeof(v_el -> 'gramos') is distinct from 'number' then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Ingrediente mal formado.';
    end if;
    v_origen := coalesce(v_el ->> 'origen', 'catalogo');
    if v_origen not in ('catalogo', 'propio') then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Ingrediente mal formado.';
    end if;
    begin
      v_id := (v_el ->> 'id')::bigint;
    exception when others then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Ingrediente mal formado.';
    end;
    v_g := (v_el ->> 'gramos')::numeric;
    if v_g <= 0 or v_g > 1000 then
      raise exception 'COMPOSICION_INVALIDA' using detail = 'Los gramos de cada ingrediente deben ser mayores a 0 y hasta 1000.';
    end if;

    if v_origen = 'propio' then
      select p.nombre, 'PROPIO', p.kcal_100g, p.proteinas_100g, p.grasas_100g, p.carbs_100g
      into v_nombre, v_fuente, v_k100, v_p100, v_g100, v_c100
      from public.alimentos_propios p
      where p.id_alimento_propio = v_id and p.estado = 'activo';
    else
      select a.nombre, a.fuente, a.kcal_100g, a.proteinas_100g, a.grasas_100g, a.carbs_100g
      into v_nombre, v_fuente, v_k100, v_p100, v_g100, v_c100
      from public.alimentos a
      where a.id_alimento = v_id;
    end if;
    if not found then
      raise exception 'ALIMENTO_NO_ENCONTRADO' using detail = v_origen || ':' || v_id::text;
    end if;
    if num_nulls(v_k100, v_p100, v_g100, v_c100) > 0 then
      raise exception 'COMPOSICION_INVALIDA' using detail = v_nombre || ' no tiene datos nutricionales en el catálogo.';
    end if;

    v_k  := v_k  + v_k100 * v_g;
    v_p  := v_p  + v_p100 * v_g;
    v_gr := v_gr + v_g100 * v_g;
    v_c  := v_c  + v_c100 * v_g;
    v_n  := v_n + 1;
    v_ult_k := v_k100; v_ult_p := v_p100; v_ult_g := v_g100; v_ult_c := v_c100;
    v_out := v_out || jsonb_build_object(
      'origen', v_origen, 'id', v_id, 'nombre', v_nombre, 'fuente', v_fuente,
      'gramos', v_g, 'kcal_100g', v_k100, 'proteinas_100g', v_p100,
      'grasas_100g', v_g100, 'carbs_100g', v_c100);
    if v_n = 1 and v_origen = 'catalogo' and abs(v_g - v_peso) <= 0.5 then
      v_vinc := v_id::integer;
    end if;
  end loop;

  -- Un solo ingrediente que iguala el peso de la foto: los valores son exactamente los de esa entrada.
  if v_n = 1 and abs((v_out -> 0 ->> 'gramos')::numeric - v_peso) <= 0.5 then
    return query select v_ult_k, v_ult_p, v_ult_g, v_ult_c, v_vinc,
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

-- ------------------------------------------------------------
-- Vistas (se recrean: p.* se expande al crear la vista y hay columna nueva)
-- ------------------------------------------------------------
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
  p.id_alimento_propio,
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

-- Propios con cuántas veces se usaron como ingrediente de un alimento validado.
drop view if exists public.v_alimentos_propios;
create view public.v_alimentos_propios
with (security_invoker = true)
as
select
  ap.*,
  (
    select count(*)
    from public.alimentos_pendientes_validacion q
    where q.estado = 'validado'
      and q.composicion -> 'componentes' @> jsonb_build_array(jsonb_build_object('origen', 'propio', 'id', ap.id_alimento_propio))
  ) as usos_como_ingrediente
from public.alimentos_propios ap;

revoke all on public.v_alimentos_propios from anon, authenticated;
grant select on public.v_alimentos_propios to authenticated;
```

- [ ] **Step 4: Run the verification**

```bash
cd "$SCRATCHPAD/pgl" && node m019.mjs
```

Expected: `017 … corrida 2 OK`, `018 … corrida 2 OK`, `019 … corrida 2 OK`, `019 … corrida 3 OK`, todas las líneas `OK` y `TODO OK`. Cualquier `FAIL` se arregla en el SQL (no en el script) salvo que el script contradiga el spec. Dos puntos a mirar si falla: (a) el nombre real del `check` de `accion` en la auditoría (el `drop constraint if exists` asume `alimentos_pendientes_auditoria_accion_check`, el nombre por defecto de Postgres; si no coincide, buscarlo con `select conname from pg_constraint where conrelid = 'public.alimentos_pendientes_auditoria'::regclass`); (b) el umbral de similitud del ejemplo `Pollo a la planchas` (si da < 0,85, ajustar **el nombre del ejemplo** en el script, no el umbral del spec).

- [ ] **Step 5: Commit**

```bash
git add supabase/019_alimentos_propios_nut119.sql supabase/schema_consolidado.sql
git commit -m "feat: migración 019 — catálogo propio (alimentos_propios), verificación, crear/retirar y composición con ingredientes propios

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

> **Nota para quien corre las migraciones en Supabase:** pegar y ejecutar `019_…sql` en el SQL Editor **antes** de desplegar el código de las Tasks 3–6.

---

## Task 3: `composicion.ts` con `origen` y server actions de alimentos propios

**Files:**
- Modify: `src/lib/composicion.ts`
- Modify: `src/app/(researcher)/validacion/actions.ts`
- Modify: `src/app/(researcher)/validacion/ComposicionCatalogo.tsx` (sólo una línea, para que compile; la lógica de propios es la Task 4)
- Modify: `testing/fixtures/validacion.ts` (`id_alimento_propio: null` en `PENDIENTE`)
- Test: `testing/composicion.test.ts`, `testing/validacionActions.test.ts`

**Interfaces:**
- Consumes: RPC `propio_verificar`, `pendiente_validar_como_propio`, `propio_retirar` (Task 2); `FUENTES_DATO`, `JUSTIFICACION_MIN`, `MOTIVO_RETIRO_MIN`, `MENSAJE_BLOQUEO`, `MENSAJE_ADVERTENCIA`, `CodigoBloqueo`, `CodigoAdvertencia`, `FuenteDato` (Task 1).
- Produces (composicion.ts):
  ```ts
  export type OrigenIngrediente = 'catalogo' | 'propio'
  // componenteSchema.origen: z.enum(['catalogo','propio']); ComponenteEditable gana `origen: OrigenIngrediente`
  export const claveIngrediente: (i: { origen: OrigenIngrediente; id: number }) => string   // 'propio:31'
  ```
- Produces (actions.ts):
  ```ts
  export interface ExistenteCatalogo { origen: 'catalogo' | 'propio'; id: number; nombre: string; fuente: string }
  export interface VerificacionPropio {
    bloqueos: Array<{ codigo: CodigoBloqueo; existente?: ExistenteCatalogo }>
    advertencias: Array<{ codigo: CodigoAdvertencia; similares?: Array<ExistenteCatalogo & { similitud: number }> }>
  }
  export interface PropioInfo { id: number; estado: 'activo' | 'retirado'; fuenteDato: string; justificacion: string; motivoRetiro: string | null }
  export type VerificarPropioResultado = ({ ok: true } & VerificacionPropio) | ResultadoError
  export type ValidarComoPropioResultado = { ok: true; idAlimentoPropio: number; itemsAfectados: number } | ResultadoError
  export type RetirarPropioResultado = { ok: true } | ResultadoError
  verificarAlimentoPropioAction(input: { nombre: string; kcal: number|null; proteinas: number|null; grasas: number|null; carbs: number|null }): Promise<VerificarPropioResultado>
  validarComoPropioAction(input: { id; nombre; categoria?; observaciones?; kcal; proteinas; grasas; carbs; propio: { fuenteDato; justificacion; confirmaciones: { reviseFuente: true; valoresPor100g: true; busqueExistente: true }; confirmaIncoherente?: boolean; confirmaDistinto?: boolean } }): Promise<ValidarComoPropioResultado>
  retirarAlimentoPropioAction(input: { id: number; motivo: string }): Promise<RetirarPropioResultado>
  buscarAlimentosPropiosAction(query: string): Promise<AlimentoOption[]>   // [] si no es investigador o query < 2; fuente 'PROPIO', id_alimento = id del propio
  // PendienteFila.id_alimento_propio: number | null
  // PendienteDetalleResultado ok: gana `propio?: PropioInfo | null`
  ```

- [ ] **Step 1: Write the failing tests**

(a) En `testing/composicion.test.ts`:
1. En el test `'un ingrediente sin datos nutricionales se reporta por nombre y no se incluye'` agregar `origen: 'catalogo'` al objeto `sinDatos` (después de `id: 9,`).
2. Agregar al final del archivo:

```ts
describe('ingredientes propios', () => {
  const PROPIO: ComponenteComposicion = {
    origen: 'propio', id: 31, nombre: 'Pan casero', fuente: 'PROPIO', gramos: 30,
    kcal_100g: 250, proteinas_100g: 8, grasas_100g: 3, carbs_100g: 48,
  };

  it('el esquema acepta origen propio y rechaza otros orígenes', () => {
    expect(restaurarComposicion({ modo: 'catalogo', componentes: [PROPIO] })?.componentes[0].origen).toBe('propio');
    expect(restaurarComposicion({ modo: 'catalogo', componentes: [{ ...PROPIO, origen: 'otro' }] })).toBeNull();
  });

  it('un propio y un alimento del catálogo con el mismo id son ingredientes distintos', () => {
    expect(claveIngrediente({ origen: 'propio', id: 31 })).toBe('propio:31');
    expect(claveIngrediente({ origen: 'catalogo', id: 31 })).toBe('catalogo:31');
  });

  it('ida y vuelta conserva el origen', () => {
    expect(aComponentes(aEditables([PROPIO]))).toEqual({ componentes: [PROPIO], problemas: [] });
    expect(aEditables([PROPIO])[0].origen).toBe('propio');
  });
});
```
y agregar `claveIngrediente` al import de `@/lib/composicion`.

(b) En `testing/validacionActions.test.ts`:
1. Agregar al import de las acciones: `verificarAlimentoPropioAction, validarComoPropioAction, retirarAlimentoPropioAction, buscarAlimentosPropiosAction`.
2. Agregar antes de `describe('getPendienteDetalleAction', …)`:

```ts
describe('alimentos propios', () => {
  const PROPIO = {
    fuenteDato: 'etiqueta_producto' as const,
    justificacion: 'Etiqueta del envase, por 100 g.',
    confirmaciones: { reviseFuente: true as const, valoresPor100g: true as const, busqueExistente: true as const },
  };
  const FORM_PROPIO = { id: 7, nombre: 'Pan casero', categoria: 'panes', observaciones: null, kcal: 250, proteinas: 8, grasas: 3, carbs: 48, propio: PROPIO };
  const args = () => sb.rpcLlamadas()[0].args as Record<string, unknown>;

  it.each(['deportista_ucc', 'particular', null])('rol %s → acceso denegado sin llamar a ninguna RPC', async (rol) => {
    const inputs: Array<() => Promise<unknown>> = [
      () => verificarAlimentoPropioAction({ nombre: 'X', kcal: 1, proteinas: 1, grasas: 1, carbs: 1 }),
      () => validarComoPropioAction(FORM_PROPIO),
      () => retirarAlimentoPropioAction({ id: 3, motivo: 'motivo suficiente largo' }),
    ];
    for (const accion of inputs) {
      comoRol(rol);
      expect(await accion()).toEqual({ error: 'Acceso denegado' });
    }
    comoRol(rol);
    expect(await buscarAlimentosPropiosAction('pan')).toEqual([]);
    expect(sb.rpcLlamadas()).toHaveLength(0);
    expect(sb.tablasLlamadas().filter((t) => t !== 'profiles')).toHaveLength(0);
  });

  it('verificar llama a propio_verificar y devuelve bloqueos y advertencias', async () => {
    comoRol('investigador');
    const verificacion = {
      bloqueos: [{ codigo: 'DUPLICADO', existente: { origen: 'catalogo', id: 5, nombre: 'Huevo', fuente: 'ANMAT' } }],
      advertencias: [{ codigo: 'KCAL_INCOHERENTE' }],
    };
    sb.mockRpc('propio_verificar', { data: verificacion, error: null });
    const r = await verificarAlimentoPropioAction({ nombre: 'Huevo', kcal: 450, proteinas: 6, grasas: 18, carbs: null });
    expect(r).toEqual({ ok: true, ...verificacion });
    expect(args()).toEqual({ p_nombre: 'Huevo', p_kcal: 450, p_prot: 6, p_grasas: 18, p_carbs: null });
  });

  it('validarComoPropio manda la evaluación en snake_case y devuelve el id del propio', async () => {
    comoRol('investigador');
    sb.mockRpc('pendiente_validar_como_propio', { data: { id_alimento_propio: 12, items_afectados: 3 }, error: null });
    const r = await validarComoPropioAction({ ...FORM_PROPIO, propio: { ...PROPIO, confirmaIncoherente: true } });
    expect(r).toEqual({ ok: true, idAlimentoPropio: 12, itemsAfectados: 3 });
    expect(sb.rpcLlamadas()[0].nombre).toBe('pendiente_validar_como_propio');
    expect(args()).toEqual({
      p_id: 7, p_nombre: 'Pan casero', p_categoria: 'panes', p_kcal: 250, p_prot: 8, p_grasas: 3, p_carbs: 48, p_observaciones: null,
      p_propio: {
        fuente_dato: 'etiqueta_producto',
        justificacion: 'Etiqueta del envase, por 100 g.',
        confirmaciones: { revise_fuente: true, valores_por_100g: true, busque_existente: true },
        confirma_incoherente: true,
        confirma_distinto: false,
      },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/validacion');
  });

  it.each([
    ['fuente inválida', { ...FORM_PROPIO, propio: { ...PROPIO, fuenteDato: 'cualquiera' } }],
    ['justificación corta', { ...FORM_PROPIO, propio: { ...PROPIO, justificacion: 'corta' } }],
    ['una confirmación sin marcar', { ...FORM_PROPIO, propio: { ...PROPIO, confirmaciones: { ...PROPIO.confirmaciones, busqueExistente: false } } }],
    ['valor negativo', { ...FORM_PROPIO, kcal: -1 }],
    ['valor faltante', { ...FORM_PROPIO, grasas: null }],
    ['sin propio', { ...FORM_PROPIO, propio: undefined }],
  ])('validarComoPropio con %s no llama a la RPC', async (_caso, input) => {
    comoRol('investigador');
    expect('error' in (await validarComoPropioAction(input as never))).toBe(true);
    expect(sb.rpcLlamadas()).toHaveLength(0);
  });

  it.each([
    ['PROPIO_BLOQUEADO', JSON.stringify([{ codigo: 'DUPLICADO', existente: { origen: 'catalogo', id: 5, nombre: 'Huevo', fuente: 'ANMAT' } }]),
      'Ya existe «Huevo» (ANMAT). Usalo desde "Del catálogo".'],
    ['PROPIO_BLOQUEADO', JSON.stringify([{ codigo: 'MACRO_MAYOR_100' }, { codigo: 'KCAL_MAYOR_900' }]),
      'Un macronutriente no puede superar los 100 g por cada 100 g de alimento. Las kcal no pueden superar las 900 por cada 100 g.'],
    ['PROPIO_ADVERTENCIA', 'SIMILAR', 'Falta confirmar: Hay alimentos con un nombre muy parecido. Confirmá que el tuyo es distinto.'],
    ['PROPIO_EVALUACION', 'confirmaciones', 'Marcá las tres confirmaciones.'],
    ['PROPIO_EVALUACION', 'motivo', 'Escribí el motivo (al menos 10 caracteres).'],
    ['PROPIO_DUPLICADO', null, 'Otro investigador acaba de crear un alimento con ese nombre. Usalo desde "Del catálogo".'],
    ['ALIMENTO_NO_ENCONTRADO', 'propio:9', 'Un alimento propio de la composición ya no está disponible (fue retirado). Quitalo de la lista.'],
  ])('%s (%s) se muestra como un mensaje entendible', async (message, details, esperado) => {
    comoRol('investigador');
    sb.mockRpc('pendiente_validar_como_propio', { data: null, error: { message, details } });
    expect(await validarComoPropioAction(FORM_PROPIO)).toEqual({ error: esperado });
  });

  it('retirar llama a propio_retirar y revalida; un motivo corto no llega a la RPC', async () => {
    comoRol('investigador');
    expect('error' in (await retirarAlimentoPropioAction({ id: 3, motivo: 'corto' }))).toBe(true);
    expect(sb.rpcLlamadas()).toHaveLength(0);

    comoRol('investigador');
    sb.mockRpc('propio_retirar', { data: null, error: null });
    expect(await retirarAlimentoPropioAction({ id: 3, motivo: 'Los valores estaban mal.' })).toEqual({ ok: true });
    expect(args()).toEqual({ p_id: 3, p_motivo: 'Los valores estaban mal.' });
    expect(revalidatePathMock).toHaveBeenCalledWith('/validacion');
  });

  it('buscarAlimentosPropios devuelve los activos con fuente PROPIO y el id del propio', async () => {
    comoRol('investigador');
    sb.mockTable('alimentos_propios', {
      data: [{ id_alimento_propio: 4, nombre: 'Pan casero', categoria: 'panes', kcal_100g: 250, proteinas_100g: 8, grasas_100g: 3, carbs_100g: 48 }],
      error: null,
    });
    expect(await buscarAlimentosPropiosAction('pan')).toEqual([
      { id_alimento: 4, nombre: 'Pan casero', categoria: 'panes', fuente: 'PROPIO', marca: null, denominacion: null, kcal_100g: 250, proteinas_100g: 8, grasas_100g: 3, carbs_100g: 48 },
    ]);
    expect(sb.filtrosLlamados()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tabla: 'alimentos_propios', metodo: 'eq', args: ['estado', 'activo'] }),
        expect.objectContaining({ tabla: 'alimentos_propios', metodo: 'ilike', args: ['nombre', '%pan%'] }),
      ]),
    );
  });

  it('buscarAlimentosPropios con menos de 2 letras no consulta nada', async () => {
    comoRol('investigador');
    expect(await buscarAlimentosPropiosAction('p')).toEqual([]);
    expect(sb.tablasLlamadas().filter((t) => t !== 'profiles')).toHaveLength(0);
  });

  it('el detalle de un pendiente que creó un propio trae la información del propio', async () => {
    comoRol('investigador');
    sb.mockTable('v_alimentos_pendientes', { data: { id_pendiente: 7, nombre_original: 'Pan', ocurrencias: 1, id_alimento_propio: 4 }, error: null });
    sb.mockTable('detecciones_guardados_items', { data: [], error: null });
    sb.mockTable('detecciones_guardados_items', { data: [], error: null });
    sb.mockTable('alimentos_propios', {
      data: { id_alimento_propio: 4, estado: 'activo', fuente_dato: 'etiqueta_producto', justificacion: 'Etiqueta.', motivo_retiro: null },
      error: null,
    });
    const r = await getPendienteDetalleAction(7);
    if (!('ok' in r)) throw new Error(r.error);
    expect(r.propio).toEqual({ id: 4, estado: 'activo', fuenteDato: 'etiqueta_producto', justificacion: 'Etiqueta.', motivoRetiro: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run testing/composicion.test.ts testing/validacionActions.test.ts`
Expected: FAIL (no existen `claveIngrediente` ni las acciones nuevas; el esquema rechaza `origen: 'propio'`).

- [ ] **Step 3: Write the implementation**

(a) `src/lib/composicion.ts`:
1. En `componenteSchema` reemplazar `origen: z.literal('catalogo'),` por `origen: z.enum(['catalogo', 'propio']),`.
2. Después de `export type ComponenteComposicion …` agregar:

```ts
export type OrigenIngrediente = ComponenteComposicion['origen'];

/** Un alimento del catálogo y uno propio pueden tener el mismo id: la clave los distingue. */
export const claveIngrediente = (i: { origen: OrigenIngrediente; id: number }) => `${i.origen}:${i.id}`;
```
3. En `interface ComponenteEditable` agregar, antes de `id: number;`: `origen: OrigenIngrediente;`.
4. En `aEditables` agregar `origen: c.origen,` como primera propiedad del objeto devuelto.
5. En `aComponentes` reemplazar `componentes.push({ origen: 'catalogo', id: e.id,` por `componentes.push({ origen: e.origen, id: e.id,`.

(b) `src/app/(researcher)/validacion/ComposicionCatalogo.tsx`: en `agregar`, en el objeto que se agrega a `ingredientes`, poner `origen: 'catalogo',` antes de `id: a.id_alimento,` (la Task 4 lo reemplaza por la lógica de propios).

(c) `testing/fixtures/validacion.ts`: en `PENDIENTE`, después de `composicion: null,` agregar `id_alimento_propio: null,`.

(d) `src/app/(researcher)/validacion/actions.ts`:

1. Imports (junto a los existentes):

```ts
import type { AlimentoOption } from '@/app/alimentacion/actions';
import {
  FUENTES_DATO,
  JUSTIFICACION_MIN,
  MENSAJE_ADVERTENCIA,
  MENSAJE_BLOQUEO,
  MOTIVO_RETIRO_MIN,
  type CodigoAdvertencia,
  type CodigoBloqueo,
  type FuenteDato,
} from '@/lib/verificacionAlimento';
```

2. En `PendienteFila`, después de `composicion: unknown;` agregar `id_alimento_propio: number | null;`.

3. Después de `export type DescartarResultado …` agregar los tipos del bloque «Interfaces → Produces (actions.ts)» (los `export interface`/`export type` de arriba, tal cual).

4. En `PendienteDetalleResultado`, reemplazar `{ ok: true; pendiente: PendienteFila; ocurrencias: OcurrenciaDetalle[]; totalOcurrencias: number }` por `{ ok: true; pendiente: PendienteFila; ocurrencias: OcurrenciaDetalle[]; totalOcurrencias: number; propio?: PropioInfo | null }`.

5. Después de `const descartarSchema = …;` agregar:

```ts
const valorVerificacion = z.number().min(-100_000).max(100_000).nullable(); // el negativo llega a la RPC, que lo informa
const verificarSchema = z.object({
  nombre: z.string().max(200),
  kcal: valorVerificacion,
  proteinas: valorVerificacion,
  grasas: valorVerificacion,
  carbs: valorVerificacion,
});
const propioSchema = z.object({
  fuenteDato: z.enum(FUENTES_DATO.map((f) => f.valor) as [FuenteDato, ...FuenteDato[]]),
  justificacion: z.string().trim().min(JUSTIFICACION_MIN).max(1000),
  confirmaciones: z.object({
    reviseFuente: z.literal(true),
    valoresPor100g: z.literal(true),
    busqueExistente: z.literal(true),
  }),
  confirmaIncoherente: z.boolean().optional(),
  confirmaDistinto: z.boolean().optional(),
});
const validarComoPropioSchema = z.object({
  ...formBase,
  kcal: valor,
  proteinas: valor,
  grasas: valor,
  carbs: valor,
  propio: propioSchema,
});
const retirarSchema = z.object({ id, motivo: z.string().trim().min(MOTIVO_RETIRO_MIN).max(1000) });
```

y los tipos de entrada, junto a los otros `export type …Input`:

```ts
export type VerificarPropioInput = z.input<typeof verificarSchema>;
export type ValidarComoPropioInput = z.input<typeof validarComoPropioSchema>;
export type RetirarPropioInput = z.input<typeof retirarSchema>;
```

6. Antes de `function errorDeRpc` agregar:

```ts
const TEXTO_EVALUACION: Record<string, string> = {
  fuente: 'Elegí la fuente del dato.',
  justificacion: `Escribí una justificación de al menos ${JUSTIFICACION_MIN} caracteres.`,
  confirmaciones: 'Marcá las tres confirmaciones.',
  motivo: `Escribí el motivo (al menos ${MOTIVO_RETIRO_MIN} caracteres).`,
};

/** `PROPIO_BLOQUEADO` trae en `details` el JSON de bloqueos de `propio_verificar`. */
function textoBloqueos(details: string | null | undefined): string {
  try {
    const bloqueos = JSON.parse(details ?? '[]') as Array<{ codigo: CodigoBloqueo; existente?: ExistenteCatalogo }>;
    const textos = bloqueos.map((b) =>
      b.codigo === 'DUPLICADO' && b.existente
        ? `Ya existe «${b.existente.nombre}» (${b.existente.fuente}). Usalo desde "Del catálogo".`
        : (MENSAJE_BLOQUEO[b.codigo] ?? 'Hay valores que no se pueden aceptar.'),
    );
    return textos.length > 0 ? textos.join(' ') : 'Hay valores que no se pueden aceptar.';
  } catch {
    return 'Hay valores que no se pueden aceptar.';
  }
}
```

7. En `errorDeRpc`: reemplazar el `case 'ALIMENTO_NO_ENCONTRADO':` (y su `return`) por

```ts
    case 'ALIMENTO_NO_ENCONTRADO':
      return {
        error: error.details?.startsWith('propio:')
          ? 'Un alimento propio de la composición ya no está disponible (fue retirado). Quitalo de la lista.'
          : 'El alimento del catálogo elegido no existe',
      };
    case 'PROPIO_BLOQUEADO':
      return { error: textoBloqueos(error.details) };
    case 'PROPIO_ADVERTENCIA':
      return { error: `Falta confirmar: ${MENSAJE_ADVERTENCIA[error.details as CodigoAdvertencia] ?? 'revisá los avisos.'}` };
    case 'PROPIO_EVALUACION':
      return { error: TEXTO_EVALUACION[error.details ?? ''] ?? 'Completá la evaluación del alimento.' };
    case 'PROPIO_DUPLICADO':
      return { error: 'Otro investigador acaba de crear un alimento con ese nombre. Usalo desde "Del catálogo".' };
```

8. Después de `descartarPendienteAction` (y antes de `type OcurrenciaRaw`) agregar:

```ts
export async function verificarAlimentoPropioAction(input: VerificarPropioInput): Promise<VerificarPropioResultado> {
  const parsed = verificarSchema.safeParse(input);
  if (!parsed.success) return { error: 'Datos inválidos' };
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const f = parsed.data;
  const { data, error } = await auth.supabase.rpc('propio_verificar', {
    p_nombre: f.nombre,
    p_kcal: f.kcal,
    p_prot: f.proteinas,
    p_grasas: f.grasas,
    p_carbs: f.carbs,
  });
  if (error) return errorDeRpc(error);
  const v = data as VerificacionPropio;
  return { ok: true, bloqueos: v.bloqueos ?? [], advertencias: v.advertencias ?? [] };
}

export async function validarComoPropioAction(input: ValidarComoPropioInput): Promise<ValidarComoPropioResultado> {
  const parsed = validarComoPropioSchema.safeParse(input);
  if (!parsed.success) {
    return { error: 'Datos inválidos: completá el nombre, los 4 valores por 100 g, la fuente, la justificación y las 3 confirmaciones' };
  }
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const f = parsed.data;
  const { data, error } = await auth.supabase.rpc('pendiente_validar_como_propio', {
    p_id: f.id,
    p_nombre: f.nombre,
    p_categoria: f.categoria,
    p_kcal: f.kcal,
    p_prot: f.proteinas,
    p_grasas: f.grasas,
    p_carbs: f.carbs,
    p_observaciones: f.observaciones,
    p_propio: {
      fuente_dato: f.propio.fuenteDato,
      justificacion: f.propio.justificacion,
      confirmaciones: { revise_fuente: true, valores_por_100g: true, busque_existente: true },
      confirma_incoherente: f.propio.confirmaIncoherente ?? false,
      confirma_distinto: f.propio.confirmaDistinto ?? false,
    },
  });
  if (error) return errorDeRpc(error);

  revalidatePath('/validacion');
  const r = data as { id_alimento_propio: number; items_afectados: number };
  return { ok: true, idAlimentoPropio: r.id_alimento_propio, itemsAfectados: r.items_afectados };
}

export async function retirarAlimentoPropioAction(input: RetirarPropioInput): Promise<RetirarPropioResultado> {
  const parsed = retirarSchema.safeParse(input);
  if (!parsed.success) return { error: `Escribí el motivo (al menos ${MOTIVO_RETIRO_MIN} caracteres).` };
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const { error } = await auth.supabase.rpc('propio_retirar', { p_id: parsed.data.id, p_motivo: parsed.data.motivo });
  if (error) return errorDeRpc(error);

  revalidatePath('/validacion');
  return { ok: true };
}

/** Buscador de propios para "Del catálogo". Sólo investigadores; el diario de los deportistas no lo usa. */
export async function buscarAlimentosPropiosAction(query: string): Promise<AlimentoOption[]> {
  const q = query.trim().replace(/[*,\\]/g, '');
  if (q.length < 2) return [];
  const auth = await clienteInvestigador();
  if ('error' in auth) return [];

  const { data } = await auth.supabase
    .from('alimentos_propios')
    .select('id_alimento_propio, nombre, categoria, kcal_100g, proteinas_100g, grasas_100g, carbs_100g')
    .eq('estado', 'activo')
    .ilike('nombre', `%${q}%`)
    .order('nombre', { ascending: true })
    .limit(20);
  return ((data ?? []) as Array<{
    id_alimento_propio: number; nombre: string; categoria: string | null;
    kcal_100g: number; proteinas_100g: number; grasas_100g: number; carbs_100g: number;
  }>).map((p) => ({
    id_alimento: p.id_alimento_propio,
    nombre: p.nombre,
    categoria: p.categoria,
    fuente: 'PROPIO',
    marca: null,
    denominacion: null,
    kcal_100g: p.kcal_100g,
    proteinas_100g: p.proteinas_100g,
    grasas_100g: p.grasas_100g,
    carbs_100g: p.carbs_100g,
  }));
}
```

9. En `getPendienteDetalleAction`, reemplazar la línea final `return { ok: true, pendiente, ocurrencias, totalOcurrencias: Number(pendiente.ocurrencias) };` por:

```ts
  let propio: PropioInfo | null = null;
  if (pendiente.id_alimento_propio != null) {
    const { data } = await supabase
      .from('alimentos_propios')
      .select('id_alimento_propio, estado, fuente_dato, justificacion, motivo_retiro')
      .eq('id_alimento_propio', pendiente.id_alimento_propio)
      .single();
    if (data) {
      propio = {
        id: data.id_alimento_propio,
        estado: data.estado,
        fuenteDato: data.fuente_dato,
        justificacion: data.justificacion,
        motivoRetiro: data.motivo_retiro,
      };
    }
  }
  return { ok: true, pendiente, ocurrencias, totalOcurrencias: Number(pendiente.ocurrencias), propio };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS (suite completa) y `tsc` limpio. Si `tsc` marca un literal de `ComponenteEditable` sin `origen` en algún test existente, agregarle `origen: 'catalogo'`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/composicion.ts "src/app/(researcher)/validacion/actions.ts" "src/app/(researcher)/validacion/ComposicionCatalogo.tsx" testing/fixtures/validacion.ts testing/composicion.test.ts testing/validacionActions.test.ts
git commit -m "feat: acciones de alimentos propios (verificar, crear, retirar, buscar) y origen en la composición

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 4: `ComposicionCatalogo` — buscar y usar alimentos propios como ingredientes

**Files:**
- Modify: `src/app/(researcher)/validacion/ComposicionCatalogo.tsx`
- Modify: `testing/PendienteDetalle.test.tsx` y `testing/ValidacionClient.test.tsx` (los mocks del módulo de acciones ganan las funciones nuevas)
- Test: `testing/ComposicionCatalogo.test.tsx`

**Interfaces:**
- Consumes: `buscarAlimentosPropiosAction` (Task 3), `claveIngrediente`, `ComponenteEditable.origen` (Task 3).
- Produces: el buscador de "Del catálogo" muestra primero hasta 3 propios (etiqueta **PROPIO**) y después hasta 6 del catálogo; un ingrediente propio se identifica por `origen + id` (no se confunde con un alimento del catálogo con el mismo id). El diario de los deportistas NO usa este buscador.

- [ ] **Step 1: Write the failing tests**

En `testing/ComposicionCatalogo.test.tsx`:

1. Debajo de `vi.mock('@/app/alimentacion/actions', …)` agregar:

```tsx
vi.mock('@/app/(researcher)/validacion/actions', () => ({ buscarAlimentosPropiosAction: vi.fn() }));
```

2. Agregar al import de acciones: `import { buscarAlimentosPropiosAction } from '@/app/(researcher)/validacion/actions';`

3. Después de la constante `SIN_DATOS` agregar:

```tsx
// Un propio con el MISMO id que el aceite del catálogo: son alimentos distintos.
const PAN_PROPIO = { id_alimento: 31, nombre: 'Pan casero', categoria: 'panes', fuente: 'PROPIO', marca: null, denominacion: null, kcal_100g: 250, proteinas_100g: 8, grasas_100g: 3, carbs_100g: 48 };
```

4. En el `beforeEach`, después de `mockBusqueda();` agregar `vi.mocked(buscarAlimentosPropiosAction).mockReset().mockImplementation(async (q: string) => (q.startsWith('pan') ? [PAN_PROPIO] : []));`

5. Agregar dentro del `describe('ComposicionCatalogo', …)`:

```tsx
  it('los propios aparecen en el buscador con la etiqueta PROPIO, antes que los del catálogo', async () => {
    const user = userEvent.setup();
    vi.mocked(searchAlimentosAction).mockResolvedValue([{ ...ACEITE, id_alimento: 77, nombre: 'Pan de molde', fuente: 'SARA2' }]);
    render(<Wrapper />);
    await user.type(screen.getByLabelText('Agregar alimento del catálogo'), 'pan');
    const botones = await screen.findAllByRole('button', { name: /^Agregar/ });
    expect(botones.map((b) => b.getAttribute('aria-label'))).toEqual(['Agregar Pan casero', 'Agregar Pan de molde']);
    expect(within(botones[0]).getByText('PROPIO')).toBeInTheDocument();
    expect(within(botones[1]).queryByText('PROPIO')).not.toBeInTheDocument();
  });

  it('un propio y un alimento del catálogo con el mismo id se agregan como ingredientes distintos', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await agregar(user, 'aceite', 'Aceite de oliva'); // catálogo id 31, arranca con 20 g
    await agregar(user, 'pan', 'Pan casero'); // propio id 31
    await gramos(user, 'Aceite de oliva', '10');
    await gramos(user, 'Pan casero', '10');
    expect(screen.getAllByLabelText(/^Gramos de /)).toHaveLength(2);
    // (800 × 10 + 250 × 10) / 20 = 525
    expect(within(resultado()).getByText(/525 kcal/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quitar Pan casero' }));
    expect(screen.getByLabelText('Gramos de Aceite de oliva')).toBeInTheDocument();
    expect(screen.queryByLabelText('Gramos de Pan casero')).not.toBeInTheDocument();
  });

  it('agregar dos veces el mismo propio no lo repite', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await agregar(user, 'pan', 'Pan casero');
    await user.type(screen.getByLabelText('Agregar alimento del catálogo'), 'pan');
    await user.click(await screen.findByRole('button', { name: /Agregar Pan casero/ }));
    expect(screen.getAllByLabelText('Gramos de Pan casero')).toHaveLength(1);
  });

  it('si falla el buscador de propios igual se ven los del catálogo', async () => {
    const user = userEvent.setup();
    vi.mocked(buscarAlimentosPropiosAction).mockRejectedValue(new Error('boom'));
    render(<Wrapper />);
    await user.type(screen.getByLabelText('Agregar alimento del catálogo'), 'aceite');
    expect(await screen.findByRole('button', { name: /Agregar Aceite de oliva/ })).toBeInTheDocument();
  });
```

6. En `testing/PendienteDetalle.test.tsx`, en el `vi.mock('@/app/(researcher)/validacion/actions', …)` agregar `buscarAlimentosPropiosAction: vi.fn(),` y, en el `beforeEach`, `vi.mocked(buscarAlimentosPropiosAction).mockReset().mockResolvedValue([]);` (con su import junto a los demás). En `testing/ValidacionClient.test.tsx` agregar `buscarAlimentosPropiosAction: vi.fn().mockResolvedValue([]),` al mock del mismo módulo.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run testing/ComposicionCatalogo.test.tsx`
Expected: FAIL (no hay etiqueta PROPIO ni se llama al buscador de propios; los dos ingredientes con id 31 colisionan).

- [ ] **Step 3: Write the implementation**

En `src/app/(researcher)/validacion/ComposicionCatalogo.tsx`:

1. Imports: cambiar `import type { OcurrenciaDetalle } from './actions';` por `import { buscarAlimentosPropiosAction, type OcurrenciaDetalle } from './actions';` y agregar `claveIngrediente` al import de `@/lib/composicion`.

2. Reemplazar el cuerpo del efecto de búsqueda (el `setTimeout`) por:

```tsx
    const timer = setTimeout(async () => {
      // Los propios van primero; si su buscador falla, se muestran igual los del catálogo.
      const [catalogo, propios] = await Promise.all([
        searchAlimentosAction(busqueda, ''),
        buscarAlimentosPropiosAction(busqueda).catch(() => [] as AlimentoOption[]),
      ]);
      setResultados([...propios.slice(0, 3), ...catalogo.slice(0, 6)]);
    }, 300);
```

3. En `agregar`, reemplazar el cuerpo por:

```tsx
  const agregar = (a: AlimentoOption) => {
    setBusqueda('');
    setResultados([]);
    const origen = a.fuente === 'PROPIO' ? 'propio' : 'catalogo';
    if (ingredientes.some((i) => claveIngrediente(i) === claveIngrediente({ origen, id: a.id_alimento }))) return; // no se repite
    onIngredientes([
      ...ingredientes,
      {
        origen,
        id: a.id_alimento,
        nombre: a.nombre,
        fuente: a.fuente,
        // El primero arranca con todo el peso de la foto; los demás los completa el investigador.
        gramos: ingredientes.length === 0 && peso > 0 ? String(redondear1(peso)) : '',
        macros: aMacros(a),
      },
    ]);
  };
```

4. Reemplazar `cambiarGramos` por (clave en vez de id):

```tsx
  const cambiarGramos = (clave: string, gramos: string) =>
    onIngredientes(ingredientes.map((i) => (claveIngrediente(i) === clave ? { ...i, gramos } : i)));
```

5. Agregar, arriba de `export default function`, el componente de la etiqueta (violeta, contraste ≥ 7:1):

```tsx
function Fuente({ fuente }: { fuente: string }) {
  return fuente === 'PROPIO' ? (
    <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs font-semibold text-violet-800">PROPIO</span>
  ) : (
    <span className="text-xs text-slate-600">{fuente}</span>
  );
}
```

6. En la lista de resultados reemplazar `{a.nombre} <span className="text-xs text-slate-600">{a.fuente}</span>` por `{a.nombre} <Fuente fuente={a.fuente} />`; y en la lista de ingredientes reemplazar la `<li key={i.id} …>` por `<li key={claveIngrediente(i)} …>`, el `{i.nombre} <span className="text-xs text-slate-600">{i.fuente}</span>` por `{i.nombre} <Fuente fuente={i.fuente} />`, el `onChange={(e) => cambiarGramos(i.id, e.target.value)}` por `onChange={(e) => cambiarGramos(claveIngrediente(i), e.target.value)}` y el `onIngredientes(ingredientes.filter((x) => x.id !== i.id))` por `onIngredientes(ingredientes.filter((x) => claveIngrediente(x) !== claveIngrediente(i)))`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS y `tsc` limpio (incluye `PendienteDetalle.test.tsx` y `ValidacionClient.test.tsx` con los mocks nuevos).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(researcher)/validacion/ComposicionCatalogo.tsx" testing/ComposicionCatalogo.test.tsx testing/PendienteDetalle.test.tsx testing/ValidacionClient.test.tsx
git commit -m "feat: los alimentos propios se buscan y se usan como ingredientes en Del catálogo (etiqueta PROPIO)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 5: `NuevoAlimentoPropio` y la creación desde "A mano"

**Files:**
- Create: `src/app/(researcher)/validacion/NuevoAlimentoPropio.tsx`
- Modify: `src/app/(researcher)/validacion/PendienteDetalle.tsx`
- Test: `testing/NuevoAlimentoPropio.test.tsx` (nuevo), `testing/PendienteDetalle.test.tsx`

**Interfaces:**
- Consumes: `verificarAlimentoPropioAction`, `validarComoPropioAction`, `VerificacionPropio` (Task 3); `verificarValores`, `FUENTES_DATO`, `JUSTIFICACION_MIN`, `MENSAJE_BLOQUEO`, `MENSAJE_ADVERTENCIA`, `ValoresPropio`, `FuenteDato` (Task 1).
- Produces:
  ```ts
  export interface PropioForm { activo: boolean; fuente: FuenteDato | ''; justificacion: string; reviseFuente: boolean; valores100: boolean; busque: boolean; confirmaIncoherente: boolean; confirmaDistinto: boolean }
  export const PROPIO_VACIO: PropioForm
  export function propioListo(p: PropioForm, v: VerificacionPropio | null): boolean
  export default function NuevoAlimentoPropio(props: { nombre: string; valores: ValoresPropio; propio: PropioForm; onChange: (patch: Partial<PropioForm>) => void; onVerificacion: (v: VerificacionPropio | null) => void }): JSX.Element
  ```
  Etiquetas que usan los tests: casilla `Agregar este alimento al catálogo propio`; `Fuente del dato`; `Justificación`; confirmaciones `Revisé la fuente`, `Los valores son por 100 g`, `Busqué y no existe ya en SARA2, ANMAT ni en los propios`; `Confirmo que las kcal son correctas`; `Confirmo que es un alimento distinto`.

- [ ] **Step 1: Write the failing tests**

(a) Crear `testing/NuevoAlimentoPropio.test.tsx`:

```tsx
/**
 * NUT-119 — Cuándo el alimento propio está listo para crearse (evaluación completa,
 * sin bloqueos y con las advertencias confirmadas).
 */
import { describe, expect, it } from 'vitest';
import { PROPIO_VACIO, propioListo, type PropioForm } from '@/app/(researcher)/validacion/NuevoAlimentoPropio';
import type { VerificacionPropio } from '@/app/(researcher)/validacion/actions';

const COMPLETO: PropioForm = {
  ...PROPIO_VACIO, activo: true, fuente: 'etiqueta_producto', justificacion: 'Etiqueta del envase.',
  reviseFuente: true, valores100: true, busque: true,
};
const LIMPIA: VerificacionPropio = { bloqueos: [], advertencias: [] };

describe('propioListo', () => {
  it('evaluación completa y verificación limpia: listo', () => {
    expect(propioListo(COMPLETO, LIMPIA)).toBe(true);
  });

  it.each([
    ['no está activo', { ...COMPLETO, activo: false }],
    ['sin fuente', { ...COMPLETO, fuente: '' as const }],
    ['justificación corta', { ...COMPLETO, justificacion: ' corta ' }],
    ['falta revisé la fuente', { ...COMPLETO, reviseFuente: false }],
    ['falta valores por 100 g', { ...COMPLETO, valores100: false }],
    ['falta busqué', { ...COMPLETO, busque: false }],
  ])('%s: no está listo', (_n, p) => {
    expect(propioListo(p, LIMPIA)).toBe(false);
  });

  it('sin verificación (todavía verificando o falló) no está listo', () => {
    expect(propioListo(COMPLETO, null)).toBe(false);
  });

  it('un bloqueo lo frena aunque todo lo demás esté completo', () => {
    expect(propioListo(COMPLETO, { bloqueos: [{ codigo: 'DUPLICADO' }], advertencias: [] })).toBe(false);
  });

  it('las advertencias exigen su confirmación', () => {
    const incoherente: VerificacionPropio = { bloqueos: [], advertencias: [{ codigo: 'KCAL_INCOHERENTE' }] };
    expect(propioListo(COMPLETO, incoherente)).toBe(false);
    expect(propioListo({ ...COMPLETO, confirmaIncoherente: true }, incoherente)).toBe(true);
    const similar: VerificacionPropio = { bloqueos: [], advertencias: [{ codigo: 'SIMILAR', similares: [] }] };
    expect(propioListo(COMPLETO, similar)).toBe(false);
    expect(propioListo({ ...COMPLETO, confirmaDistinto: true }, similar)).toBe(true);
  });
});
```

(b) En `testing/PendienteDetalle.test.tsx`:
1. En el `vi.mock('@/app/(researcher)/validacion/actions', …)` agregar `verificarAlimentoPropioAction: vi.fn(), validarComoPropioAction: vi.fn(),` e importarlos junto a los demás.
2. En el `beforeEach` agregar:
```tsx
  vi.mocked(verificarAlimentoPropioAction).mockReset().mockResolvedValue({ ok: true, bloqueos: [], advertencias: [] });
  vi.mocked(validarComoPropioAction).mockReset().mockResolvedValue({ ok: true, idAlimentoPropio: 9, itemsAfectados: 2 });
```
3. Agregar al final del archivo:

```tsx
describe('PendienteDetalle — crear un alimento propio desde A mano', () => {
  const CASILLA = 'Agregar este alimento al catálogo propio';

  async function abrirAMano() {
    const r = await abrir();
    await r.user.click(pestana('A mano'));
    return r;
  }

  /** La verificación del servidor tarda ~400 ms (debounce): Validar se habilita recién cuando vuelve. */
  async function esperarListo() {
    await waitFor(() => expect(screen.getByRole('button', { name: 'Validar' })).toBeEnabled());
  }

  async function completarEvaluacion(user: ReturnType<typeof userEvent.setup>) {
    await user.selectOptions(screen.getByLabelText('Fuente del dato'), 'etiqueta_producto');
    await user.type(screen.getByLabelText('Justificación'), 'Etiqueta del envase, por 100 g.');
    await user.click(screen.getByLabelText('Revisé la fuente'));
    await user.click(screen.getByLabelText('Los valores son por 100 g'));
    await user.click(screen.getByLabelText('Busqué y no existe ya en SARA2, ANMAT ni en los propios'));
  }

  it('la casilla sólo existe en A mano, no en IA ni en Del catálogo', async () => {
    const { user } = await abrir();
    expect(screen.queryByLabelText(CASILLA)).not.toBeInTheDocument();
    await user.click(pestana('Del catálogo'));
    expect(screen.queryByLabelText(CASILLA)).not.toBeInTheDocument();
    await user.click(pestana('A mano'));
    expect(screen.getByLabelText(CASILLA)).not.toBeChecked();
  });

  it('marcarla pide fuente, justificación y las tres confirmaciones; Validar espera a que esté todo', async () => {
    const { user } = await abrirAMano();
    await user.click(screen.getByLabelText(CASILLA));
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
    await completarEvaluacion(user);
    await esperarListo();
  });

  it('crea el propio: manda la evaluación, NO llama a validar común y cierra', async () => {
    const { user, onResuelto } = await abrirAMano();
    await user.click(screen.getByLabelText(CASILLA));
    await completarEvaluacion(user);
    await esperarListo();
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    expect(within(screen.getByRole('alertdialog')).getByText(/se agregará «Flan casero» al catálogo propio/)).toBeInTheDocument();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }));
    expect(validarComoPropioAction).toHaveBeenCalledWith({
      id: 5, nombre: 'Flan casero', categoria: 'postre', observaciones: null,
      kcal: 150, proteinas: 3, grasas: 5, carbs: 23,
      propio: {
        fuenteDato: 'etiqueta_producto',
        justificacion: 'Etiqueta del envase, por 100 g.',
        confirmaciones: { reviseFuente: true, valoresPor100g: true, busqueExistente: true },
        confirmaIncoherente: false,
        confirmaDistinto: false,
      },
    });
    expect(validarPendienteAction).not.toHaveBeenCalled();
    expect(onResuelto).toHaveBeenCalledTimes(1);
  });

  it('un bloqueo del servidor (nombre duplicado) se muestra con el alimento existente y frena Validar', async () => {
    vi.mocked(verificarAlimentoPropioAction).mockResolvedValue({
      ok: true,
      bloqueos: [{ codigo: 'DUPLICADO', existente: { origen: 'catalogo', id: 5, nombre: 'Huevo', fuente: 'ANMAT' } }],
      advertencias: [],
    });
    const { user } = await abrirAMano();
    await user.click(screen.getByLabelText(CASILLA));
    await completarEvaluacion(user);
    expect(await screen.findByText(/Ya existe «Huevo» \(ANMAT\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
  });

  it('un nombre parecido lista los similares y exige confirmar que es distinto', async () => {
    vi.mocked(verificarAlimentoPropioAction).mockResolvedValue({
      ok: true,
      bloqueos: [],
      advertencias: [{ codigo: 'SIMILAR', similares: [{ origen: 'catalogo', id: 1, nombre: 'Flan de vainilla', fuente: 'SARA2', similitud: 0.9 }] }],
    });
    const { user } = await abrirAMano();
    await user.click(screen.getByLabelText(CASILLA));
    await completarEvaluacion(user);
    expect(await screen.findByText(/Flan de vainilla/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
    await user.click(screen.getByLabelText('Confirmo que es un alimento distinto'));
    await esperarListo();
  });

  it('kcal incoherentes exigen confirmación explícita', async () => {
    vi.mocked(verificarAlimentoPropioAction).mockResolvedValue({ ok: true, bloqueos: [], advertencias: [{ codigo: 'KCAL_INCOHERENTE' }] });
    const { user } = await abrirAMano();
    await user.click(screen.getByLabelText(CASILLA));
    await completarEvaluacion(user);
    expect(await screen.findByText(/Las kcal no cierran con 4 kcal/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
    await user.click(screen.getByLabelText('Confirmo que las kcal son correctas'));
    await esperarListo();
  });

  it('al editar un valor se vuelve a verificar y Validar espera el resultado nuevo', async () => {
    const { user } = await abrirAMano();
    await user.click(screen.getByLabelText(CASILLA));
    await completarEvaluacion(user);
    await esperarListo();
    await waitFor(() => expect(verificarAlimentoPropioAction).toHaveBeenCalledWith({ nombre: 'Flan casero', kcal: 150, proteinas: 3, grasas: 5, carbs: 23 }));

    let resolver: (v: Awaited<ReturnType<typeof verificarAlimentoPropioAction>>) => void = () => {};
    vi.mocked(verificarAlimentoPropioAction).mockImplementation(() => new Promise((r) => { resolver = r; }));
    const kcal = screen.getByLabelText('kcal / 100 g');
    await user.clear(kcal);
    await user.type(kcal, '160');
    await waitFor(() => expect(verificarAlimentoPropioAction).toHaveBeenLastCalledWith(expect.objectContaining({ kcal: 160 })));
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled(); // verificando: no se valida con una verificación vieja
    resolver({ ok: true, bloqueos: [], advertencias: [] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Validar' })).toBeEnabled());
  });

  it('un error del servidor al crear se muestra y no cierra', async () => {
    vi.mocked(validarComoPropioAction).mockResolvedValue({ error: 'Otro investigador acaba de crear un alimento con ese nombre. Usalo desde "Del catálogo".' });
    const { user, onResuelto } = await abrirAMano();
    await user.click(screen.getByLabelText(CASILLA));
    await completarEvaluacion(user);
    await esperarListo();
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Otro investigador acaba de crear');
    expect(onResuelto).not.toHaveBeenCalled();
  });

  it('marcar la casilla y volver a IA valida como siempre, sin crear el propio', async () => {
    const { user } = await abrirAMano();
    await user.click(screen.getByLabelText(CASILLA));
    await user.click(pestana('IA'));
    await confirmarValidar(user);
    expect(validarPendienteAction).toHaveBeenCalledTimes(1);
    expect(validarComoPropioAction).not.toHaveBeenCalled();
  });

  it('marcar la casilla no cuenta como "cambios sin guardar" (el borrador no la guarda)', async () => {
    const { user } = await abrirAMano();
    await user.click(screen.getByLabelText(CASILLA));
    expect(screen.queryByText(/Cambios sin guardar/)).not.toBeInTheDocument();
  });
});
```
y agregar `waitFor` al import de `@testing-library/react`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run testing/NuevoAlimentoPropio.test.tsx testing/PendienteDetalle.test.tsx`
Expected: FAIL (no existe `NuevoAlimentoPropio` ni la casilla).

- [ ] **Step 3: Write the implementation**

(a) Crear `src/app/(researcher)/validacion/NuevoAlimentoPropio.tsx`:

```tsx
'use client';

/**
 * NUT-119 — "Agregar este alimento al catálogo propio" (pestaña "A mano"): fuente del
 * dato, justificación y tres confirmaciones, con la verificación del servidor en vivo
 * (duplicados, nombres parecidos y kcal incoherentes). La verificación se repite cada
 * vez que cambia el nombre o un valor; mientras corre, el alimento no está "listo".
 */
import { useEffect, useState } from 'react';
import {
  FUENTES_DATO,
  JUSTIFICACION_MIN,
  MENSAJE_ADVERTENCIA,
  MENSAJE_BLOQUEO,
  verificarValores,
  type FuenteDato,
  type ValoresPropio,
} from '@/lib/verificacionAlimento';
import { verificarAlimentoPropioAction, type VerificacionPropio } from './actions';

export interface PropioForm {
  activo: boolean;
  fuente: FuenteDato | '';
  justificacion: string;
  reviseFuente: boolean;
  valores100: boolean;
  busque: boolean;
  confirmaIncoherente: boolean;
  confirmaDistinto: boolean;
}

export const PROPIO_VACIO: PropioForm = {
  activo: false,
  fuente: '',
  justificacion: '',
  reviseFuente: false,
  valores100: false,
  busque: false,
  confirmaIncoherente: false,
  confirmaDistinto: false,
};

/** ¿Se puede crear el propio? Evaluación completa, sin bloqueos y con las advertencias confirmadas. */
export function propioListo(p: PropioForm, v: VerificacionPropio | null): boolean {
  if (!p.activo || v == null || v.bloqueos.length > 0) return false;
  if (p.fuente === '' || p.justificacion.trim().length < JUSTIFICACION_MIN) return false;
  if (!p.reviseFuente || !p.valores100 || !p.busque) return false;
  if (v.advertencias.some((a) => a.codigo === 'KCAL_INCOHERENTE') && !p.confirmaIncoherente) return false;
  if (v.advertencias.some((a) => a.codigo === 'SIMILAR') && !p.confirmaDistinto) return false;
  return true;
}

interface Props {
  nombre: string;
  valores: ValoresPropio;
  propio: PropioForm;
  onChange: (patch: Partial<PropioForm>) => void;
  /** Resultado de la última verificación del servidor; null mientras verifica o si falló. */
  onVerificacion: (v: VerificacionPropio | null) => void;
}

const claseCampo = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

export default function NuevoAlimentoPropio({ nombre, valores, propio, onChange, onVerificacion }: Props) {
  const [verificacion, setVerificacion] = useState<VerificacionPropio | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [falloVerificar, setFalloVerificar] = useState(false);

  const local = verificarValores(nombre, valores);
  const completos = [valores.kcal, valores.proteinas, valores.grasas, valores.carbs].every((v) => v != null);

  // Verificación del servidor (duplicados y parecidos viven en la base). Cualquier cambio invalida la anterior.
  useEffect(() => {
    setVerificacion(null);
    onVerificacion(null);
    setFalloVerificar(false);
    if (!propio.activo || !completos || nombre.trim() === '') {
      setVerificando(false);
      return;
    }
    let cancelado = false;
    setVerificando(true);
    const timer = setTimeout(async () => {
      const r = await verificarAlimentoPropioAction({ nombre: nombre.trim(), ...valores });
      if (cancelado) return;
      setVerificando(false);
      if ('error' in r) {
        setFalloVerificar(true);
        return;
      }
      const v = { bloqueos: r.bloqueos, advertencias: r.advertencias };
      setVerificacion(v);
      onVerificacion(v);
    }, 400);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propio.activo, nombre, valores.kcal, valores.proteinas, valores.grasas, valores.carbs]);

  if (!propio.activo) {
    return (
      <div className="rounded-xl border border-slate-200 p-3">
        <label className="flex items-start gap-2 text-sm font-medium text-slate-900">
          <input
            type="checkbox"
            checked={false}
            onChange={() => onChange({ activo: true })}
            className="mt-0.5 h-4 w-4"
          />
          Agregar este alimento al catálogo propio
        </label>
        <p className="mt-1 pl-6 text-xs text-slate-600">
          Para reutilizarlo después desde &quot;Del catálogo&quot; (etiqueta PROPIO). Se verifica antes de entrar y se puede retirar.
        </p>
      </div>
    );
  }

  const bloqueos = [
    ...local.bloqueos.filter((c) => c !== 'DUPLICADO').map((c) => MENSAJE_BLOQUEO[c]),
    ...(verificacion?.bloqueos ?? []).map((b) =>
      b.codigo === 'DUPLICADO' && b.existente
        ? `Ya existe «${b.existente.nombre}» (${b.existente.fuente}). Usalo desde "Del catálogo".`
        : MENSAJE_BLOQUEO[b.codigo],
    ),
  ];
  const incoherente = verificacion?.advertencias.some((a) => a.codigo === 'KCAL_INCOHERENTE');
  const similar = verificacion?.advertencias.find((a) => a.codigo === 'SIMILAR');

  return (
    <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-3">
      <label className="flex items-start gap-2 text-sm font-medium text-slate-900">
        <input type="checkbox" checked onChange={() => onChange({ activo: false })} className="mt-0.5 h-4 w-4" />
        Agregar este alimento al catálogo propio
      </label>

      <div aria-live="polite" className="space-y-1 text-sm">
        {verificando && <p className="text-slate-700">Verificando…</p>}
        {falloVerificar && <p className="text-amber-700">No se pudo verificar ahora. Revisá los valores y probá de nuevo.</p>}
        {bloqueos.map((m) => (
          <p key={m} role="alert" className="text-red-700">
            {m}
          </p>
        ))}
        {incoherente && (
          <div className="rounded-lg bg-amber-50 p-2 text-amber-800">
            <p>{MENSAJE_ADVERTENCIA.KCAL_INCOHERENTE}</p>
            <label className="mt-1 flex items-start gap-2 font-medium">
              <input
                type="checkbox"
                checked={propio.confirmaIncoherente}
                onChange={(e) => onChange({ confirmaIncoherente: e.target.checked })}
                className="mt-0.5 h-4 w-4"
              />
              Confirmo que las kcal son correctas
            </label>
          </div>
        )}
        {similar && (
          <div className="rounded-lg bg-amber-50 p-2 text-amber-800">
            <p>{MENSAJE_ADVERTENCIA.SIMILAR}</p>
            <ul className="ml-4 list-disc">
              {(similar.similares ?? []).map((s) => (
                <li key={`${s.origen}:${s.id}`}>
                  {s.nombre} <span className="text-xs">({s.fuente})</span>
                </li>
              ))}
            </ul>
            <label className="mt-1 flex items-start gap-2 font-medium">
              <input
                type="checkbox"
                checked={propio.confirmaDistinto}
                onChange={(e) => onChange({ confirmaDistinto: e.target.checked })}
                className="mt-0.5 h-4 w-4"
              />
              Confirmo que es un alimento distinto
            </label>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Fuente del dato
          <select
            value={propio.fuente}
            onChange={(e) => onChange({ fuente: e.target.value as FuenteDato | '' })}
            className={`mt-1 ${claseCampo}`}
          >
            <option value="">Elegí una fuente…</option>
            {FUENTES_DATO.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.etiqueta}
              </option>
            ))}
          </select>
        </label>
        <div>
          <label htmlFor="pv-propio-justificacion" className="block text-sm font-medium text-slate-700">
            Justificación
          </label>
          <textarea
            id="pv-propio-justificacion"
            value={propio.justificacion}
            onChange={(e) => onChange({ justificacion: e.target.value })}
            rows={2}
            placeholder="De dónde sale el valor (o por qué un valor llamativo es correcto)"
            className={`mt-1 ${claseCampo}`}
          />
          <span className="text-xs text-slate-600">
            {propio.justificacion.trim().length}/{JUSTIFICACION_MIN} caracteres como mínimo
          </span>
        </div>
      </div>

      <div className="space-y-1 text-sm text-slate-800">
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={propio.reviseFuente} onChange={(e) => onChange({ reviseFuente: e.target.checked })} className="mt-0.5 h-4 w-4" />
          Revisé la fuente
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={propio.valores100} onChange={(e) => onChange({ valores100: e.target.checked })} className="mt-0.5 h-4 w-4" />
          Los valores son por 100 g
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={propio.busque} onChange={(e) => onChange({ busque: e.target.checked })} className="mt-0.5 h-4 w-4" />
          Busqué y no existe ya en SARA2, ANMAT ni en los propios
        </label>
      </div>
    </div>
  );
}
```

(b) `src/app/(researcher)/validacion/PendienteDetalle.tsx`:

1. Imports: agregar
```tsx
import NuevoAlimentoPropio, { PROPIO_VACIO, propioListo, type PropioForm } from './NuevoAlimentoPropio';
```
y, en el import de `./actions`, `validarComoPropioAction,` y `type VerificacionPropio,`.

2. En `interface Form` agregar al final `propio: PropioForm;` y en `formInicial` agregar `propio: PROPIO_VACIO,` al objeto devuelto.

3. Debajo de `const [aviso, setAviso] …` agregar `const [verificacionPropio, setVerificacionPropio] = useState<VerificacionPropio | null>(null);` y, en el efecto de carga, junto a los demás `set…` de reinicio, `setVerificacionPropio(null);`.

4. El indicador de cambios no cuenta el pedido de propio (no se guarda en el borrador). Reemplazar las tres serializaciones: en el efecto de carga `setBase(JSON.stringify(inicial));` → `setBase(JSON.stringify({ ...inicial, propio: null }));`; en `guardarBorrador` `setBase(JSON.stringify(form));` → `setBase(JSON.stringify({ ...form, propio: null }));`; y `const sinGuardar = form != null && JSON.stringify(form) !== base;` → `const sinGuardar = form != null && JSON.stringify({ ...form, propio: null }) !== base;`.

5. Después de `const incoherente = …;` agregar:

```tsx
  const creaPropio = form?.modo === 'manual' && form.propio.activo;
```
y reemplazar `const puedeResolver = !soloLectura && macros != null && (form?.nombre.trim() ?? '') !== '' && !trabajando;` por:

```tsx
  const puedeResolver =
    !soloLectura &&
    macros != null &&
    (form?.nombre.trim() ?? '') !== '' &&
    !trabajando &&
    (!creaPropio || propioListo(form!.propio, verificacionPropio));
```

6. En `validar`, reemplazar la llamada `const r = await validarPendienteAction({ ...argsForm(), ...valores(), composicion: composicion(false) });` por:

```tsx
    const r = creaPropio
      ? await validarComoPropioAction({
          ...argsForm(),
          kcal: macros!.kcal_100g,
          proteinas: macros!.proteinas_100g,
          grasas: macros!.grasas_100g,
          carbs: macros!.carbs_100g,
          propio: {
            fuenteDato: form!.propio.fuente as Exclude<PropioForm['fuente'], ''>,
            justificacion: form!.propio.justificacion.trim(),
            confirmaciones: { reviseFuente: true, valoresPor100g: true, busqueExistente: true },
            confirmaIncoherente: form!.propio.confirmaIncoherente,
            confirmaDistinto: form!.propio.confirmaDistinto,
          },
        })
      : await validarPendienteAction({ ...argsForm(), ...valores(), composicion: composicion(false) });
```

7. En el panel de la pestaña `manual`, después del `<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">…</div>` de los cuatro `Input` (dentro del mismo `{form.modo === 'manual' && ( … )}`), envolver ambos en un fragmento y agregar el componente. El bloque queda:

```tsx
                {form.modo === 'manual' && (
                  <>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      …los cuatro Input de siempre, sin cambios…
                    </div>
                    {!soloLectura && (
                      <NuevoAlimentoPropio
                        nombre={form.nombre}
                        valores={{ kcal: aNumero(form.kcal), proteinas: aNumero(form.prot), grasas: aNumero(form.grasas), carbs: aNumero(form.carbs) }}
                        propio={form.propio}
                        onChange={(patch) => cambiar({ propio: { ...form.propio, ...patch } })}
                        onVerificacion={setVerificacionPropio}
                      />
                    )}
                  </>
                )}
```

8. En el cuadro de confirmación de validar, reemplazar el párrafo de `confirmando === 'validar'` por:

```tsx
                  <p>
                    Se actualizarán <strong>{plural(total)}</strong> del diario con estos valores
                    {vinculo ? ` (vinculado a ${vinculo})` : ''}, recalculados según el gramaje de cada uno.
                    {creaPropio ? ` Además se agregará «${form.nombre.trim()}» al catálogo propio.` : ''}
                  </p>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS y `tsc` limpio.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(researcher)/validacion/NuevoAlimentoPropio.tsx" "src/app/(researcher)/validacion/PendienteDetalle.tsx" testing/NuevoAlimentoPropio.test.tsx testing/PendienteDetalle.test.tsx
git commit -m "feat: crear un alimento propio desde A mano (fuente, justificación, confirmaciones y verificación en vivo)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 6: «Retirar del catálogo propio» en el detalle de sólo lectura

**Files:**
- Modify: `src/app/(researcher)/validacion/PendienteDetalle.tsx`
- Test: `testing/PendienteDetalle.test.tsx`

**Interfaces:**
- Consumes: `retirarAlimentoPropioAction`, `PropioInfo`, `getPendienteDetalleAction().propio` (Task 3); `MOTIVO_RETIRO_MIN` (Task 1).
- Produces: en el detalle de un alimento validado que creó un propio: sección "Alimento propio" con fuente y justificación; si está activo, botón **Retirar del catálogo propio** → motivo (≥ 10 caracteres) → **Confirmar retiro**; si está retirado, muestra el motivo. Tras retirar se llama a `onGuardado` (refresca el listado).

- [ ] **Step 1: Write the failing tests**

En `testing/PendienteDetalle.test.tsx`:

1. En el mock de acciones agregar `retirarAlimentoPropioAction: vi.fn(),` (con su import) y en el `beforeEach` `vi.mocked(retirarAlimentoPropioAction).mockReset().mockResolvedValue({ ok: true });`.
2. Reemplazar el helper `detalle` y `abrir` por (agregan el parámetro opcional `propio`):

```tsx
const detalle = (over: Partial<typeof PENDIENTE> = {}, ocurrencias = [OCURRENCIA], propio: PropioInfo | null = null) =>
  ({ ok: true, pendiente: { ...PENDIENTE, ...over }, ocurrencias, totalOcurrencias: 2, propio }) as const;

async function abrir(over: Partial<typeof PENDIENTE> = {}, ocurrencias = [OCURRENCIA], propio: PropioInfo | null = null) {
  vi.mocked(getPendienteDetalleAction).mockResolvedValue(detalle(over, ocurrencias, propio));
```
(el resto de `abrir` queda igual) y agregar `type PropioInfo` al import de `@/app/(researcher)/validacion/actions`.
3. Agregar al final:

```tsx
describe('PendienteDetalle — retirar un alimento propio', () => {
  const PROPIO: PropioInfo = { id: 9, estado: 'activo', fuenteDato: 'etiqueta_producto', justificacion: 'Etiqueta del envase.', motivoRetiro: null };
  const validado = { estado: 'validado' as const, id_alimento_propio: 9 };

  it('muestra la fuente y la justificación del propio y el botón Retirar', async () => {
    await abrir(validado, [OCURRENCIA], PROPIO);
    const seccion = screen.getByRole('region', { name: 'Alimento propio' });
    expect(within(seccion).getByText(/Etiqueta del producto/)).toBeInTheDocument();
    expect(within(seccion).getByText(/Etiqueta del envase\./)).toBeInTheDocument();
    expect(within(seccion).getByRole('button', { name: 'Retirar del catálogo propio' })).toBeInTheDocument();
  });

  it('pide un motivo de al menos 10 caracteres antes de confirmar', async () => {
    const { user } = await abrir(validado, [OCURRENCIA], PROPIO);
    await user.click(screen.getByRole('button', { name: 'Retirar del catálogo propio' }));
    const confirmar = screen.getByRole('button', { name: 'Confirmar retiro' });
    expect(confirmar).toBeDisabled();
    await user.type(screen.getByLabelText('Motivo del retiro'), 'corto');
    expect(confirmar).toBeDisabled();
    await user.type(screen.getByLabelText('Motivo del retiro'), ' pero ya largo');
    expect(confirmar).toBeEnabled();
  });

  it('retira, avisa, oculta el botón y refresca el listado', async () => {
    const { user, onGuardado } = await abrir(validado, [OCURRENCIA], PROPIO);
    await user.click(screen.getByRole('button', { name: 'Retirar del catálogo propio' }));
    await user.type(screen.getByLabelText('Motivo del retiro'), 'Los valores de la etiqueta estaban mal.');
    await user.click(screen.getByRole('button', { name: 'Confirmar retiro' }));
    expect(retirarAlimentoPropioAction).toHaveBeenCalledWith({ id: 9, motivo: 'Los valores de la etiqueta estaban mal.' });
    expect(await screen.findByText(/Retirado del catálogo propio/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retirar del catálogo propio' })).not.toBeInTheDocument();
    expect(onGuardado).toHaveBeenCalledTimes(1);
  });

  it('si el servidor rechaza el retiro muestra el error y deja el botón', async () => {
    vi.mocked(retirarAlimentoPropioAction).mockResolvedValue({ error: 'Este alimento ya fue resuelto por otro investigador' });
    const { user, onGuardado } = await abrir(validado, [OCURRENCIA], PROPIO);
    await user.click(screen.getByRole('button', { name: 'Retirar del catálogo propio' }));
    await user.type(screen.getByLabelText('Motivo del retiro'), 'Los valores de la etiqueta estaban mal.');
    await user.click(screen.getByRole('button', { name: 'Confirmar retiro' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ya fue resuelto');
    expect(onGuardado).not.toHaveBeenCalled();
  });

  it('un propio ya retirado muestra el motivo y no ofrece retirar', async () => {
    await abrir(validado, [OCURRENCIA], { ...PROPIO, estado: 'retirado', motivoRetiro: 'Valores incorrectos.' });
    expect(screen.getByText(/Retirado del catálogo propio/)).toBeInTheDocument();
    expect(screen.getByText(/Valores incorrectos\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retirar del catálogo propio' })).not.toBeInTheDocument();
  });

  it('un alimento validado sin propio, o uno todavía pendiente, no muestra la sección', async () => {
    await abrir({ estado: 'validado' });
    expect(screen.queryByRole('region', { name: 'Alimento propio' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run testing/PendienteDetalle.test.tsx`
Expected: FAIL (no existe la sección ni la acción de retirar en el detalle).

- [ ] **Step 3: Write the implementation**

En `src/app/(researcher)/validacion/PendienteDetalle.tsx`:

1. Imports: en `./actions` agregar `retirarAlimentoPropioAction,` y `type PropioInfo,`; agregar `import { FUENTES_DATO, MOTIVO_RETIRO_MIN } from '@/lib/verificacionAlimento';`.

2. En `interface Datos` agregar `propio: PropioInfo | null;`, y en el efecto de carga reemplazar `setDatos({ pendiente: r.pendiente, ocurrencias: r.ocurrencias, totalOcurrencias: r.totalOcurrencias });` por `setDatos({ pendiente: r.pendiente, ocurrencias: r.ocurrencias, totalOcurrencias: r.totalOcurrencias, propio: r.propio ?? null });`.

3. Debajo de `const [verificacionPropio, …]` agregar:

```tsx
  const [retirando, setRetirando] = useState(false);
  const [motivoRetiro, setMotivoRetiro] = useState('');
```
y en el efecto de carga, junto a los demás reinicios: `setRetirando(false); setMotivoRetiro('');`.

4. Debajo de la función `descartar` agregar:

```tsx
  const retirarPropio = async () => {
    setTrabajando(true);
    setError(null);
    const r = await retirarAlimentoPropioAction({ id: datos!.propio!.id, motivo: motivoRetiro.trim() });
    setTrabajando(false);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    setDatos((d) => (d && d.propio ? { ...d, propio: { ...d.propio, estado: 'retirado', motivoRetiro: motivoRetiro.trim() } } : d));
    setRetirando(false);
    setMotivoRetiro('');
    onGuardado?.();
  };
```

5. Justo antes del `<form className="space-y-4" …>` agregar la sección:

```tsx
          {datos.propio && (
            <section aria-label="Alimento propio" role="region" className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/50 p-3 text-sm">
              <h3 className="font-semibold text-slate-900">
                <span className="mr-2 rounded bg-violet-50 px-1.5 py-0.5 text-xs font-semibold text-violet-800">PROPIO</span>
                Se agregó al catálogo propio
              </h3>
              <p className="text-slate-700">
                Fuente: {FUENTES_DATO.find((f) => f.valor === datos.propio!.fuenteDato)?.etiqueta ?? datos.propio.fuenteDato}.{' '}
                {datos.propio.justificacion}
              </p>
              {datos.propio.estado === 'retirado' ? (
                <p className="text-slate-800">
                  Retirado del catálogo propio{datos.propio.motivoRetiro ? `: ${datos.propio.motivoRetiro}` : '.'}
                </p>
              ) : retirando ? (
                <div className="space-y-2">
                  <div>
                    <label htmlFor="pv-motivo-retiro" className="block text-sm font-medium text-slate-700">
                      Motivo del retiro
                    </label>
                    <textarea
                      id="pv-motivo-retiro"
                      value={motivoRetiro}
                      onChange={(e) => setMotivoRetiro(e.target.value)}
                      rows={2}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                    <span className="text-xs text-slate-600">
                      {motivoRetiro.trim().length}/{MOTIVO_RETIRO_MIN} caracteres como mínimo. Los ítems ya validados no cambian.
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      loading={trabajando}
                      disabled={motivoRetiro.trim().length < MOTIVO_RETIRO_MIN}
                      onClick={() => void retirarPropio()}
                    >
                      Confirmar retiro
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setRetirando(false)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={() => setRetirando(true)}>
                  Retirar del catálogo propio
                </Button>
              )}
            </section>
          )}
```

> El error de `retirarPropio` se muestra en el bloque `aria-live` del formulario (que se renderiza también en el detalle de sólo lectura): por eso la sección no repite el `role="alert"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS y `tsc` limpio.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(researcher)/validacion/PendienteDetalle.tsx" testing/PendienteDetalle.test.tsx
git commit -m "feat: retirar un alimento propio del catálogo desde el detalle (motivo obligatorio y auditado)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 7: Documentación y verificación completa

**Files:**
- Modify: `docs/contrato-deteccion.md` (lista de migraciones), `docs/superpowers/specs/2026-10-13-validacion-composicion-y-alimentos-propios-design.md` (estado y número de migración)

**Interfaces:** ninguna.

- [ ] **Step 1: Documentar**

En `docs/contrato-deteccion.md`, en la línea «Migraciones: …» agregar, antes de «Todas son idempotentes»: «`supabase/019_alimentos_propios_nut119.sql` (tabla `alimentos_propios` sin escritura directa; RPC `propio_verificar`, `pendiente_validar_como_propio` y `propio_retirar`; los propios se pueden usar como ingredientes de una composición pero **no** entran al matching automático de la IA; correrla **antes** de desplegar la UI)».

En el spec: reemplazar la línea «> Estado: Fase A implementada (…). Fase B pendiente.» por «> Estado: Fases A y B implementadas (planes `docs/superpowers/plans/2026-10-14-validacion-composicion-fase-a.md` y `…-alimentos-propios-fase-b.md`). La migración de la Fase B es la 019 (la 018 es la de la foto de referencia).» y, en §7 «Fase B», cambiar `supabase/018_alimentos_propios_nut119.sql` por `supabase/019_alimentos_propios_nut119.sql`.

- [ ] **Step 2: Verificación completa**

```bash
npx tsc --noEmit
npx vitest run
npm run build
```

Expected: `tsc` sin salida; todos los tests verdes; `next build` termina bien. Correr también `node m019.mjs` (Task 2, Step 4) sobre el árbol final → `TODO OK`.

- [ ] **Step 3: Revisión del Review Focus**

Confirmar con los tests ya escritos, línea por línea: (1) «nadie inserta/actualiza/borra directo», «anon no lee», «un deportista ve 0 propios» y los `FORBIDDEN` (m019); (2) `sin efectos tras el error` y «misma transacción» (m019); (3) «nombre idéntico … desde otro pendiente» y `PROPIO_DUPLICADO` mapeado (m019 + validacionActions); (4) «un propio retirado ya no se puede usar como ingrediente», «al retirarlo el nombre queda libre» (m019) y el mensaje de `ALIMENTO_NO_ENCONTRADO` con `propio:` (validacionActions); (5) «un propio y un alimento del catálogo con el mismo id» (ComposicionCatalogo + m019); (6) «al editar un valor se vuelve a verificar» (PendienteDetalle); (7) el buscador de propios sólo está en `validacion/actions.ts` y `searchAlimentosAction` no se modificó (`git diff main -- src/app/alimentacion/actions.ts` vacío en esta fase).

- [ ] **Step 4: Commit**

```bash
git add -A docs
git commit -m "docs: migración 019 y estado de la Fase B (alimentos propios)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Publicar (requiere autorización)**

La rama `feat-nut119-matching-macros-validacion` ya está publicada. El `git push` lo autoriza la persona dueña del repo; no se hace sin pedirlo. Antes del despliegue hay que correr en Supabase la `019` (la 017 y la 018 ya están aplicadas).

---

## Fuera de esta fase (decisiones D2–D4)

- Aprobación por un segundo investigador (D2): v1 es autoría + «Retirar» auditado.
- Los propios no entran al matching automático de la IA (D3); se pueden revisar la calidad y reabrir la decisión más adelante.
- Crear propios desde composiciones de «Del catálogo» (D4): sólo «A mano» en v1; la verificación (`propio_verificar`) y las RPC ya están pensadas para reutilizarse.
- El pedido de «agregar al catálogo propio» no se guarda en el borrador: hay que completarlo al validar.
