# NutriScan

**NutriScan** es una app web (PWA) de salud y nutrición deportiva, desarrollada como proyecto académico para la Universidad Católica de Córdoba (UCC). Permite a deportistas universitarios y usuarios particulares registrar su alimentación diaria —a mano, con el código de barras, con una foto del plato o conversando con un chat— y completar un perfil físico personalizado. Los datos son accesibles para el equipo de investigación a través de un panel analítico, que además cuenta con herramientas para validar los alimentos nuevos y medir la calidad de la IA.

---

## 👥 Roles de Usuario

| Rol | Descripción | Acceso |
|---|---|---|
| `deportista_ucc` | Usuario con email `@ucc.edu.ar` | Onboarding completo (perfil físico + académico + encuesta psicológica) → Home. **Estudio a ciegas:** no ve calorías ni macros en ninguna pantalla |
| `particular` | Usuario con cualquier otro email | Onboarding reducido (solo perfil físico) → Home, con calorías y macros visibles |
| `investigador` | Acceso mediante código de invitación | Panel de investigación (datos de todos los atletas, validación, revisión de IA) |
| `administrador` | Asignado desde la base de datos | Mismos permisos que `investigador` en el panel |

Los usuarios `deportista_ucc` pueden optar por registrarse como `particular` al momento de elegir su modalidad de uso. El rol se lee siempre en el servidor desde `profiles`, nunca del cliente.

---

## ⚡ Funcionalidades Principales

### Para deportistas y particulares

- **Dashboard nutricional diario** — calorías consumidas vs. meta diaria, macros del día (proteínas, carbohidratos, grasas) e hidratación. Para `deportista_ucc` se oculta la información numérica.
- **Cálculo nutricional personalizado** — TMB y GET con la ecuación de Harris-Benedict revisada (Roza & Shizgal, 1984) a partir del perfil físico.
- **Registro de ingestas** por momento del día (desayuno, almuerzo, merienda, cena, colaciones y suplementos), hasta 7 días hacia atrás, con cuatro vías de carga:
  - **Buscador de alimentos** sobre el catálogo SARA2 + ANMAT, con cálculo automático de macros por cantidad, y opción de cargar un **alimento personalizado** si no está en el catálogo.
  - **Escáner de código de barras** (cámara) con consulta a Open Food Facts.
  - **Reconocimiento por foto con IA (Gemini)** — se fotografía el plato, se indica la vajilla y el ángulo del dispositivo, la IA detecta los alimentos y estima los gramos; el usuario revisa, corrige, quita o agrega alimentos antes de guardar.
  - **Chat de comidas con IA** — se describe la comida en lenguaje natural y se confirma lo detectado.
- **Hidratación** — registro de agua diaria (también detectable desde el chat).
- **Perfil académico y deportivo** — para deportistas UCC: carrera, año, deporte, posición y frecuencia de entrenamientos.
- **Encuesta psicológica** — 25 preguntas Likert (escala 0–5) para deportistas UCC.
- **Recordatorios por email** — un cron diario de Vercel avisa a quienes no cargaron ingestas.
- **PWA instalable** con service worker (Serwist) y pantalla offline.
- **Autenticación dual** — email/contraseña o Google OAuth, con recuperación de contraseña.
- **Eliminación de cuenta** — borra la cuenta y todos sus datos, incluidas las fotos de detección.

### Para investigadores (panel `(researcher)`)

| Sección | Ruta | Qué hace |
|---|---|---|
| Dashboard | `/dashboard` | KPIs, distribución por deporte, cumplimiento semanal y ranking de atletas |
| Deportistas | `/deportistas` | Tabla con filtros (unidad académica, carrera, año, deporte), detalle por atleta y exportación a Excel (`.xlsx`) con la **fuente de cada dato nutricional** |
| Validación | `/validacion` | Cola de alimentos de deportistas que no estaban en el catálogo: el investigador los modifica, valida (recalcula los ítems vinculados), los vincula a un alimento existente, arma un valor mezclando varios alimentos o los descarta. Todo con auditoría append-only |
| Revisión de IA | `/revision-ia` | Cola de detecciones de Gemini que el equipo de nutrición debe revisar (ítem quitado, cambio de alimento, corrección grande de peso, confianza baja). Muestra la foto con las marcas de detección y permite confirmar o corregir |
| Métricas de IA | `/revision-ia/metricas` | Calidad de las detecciones: tasas de corrección, alimentos más corregidos, evolución por versión de prompt, y descarga de un **resumen en `.md`** para mejorar el prompt |

Cada pantalla del panel tiene un **cajón de ayuda** contextual.

---

## 🤖 Cómo funciona la IA

- **Detección por foto** (`POST /api/food-recognition`): una sola llamada a Gemini por foto. La imagen se recorta y procesa en el cliente/servidor, se guarda en un bucket **privado** de Supabase Storage (acceso solo por signed URLs de 5 minutos) y la predicción original se persiste.
- **Guardado** (`POST /api/food-recognition/save`): calcula los macros sobre el gramaje final. Cada alimento se resuelve por `foodRef` (elegido en el buscador), por match exacto contra SARA2 o, si no, Gemini elige una entrada del catálogo o estima los valores por 100 g. Todo se escribe en una única transacción (RPC `registrar_guardado_deteccion`).
- **Origen del dato**: cada ítem registra de dónde salió (`catalogo`, `estimado_ia`, `pendiente`, `validado`, `descartado`, `sin_datos`). Los alimentos desconocidos de deportistas UCC pasan a la cola de validación; los de particulares quedan como estimación de la IA.
- **Chat de comidas** (`POST /api/chat/meal` y `/confirm`): sin estado, con matching contra SARA2 en el backend (coeficiente de Dice sobre palabras, sin comparación difusa) y estimación de Gemini como respaldo. Con rate limit.
- **Métricas de calidad**: los motivos de revisión se calculan al guardar y las métricas solo los agregan (vistas `v_metricas_ia_items` y `v_metricas_ia_no_detectados`).

Detalle de contratos y reglas:

- [docs/contrato-deteccion.md](docs/contrato-deteccion.md) — endpoints de detección, guardado, validación y fuente del dato.
- [docs/chat-meal-api.md](docs/chat-meal-api.md) — API del chat de comidas.
- [docs/postman/](docs/postman/) — colección de Postman del chat.
- [docs/superpowers/](docs/superpowers/) — specs y planes de diseño de cada feature.

---

## 🛠️ Tecnologías Utilizadas

| Categoría | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router, `proxy.ts` como middleware) |
| Lenguaje | TypeScript (strict mode) |
| UI | React 19 + Tailwind CSS v4 |
| Formularios | React Hook Form + Zod |
| Base de datos | Supabase (PostgreSQL + RLS + RPCs + Storage) |
| Autenticación | Supabase Auth (email + Google OAuth) |
| IA | Google Gemini (`@google/genai`) |
| Imágenes | sharp |
| Escáner | html5-qrcode + Open Food Facts |
| Gráficos | Recharts |
| Exportación | ExcelJS |
| PWA | Serwist |
| Email | Nodemailer (Gmail) + Resend |
| Testing | Vitest + React Testing Library (jsdom) |
| Deploy | Vercel (+ Speed Insights y cron) |

---

## 📁 Estructura del Proyecto

```
NutriScan_ProyectoIntegrador/
├── src/
│   ├── proxy.ts                      # Auth + redirección al onboarding pendiente
│   ├── app/
│   │   ├── (researcher)/             # Panel de investigación
│   │   │   ├── dashboard/            # KPIs y gráficos de cumplimiento
│   │   │   ├── deportistas/          # Tabla de atletas + exportación a Excel
│   │   │   ├── validacion/           # Cola de validación de alimentos
│   │   │   └── revision-ia/          # Cola de revisión de detecciones
│   │   │       └── metricas/         # Métricas de calidad de la IA
│   │   ├── api/
│   │   │   ├── admin/delete-account-by-email/  # Baja de cuenta (x-admin-key)
│   │   │   ├── auth/provider-hint/   # Detección de proveedor OAuth
│   │   │   ├── chat/meal/            # Chat de comidas (+ confirm)
│   │   │   ├── food-recognition/     # Detección por foto (+ save)
│   │   │   ├── delete-account/       # Eliminación de cuenta propia
│   │   │   ├── register/             # Alta de nuevos usuarios
│   │   │   ├── send-reminders/       # Recordatorios por email (cron)
│   │   │   └── validate-investigator/# Validación del código de invitación
│   │   ├── alimentacion/             # Registro de ingestas (buscador, barcode, foto, chat)
│   │   ├── auth/                     # Callbacks de OAuth y reseteo de contraseña
│   │   ├── elegir-uso/               # Selección de rol (usuarios UCC)
│   │   ├── encuesta-psicologica/     # Encuesta psicológica (25 preguntas)
│   │   ├── home/                     # Dashboard del atleta/particular
│   │   ├── login/ · register/        # Login y registro (incl. investigador)
│   │   ├── perfil/ · perfil-academico/ · perfil-fisico/
│   │   └── offline/                  # Pantalla sin conexión (PWA)
│   ├── components/                   # researcher/, profile/, onboarding/, auth/, ui/
│   ├── lib/
│   │   ├── ai/ · geminiClient.ts · geminiFoodPrompt.ts   # Integración con Gemini
│   │   ├── chat/                     # Chat de comidas, matcher SARA2, rate limit
│   │   ├── deteccion*.ts · matchingAlimentos.ts          # Detección y matching
│   │   ├── revisionIa*.ts · metricasIa*.ts · resumenMetricasMd.ts
│   │   ├── researcher/               # Atletas, cumplimiento semanal
│   │   ├── supabase/                 # Clientes Supabase (client/server/admin)
│   │   └── calculations.ts · nutrition.ts · roles.ts · password.ts · dates.ts
│   └── types/                        # Tipos del dominio
├── testing/                          # Pruebas (Vitest): unitarias, componentes, API
│   ├── integration/                  # Integración (solo Gemini y Supabase simulados)
│   └── e2e/                          # E2E contra servicios reales (npm run test:e2e)
├── load/                             # Escenarios de k6 (stress y esfuerzo sostenido)
├── .github/workflows/                # CI y verificación posterior al despliegue                          
├── supabase/
│   ├── schema_consolidado.sql        # Fuente de verdad del esquema
│   ├── 020_alimento_personalizado_cola_nut192.sql  # Migración suelta (ya incluida arriba)
│   └── 021_chat_ia_cola_validacion_nut228.sql      # Migración suelta (ya incluida arriba)
├── SARA2/                            # ETL + seed del catálogo SARA2 (ver README_ETL_SARA2.md)
├── ANMAT/                            # Catálogo ANMAT: CSV + seed_anmat.py / unseed_anmat.py
├── scripts/                          # Íconos PWA, preview del matcher, prueba de prompt
├── docs/                             # Contratos de API, Postman, specs y planes
├── vercel.json                       # Cron diario de recordatorios
└── package.json
```

---

## 🚀 Instalación y Ejecución

### 1. Clonar el repositorio e instalar dependencias

```bash
git clone https://github.com/baujuncos/NutriScan_ProyectoIntegrador.git
cd NutriScan_ProyectoIntegrador
npm install
```

### 2. Configurar variables de entorno

Copiar `.env.example` a `.env.local` y completar:

```env
SUPABASE_URL=https://<tu-proyecto>.supabase.co
SUPABASE_ANON_KEY=<tu-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<tu-service-role-key>
INVITATION_CODE_INVESTIGADOR=<codigo-de-invitacion>
GEMINI_API_KEY=<tu-api-key-de-gemini>

# Opcionales
GEMINI_MODEL=gemini-3.5-flash
CRON_SECRET=<secreto-largo-aleatorio>   # obligatorio en Vercel: protege /api/send-reminders
GEMINI_FALLBACK_MODEL=gemini-3.6-flash
GMAIL_USER=<cuenta-que-envia-recordatorios>
GMAIL_PASS=<app-password-de-gmail>
```

| Variable | Para qué sirve |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | **Supabase → Project Settings → API**. La service role es solo de servidor |
| `INVITATION_CODE_INVESTIGADOR` | String arbitrario que define el equipo; los investigadores lo ingresan al registrarse |
| `GEMINI_API_KEY` | **Google AI Studio → Get API key**. Detección por foto y chat de comidas |
| `GEMINI_MODEL` | Modelo de Gemini; si Google depreca uno se puede pisar sin tocar código. El default está en `src/lib/geminiClient.ts` y `src/lib/ai/gemini.ts` |
| `GEMINI_FALLBACK_MODEL` | Modelo de respaldo si el principal falla |
| `GMAIL_USER`, `GMAIL_PASS` | Credenciales para `/api/send-reminders` |

> Las claves de Gemini y de Supabase service role son **solo de servidor**: nunca con prefijo `NEXT_PUBLIC_` ni desde componentes cliente.

### 3. Configurar la base de datos en Supabase

En el **SQL Editor** del proyecto, ejecutar `supabase/schema_consolidado.sql` (es re-ejecutable). Crea y configura:

| Objeto | Descripción |
|---|---|
| `profiles`, `physical_data`, `academic_data`, `psychological_surveys` | Perfil, datos físicos y resultados (TMB, GET, macros), académicos y encuesta |
| `alimentos`, `alimentos_barcode`, `alimentos_propios` | Catálogo (SARA2 + ANMAT), productos por código de barras y alimentos personalizados |
| `ingestas`, `items`, `hidratacion` | Diario alimentario con macros calculados por trigger, y agua |
| `detecciones_ia`, `detecciones_ia_items`, `detecciones_guardados`, `detecciones_guardados_items` | Predicción original de la IA y lo que finalmente guardó el usuario |
| `chat_ia_registros`, `chat_ia_registros_items` | Registro del chat de comidas |
| `alimentos_pendientes_validacion`, `alimentos_pendientes_auditoria` | Cola de validación y su auditoría append-only |
| Vistas | `v_alimentos_pendientes`, `v_alimentos_validados`, `v_alimentos_propios`, `v_revision_ia`, `v_metricas_ia_items`, `v_metricas_ia_no_detectados` |
| RPCs | `registrar_guardado_deteccion`, `match_alimentos`, `pendiente_modificar` / `pendiente_validar` / `pendiente_descartar`, entre otras |
| Storage | Bucket privado `detecciones-fotos` |
| RLS y triggers | Cada usuario accede solo a sus datos; investigadores y administradores leen los del panel |

### 4. Importar los catálogos de alimentos

Cargar **primero SARA2** y después ANMAT (ambos escriben en `public.alimentos`; ANMAT usa IDs con offset `1_000_000` para no colisionar). Requieren Python 3 y `pip install supabase python-dotenv`; leen `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` desde `.env.local`.

```bash
cd SARA2 && python seed_supabase.py      # ~930 alimentos del sistema oficial SARA2
cd ../ANMAT && python seed_anmat.py      # alimentos envasados (unseed_anmat.py los quita)
```

El proceso con que se construyó `base_macros.csv` está en [SARA2/README_ETL_SARA2.md](SARA2/README_ETL_SARA2.md).

### 5. Configurar Google OAuth en Supabase

1. Ir a **Supabase → Authentication → Providers → Google**.
2. Habilitar el proveedor e ingresar las credenciales de una aplicación OAuth 2.0 creada en [Google Cloud Console](https://console.cloud.google.com).
3. Agregar como **Authorized Redirect URIs**, tanto en Google Cloud como en Supabase:

```
http://localhost:3000/auth/callback            ← desarrollo local
https://<tu-dominio>.vercel.app/auth/callback  ← producción
```

### 6. Correr el proyecto

```bash
npm run dev      # http://localhost:3000
```

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo (Turbopack, service worker deshabilitado) |
| `npm run build` | Corre los tests y luego `next build --webpack` (necesario para Serwist) |
| `npm start` | Sirve el build de producción |
| `npm run lint` | ESLint |
| `npm test` / `npm run test:watch` | Tests con Vitest |

### 7. Ejecutar las pruebas y el proceso de calidad

Todo se ejecuta con un comando (Node 24):

| Qué | Comando | Necesita red / credenciales |
| --- | --- | --- |
| Todas las pruebas (unitarias, componentes, API, integración) | `npm test` | No |
| Con cobertura de sentencia y de decisión (`coverage/index.html`) | `npm run test:coverage` | No |
| Solo unitarias/componentes · solo integración | `npm run test:unit` · `npm run test:integration` | No |
| Análisis estático + quality gate completo | `npm run qa` (lint, tipos, cobertura, jscpd, npm audit, gate) | No |
| Solo el quality gate (con los reportes ya generados) | `npm run qa:gate` | No |
| **Smoke test** del despliegue | `BASE_URL=https://tu-app.vercel.app npm run smoke` | No (solo la URL) |
| **E2E contra Supabase, Gemini y Open Food Facts reales** | `npm run test:e2e` | Sí (`.env.local`, ver [SETUP_SECRETS](docs/SETUP_SECRETS.md)) |
| **Stress** (k6) | `BASE_URL=... npm run load:stress` | Necesita [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) (o `K6_BIN`) |
| **Esfuerzo sostenido** (k6) | `BASE_URL=... SOAK_DURATION=10m npm run load:soak` | idem |

El pipeline (`.github/workflows/`) hace lo mismo automáticamente: **CI** en cada push/PR (compila, prueba, analiza y aplica el quality gate) y **Verificar despliegue** después de cada despliegue (smoke → E2E real → carga).
La suite vive en `testing/` y tiene dos proyectos de Vitest: `node` (lógica pura: cálculos, roles, matching, detección, métricas, rutas API con mocks) y `jsdom` (componentes React con Testing Library). `npm run build` ejecuta los tests antes de compilar, así que un test roto frena el deploy.

Script de apoyo para el chat de comidas, sin gastar cuota de Gemini:

```bash
npx tsx --env-file=.env.local scripts/preview-sara2-matching.ts "pan blanco" "banana"
```
**Documentación de calidad** (trabajo integrador de Calidad de Software, nivel 3):

| Documento | Contenido |
| --- | --- |
| [docs/plan-de-pruebas.md](docs/plan-de-pruebas.md) | Criterios de entrada/salida, ISO 25010, riesgos, niveles, QA vs QC, plantillas, contingencia, 7 principios, trazabilidad |
| [docs/casos-de-prueba.md](docs/casos-de-prueba.md) | Clases de equivalencia, valores límite, tablas de decisión, cobertura de sentencia y decisión |
| [docs/defectos.md](docs/defectos.md) · [defectos.csv](docs/defectos.csv) | Registro de defectos (importable a Jira) y contraste rojo/verde |
| [docs/integracion-externa.md](docs/integracion-externa.md) | Contrato y pruebas de Supabase, Gemini y Open Food Facts |
| [docs/pruebas-de-carga.md](docs/pruebas-de-carga.md) · [docs/herramienta-k6.md](docs/herramienta-k6.md) | Stress, esfuerzo sostenido y la herramienta incorporada |
| [docs/metricas.md](docs/metricas.md) | Análisis estático, métricas y mejoras antes/después |
| [docs/SETUP_SECRETS.md](docs/SETUP_SECRETS.md) | Secrets y configuración externa necesarios |
| [docs/guion-demo.md](docs/guion-demo.md) | Guion de la demostración |
| [docs/GUIA_DEFENSA.md](docs/GUIA_DEFENSA.md) | Explicación simple de cada test, paso del pipeline y decisión |

---

## 🔒 Seguridad

- El código de invitación de investigadores se valida **únicamente en el servidor** (`/api/validate-investigator`) y nunca se expone al cliente. El rol de investigador se decide con `app_metadata` (solo escribible con service role) o con la cookie del código ya validado, nunca con `user_metadata` ni query params.
- Row Level Security habilitado en todas las tablas: cada usuario solo lee y modifica sus propios datos; investigadores y administradores tienen lectura ampliada mediante políticas específicas.
- Las operaciones sensibles (guardado de detecciones, validación de alimentos) corren en RPCs transaccionales con verificación de rol adentro; la cola de validación guarda auditoría append-only.
- Las fotos de los platos van a un bucket privado, se sirven con signed URLs de corta vida y se borran junto con la cuenta.
- El endpoint `/api/admin/delete-account-by-email` exige el header `x-admin-key` igual a la service role key.
- `proxy.ts` redirige al paso de onboarding pendiente si se intenta acceder a rutas protegidas antes de completarlo.
- Los deportistas UCC no reciben kcal ni macros en ninguna pantalla ni respuesta de API, para no sesgar el estudio.
