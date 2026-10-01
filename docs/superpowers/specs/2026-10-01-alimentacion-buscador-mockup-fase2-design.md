# Buscador de alimentos — segunda pasada hacia el mockup

Branch: `fix-responsiveness-and-random-bugs` (continúa la pasada "lazy" anterior)

## 1. Objetivo y alcance

Terminar de acercar el buscador de `/alimentacion` al mockup "Buscador de alimentos" (Desktop, Mobile·Registro, Mobile·Búsqueda, Mobile·Cantidad) con las mejoras que la primera pasada dejó afuera a propósito por romper tests existentes.

**Incluye:**
1. Resaltado de la coincidencia (`<mark>`) en el nombre de cada resultado.
2. Stepper fino de cantidad de a 10 g (hoy de a 1 g).
3. Se elimina el botón "?" y el modal de detalle: la denominación completa ya se ve inline (3ª línea de cada fila, con `title`).
4. Desktop: popover debajo del input (~640 px, lista con scroll propio ~360 px, sombra, scrim, cabecera con filtros, pie con atajos). Mobile: la búsqueda pasa a pantalla completa (input + "Cancelar", chips de fuente con scroll horizontal, "Buscar en" abre un bottom sheet).
5. Verificar si ya existe la barra de navegación inferior (no construir una nueva sin consultar).
6. Documentar (sin aplicar) qué haría falta para el atajo "porción propia".

**No incluye:** cambiar `MEAL_COLOR` por un primary único (decisión de diseño ya establecida), migraciones de schema, cambios en `hideNutrition`, `MAX_CANTIDAD` o la firma de `searchAlimentosAction`.

## 2. Decisiones

### 2.1 Resaltado: partir el nombre en nodos (opción b)

Se parte el nombre en `texto · <mark>coincidencia</mark> · texto` y se ajustan los asserts que buscaban el nombre completo con `getByText(string)` para que usen un matcher por `textContent`. Se descarta la CSS Custom Highlight API: jsdom no la implementa (el resaltado quedaría sin cobertura automatizada), requiere un registro global de `Range`s sincronizado con cada render, y en un PWA instalable no hay garantía de navegador moderno. La coincidencia ignora mayúsculas y tildes ("mani" resalta "Maní") mediante una función pura `rangoCoincidencia(texto, q)` en `searchQuery.ts`.

### 2.2 Popover/pantalla completa: un único árbol DOM, conmutado por CSS

No se usa `Modal` como base del overlay mobile: es una tarjeta centrada con `role="dialog"`, título y "×", y portalizar/duplicar el input a otro árbol lo desmontaría (pierde foco y estado al pasar de la página al overlay). En cambio, el mismo contenedor del input pasa a `fixed inset-0` en mobile cuando la búsqueda está abierta y a `sm:relative` + popover `sm:absolute` en desktop. Ventajas: un solo `<input>` (los ~20 tests que usan `getByRole('textbox')` siguen funcionando), el foco no se pierde, y jsdom (que no evalúa media queries) ve un solo árbol.

El cierre por `blur` (con `setTimeout` de 150 ms) se reemplaza por: Esc, click en el scrim (desktop), "Cancelar" (mobile), seleccionar un resultado, o mover el foco por teclado fuera del buscador. Esto es necesario porque los filtros ahora viven dentro del popover: tocarlos no puede cerrarlo.

Los filtros ("Buscar ▽" y el segmentado de fuente) pasan a vivir dentro del popover — cambio intencional: antes se veían siempre debajo del input.

### 2.3 Bottom nav

Ya existe `src/components/BottomNav.tsx` (Inicio/Comidas/Perfil, `safe-area-inset-bottom`, `lg:hidden`) y `/alimentacion/page.tsx` ya la renderiza. No se toca.

### 2.4 Porción propia

Requiere columnas nuevas en `alimentos`; queda documentado en el resumen para que decida el usuario. No se aplica migración.
