# Rediseño de la barra buscadora y layout de /alimentacion

Branch: `fix-barcode-scanning-flow` (continúa en la misma rama de trabajo)

## 1. Objetivo y alcance

Reestructurar la sección de búsqueda/carga de `/alimentacion` (mobile y desktop) según los mockups provistos, y de paso corregir bugs puntuales que viven en la misma zona de código. No toca el escáner de código de barras en sí (ya terminado); sí toca `AlimentacionClient.tsx`, `AlimentacionView.tsx`, `DatePicker.tsx` y `actions.ts`/`searchAlimentosAction`.

**Incluye:**
1. Layout adaptativo del buscador + métodos de carga (mobile colapsa a íconos, desktop en una fila).
2. Filtros de búsqueda por campo (Nombre/Marca/Denominación), compartidos entre mobile y desktop detrás de un toggle "Buscar ▽".
3. Sección "Recientes" (alimentos que el usuario cargó últimamente).
4. Selector de cantidad por botones rápidos + stepper para alimentos del catálogo (con "Personalizar" para seguir permitiendo un valor libre).
5. Bugs: fecha que se sale de pantalla en mobile, nombres largos cortados en la lista de ítems, el "?" de detalle resetea el buscador, "Suplementos" deja pasar/filtra mal por nombre.

**No incluye (fuera de alcance):** ícono de método de registro por ítem, ver detalle de un ítem ya cargado sin re-pegarle a OFF, botones "Volver" en páginas sueltas (elegir-uso/perfil-físico). Quedan para rondas separadas.

## 2. Layout — mobile vs. desktop

### 2.1 Mobile

- **Buscador vacío (o sin foco):** se muestra, debajo del input, una fila de 3 botones ícono-only (IA ✨ / chat 💬 / escanear código 📷), con los mismos colores/gradientes que ya tienen hoy sus versiones de texto completo.
- **Apenas el usuario tipea algo:** esa fila de 3 íconos se reemplaza por el buscador expandido (ocupa el ancho completo) + un botón ícono de "Escanear código" al lado, como atajo rápido. Al limpiar el texto, vuelve a la fila de 3 íconos.
- **Botón "×" en el input:** cuando el input tiene texto, aparece una "×" para limpiarlo de un toque (en vez de borrar letra por letra) y volver al estado colapsado de 3 íconos.
- Los botones de IA y chat siguen abriendo sus modales igual que hoy; nada cambia ahí salvo dónde viven en el layout.

### 2.2 Desktop

- Una sola fila: buscador (flex-grow) + los 3 botones de texto completo, tal como está hoy. No hay colapso — el ancho alcanza.

### 2.3 Compartido (mobile y mobile)

El toggle de filtros ("Buscar ▽", ver §3) y la sección "Recientes" (ver §4) son el **mismo componente/comportamiento en ambos breakpoints** — no son exclusivos de desktop. Solo cambia cómo se acomodan en el ancho disponible (en mobile, los checkboxes de filtro pueden apilarse en vez de ir en una sola línea).

## 3. Filtros de búsqueda (Nombre / Marca / Denominación)

- Botón/chip "Buscar ▽" junto a los chips de fuente (Todas/SARA2/ANMAT) — al tocarlo, despliega 3 checkboxes: **Nombre**, **Marca**, **Denominación** (los 3 tildados por default). Mismo componente en mobile y desktop.
- `searchAlimentosAction(query, tipoIngesta, campos)` gana un tercer parámetro `campos: { nombre: boolean; marca: boolean; denominacion: boolean }`. La query arma el `OR` solo sobre los campos tildados (si los 3 están tildados, es equivalente al comportamiento actual de nombre-primero + marca/denominación-después).
- Con 2-3+ caracteres, se saca el tope artificial de 80 resultados que existe hoy (`slice(0, 80)`) y se sube a un límite generoso (150) — "todos los que coincidan" en la práctica, sin reventar la lista.
- El estado de "0 resultados" agrega un botón **"Quitar filtros"** (vuelve los 3 checkboxes a tildados) además de lo que ya ofrece hoy (cargar manual / registrar por chat).

### 3.1 Bug — "Suplementos" deja pasar/bloquea mal

Hoy `searchAlimentosAction` solo mira `categoria` para decidir si un alimento es o no de la sección Suplementos:

```ts
isSuplemento ? q.ilike('categoria', '%suplemento%') : q.not('categoria', 'ilike', '%suplemento%')
```

Esto tiene dos problemas: (a) un producto llamado "Proteína Whey" pero categorizado como "Snacks" no aparece buscando desde Suplementos; (b) ese mismo producto SÍ aparece buscando desde Desayuno/Almuerzo/etc., porque solo se excluye por categoría. Fix: la condición pasa a mirar categoría **o** nombre en ambas ramas:

```ts
isSuplemento
  ? q.or('categoria.ilike.%suplemento%,nombre.ilike.%suplemento%')
  : q.not('categoria', 'ilike', '%suplemento%').not('nombre', 'ilike', '%suplemento%')
```

### 3.2 Bug — el "?" de detalle resetea el buscador

El botón "?" que abre el modal de denominación usa `onMouseDown={(e) => { e.stopPropagation(); setDenominacionModal(a); }}`. `stopPropagation` no evita que el input pierda el foco al hacer click en otro elemento — el `onBlur` del input (que esconde el dropdown 150ms después) se dispara igual, y al cerrar el modal de denominación el dropdown queda escondido aunque la búsqueda siga teniendo texto. Fix: agregar `e.preventDefault()` en ese mismo `onMouseDown` — evita que el navegador le saque el foco al input, así el blur nunca se dispara y el dropdown no se esconde.

## 4. "Recientes"

- Se muestra en el dropdown cuando el input está vacío y tiene foco (reemplaza a no mostrar nada, como es hoy).
- Definición: los últimos alimentos **distintos** que el usuario cargó (se arma con una consulta sobre `items`/`ingestas`, que ya existen — sin tabla nueva ni trackear cada tecleo de búsqueda). Alcance **global** (no filtrado por el tipo de comida actual — si comés banana seguido, aparece sin importar si estás en desayuno o merienda).
- Server action nuevo `getAlimentosRecientesAction(): Promise<AlimentoOption[]>` — selecciona `items` del usuario autenticado vía `ingestas.id_usuario`, ordenados por `items.created_at desc`, deduplicados por `id_alimento`, join a `alimentos`, límite 8. Excluye ítems manuales (`id_alimento is null`) y escaneados (`id_alimento_barcode`) — son catálogos distintos, no aplica el mismo `AlimentoOption`.
- Mismo diseño visual que un resultado de búsqueda normal (nombre, marca/categoría, badge de fuente).

## 5. Selector de cantidad (catálogo SARA2/ANMAT)

Reemplaza el `<input type="number">` libre del formulario de "agregar cantidad" (el que aparece al seleccionar un alimento del dropdown) por el mismo patrón ya usado en `BarcodeScannerModal` (paquete/porción):

- 4 botones rápidos: `25 g`, `50 g`, `100 g`, `150 g` (fijos, no derivados de ningún dato del alimento — a diferencia del escáner, acá no hay porción/envase de referencia).
- Un stepper (−/valor/+) que parte en 50 y permite ajustar de a 1g, sincronizado con los botones rápidos (tocar un botón rápido también actualiza el valor del stepper).
- Botón **"Personalizar"** que revela el input numérico libre que existe hoy, para cuando ninguno de los rápidos ni el stepper ajustan bien — queda disponible, no se elimina.
- Si el alimento seleccionado tiene `kcal_100g`, `proteinas_100g`, `grasas_100g` y `carbs_100g` todos `null` (confirmado: pasa con algunos ítems de ANMAT, ver `ANMAT/seed_anmat.py` — campos vacíos en el CSV se guardan como `null`), se muestra el aviso: *"Este alimento no tiene valores nutricionales cargados — vas a poder registrarlo igual, pero no va a sumar a tus calorías/macros."* (texto ajustado a la realidad: no hay forma de "completar desde la etiqueta" sin un flujo nuevo, así que el aviso informa en vez de prometer una acción que no existe todavía).

## 6. Bugs chicos de layout

- **Fecha fuera de pantalla en mobile:** `DatePicker` ya es `w-full box-border`, así que el problema es de contexto (flex/grid ancestro sin `min-width: 0`, o el control nativo de fecha de algunos navegadores móviles con un ancho mínimo mayor al disponible). Fix: envolver el `<input type="date">` en un contenedor con `min-w-0 overflow-hidden` y verificar en un viewport angosto (375px) que no fuerce scroll horizontal.
- **Nombres largos cortados en "Últimas comidas":** la fila de cada ítem (`getAlimentoNombre(item)`) pasa a `truncate` con `title={nombre}` (tooltip nativo) en vez de desbordar silenciosamente — en mobile además se le da más ancho relativo reduciendo el espacio fijo de los botones de editar/borrar si hace falta.

## 7. Testing

- `testing/AlimentacionSearch.test.tsx`: nuevos casos para los checkboxes de filtro (buscar solo por marca, solo por denominación, los 3 combinados), el fix de Suplementos (nombre O categoría, en ambas ramas), el botón "×" del buscador mobile, el toggle "Buscar ▽", "Recientes" (mock de `getAlimentosRecientesAction`), y el selector de cantidad nuevo (botones rápidos + stepper + Personalizar, igual que se testeó en `BarcodeScannerModal`).
- Sin tests de viewport real (jsdom no mide layout real) para los bugs de overflow — se verifican manualmente en el navegador antes de dar por cerrado ese punto, igual que se documentó para el testing de UI en otras partes de este proyecto.

## 8. Riesgos / decisiones documentadas

- El límite de 150 resultados sigue siendo un tope, no "infinitos" — si en el futuro el catálogo crece mucho más, esto necesita paginación real.
- "Recientes" no excluye alimentos ya cargados *hoy* en la comida actual — mostrar "Banana" como reciente aunque ya la hayas agregado a este desayuno es intencional (podés querer agregar una segunda porción).
- El aviso de "sin valores nutricionales" en el selector de cantidad es informativo nomás — no bloquea el guardado ni ofrece todavía una forma de completar los datos manualmente (eso sería una feature aparte).
