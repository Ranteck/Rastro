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

test("notion.pagina acepta un id de 32 hex con o sin guiones y no está en la config por defecto", () => {
  assert.equal(base.notion.pagina, undefined);
  for (const pagina of ["0123456789abcdef0123456789ABCDEF", "01234567-89ab-cdef-0123-456789abcdef"]) {
    assert.equal(leerCon({ notion: { modo: "claude", pagina } }).notion.pagina, pagina);
  }
});

test("un notion.pagina que no es un id de página falla nombrando la clave", () => {
  for (const pagina of ["AI Day", "", "0123456789abcdef", "g123456789abcdef0123456789abcdef", "https://www.notion.so/0123456789abcdef0123456789abcdef"]) {
    assert.throws(() => leerCon({ notion: { modo: "claude", pagina } }), (e) => e instanceof ErrorUsuario && /notion\.pagina/.test(e.message), pagina);
  }
});
