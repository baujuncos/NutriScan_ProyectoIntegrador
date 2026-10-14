# Validación: composición desde el catálogo, formulario simplificado y alimentos propios

Branch: `feat-nut119-matching-macros-validacion` (continúa NUT-119)

> Estado: Fase A implementada (plan `docs/superpowers/plans/2026-10-14-validacion-composicion-fase-a.md`). Fase B pendiente.

## 1. Objetivo y alcance

Rediseñar el detalle de un alimento pendiente (`/validacion`) para que validar sea más simple, no pierda trabajo y permita reutilizar lo que se carga.

**Incluye**
1. **Una sola sección "Del catálogo"** que reemplaza a "Buscar en el catálogo" y "Armar una mezcla": el investigador agrega 1 o más alimentos del buscador e indica los **gramos reales de cada uno que hay en la foto**. Sin proporciones ni "por 100 g": el sistema hace la cuenta.
2. **Pestañas de origen de los valores:** IA · Del catálogo · A mano. Se ve y se edita una sola a la vez.
3. **La composición se guarda** (borrador y validación): los alimentos elegidos y sus gramos quedan asociados al alimento de la foto, se restauran al reabrir y quedan en la auditoría.
4. **Formulario menos cargado:** categoría y observaciones plegadas, "Dónde apareció" plegable, un solo botón por acción y aviso claro de "cambios sin guardar".
5. **Crear un alimento propio** desde la pestaña "A mano", que se agrega a una tabla nueva de alimentos propios **sólo tras una verificación de campos y una evaluación breve** (Fase B, §6).
6. **Contraste:** los dos grises ilegibles que quedan en componentes compartidos.

**No incluye**
- Cambiar el matching automático (sigue sólo SARA2, ver §4c del spec de NUT-119).
- Que los alimentos propios entren al matching automático de la IA (decisión abierta D3, recomendación: no por ahora).
- Aprobación por un segundo investigador (decisión abierta D2, recomendación: no en v1).
- Cambios en `items` ni en el diario del deportista.

## 2. Problemas de hoy (evidencia)

| Problema | Causa |
|---|---|
| El borrador "pierde" lo que armé con el catálogo | `pendiente_modificar` guarda sólo nombre, categoría, los 4 valores y observaciones. La mezcla (ingredientes y gramos) y el alimento vinculado viven sólo en el estado de React y se pierden al cerrar. |
| Al vincular un alimento, el formulario sigue mostrando los valores de la IA | El vínculo se aplica recién en el servidor al validar; los 4 campos no se actualizan. |
| No se puede decir "en la foto hay 40 g de palta" | La mezcla trabaja con proporciones y las normaliza a 100 g; con un solo ingrediente siempre da 100 %. |
| Dos secciones que parecen lo mismo | "Buscar en el catálogo" (vincula 1 alimento entero) y "Armar una mezcla" (varios) se superponen, con 7+ campos a la vista. |
| Grises ilegibles | `placeholder-gray-400` en `Input` y `text-gray-400` en los botones de `Modal`: 2,5:1 (mínimo AA 4,5:1). |

El backend del borrador funciona (la base expone `pendiente_modificar` con la firma que usa la app); el problema es lo que no se persiste.

## 3. Diseño de la interfaz

### 3.1 Estructura del detalle

```
 Alimento:  [ Flan casero ............ ]        IA estimó: 150 kcal · P 3 · C 23 · G 5
 ▸ Dónde apareció (2 ocurrencias)                                              [plegable]

 Valores por 100 g       ( IA )  ( Del catálogo )  ( A mano )
 ┌───────────────────────────────────────────────────────────────────────────────────┐
 │ <contenido de la pestaña elegida>                                                  │
 └───────────────────────────────────────────────────────────────────────────────────┘
 Resultado por 100 g: 150 kcal · P 3 g · C 23 g · G 5 g
 ▸ Cómo queda en cada ocurrencia                                               [plegable]
 ▸ Más datos (categoría, observaciones)                                        [plegado]

 ● Cambios sin guardar        [ Guardar borrador ]  [ Validar ]  [ Descartar ]
```

- La pestaña inicial es **IA** si Gemini dio valores y **A mano** si no. Si el borrador guardado tenía composición, abre en **Del catálogo**.
- Cada pestaña lleva una línea que explica para qué sirve:
  - **IA:** "Usa la estimación de Gemini tal cual. Elegila si te parece razonable."
  - **Del catálogo:** "Tomá los valores de uno o más alimentos de SARA2 o ANMAT e indicá cuántos gramos de cada uno hay en la foto. Sirve para equivalencias ('esto es palta') y para compuestos ('aceite y vinagre')."
  - **A mano:** "Cargá los cuatro valores vos. Podés además crear el alimento para reutilizarlo (se evalúa antes)."
- **Cambiar de pestaña no borra** lo de las otras: el resultado y lo que se valida salen de la pestaña activa.
- Los textos usan tonos AA (`slate-600` o más oscuro) y los controles tienen foco visible.

### 3.2 Pestaña "Del catálogo" (reemplaza a las dos secciones)

El investigador describe **lo que hay en la foto**, en gramos reales.

1. **Foto de referencia.** Arriba se muestra cuánto pesa el alimento en una de sus ocurrencias ("En la foto de Ana, 6/10, pesa **20 g**"). Por defecto es la más reciente; si hay varias se elige con un selector. Ese peso es el de la ocurrencia (el gramaje final que quedó guardado), no un dato que se tipee.
2. **Ingredientes.** Un buscador (SARA2, ANMAT y, desde la Fase B, alimentos propios). Cada resultado se agrega como un ingrediente con un campo **"gramos en la foto"**, que el investigador completa (el primero arranca con el peso total de la foto; los siguientes, vacío). Un ingrediente sin datos nutricionales se marca y bloquea el cálculo.
3. **Cuenta (la hace el sistema).** Aporte de cada ingrediente = valor por 100 g × gramos / 100. Los valores del alimento **por 100 g** (que es lo que se guarda para reutilizarlo con otros pesos) = Σ aportes × 100 / peso de la foto. Ejemplos con un alimento de **20 g** en la foto:
   - 20 g de aceite → es ese mismo aceite al 100 %: **vínculo puro** (los ítems pasan a apuntar a esa entrada del catálogo).
   - 15 g de aceite + 5 g de vinagre → mezcla de 20 g.
   - 8 g de palta → equivalencia parcial: los 12 g restantes se cuentan sin aporte.
4. **Aviso de suma.** Se muestra "Sumás X g de Y g de la foto". Si falta ("los 12 g restantes se cuentan sin aporte") o si se pasa ("superás el peso de la foto: revisá") se avisa, **sin bloquear**.
5. **Sin proporciones, sin "por 100 g" y sin "Ajustar a 100 g".** El investigador nunca escribe esos números; sólo ve el resultado por 100 g.
6. Tope de cordura: cada ingrediente ≤ 1 000 g.

### 3.3 Borrador y feedback

- **Guardar borrador** persiste todo: pestaña activa, composición, valores, nombre, categoría y observaciones. Al reabrir se restaura exactamente.
- Indicador "● Cambios sin guardar" que se apaga con "Guardado hace un momento"; el mensaje queda visible junto a los botones.
- Después de guardar o validar se refresca el listado (hoy el borrador no actualiza la lista).
- Al validar/descartar con cambios sin guardar el flujo no los pierde: se validan los valores en pantalla.

## 4. Modelo de datos y flujo (Fase A)

### 4.1 Columna nueva

`alimentos_pendientes_validacion.composicion jsonb` (nullable):

```json
{
  "modo": "catalogo",                       // 'ia' | 'catalogo' | 'manual'
  "id_guardado_item": 412,                  // la ocurrencia (foto) de referencia
  "gramos_foto": 20,                        // peso de esa ocurrencia (lo fija el servidor)
  "componentes": [
    { "origen": "catalogo", "id": 31, "nombre": "Aceite de oliva", "fuente": "SARA2",
      "gramos": 15, "kcal_100g": 884, "proteinas_100g": 0, "grasas_100g": 100, "carbs_100g": 0 }
  ]
}
```

`gramos` son los gramos reales **en la foto de referencia**. Se guardan los valores del ingrediente **al momento de elegirlo** (snapshot) para restaurar y auditar sin depender de que el catálogo no cambie. `composicion` entra sola en la auditoría (`to_jsonb(fila)` ya la incluye).

### 4.2 RPCs (migración 017)

`pendiente_modificar` y `pendiente_validar` ganan `p_composicion jsonb default null`. Se hace `drop function` de las firmas viejas para no dejar sobrecargas ambiguas en PostgREST.

- **Integridad:** si `modo = 'catalogo'`, el servidor lee de la base el peso de la ocurrencia de referencia (`detecciones_guardados_items.grams` de `id_guardado_item`, que debe pertenecer a esa fila de cola), lee los valores de cada ingrediente en `alimentos` (y propios), **recalcula** los 4 valores por 100 g con la cuenta de §3.2 y **descarta** los `p_kcal…` y el `gramos_foto` que mande el cliente. Así la composición y los números nunca se contradicen y nadie puede falsear el peso.
- **Validaciones del servidor:** estructura del JSON, ocurrencia de referencia válida, ids existentes, gramos de cada ingrediente entre 0 (exclusivo) y 1 000, al menos un componente, valores ≥ 0. Que la suma no coincida con el peso de la foto **no** es un error (sólo un aviso de la interfaz).
- **Vínculo puro:** un solo componente de `alimentos` cuyos gramos igualan el peso de la foto (tolerancia 0,5 g) equivale al actual `p_id_alimento_existente` (se rellena `id_alimento_vinculado` y los ítems toman esa entrada). Cualquier otra composición valida como alimento nuevo con valores calculados (sin tocar `alimentos`).
- `p_id_alimento_existente` se mantiene por compatibilidad pero la interfaz deja de usarlo.
- Las vistas `v_alimentos_pendientes` y `v_alimentos_validados` usan `p.*`: se **recrean** (`drop view` + `create`) para incluir la columna nueva.

### 4.3 Lectura y escritura desde la app

- `getPendienteDetalleAction` devuelve `composicion`; el formulario la restaura.
- `modificarPendienteAction` y `validarPendienteAction` reciben `composicion` (zod: mismo esquema que el servidor).
- `macrosMezcla` cambia: recibe los gramos reales y el **peso de la foto** y devuelve los valores por 100 g = Σ(valor × gramos / 100) × 100 / peso de la foto, más la suma de gramos para los avisos. Desaparece la normalización a 100 g (no hay "Ajustar a 100 g").

## 5. Contraste

- `Input`: `placeholder-gray-400` → `placeholder-gray-500` (4,8:1).
- `Modal`: botones de cerrar y volver `text-gray-400` → `text-gray-600`.
- Test que fija ambas clases (jsdom no evalúa contraste). Son componentes compartidos: también cambian login y registro; es un cambio de color menor.

## 6. Alimentos propios — crear desde "A mano" (Fase B)

Cuando el investigador elige **A mano**, puede tildar **"Agregar este alimento al catálogo propio"** para reutilizarlo. Pasa por una verificación y una evaluación breve antes de entrar.

### 6.1 Tabla nueva `alimentos_propios`

| Columna | Notas |
|---|---|
| `id_alimento_propio` | bigserial PK |
| `nombre`, `nombre_normalizado` | normalizado con `norm_alimento` (columna generada); único entre los `activo` |
| `categoria` | texto |
| `kcal_100g`, `proteinas_100g`, `grasas_100g`, `carbs_100g` | numeric ≥ 0, todos obligatorios |
| `fuente_dato` | `etiqueta_producto` · `tabla_composicion` · `calculo_propio` · `estimacion_ia_revisada` · `otra` (obligatoria) |
| `justificacion` | texto, obligatorio (≥ 10 caracteres) |
| `composicion` | jsonb nullable (igual que §4.1) |
| `id_pendiente_origen` | FK a la cola |
| `creado_por`, `creado_at` | auditoría |
| `estado` | `activo` · `retirado` |
| `retirado_por`, `retirado_at`, `motivo_retiro` | si se retira |

RLS: sólo investigadores/administradores leen; **nadie escribe directo**: sólo las RPCs definer (mismo patrón que la cola). Sin `update` ni `delete` desde la app.

### 6.2 Verificación de campos (automática, en servidor y cliente)

| Regla | Efecto |
|---|---|
| Nombre no vacío; 4 valores ≥ 0 | Bloquea |
| Cada macro ≤ 100 g; proteínas + grasas + carbs ≤ 105 g; kcal ≤ 900 | Bloquea |
| kcal incoherentes con 4/4/9 (tolerancia `max(25 kcal, 35 %)`) | Advierte: exige justificación explícita |
| Nombre idéntico (normalizado) a una entrada de `alimentos` o de un propio `activo` | Bloquea y muestra la existente ("usala desde 'Del catálogo'") |
| Nombre muy parecido (similitud trigram ≥ 0,85) a SARA2 o propios | Advierte con la lista; tiene que confirmar que es distinto |

### 6.3 Evaluación breve

Al validar con "agregar al catálogo" el investigador completa, en un solo paso:
1. **Fuente del dato** (lista de §6.1).
2. **Justificación** en una o dos frases (de dónde sale el valor, o por qué el valor incoherente es correcto).
3. **Tres confirmaciones:** "revisé la fuente", "los valores son por 100 g", "busqué y no existe ya en SARA2/ANMAT/propios".

El servidor exige fuente y justificación; las confirmaciones quedan registradas en la auditoría. Todo se guarda en la misma transacción que la validación; si falla cualquier verificación no se valida nada.

### 6.4 Qué pasa después

- El alimento aparece en la pestaña **Del catálogo** (buscador con etiqueta "PROPIO") para usarlo como ingrediente o equivalencia.
- Los ítems validados siguen guardando el snapshot por 100 g (`origen_macros = 'validado'`); la cola apunta al propio por `id_alimento_propio` para trazabilidad.
- **Retirar:** una acción "Retirar del catálogo propio" (motivo obligatorio, auditada) lo deja `retirado`: deja de aparecer en el buscador y de bloquear el nombre. No borra nada ni cambia ítems ya validados.
- Vista `v_alimentos_propios` (security_invoker) con creador, fuente y cantidad de usos.

### 6.5 Fuera de v1

- Entran al **matching automático de la IA** (D3).
- Aprobación por un segundo investigador (D2).

## 7. Archivos

**Fase A**
- `supabase/017_composicion_validacion_nut119.sql` + sección en `schema_consolidado.sql`
- `src/lib/macros.ts` (`macrosMezcla` con gramos reales sobre el peso de la foto) · `src/lib/composicion.ts` (esquema, restaurar, resumen)
- `src/app/(researcher)/validacion/actions.ts`, `PendienteDetalle.tsx` (se reordena), `MezclaCatalogo.tsx` → `ComposicionCatalogo.tsx`, `ValidacionClient.tsx` (refresco)
- `src/components/ui/Input.tsx`, `src/components/ui/Modal.tsx`
- `testing/*` correspondientes

**Fase B**
- `supabase/018_alimentos_propios_nut119.sql` + sección en `schema_consolidado.sql`
- `src/app/(researcher)/validacion/actions.ts` (+ `retirarAlimentoPropioAction`), `NuevoAlimentoPropio.tsx`
- `src/lib/verificacionAlimento.ts` (reglas de §6.2 compartidas con `macrosPlausibles`)

## 8. Estrategia de tests

| Área | Casos |
|---|---|
| `macrosMezcla` | gramos reales sobre el peso de la foto (8 g de palta en 20 g → 40 % del aporte; 15 g de aceite + 5 g de vinagre en 20 g); suma distinta del peso (falta y sobra); peso 0 o gramos inválidos → null |
| Composición | esquema válido/inválido; restaurar desde el borrador; un solo componente que iguala el peso de la foto es vínculo puro |
| Detalle (jsdom) | pestañas (una a la vez, cambiar no pierde), explicación por pestaña, aviso de "sumás X g de Y g", selector de foto de referencia, indicador de cambios sin guardar, borrador restaura la composición, plegables |
| Acciones | `composicion` viaja a la RPC; el servidor no confía en los números del cliente (PGlite) |
| SQL (PGlite) | modificar/validar con composición; recálculo desde `alimentos` y desde el peso real de la ocurrencia (se ignora el que manda el cliente); vínculo puro; sobrecargas viejas eliminadas; vistas con la columna nueva; idempotencia |
| Contraste | clases de `Input` y `Modal` |
| Fase B | todas las reglas de §6.2 (bloqueos y advertencias), exigir fuente y justificación, duplicado exacto, retirar, RLS (sólo investigadores leen, nadie escribe directo), aparece en el buscador, atomicidad |

## 9. Riesgos y limitaciones

- **Cambio de semántica de la mezcla:** antes eran proporciones, ahora son gramos reales sobre el peso de la foto. No hay datos viejos que migrar: los borradores no tenían composición y los validados anteriores quedan con `composicion = null`.
- **El peso de la foto es una estimación** (de la IA o corregida por el deportista); si es incorrecto, los valores por 100 g salen distintos. Se muestra siempre a la vista y el investigador puede elegir otra ocurrencia de referencia.
- **Snapshot de ingredientes:** si SARA2/ANMAT cambian, el borrador conserva lo elegido; sólo se recalcula al volver a elegir el ingrediente.
- **Catálogo propio y calidad:** la verificación y la evaluación reducen los errores pero no los eliminan. Mitigación: auditoría completa, "Retirar", y fuera del matching automático en v1.
- **Componentes compartidos:** el cambio de contraste de `Input`/`Modal` afecta toda la app.
- **No probado en Supabase real:** como en las migraciones anteriores, se valida en PGlite y hace falta una prueba manual con una sesión de investigador.

## 10. Decisiones abiertas

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| D1 | ¿Hacer Fase A y B juntas o por separado? | Juntas / A y después B | **Separadas:** A (composición + formulario + borrador + contraste) es independiente y resuelve los bugs; B agrega una tabla y flujo nuevos. |
| D2 | ¿Quién aprueba un alimento propio? | Verificación + evaluación del propio autor / además un segundo investigador | **Autor + "Retirar" auditado en v1.** La aprobación de un segundo investigador agrega una pantalla y fricción; se suma si aparecen errores. |
| D3 | ¿Los propios entran al matching automático de la IA? | Sí / No | **No por ahora:** revisamos primero la calidad (es el riesgo que motivó sacar VALIDADO del catálogo). Se pueden usar a mano y como ingredientes. |
| D4 | ¿Se puede crear un propio también desde "Del catálogo" (composiciones)? | Sólo "A mano" / también composiciones | **Sólo "A mano" en v1**, como pediste. Extensible después reutilizando la misma verificación. |
