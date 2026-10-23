import { defineConfig } from 'vitest/config';
import path from 'path';

// Pruebas E2E contra las integraciones REALES (Supabase, Gemini, Open Food Facts) y contra la
// app desplegada. NO forman parte de `npm test` (que debe ser rápido y sin red): se corren con
// `npm run test:e2e` y el pipeline las ejecuta en cada despliegue (.github/workflows/deploy-verify.yml).
//
// Para correrlas en local alcanza con tener las variables en .env.local (no pisa las ya definidas).
try {
  process.loadEnvFile('.env.local');
} catch {
  // sin .env.local: se usan las variables del entorno (CI)
}

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    name: 'e2e',
    include: ['testing/e2e/**/*.e2e.test.ts'],
    environment: 'node',
    globals: true,
    // Llamadas de red reales: Gemini puede tardar y Vercel tiene cold starts.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Un solo worker y en orden: las pruebas comparten un usuario de prueba y respetan el rate limit.
    fileParallelism: false,
    retry: 1,
    reporters: ['default', 'json', 'junit'],
    outputFile: { json: 'reports/e2e/results.json', junit: 'reports/e2e/junit.xml' },
  },
});
