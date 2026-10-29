import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Los tests de componentes arman formularios largos con user-event (tecla por
// tecla). Con la instrumentación de cobertura superaban los 5 s por defecto y
// fallaban de forma intermitente (DEF-001, docs/defectos.md).
const TEST_TIMEOUT_MS = 30_000;

const alias = {
  '@': path.resolve(__dirname, './src'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    // Vercel corre `npm run build` con NODE_ENV=production; sin esto, React
    // carga su bundle de producción (sin `React.act`) y los tests de RTL
    // fallan con "React.act is not a function".
    env: { NODE_ENV: 'test' },
    coverage: {
      provider: 'v8',
      // Se mide TODO src/, no solo los archivos que algún test importa: con el
      // default de Vitest un archivo sin tests no aparece y el porcentaje se
      // infla (DEF-006 — 86 % "visible" vs 70 % real al empezar el TP).
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        // Solo tipos: no tienen sentencias ejecutables.
        'src/types/**',
        // Service worker de serwist: corre en el navegador, no en Node/jsdom.
        'src/app/sw.ts',
        // Declarativos sin lógica: manifiesto PWA y pantallas de carga estáticas.
        'src/app/manifest.ts',
        'src/**/loading.tsx',
      ],
      reporter: ['text-summary', 'json-summary', 'lcov', 'html'],
      reportsDirectory: 'coverage',
    },
    projects: [
      {
        // Lógica de negocio pura — sin DOM, sin red. Incluye las pruebas de
        // integración (testing/integration), que usan dobles de prueba.
        resolve: { alias },
        test: {
          name: 'node',
          include: ['testing/**/*.test.ts'],
          // E2E (red real) se corre aparte: `npm run test:e2e` (vitest.e2e.config.ts).
          exclude: [...configDefaults.exclude, 'testing/e2e/**'],
          testTimeout: TEST_TIMEOUT_MS,
          globals: true,
          environment: 'node',
        },
      },
      {
        // Componentes React (React Testing Library).
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'jsdom',
          include: ['testing/**/*.test.tsx'],
          testTimeout: TEST_TIMEOUT_MS,
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./testing/setup.ts'],
        },
      },
    ],
  },
});
