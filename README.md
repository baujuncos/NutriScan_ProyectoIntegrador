# NutriScan

**NutriScan** es una app de salud y nutrición deportiva desarrollado como proyecto académico para la Universidad Católica de Córdoba (UCC). Permite a deportistas universitarios y usuarios particulares registrar su alimentación diaria, visualizar sus macronutrientes y calorías en tiempo real, y completar un perfil físico personalizado basado en la ecuación científica de Harris-Benedict. Los datos recolectados son accesibles para investigadores a través de un panel analítico dedicado.

---

## 👥 Roles de Usuario

| Rol | Descripción | Acceso |
|---|---|---|
| `deportista_ucc` | Usuario con email `@ucc.edu.ar` | Onboarding completo (perfil físico + académico + encuesta psicológica) → Home |
| `particular` | Usuario con cualquier otro email | Onboarding reducido (solo perfil físico) → Home |
| `investigador` | Acceso mediante código de invitación | Panel de investigadores con datos de todos los atletas |

Los usuarios `deportista_ucc` pueden optar por registrarse como `particular` al momento de elegir su modalidad de uso.

---

## ⚡ Funcionalidades Principales

- **Dashboard nutricional diario** — visualización de calorías consumidas vs. meta diaria, macros del día (proteínas, carbohidratos, grasas) y progreso de hidratación.
- **Registro de ingestas** — carga de alimentos por momento del día (desayuno, almuerzo, merienda, cena, colaciones y suplementos), con búsqueda en la base de datos SARA2 de 930 alimentos y cálculo automático de macros por cantidad indicada.
- **Cálculo nutricional personalizado** — la TMB (Tasa Metabólica Basal) y el GET (Gasto Energético Total) se calculan con la ecuación de Harris-Benedict revisada (Roza & Shizgal, 1984) a partir del perfil físico del usuario.
- **Perfil académico y deportivo** — para deportistas UCC: carrera, año, deporte (hockey/básquet), posición y frecuencia de entrenamientos.
- **Encuesta psicológica** — 25 preguntas Likert (escala 0–5) para deportistas UCC, almacenadas para análisis investigativo.
- **Panel de investigadores** — tabla de atletas con filtros por unidad académica, carrera, año, deporte; indicador de cumplimiento semanal de ingestas; y modal de detalle por atleta.
- **Exportación de datos a Excel** — los investigadores pueden exportar los datos nutricionales y de perfil de los atletas seleccionados en formato `.xlsx` directamente desde el panel.
- **Autenticación dual** — registro e inicio de sesión por email/contraseña o mediante Google OAuth.
- **Eliminación de cuenta** — los usuarios pueden eliminar su cuenta y todos sus datos desde el perfil.

---

## 🛠️ Tecnologías Utilizadas

| Categoría | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router) |
| Lenguaje | TypeScript (strict mode) |
| Estilos | Tailwind CSS v4 |
| UI State | React 19 |
| Formularios | React Hook Form + Zod |
| Base de datos | Supabase (PostgreSQL + RLS) |
| Autenticación | Supabase Auth (email + Google OAuth) |
| Gráficos | Recharts |
| Email | Resend + Nodemailer |
| Testing | Vitest |
| Deploy | Vercel |

---

## 📁 Estructura del Proyecto

```
NutriScan_MVP_APS/
├── src/
│   ├── app/
│   │   ├── (protected)/              # Middleware de autenticación
│   │   ├── (researcher)/             # Panel exclusivo del investigador
│   │   │   ├── dashboard/            # KPIs y gráficos de cumplimiento
│   │   │   └── deportistas/          # Tabla de atletas + exportación
│   │   ├── api/                      # Endpoints del servidor
│   │   │   ├── auth/provider-hint/   # Detección de proveedor OAuth
│   │   │   ├── delete-account/       # Eliminación de cuenta propia
│   │   │   ├── register/             # Alta de nuevos usuarios
│   │   │   ├── send-reminders/       # Envío de recordatorios por email
│   │   │   └── validate-investigator/# Validación del código de invitación
│   │   ├── alimentacion/             # Registro diario de ingestas
│   │   ├── auth/                     # Callbacks de OAuth
│   │   ├── elegir-uso/               # Selección de rol (usuarios UCC)
│   │   ├── encuesta-psicologica/     # Encuesta psicológica (25 preguntas)
│   │   ├── home/                     # Dashboard del atleta/particular
│   │   ├── login/                    # Login y registro unificados
│   │   ├── perfil/                   # Gestión y eliminación de cuenta
│   │   ├── perfil-academico/         # Datos académicos y deportivos
│   │   └── perfil-fisico/            # Datos físicos y cálculo TMB/GET
│   ├── components/
│   │   ├── researcher/               # Tabla de atletas, gráficos, modal
│   │   ├── profile/                  # Formularios de perfil físico y académico
│   │   ├── onboarding/               # Componentes del flujo de alta
│   │   └── ui/                       # Componentes reutilizables (Input, etc.)
│   ├── lib/
│   │   ├── calculations.ts           # Harris-Benedict, macros, kcal restantes
│   │   ├── dates.ts                  # Validación y parsing de fechas
│   │   ├── password.ts               # Reglas de contraseña + esquema Zod
│   │   ├── roles.ts                  # Asignación y etiquetas de roles
│   │   ├── nutrition.ts              # Constantes y utilidades de ingestas
│   │   ├── researcher/               # Lógica de cumplimiento semanal
│   │   └── supabase/                 # Clientes Supabase (client/server/admin)
│   └── types/                        # Tipos TypeScript del dominio
├── testing/                          # Pruebas (Vitest): unitarias, componentes, API
│   ├── integration/                  # Integración (solo Gemini y Supabase simulados)
│   └── e2e/                          # E2E contra servicios reales (npm run test:e2e)
├── load/                             # Escenarios de k6 (stress y esfuerzo sostenido)
├── scripts/qa/                       # Quality gate y reportes de análisis estático
├── .github/workflows/                # CI y verificación posterior al despliegue
├── supabase/
│   └── schema_consolidado.sql        # Schema completo: tablas, RLS, triggers
├── SARA2/
│   ├── base_macros.csv               # Base de datos de 930 alimentos (SARA2)
│   └── seed_supabase.py              # Script de importación a Supabase
├── vitest.config.ts
├── next.config.ts
└── package.json
```

---

## 🚀 Instalación y Ejecución

### 1. Clonar el repositorio e instalar dependencias

```bash
git clone <url-del-repositorio>
cd NutriScan_MVP_APS
npm install
```

### 2. Configurar variables de entorno

Crear el archivo `.env.local` en la raíz del proyecto con el siguiente contenido:

```env
SUPABASE_URL=https://<tu-proyecto>.supabase.co
SUPABASE_ANON_KEY=<tu-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<tu-service-role-key>
INVITATION_CODE_INVESTIGADOR=<codigo-de-invitacion>
GEMINI_API_KEY=<tu-api-key-de-gemini>
GEMINI_MODEL=gemini-3.5-flash
CRON_SECRET=<secreto-largo-aleatorio>   # obligatorio en Vercel: protege /api/send-reminders
```

Los valores de `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` se obtienen desde **Supabase → Project Settings → API**.

El valor de `INVITATION_CODE_INVESTIGADOR` es un string arbitrario que el equipo define; los investigadores lo ingresan al registrarse para recibir acceso al panel.

El valor de `GEMINI_API_KEY` se obtiene desde **Google AI Studio → Get API key** (lo usa el endpoint de reconocimiento de alimentos por IA, épica NUT-12). `GEMINI_MODEL` es opcional — si no se define, el servidor usa `gemini-3.5-flash` por defecto (definido en `src/lib/geminiClient.ts`); si Google vuelve a deprecar el modelo, se puede pisar sin tocar código seteando esta variable.

### 3. Configurar la base de datos en Supabase

En el **SQL Editor** del proyecto de Supabase, ejecutar el archivo de schema consolidado:

```
supabase/schema_consolidado.sql
```

Este script crea y configura:

| Objeto | Descripción |
|---|---|
| `public.profiles` | Perfil de usuario con rol y flags de onboarding |
| `public.physical_data` | Datos físicos y resultados nutricionales (TMB, GET, macros) |
| `public.academic_data` | Datos académicos y deportivos (solo deportistas UCC) |
| `public.psychological_surveys` | Respuestas de la encuesta psicológica (25 ítems Likert) |
| `public.alimentos` | Catálogo de alimentos con macros por 100g (SARA2) |
| `public.ingestas` | Registro de ingestas diarias por usuario y momento del día |
| `public.items` | Ítems individuales de cada ingesta con cantidades y macros calculados |
| RLS policies | Cada usuario accede únicamente a sus propios datos; investigadores leen todos |
| Triggers | Recalcula totales de macros en `ingestas` al insertar, modificar o eliminar un ítem |

### 4. Importar la base de datos de alimentos SARA2

La tabla `public.alimentos` se puebla con 930 alimentos extraídos del sistema oficial argentino SARA2. Ejecutar el script de importación con las variables de entorno configuradas:

```bash
cd SARA2
python seed_supabase.py
```

> **Requisito:** Python 3 con las librerías `supabase` y `python-dotenv` instaladas (`pip install supabase python-dotenv`). El script lee `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` desde `.env.local`.

### 5. Configurar Google OAuth en Supabase

1. Ir a **Supabase → Authentication → Providers → Google**.
2. Habilitar el proveedor e ingresar las credenciales de una aplicación OAuth 2.0 creada en [Google Cloud Console](https://console.cloud.google.com).
3. Agregar las siguientes URLs como **Authorized Redirect URIs** tanto en Google Cloud como en Supabase:

```
http://localhost:3000/auth/callback        ← desarrollo local
https://<tu-dominio>.vercel.app/auth/callback  ← producción
```

### 6. Correr el proyecto en desarrollo

```bash
npm run dev
```

La aplicación estará disponible en `http://localhost:3000`.

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

- El código de invitación de investigadores se valida **únicamente en el servidor** (`/api/validate-investigator`) y nunca se expone al cliente.
- Row Level Security (RLS) habilitado en todas las tablas: cada usuario solo puede leer y modificar sus propios datos.
- Los investigadores tienen acceso de lectura a todos los perfiles mediante políticas RLS específicas para su rol.
- El middleware de Next.js redirige automáticamente a los usuarios al paso de onboarding pendiente si intentan acceder a rutas protegidas antes de completarlo.
