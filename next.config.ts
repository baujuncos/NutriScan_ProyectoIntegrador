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
};

export default withSerwist(nextConfig);
