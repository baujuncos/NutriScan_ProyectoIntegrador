# Buscador de alimentos — segunda pasada hacia el mockup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar las mejoras del mockup que la primera pasada dejó afuera (resaltado, stepper ±10 g, sacar "?", popover desktop + pantalla completa mobile).

**Spec:** `docs/superpowers/specs/2026-10-01-alimentacion-buscador-mockup-fase2-design.md`

## Global Constraints

- `MAX_CANTIDAD` = 2000, `hideNutrition` y `searchAlimentosAction(query, tipoIngesta, campos?)` no se tocan.
- Sin dependencias npm nuevas, sin migraciones.
- Texto de UI en español, mismo tono que el resto de `/alimentacion`.
- Antes de cada commit: `npx vitest run` y `npx tsc --noEmit` limpios.

## Task 1: Resaltado de coincidencia

**Files:** `src/app/alimentacion/searchQuery.ts`, `src/app/alimentacion/BusquedaAlimento.tsx`, `testing/searchQuery.test.ts`, `testing/AlimentacionSearch.test.tsx`

- [ ] Tests que fallan: `rangoCoincidencia` (mayúsculas, tildes, sin match, query vacía) y un test de integración que verifica `<mark>` con la parte que coincide.
- [ ] Implementar `rangoCoincidencia` y el resaltado en `FilaResultado`.
- [ ] Reemplazar `getByText(A_X.nombre)` por un matcher de `textContent` (helper `porNombre`).
- [ ] Commit.

## Task 2: Stepper de a 10 g

**Files:** `src/app/alimentacion/CantidadSelector.tsx`, `testing/CantidadSelector.test.tsx`

- [ ] Actualizar tests: aria-labels "Sumar 10 gramos"/"Restar 10 gramos", 50→60→40, piso 1, techo `maxCantidad`.
- [ ] Implementar. Commit.

## Task 3: Sacar el botón "?" y el modal de detalle

**Files:** `src/app/alimentacion/BusquedaAlimento.tsx`, `testing/AlimentacionSearch.test.tsx`

- [ ] Reemplazar `describe('botón "?" de detalle')` por `describe('denominación inline')`: la denominación se ve en la fila con `title`, no hay botón "?" ni diálogo, no se muestra el id.
- [ ] Borrar el botón y el `Modal`. Commit.

## Task 4: Popover desktop + pantalla completa mobile

**Files:** `src/app/alimentacion/BusquedaAlimento.tsx`, `testing/AlimentacionSearch.test.tsx`

- [ ] Tests que fallan: el popover contiene los filtros y el pie de atajos; Esc cierra; click en el scrim cierra; "Cancelar" cierra; tocar un filtro no cierra.
- [ ] Ajustar los tests de filtros para enfocar el input antes (los filtros viven dentro del popover).
- [ ] Implementar (un solo árbol DOM, ver spec §2.2). Commit.

## Task 5: Bottom nav y porción propia

- [ ] Verificado: `BottomNav` ya existe y se usa en `/alimentacion`. Sin cambios.
- [ ] Porción propia: documentar en el resumen, sin migración.
