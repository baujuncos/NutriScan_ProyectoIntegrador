# Guía para la defensa oral

Está escrita en lenguaje simple y organizada por lo que te pueden preguntar. Para cada cosa: **qué es**, **qué hace**, **por qué se hizo así**. Si una pregunta no está acá, buscá el archivo mencionado y leelo: todo es corto.

---

## 0. La historia en un minuto

NutriScan es una app para que deportistas registren lo que comen, y los investigadores vean los datos. Se conecta con **Supabase** (cuentas y base de datos), **Gemini** (inteligencia artificial que interpreta "comí una manzana") y **Open Food Facts** (códigos de barras).

Declaramos **Nivel 3**. Armamos un proceso de calidad completo:

1. Un **pipeline** que en cada cambio compila, corre ~1800 pruebas, analiza el código y bloquea si algo está mal (el *quality gate*).
2. Otro pipeline que **después de cada despliegue** comprueba que la app y sus integraciones reales funcionan y la somete a carga.
3. Un **plan de pruebas** con riesgos, ISO 25010 y trazabilidad.
4. **Defectos reales** encontrados, con su prueba (primero roja, después verde).

Lo más importante que descubrimos: (a) la cobertura "86 %" era 70 % real; (b) un endpoint abierto que filtraba emails de todos los usuarios; (c) gracias a la prueba contra la base real, que la tabla de perfiles se podía leer sin iniciar sesión.

---

## 1. Mapa del repositorio (qué mirar para cada tema)

| Tema | Archivo(s) |
| --- | --- |
| Plan de pruebas, riesgos, ISO 25010, trazabilidad | `docs/plan-de-pruebas.md` |
| Casos de prueba (partición de equivalencia, valores límite, tablas de decisión) | `docs/casos-de-prueba.md` |
| Defectos | `docs/defectos.md`, `docs/defectos.csv`, `docs/evidencia/` |
| Integraciones externas | `docs/integracion-externa.md` |
| Carga | `docs/pruebas-de-carga.md`, `load/`, `scripts/load/` |
| Herramienta nueva (k6) | `docs/herramienta-k6.md` |
| Métricas y análisis estático | `docs/metricas.md` |
| Pipeline | `.github/workflows/ci.yml`, `.github/workflows/deploy-verify.yml` |
| Quality gate | `scripts/qa/lib.mjs`, `scripts/qa/quality-gate.mjs` |
| Smoke | `scripts/smoke.mjs` |
| Tests | `testing/` (unitarios, componentes, API), `testing/e2e/` (reales) |
| Secrets que hay que cargar | `docs/SETUP_SECRETS.md` |
| Demo | `docs/guion-demo.md` |

Comandos: `npm test` · `npm run test:coverage` · `npm run qa` · `npm run smoke` · `npm run test:e2e` · `npm run load:stress` · `npm run load:soak`.

---

## 2. Qué hace cada tipo de test (y por qué existe)

**Estructura Arrange–Act–Assert (AAA):** cada test tiene tres partes. *Arrange*: preparar los datos y los dobles. *Act*: ejecutar lo que se prueba, una sola cosa. *Assert*: verificar el resultado. Se escribe con comentarios en los tests nuevos para que se vea.

### Pruebas unitarias (`testing/*.test.ts`)
Prueban una función aislada, sin internet ni base de datos. Ejemplos: `calculations.test.ts` verifica la fórmula de calorías; `password.test.ts` las reglas de contraseña; `rateLimit.test.ts` el límite de pedidos por minuto.

### Pruebas de componentes (`testing/*.test.tsx`)
Dibujan una pantalla en un navegador simulado (jsdom) con React Testing Library y simulan un usuario que escribe y hace clic. Ejemplos: `LoginPage.test.tsx`, `HidratacionCard.test.tsx`.

### Pruebas de API / integración (`testing/*Route.test.ts`, `proxy.test.ts`, …)
Llaman directamente a las rutas del servidor (`POST /api/...`) como si fueran requests reales, pero con **dobles de prueba** en lugar de Supabase y Gemini.
- *Doble de prueba (mock):* un reemplazo falso, que devuelve lo que le decimos, para poder probar casos difíciles (que Gemini devuelva 503, que la base falle) rápido y gratis.
- Por qué: las rutas de API eran lo menos probado (0 % de cobertura) y ahí estaban los defectos más graves.

### Pruebas E2E reales (`testing/e2e/`)
Las mismas ideas pero contra **Supabase, Gemini y Open Food Facts de verdad**. Son pocas porque son lentas, usan cuota y dependen de internet. Por eso no están en `npm test`, sino en `npm run test:e2e` y se ejecutan después de cada despliegue.
- *Por qué hacen falta:* un doble de prueba solo prueba lo que nosotros creemos que hace el servicio. Solo el servicio real puede contradecirnos. Así apareció **DEF-009**.

### Smoke (`scripts/smoke.mjs`)
Ocho comprobaciones rápidas: "¿el despliegue arrancó?" (login responde, el manifiesto existe, las rutas protegidas redirigen, las APIs rechazan sin credenciales, Supabase responde). Dura segundos. Si falla, no tiene sentido seguir con E2E ni con carga. Nombre: "smoke" por la prueba de encender un aparato y ver si sale humo.

### Pruebas de carga (`load/`)
- **Stress:** subimos usuarios simulados por escalones hasta pasar el uso normal, para ver cuándo se degrada.
- **Esfuerzo sostenido (soak):** carga moderada constante durante varios minutos, para ver si algo empeora con el tiempo (por ejemplo memoria que se pierde).

---

## 3. Técnicas de diseño de casos (con ejemplos nuestros)

| Técnica | Idea | Ejemplo nuestro |
| --- | --- | --- |
| **Partición de equivalencia** | Dividir las entradas en grupos que el programa trata igual y probar un representante de cada grupo | Contraseñas: válida / corta / sin mayúscula / sin minúscula / sin número / vacía |
| **Valores límite** | Los errores se esconden en los bordes: probar justo antes, en y justo después | Edad 9a 364d (rechaza) · 10 años exactos (acepta) · 100 (acepta) · 101 (rechaza); cantidad 0, 0,01, 2000, 2000,01 |
| **Tabla de decisión** | Combinar condiciones y definir el resultado de cada combinación | Autorización del cron: (¿hay secreto? × ¿header correcto?) → 200/401 |
| **Cobertura de sentencia** | % de líneas ejecutadas por los tests | 84,82 % de todo `src/` |
| **Cobertura de decisión (ramas)** | % de salidas de cada `if` recorridas (verdadera y falsa) | 81,21 %. Es más exigente: 100 % de sentencias no garantiza 100 % de decisiones |

---

## 4. El pipeline paso a paso

### `ci.yml` — en cada push y pull request

| Paso | Qué hace | Por qué |
| --- | --- | --- |
| Checkout con historial completo | Baja el código y todo el historial | Para comparar contra la rama base y medir solo el código nuevo |
| Node 24 + caché | Prepara el entorno | Mismo Node que usamos en local |
| `npm ci` | Instala dependencias exactas del `package-lock.json` | Reproducible: mismo resultado en cualquier máquina |
| Compilar (`next build`) | Genera la app como la de producción | Si no compila, no se puede desplegar |
| Chequeo de tipos (`tsc`) | Verifica los tipos TypeScript | Atrapa errores antes de ejecutar |
| Pruebas con cobertura | Corre toda la suite y mide qué líneas se ejecutaron | Detecta regresiones y calcula la cobertura |
| Análisis estático | ESLint (errores de código), jscpd (copias de código), npm audit (dependencias con vulnerabilidades) | Encuentra problemas sin ejecutar |
| **Quality gate** | Decide si el cambio se acepta | Ver abajo |
| Resumen y artefactos | Publica los reportes en la ejecución | Evidencia descargable, los números del informe salen de acá |

### El quality gate (`scripts/qa/quality-gate.mjs`)
Bloquea (el job falla y el PR no se puede integrar) si:
1. hay **algún error de ESLint** (los consideramos "bugs críticos"),
2. la **duplicación supera 5 %** (2,62 % hoy),
3. la **cobertura global baja de 80 %** (84,82 %),
4. la **cobertura del código nuevo** (líneas que agrega el cambio) **baja de 80 %** (98,57 % en este trabajo).

Cómo mide "código nuevo": `git diff` contra la rama base da las líneas agregadas; el reporte `lcov.info` dice qué líneas se ejecutaron; se cruzan. `npm audit` solo **avisa** (no bloquea) porque hay vulnerabilidades en bibliotecas que requieren cambios mayores.

Por qué lo escribimos en vez de usar SonarCloud: no requiere cuenta ni token, y los números salen de las mismas herramientas que el informe. SonarCloud queda como opcional (`sonar-project.properties`).

### `deploy-verify.yml` — después de cada despliegue
Se dispara solo cuando Vercel termina un despliegue (evento `deployment_status`) o a mano. Orden: **smoke → E2E → carga**. Si el smoke falla, los demás no corren.

---

## 5. Decisiones importantes y su porqué

| Decisión | Por qué |
| --- | --- |
| Medir cobertura sobre todo `src/` | Con el default, los archivos sin tests no aparecen y el número se infla: 86 % visible vs 70 % real (DEF-006). |
| Excluir de la cobertura solo tipos, `sw.ts`, `manifest.ts`, `loading.tsx` | No tienen lógica (o corren solo en el navegador); cada exclusión está comentada en `vitest.config.ts`. |
| Test rojo primero, fix después | Demuestra que el test detecta el defecto (si nunca falló, no sabemos si prueba algo) y fija el criterio de aceptación antes de ejecutar. |
| Gemini y Supabase se reemplazan por dobles en CI | Rápido, gratis, determinista; la realidad se verifica en el E2E posterior al despliegue. |
| Las pruebas E2E se saltean sin credenciales | Un secret faltante no debe poner el pipeline en rojo ni ocultar un problema: aparece como "skipped". |
| El E2E cuenta filas, no imprime datos | Si detecta una fuga de datos personales, no debe copiarlos a los logs públicos del pipeline. |
| `CRON_SECRET` falla cerrado | Sin la variable el endpoint rechaza todo: es preferible no mandar mails que dejarlo abierto. |
| Reglas del React Compiler de ESLint pasadas a "warn" | Son recomendaciones de estilo (13 casos que funcionan y tienen tests); como el gate bloquea con errores, queremos que bloquee bugs reales. Quedan como deuda técnica visible. |
| No se cambió la fórmula de Harris-Benedict (DEF-004) | Cambiaría resultados de un estudio: eso lo decide el equipo, no una herramienta. |
| Stress con umbral de p95 < 2 s y sostenido p95 < 1 s | El sostenido es el uso esperado, así que es más estricto; el stress admite degradación pero no errores (> 5 %). |

---

## 6. Los defectos, explicados

- **DEF-002 (crítico):** `/api/send-reminders` no pedía autenticación. Cualquiera podía hacer que se mandaran mails a todos los usuarios y recibir sus emails en la respuesta. Se arregló pidiendo un secreto que Vercel Cron ya envía.
- **DEF-003:** para borrar una cuenta por email se buscaba al usuario en una lista que Supabase corta en 50: de ahí para atrás "no existe". Se recorre por páginas.
- **DEF-005:** el código de invitación de investigadores se podía probar sin límite. Ahora 10 por minuto por IP (limitación: el contador es por instancia).
- **DEF-007:** el login decía "mínimo 8" pero validaba 6. Se alineó el mensaje con la regla.
- **DEF-008:** la hidratación aceptaba cualquier número desde el servidor (NaN, un billón). Se valida del lado del servidor, no se confía en la interfaz.
- **DEF-009:** la base real permite leer perfiles sin sesión (una política vieja nunca se quitó de la base). Lo detectó el E2E; la corrección es una sentencia SQL que debe ejecutar el equipo.
- **DEF-004:** las constantes de Harris-Benedict son las de 1919 aunque la documentación dice "revisada 1984". Abierto.

**Contraste rojo/verde:** `git show c220b12 --stat` (test rojo) y `git show da001fb --stat` (fix). `docs/evidencia/def002-rojo.txt` muestra `expected 200 to be 401`; `def002-verde.txt` muestra 23 pruebas en verde.

---

## 7. Preguntas probables

**¿Qué diferencia hay entre QA y QC?** QA previene mejorando el proceso (pipeline, plantillas, revisión, riesgos); QC detecta defectos en el producto (ejecutar pruebas, medir, registrar defectos). Ambas listas están en el plan (§6).

**¿Por qué una cobertura alta no alcanza?** Mide qué líneas se ejecutaron, no si se verificó algo útil. Además la nuestra era 86 % solo porque no contaba los archivos sin tests. Por eso también usamos cobertura de decisión, valores límite y pruebas contra servicios reales.

**¿Qué es una prueba de regresión?** La que se escribe para un defecto corregido, para que no vuelva. Cada defecto de `defectos.md` tiene la suya (columna "Test de regresión").

**¿Cómo se cumple "criterio de aceptación antes de ejecutar"?** Escribiendo el test (que define lo esperado) y viéndolo fallar antes del fix; está en el historial de git.

**¿Qué pasa si Gemini se cae?** Reintenta una vez, prueba un modelo de respaldo, avisa con un mensaje claro y el usuario puede cargar la comida a mano o escanear el código de barras. No se pierde nada porque el chat no guarda hasta confirmar. Plan de contingencia: `plan-de-pruebas.md` §9.

**¿Por qué se prueba contra integraciones reales si ya hay mocks?** Porque un mock repite nuestras suposiciones; el servicio real puede contradecirlas (DEF-009).

**¿Qué es stress y qué es esfuerzo sostenido?** Stress: subir la carga hasta pasar el límite para ver cuándo y cómo se degrada. Sostenido: carga normal durante mucho tiempo para ver si algo empeora con las horas.

**¿Qué mostró el stress?** Ver `docs/pruebas-de-carga.md`: con 100 usuarios simultáneos cumple todos los umbrales; con 300 la latencia p95 pasa los 2 s (sin errores) en la máquina de pruebas.

**¿Por qué k6 y no JMeter?** Matriz de decisión en `docs/herramienta-k6.md`: umbrales como código que cortan el pipeline, scripts en JavaScript, bajo consumo.

**¿Cómo sabés que los números del informe son reales?** Salen de los archivos que genera el pipeline (`coverage/coverage-summary.json`, `reports/eslint.json`, `reports/jscpd`, `reports/load/*.json`); el informe cita el comando que los produce.

**¿Cuáles son los siete principios?** (1) las pruebas muestran presencia de defectos, no ausencia; (2) no se puede probar todo; (3) probar temprano; (4) los defectos se agrupan; (5) paradoja del pesticida; (6) depende del contexto; (7) falacia de la ausencia de errores. Aplicación al proyecto: `plan-de-pruebas.md` §11.

**¿Qué NO cumple el trabajo?** Honestidad: DEF-004 y DEF-009 siguen abiertos por requerir una decisión o una acción en Supabase; la ejecución del pipeline en GitHub depende de cargar los secrets y mergear a la rama principal; el E2E con usuario de prueba y la carga contra el despliegue real se ejecutan cuando eso esté listo. El informe lo declara.

---

## 8. Glosario

- **CI/CD:** integración continua / entrega continua; automatizar compilar, probar y desplegar.
- **Quality gate:** "puerta de calidad"; reglas que un cambio debe cumplir para integrarse.
- **RLS (Row Level Security):** reglas de la base de datos que deciden qué filas ve cada usuario.
- **Anon key:** clave pública de Supabase; con RLS bien puesta solo permite lo que cualquiera puede hacer.
- **Service role:** clave todopoderosa de Supabase, solo servidor, ignora RLS.
- **Mock / doble de prueba:** reemplazo falso de un componente real para probar en aislamiento.
- **Flaky (intermitente):** test que a veces pasa y a veces falla sin que el código cambie (DEF-001).
- **p95:** valor bajo el cual está el 95 % de las mediciones.
- **VU:** usuario virtual de k6.
- **Falla cerrado (fail closed):** ante la duda, se rechaza.
