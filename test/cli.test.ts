import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
