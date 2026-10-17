import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/rastro.js", import.meta.url));

test("sin argumentos muestra la ayuda y sale con 0", () => {
  const r = spawnSync(process.execPath, [BIN], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /rastro daily/);
});

test("un comando desconocido sale con 2 y lo nombra", () => {
  const r = spawnSync(process.execPath, [BIN, "nada"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Comando desconocido: nada/);
});

test("un nombre heredado de Object.prototype no es un comando", () => {
  const r = spawnSync(process.execPath, [BIN, "constructor"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Comando desconocido: constructor/);
});

test("una opción desconocida sale con 2, explica el error y muestra el uso", () => {
  const r = spawnSync(process.execPath, [BIN, "daily", "--foo"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--foo/);
  assert.match(r.stderr, /Uso:/);
  assert.doesNotMatch(r.stderr, /error inesperado/);
});

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));

function versionDe(ruta: string): unknown {
  return (JSON.parse(readFileSync(`${RAIZ}${ruta}`, "utf8")) as { version?: unknown }).version;
}

test("--version imprime la versión de backend/package.json", () => {
  const r = spawnSync(process.execPath, [BIN, "--version"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), versionDe("backend/package.json"));
});

test("la primera línea de --help lleva la versión", () => {
  const r = spawnSync(process.execPath, [BIN, "--help"], { encoding: "utf8" });
  assert.ok(r.stdout.startsWith(`rastro ${String(versionDe("backend/package.json"))}:`));
});

test("backend, frontend y plugin tienen la misma versión", () => {
  const backend = versionDe("backend/package.json");
  assert.equal(typeof backend, "string");
  assert.equal(versionDe("frontend/package.json"), backend);
  assert.equal(versionDe("plugin/.claude-plugin/plugin.json"), backend);
});
