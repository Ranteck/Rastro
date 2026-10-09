import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Almacen } from "../src/central/almacen.ts";
import { crearCentral } from "../src/central/servidor.ts";
import { checkEquipo } from "../src/contract/equipo.ts";

const ejemplo = (nombre: string): unknown => JSON.parse(readFileSync(new URL(`../../frontend/ejemplos/${nombre}`, import.meta.url), "utf8"));

async function levantar(estaticos = join(tmpdir(), "rastro-sin-dist")) {
  const servidor = crearCentral({ almacen: new Almacen(mkdtempSync(join(tmpdir(), "rastro-central-"))), estaticos });
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const { port } = servidor.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, port, cerrar: () => new Promise<void>((resolve) => servidor.close(() => resolve())) };
}

/** GET con la ruta tal cual: fetch normaliza "/../" y no sirve para probar recorridos de directorio. */
function getCrudo(port: number, ruta: string): Promise<{ estado: number; cuerpo: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: ruta, method: "GET" }, (res) => {
      let cuerpo = "";
      res.setEncoding("utf8").on("data", (d: string) => {
        cuerpo += d;
      });
      res.on("end", () => resolve({ estado: res.statusCode ?? 0, cuerpo }));
    });
    req.on("error", reject);
    req.end();
  });
}

const publicar = (url: string, cuerpo: unknown) =>
  fetch(`${url}/api/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });

test("publica un snapshot válido, lo devuelve por persona y calcula la fila del equipo", async (t) => {
  const c = await levantar();
  t.after(c.cerrar);
  assert.equal((await publicar(c.url, ejemplo("persona-denis.json"))).status, 201);
  assert.deepEqual(await (await fetch(`${c.url}/api/persona/denis`)).json(), ejemplo("persona-denis.json"));
  const equipo = checkEquipo(await (await fetch(`${c.url}/api/equipo`)).json(), "equipo");
  const filaDelEjemplo = checkEquipo(ejemplo("equipo.json"), "ejemplo").equipo[0];
  assert.deepEqual(equipo.equipo, [filaDelEjemplo]);
});

test("rechaza campos no admitidos y no guarda nada", async (t) => {
  const c = await levantar();
  t.after(c.cerrar);
  const res = await publicar(c.url, { ...(ejemplo("persona-denis.json") as object), extra: true });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /snapshot\.extra/);
  assert.equal((await fetch(`${c.url}/api/persona/denis`)).status, 404);
});

test("JSON roto da 400 y un cuerpo de más de 1 MB da 413", async (t) => {
  const c = await levantar();
  t.after(c.cerrar);
  assert.equal((await fetch(`${c.url}/api/publish`, { method: "POST", body: "{no" })).status, 400);
  assert.equal((await fetch(`${c.url}/api/publish`, { method: "POST", body: "x".repeat(1_100_000) })).status, 413);
});

test("rutas hostiles nunca salen de sus directorios", async (t) => {
  const padre = mkdtempSync(join(tmpdir(), "rastro-padre-"));
  const dist = join(padre, "dist");
  mkdirSync(dist);
  writeFileSync(join(dist, "index.html"), "<h1>ui</h1>");
  writeFileSync(join(padre, "secreto.txt"), "CENTINELA-FUERA-DE-DIST");
  symlinkSync(join(padre, "secreto.txt"), join(dist, "enlace.txt"));
  symlinkSync(padre, join(dist, "dirlink"));
  const c = await levantar(dist);
  t.after(c.cerrar);
  assert.deepEqual(await getCrudo(c.port, "/"), { estado: 200, cuerpo: "<h1>ui</h1>" });
  for (const ruta of ["/../secreto.txt", "/../../secreto.txt", "/..%2fsecreto.txt", "/%2e%2e/secreto.txt", "/..%2f..%2fsecreto.txt", "/..%2f..%2fetc%2fpasswd", "//", "/enlace.txt", "/dirlink/secreto.txt"]) {
    const r = await getCrudo(c.port, ruta);
    assert.ok(!r.cuerpo.includes("CENTINELA"), `${ruta} filtró un archivo de afuera`);
    assert.ok(!r.cuerpo.includes("root:"), `${ruta} filtró un archivo de afuera`);
    assert.ok([400, 404].includes(r.estado) || r.cuerpo === "<h1>ui</h1>", `${ruta} dio ${r.estado}`);
  }
  assert.equal((await getCrudo(c.port, "/..%2fsecreto.txt")).estado, 404);
  assert.equal((await getCrudo(c.port, "/enlace.txt")).estado, 404);
  assert.equal((await getCrudo(c.port, "/dirlink/secreto.txt")).estado, 404);
  assert.equal((await getCrudo(c.port, "//")).estado, 400);
  assert.equal((await getCrudo(c.port, "/api/persona/..%2F..%2Fetc")).estado, 404);
  assert.equal((await getCrudo(c.port, "/api/persona/..%2F..")).estado, 404);
  assert.equal((await getCrudo(c.port, "/%E0%A4%A")).estado, 400);
  assert.equal((await getCrudo(c.port, "/api/persona/%E0%A4%A")).estado, 400);
});

test("sin UI construida, la raíz dice dónde está el pedido", async (t) => {
  const c = await levantar();
  t.after(c.cerrar);
  const res = await fetch(c.url);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /frontend\/README\.md/);
});

test("el ejemplo de equipo de frontend cumple el contrato", () => {
  assert.equal(checkEquipo(ejemplo("equipo.json"), "ejemplo").equipo.length, 3);
});
