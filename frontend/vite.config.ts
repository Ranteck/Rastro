import { defineConfig } from "vitest/config";

export default defineConfig({
  // Rutas relativas: `rastro serve` sirve dist/ desde la raíz del central.
  base: "./",
  // En dev la UI vive en otro origen que el central: /api se reenvía al central local.
  server: { proxy: { "/api": "http://127.0.0.1:4317" } },
  build: { outDir: "dist" },
  test: { environment: "jsdom" },
});
