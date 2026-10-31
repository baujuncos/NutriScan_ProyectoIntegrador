# Antropometrías — progreso (NUT-235)

Rama `feat/motor-antropometrias` (commits locales, **sin push ni PR**). Última actualización: 30-oct-2026.

> Nota de carpetas: `docs/antropometria/` (esta, versionada) no es `docs/antropometrias/` (sin versionar: planillas Excel con datos de una persona real y mockups). **No commitear ni citar nada de la segunda.**

## Estado por fase

| Fase | Qué | Commit | Estado |
|---|---|---|---|
| 1 | Tablas, RLS y tipos (NUT-247, NUT-252) | `8221b02` | Hecha. SQL **sin aplicar** y script de verificación **sin ejecutar** (no hay base a mano). |
| 2 | Listado y alta manual (NUT-236, NUT-237) | `d482006` | Hecha |
| 3 | Ficha del paciente (NUT-238) | `d03e73e` | Hecha |
| 4 | Asistente de carga con borrador (NUT-239, NUT-240) | `47ff978` | Hecha |
| 5 | Informe en pantalla + PDF por impresión (NUT-241/242/243) | `438f9a3` | Hecha |
| 6 | Edición y anulación (NUT-245) | `e4338bd` | Hecha |

Verificado: `tsc` sin errores, ESLint sin errores (solo warnings viejos de otros archivos), 2189 tests verdes, `next build --webpack` compila las 5 rutas nuevas.
**No verificado todavía:** el recorrido real en el navegador (alta → medición → informe) y las capturas, porque necesitan la migración aplicada en un Supabase de desarrollo.

## Cómo probarlo

1. Pegar `supabase/022_antropometria_nut247.sql` en el SQL Editor de Supabase (idempotente; la misma sección está al final de `schema_consolidado.sql`).
2. Opcional, en una base **descartable**: `psql "$DATABASE_URL" -f supabase/tests/022_antropometria_rls.test.sql` (termina en `ROLLBACK`; imprime `TODOS LOS CASOS OK`). Nunca se corrió: puede pedir ajustes del `insert into auth.users`.
3. `npm run dev`, entrar como investigador o administrador → pestaña **Antropometrías**.
4. Recorrido con la paciente ficticia: Agregar paciente → Julieta Marchetti, 05/04/2002, Femenino → Nueva medición (24/10/2026, nivel Moderada, deporte Voleibol) con los valores de `testing/fixtures/antropometria.ts` (`SERIES_JULIETA`, 2 series por variable).
5. Valores ancla del informe: masa adiposa **17,64 kg**, muscular **21,26 kg**, somatotipo **2,8 – 3,6 – 3,3**, IMC **19,8**. (Ya están asertados en tests contra el motor y las páginas con Supabase simulado.)
6. Exportar PDF → "Guardar como PDF"; el nombre sugerido es `Marchetti_Julieta_2026-10-24`.

Tests: `npm run test:unit` (archivos nuevos: `testing/antropometria/*.test.ts`, `antropometria*Actions.test.ts`, `AntropometriasClient`, `MedicionWizard`, `InformeAntropometria`, `AntropometriaPaginas`, `AnularMedicion`).

## Mapa del código

- Motor puro (ya existía): `src/lib/antropometria/`.
- Capa de la app: `src/lib/researcher/antropometria/` — `reglas` (menores, duplicados, límite de 12, mismo mes, coma decimal), `listado`, `datos`, `calculo`, `guardado` (masa ósea de referencia), `asistente`, `informe`, `formato`, `rutas`.
- Pantallas: `src/app/(researcher)/antropometrias/` (`page`, `nuevo`, `[origen]/[id]` ficha, `[origen]/[id]/medicion/nueva`, `medicion/[medicionId]` informe, `.../editar`) + `actions.ts`, `MedicionWizard`, `AnularMedicion`.
- Datos: `supabase/022_antropometria_nut247.sql`; tipos a mano en `src/types/antropometria.ts` (el repo no genera tipos de la base).

## Decisiones tomadas

- **Roles:** investigador **y administrador** (mismo criterio que el resto del panel y que `get_my_role()`); los demás roles y anon no ven nada (RLS + guard de acciones).
- **Sin carpeta de migraciones:** el repo aplica el SQL a mano; se siguió esa convención (sección 022 + archivo suelto).
- **Datos del deportista registrado:** `physical_data` tiene sexo y nacimiento `NOT NULL`, así que un deportista que no completó su perfil no tiene fila y no se le puede escribir desde el panel. En lugar de una RPC se creó la tabla auxiliar `antropometria_deportistas_datos`: guarda la **masa ósea de referencia** y, solo como respaldo, sexo y fecha de nacimiento. Si `physical_data` tiene el dato, manda ese; nunca se pisa.
- **Masa ósea de referencia:** si la persona tiene ≥ 21 años y no hay referencia, se guarda la masa ósea calculada de esa medición. Al editar la medición vigente **más antigua** se recalcula desde ella. Menores de 21: se calcula siempre y no se guarda.
- **Solo datos crudos:** el informe se calcula al abrirlo; no hay resultados guardados que puedan quedar desincronizados.
- **Límite de 12:** cuentan solo las **vigentes**; los borradores y las anuladas no. Editar una vigente no cuenta contra el límite. Se valida también en el servidor.
- **Mismo mes:** aviso en el primer paso, no bloquea.
- **Borrador:** autoguardado con debounce de 1,5 s; una medición ya generada se edita sin autoguardado y se guarda de una vez. Un borrador sin informe redirige al asistente.
- **Medición anterior** (para comparar): la vigente inmediatamente previa por fecha.
- **Fechas:** la fecha de medición no puede ser futura.
- **Informe:** decimales fijos en es-AR ("3,0", no "3"); gráficos en SVG inline; la talla no tiene Z (no hay Phantom). Nota fija sobre el Z del perímetro de muslo medial (el módulo usa el valor ajustado; la planilla, el sin ajustar).
- **Voleibol (mujer):** el módulo da 3,0 – 3,5 – 3,5 (búsqueda por id exacto); el mockup mostraba 2,9 – 3,7 – 3,2, que es un error del VLOOKUP de la planilla.
- **PDF:** hoja de estilos `@media print` A4 en `globals.css` (imprime solo `#informe-imprimible`) y `window.print()`; el título de la pestaña se cambia mientras imprime para que el archivo se llame paciente + fecha.
- **Listado:** solo `deportista_ucc` (los `particular` nunca se ven en el panel, como en el resto).

## Pendiente

- Aplicar la migración, correr el script SQL de verificación y hacer el recorrido en el navegador con capturas.
- Fuera de alcance acordado: fotos posturales; ABM de instrumentos y error técnico por investigador; pantalla Evolución (12 meses, comparador A/B, trayectoria de somatotipo); compartir el PDF con la Web Share API (un PDF real requiere generarlo; hoy se usa "Guardar como PDF" del navegador).
- Pulido: contorno clásico de la somatocarta; columnas del mockup que no se pidieron (KPIs, deporte, estado "al día/atrasada" en el listado; "Exportar historial"); condición deportista/recreacional en el alta manual.
- Tipos generados de la base (hoy a mano).

## Dudas para los nutricionistas

1. Si se **anula** o se edita la primera medición, ¿la masa ósea de referencia debe seguir siendo la de esa medición, la de la siguiente o recalcularse? Hoy: se recalcula al editar la más antigua; al anularla la referencia guardada se mantiene.
2. Si la primera medición es de una persona de 18 a 20 años, no se guarda referencia hasta la primera medición con ≥ 21: ¿es lo esperado?
3. ¿Los **borradores** deben ocupar lugar en las 12 mediciones? Hoy no.
4. **Distancia al deporte** en la somatocarta: se muestra la distancia euclídea X–Y entre el punto del paciente y el del deporte. ¿Prefieren otra medida (p. ej. SAD en 3 dimensiones)?
5. **Textos fijos que redacté yo** y necesitan su revisión: las descripciones de cada masa y la nota del control de calidad (`DESCRIPCION_MASA` en `src/lib/researcher/antropometria/informe.ts`, `InformeParte1.tsx`).
6. La planilla permite hasta 5 series por variable; el módulo y el asistente usan 2 o 3 (según el protocolo): ¿confirmado?
