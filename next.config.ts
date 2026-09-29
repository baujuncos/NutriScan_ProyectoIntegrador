import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  // `build` usa `next build --webpack` porque @serwist/next aporta config de
  // webpack para bundlear el service worker. En dev serwist está deshabilitado,
  // así que dejamos Turbopack (default de Next 16) explícito y sin config.
  turbopack: {},
  // Inlinea solo URL y anon key (públicas) para el cliente de navegador; nunca el service role.
  env: {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  },
};

export default withSerwist(nextConfig);
