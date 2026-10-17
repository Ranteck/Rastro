import { readFileSync } from "node:fs";

// El número vive solo en package.json: acá se lee en vez de copiarlo.
export function versionDeRastro(): string {
  const paquete: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const v = typeof paquete === "object" && paquete !== null ? (paquete as { version?: unknown }).version : undefined;
  if (typeof v !== "string") throw new Error("backend/package.json no tiene version");
  return v;
}
