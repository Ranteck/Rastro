import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPorDefecto, escribirConfig, leerConfig, type Config } from "../src/config.ts";
import { ErrorUsuario } from "../src/errores.ts";

const base = configPorDefecto({ id: "test", nombre: "Test", equipo: "QA" });

function leerCon(cambios: Partial<Config>): Config {
  const repo = mkdtempSync(join(tmpdir(), "rastro-config-"));
  escribirConfig(repo, { ...base, ...cambios });
  return leerConfig(repo);
}

test("la config por defecto es válida", () => {
  assert.deepEqual(leerCon({}), base);
});

test("una zona horaria inexistente falla nombrando la clave", () => {
  assert.throws(() => leerCon({ zonaHoraria: "Mars/Olympus" }), (e) => e instanceof ErrorUsuario && /zonaHoraria/.test(e.message));
});

test("una URL del central inválida o que no es http(s) falla nombrando la clave", () => {
  for (const url of ["no es una url", "ftp://127.0.0.1:4317", ""]) {
    assert.throws(() => leerCon({ central: { url } }), (e) => e instanceof ErrorUsuario && /central\.url/.test(e.message), url);
  }
  assert.equal(leerCon({ central: { url: "https://central.example.com" } }).central.url, "https://central.example.com");
});
