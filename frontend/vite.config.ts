import { defineConfig } from "vitest/config";

export default defineConfig({
  // Rutas relativas: `rastro serve` sirve dist/ desde la raíz del central.
  base: "./",
  build: { outDir: "dist" },
  test: { environment: "jsdom" },
});
