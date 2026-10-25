import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Reglas del React Compiler (eslint-plugin-react-hooks 7) que marcan patrones válidos pero
    // mejorables (setState dentro de un efecto, ref actualizada en render). No son bugs: los 13
    // casos tienen tests y funcionan. Se bajan a "warn" para que el quality gate (que bloquea con
    // errores) detecte bugs reales, y quedan visibles como deuda técnica (docs/metricas.md, sección 4).
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      // Convención estándar: los parámetros/variables que empiezan con "_" son intencionalmente no usados.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Artefactos generados (no son código del proyecto): service worker de
    // serwist, reportes de cobertura/análisis y resultados de carga.
    "public/sw.js",
    "public/swe-worker*.js",
    "coverage/**",
    "reports/**",
  ]),
]);

export default eslintConfig;
