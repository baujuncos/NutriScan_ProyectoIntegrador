# Secrets y configuración externa (lo que tenés que cargar vos)

Nada de esto está en el repositorio ni debe estarlo. Los **nombres** de las variables son los de las tablas; los **valores** los obtenés como se explica.

## 1. Secrets de GitHub Actions

*Repositorio → Settings → Secrets and variables → Actions → New repository secret.*

| Secret | Para qué se usa | Cómo obtenerlo | Obligatorio |
| --- | --- | --- | --- |
| `SUPABASE_URL` | Smoke y E2E contra Supabase real | Supabase → Project Settings → API → *Project URL* | Sí |
| `SUPABASE_ANON_KEY` | Idem (clave pública, respeta RLS) | Supabase → Project Settings → API → *anon public* | Sí |
| `E2E_USER_EMAIL` | Usuario de **prueba** para el flujo E2E (login → chat con Gemini → guardar en el diario) | Ver "Crear el usuario de prueba" abajo | Sí para el E2E completo |
| `E2E_USER_PASSWORD` | Contraseña de ese usuario | La elegís vos al crearlo | Sí para el E2E completo |
| `GEMINI_API_KEY` | Prueba de contrato directa contra Gemini | Google AI Studio → *Get API key*. Mejor una clave aparte de la de producción, para no gastar su cuota | Recomendado |
| `VERCEL_BYPASS_SECRET` | Que el pipeline pueda entrar a **previews** protegidos de Vercel | Vercel → Project → Settings → Deployment Protection → *Protection Bypass for Automation* → generar | Solo si probás previews |
| `SONAR_TOKEN` | Análisis complementario con SonarCloud | sonarcloud.io → My Account → Security → generar token | No (opcional) |

*Variable* (no secret) opcional: `SONAR_ENABLED=true` en la misma pantalla, pestaña *Variables*, para activar el job de SonarCloud. Además hay que crear el proyecto en SonarCloud y ajustar `sonar.organization` en `sonar-project.properties`.

Sin `E2E_USER_*` las pruebas E2E que necesitan usuario **se saltean** (aparecen como *skipped*, no fallan); el resto del E2E y el smoke corren igual.

### Crear el usuario de prueba

1. Registrá una cuenta nueva desde la app desplegada con un email **que no sea `@ucc.edu.ar`** (así queda como rol `particular` y no entra en el estudio), por ejemplo una casilla de pruebas tuya. Contraseña fuerte y única.
2. Confirmá el email desde el mail que llega y completá el perfil físico una vez (el onboarding).
3. Cargá email y contraseña en los secrets `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`.
4. Ese usuario **solo** debe usarse para el E2E: las pruebas escriben (y luego borran) una ingesta de tipo "colación" del día.

## 2. Variables en Vercel

*Vercel → Project → Settings → Environment Variables.*

| Variable | Valor | Por qué |
| --- | --- | --- |
| `CRON_SECRET` | Una cadena aleatoria larga, p. ej. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | **Obligatoria desde la corrección de DEF-002.** Vercel Cron la manda sola como `Authorization: Bearer …` a `/api/send-reminders`. Si falta, el endpoint responde 401 y los recordatorios por mail **no se envían**. |

Las demás (`SUPABASE_*`, `GEMINI_*`, `GMAIL_*`, `INVITATION_CODE_INVESTIGADOR`) ya existían.

## 3. Sentencia SQL pendiente en Supabase (DEF-009)

*Supabase → SQL Editor*:

```sql
drop policy if exists "public read for reminders" on public.profiles;
```

Cierra la lectura de `profiles` sin sesión que detectó el E2E (ver [defectos.md](defectos.md)). Se puede ejecutar más de una vez sin riesgo. Después: `npm run test:e2e` → el test *RLS: sin sesión NO se pueden leer perfiles* tiene que pasar a verde.

## 4. Conectar el despliegue con el pipeline

- **Vercel ↔ GitHub:** si el proyecto de Vercel está conectado al repositorio con la integración oficial, cada despliegue crea un evento `deployment_status` en GitHub y dispara `.github/workflows/deploy-verify.yml` solo.
- **Limitación de GitHub:** los eventos `deployment_status` y el botón *Run workflow* usan el archivo de workflow de la **rama por defecto** (`main`). Hay que mergear `tp-calidad` a `main` (o a la rama por defecto) para que se active. Mientras tanto, se puede probar a mano con `gh workflow run` o desde la pestaña Actions una vez que el archivo esté en `main`.
- **Protección de rama (recomendado):** *Settings → Branches → Add rule* sobre `main`: exigir que el check `Compilación, pruebas, análisis estático y quality gate` pase antes de mergear. Así el gate realmente **bloquea**.

## 5. Correr en local

Copiá `.env.example` a `.env.local` y completalo. El código lee `SUPABASE_URL` y `SUPABASE_ANON_KEY`; las pruebas E2E aceptan además `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (nombres que usaba el `.env.local` anterior). Para el E2E agregá `E2E_USER_EMAIL` y `E2E_USER_PASSWORD`.
