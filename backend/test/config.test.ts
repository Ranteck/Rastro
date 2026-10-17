import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { configPorDefecto, escribirConfig, leerConfig, rutasGlobales, type Config } from "../src/config.ts";
import { ErrorUsuario } from "../src/errores.ts";

const base = configPorDefecto({ id: "test", nombre: "Test", equipo: "QA" });

function homeTemporal(): string {
  const home = mkdtempSync(join(tmpdir(), "rastro-config-"));
  process.env["RASTRO_HOME"] = home;
  return home;
}

function leerCon(cambios: Partial<Config>): Config {
  homeTemporal();
  escribirConfig({ ...base, ...cambios });
  return leerConfig();
}

test("la carpeta global es absoluta aunque RASTRO_HOME sea relativa", () => {
  const original = process.env["RASTRO_HOME"];
  process.env["RASTRO_HOME"] = "datos/rastro";
  try {
    assert.ok(isAbsolute(rutasGlobales().dir));
    assert.ok(isAbsolute(rutasGlobales().cronLog));
  } finally {
    if (original === undefined) delete process.env["RASTRO_HOME"];
    else process.env["RASTRO_HOME"] = original;
  }
});

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

test("un config anterior, sin disponibilidad ni umbrales.atrasadas, carga con los valores por defecto", () => {
  const home = homeTemporal();
  const { disponibilidad: _d, ...sinDisponibilidad } = base;
  const { atrasadas: _a, ...umbralesViejos } = base.umbrales;
  writeFileSync(join(home, "config.json"), JSON.stringify({ ...sinDisponibilidad, umbrales: umbralesViejos }));
  const config = leerConfig();
  assert.equal(config.disponibilidad.horasDia, 8);
  assert.deepEqual(config.disponibilidad.dias, ["lun", "mar", "mie", "jue", "vie"]);
  assert.deepEqual(config.disponibilidad.fijos.map((f) => [f.nombre, f.horas]), [["Daily", 0.25], ["Checkpoint", 1.5]]);
  assert.deepEqual(config.disponibilidad.excepciones, []);
  assert.equal(config.umbrales.atrasadas, 1);
});

test("una disponibilidad incompleta completa cada subcampo faltante con su valor por defecto", () => {
  const home = homeTemporal();
  writeFileSync(join(home, "config.json"), JSON.stringify({ ...base, disponibilidad: { horasDia: 6, excepciones: [{ fecha: "2026-10-08", horas: 8 }] } }));
  const { disponibilidad } = leerConfig();
  assert.equal(disponibilidad.horasDia, 6);
  assert.deepEqual(disponibilidad.excepciones, [{ fecha: "2026-10-08", horas: 8 }]);
  assert.deepEqual(disponibilidad.dias, base.disponibilidad.dias);
  assert.deepEqual(disponibilidad.fijos, base.disponibilidad.fijos);
});

test("una disponibilidad con valores inválidos falla nombrando la clave", () => {
  const malos: [string, Partial<Config>][] = [
    ["disponibilidad.horasDia", { disponibilidad: { ...base.disponibilidad, horasDia: 0 } }],
    ["disponibilidad.horasDia", { disponibilidad: { ...base.disponibilidad, horasDia: 25 } }],
    ["disponibilidad.dias[0]", { disponibilidad: { ...base.disponibilidad, dias: ["lunes" as never] } }],
    ["disponibilidad.fijos[0].dias[0]", { disponibilidad: { ...base.disponibilidad, fijos: [{ nombre: "X", dias: ["xx" as never], horas: 1 }] } }],
    ["disponibilidad.excepciones[0].fecha", { disponibilidad: { ...base.disponibilidad, excepciones: [{ fecha: "jueves", horas: 8 }] } }],
    ["umbrales.atrasadas", { umbrales: { ...base.umbrales, atrasadas: 0 } }],
    ["umbrales.atrasadas", { umbrales: { ...base.umbrales, atrasadas: 1.5 } }],
  ];
  for (const [clave, cambios] of malos) {
    assert.throws(() => leerCon(cambios), (e) => e instanceof ErrorUsuario && e.message.includes(clave), clave);
  }
});
