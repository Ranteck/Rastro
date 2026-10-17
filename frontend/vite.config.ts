import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

const version = (JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")) as { version: string }).version;

// Deja la versión del build en dist/version.txt: `rastro start` y `/rastro:init` lo comparan para detectar un dashboard viejo tras actualizar.
const versionDelBuild: Plugin = {
  name: "version-del-build",
  apply: "build",
  writeBundle(opciones) {
    writeFileSync(join(opciones.dir ?? "dist", "version.txt"), `${version}\n`);
  },
};

export default defineConfig({
  plugins: [versionDelBuild],
  // Rutas relativas: `rastro serve` sirve dist/ desde la raíz del central.
  base: "./",
  // En dev la UI vive en otro origen que el central: /api se reenvía al central local.
  server: { proxy: { "/api": "http://127.0.0.1:4317" } },
  build: { outDir: "dist" },
  test: { environment: "jsdom" },
});
