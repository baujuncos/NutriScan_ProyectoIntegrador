import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

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
    projects: [
      {
        // Lógica de negocio pura — sin DOM, sin red.
        resolve: { alias },
        test: {
          name: 'node',
          include: ['testing/**/*.test.ts'],
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
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./testing/setup.ts'],
        },
      },
    ],
  },
});
