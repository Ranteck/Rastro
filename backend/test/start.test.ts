import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { Almacen } from "../src/central/almacen.ts";
import { crearCentral } from "../src/central/servidor.ts";
import { leerConfig, rutasGlobales } from "../src/config.ts";
import { ErrorUsuario } from "../src/errores.ts";
import { BIN_RASTRO, inicializar } from "../src/init.ts";
import { comandoParaAbrir, start, type Lanzador } from "../src/start.ts";
import { validarSnapshot } from "../src/contract/snapshot.ts";
import { guardarState } from "../src/state.ts";
import { registrar } from "../src/repos.ts";
import { versionDeRastro } from "../src/version.ts";
import { crearRepo } from "./helpers/repo.ts";

const BIN = fileURLToPath(new URL("../bin/rastro.js", import.meta.url));

function escenario(): { dist: string; persona: string } {
  const r = crearRepo();
  r.escribir("a.txt", "x");
  r.commit("inicial");
  inicializar(r.dir, { equipo: "Eq", binRastro: BIN_RASTRO });
  const dist = join(mkdtempSync(join(tmpdir(), "rastro-dist-")), "dist");
  mkdirSync(dist);
  writeFileSync(join(dist, "index.html"), "<html></html>");
  writeFileSync(join(dist, "version.txt"), `${versionDeRastro()}\n`);
  return { dist, persona: leerConfig().persona.id };
}

/** Un lanzador que anota las URL y, como `start` sirve hasta Ctrl+C, corta el servidor después de "abrir". */
function lanzadorQueCorta(abiertas: string[]): Lanzador {
  return (url) => {
    abiertas.push(url);
    setImmediate(() => process.emit("SIGINT"));
    return Promise.resolve();
  };
}

test("start levanta el central y abre la URL de mi-dia de la persona", async () => {
  const { dist, persona } = escenario();
  const abiertas: string[] = [];
  const codigo = await start(["--puerto", "0"], { lanzar: lanzadorQueCorta(abiertas), estaticos: dist });
  assert.equal(codigo, 0);
  assert.equal(abiertas.length, 1);
  assert.match(abiertas[0] ?? "", new RegExp(`^http://127\\.0\\.0\\.1:\\d+/#/persona/${persona}/mi-dia$`));
});

test("--sin-navegador sirve pero no abre nada", async () => {
  const { dist } = escenario();
  const abiertas: string[] = [];
  const lanzar: Lanzador = (url) => {
    abiertas.push(url);
    return Promise.resolve();
  };
  setTimeout(() => process.emit("SIGINT"), 300);
  assert.equal(await start(["--puerto", "0", "--sin-navegador"], { lanzar, estaticos: dist }), 0);
  assert.deepEqual(abiertas, []);
});

test("con el puerto ocupado por un central de la misma carpeta global no levanta otro y abre el navegador", async (t) => {
  const { dist, persona } = escenario();
  const central = crearCentral({ almacen: new Almacen(mkdtempSync(join(tmpdir(), "rastro-datos-"))), estaticos: dist, personal: {} });
  await new Promise<void>((resolver) => central.listen(0, "127.0.0.1", resolver));
  t.after(() => central.close());
  const puerto = (central.address() as AddressInfo).port;
  const abiertas: string[] = [];
  const lanzar: Lanzador = (url) => {
    abiertas.push(url);
    return Promise.resolve();
  };
  assert.equal(await start(["--puerto", String(puerto)], { lanzar, estaticos: dist }), 0);
  assert.deepEqual(abiertas, [`http://127.0.0.1:${puerto}/#/persona/${persona}/mi-dia`]);
});

test("con el puerto ocupado por un central de otra carpeta global da el error de puerto ocupado", async (t) => {
  const a = escenario();
  const central = crearCentral({ almacen: new Almacen(mkdtempSync(join(tmpdir(), "rastro-datos-"))), estaticos: a.dist, personal: {} });
  await new Promise<void>((resolver) => central.listen(0, "127.0.0.1", resolver));
  t.after(() => central.close());
  const puerto = (central.address() as AddressInfo).port;
  // El central de `a` ya capturó su carpeta global: cambiar de carpeta lo vuelve ajeno para este start.
  const b = escenario();
  const lanzar: Lanzador = () => assert.fail("no debería abrir nada");
  await assert.rejects(start(["--puerto", String(puerto)], { lanzar, estaticos: b.dist }), (e: unknown) => e instanceof ErrorUsuario && /ocupado/.test(e.message));
});

test("sin frontend/dist explica cómo construirlo", async () => {
  const { dist } = escenario();
  await assert.rejects(
    start(["--puerto", "0"], { lanzar: () => Promise.resolve(), estaticos: join(dist, "no-existe") }),
    (e: unknown) => e instanceof ErrorUsuario && /npm run build/.test(e.message) && /\/rastro:init/.test(e.message),
  );
});

async function startAvisando(dist: string): Promise<string> {
  const abiertas: string[] = [];
  const escrito: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((texto: string) => (escrito.push(texto), true)) as typeof process.stderr.write;
  try {
    assert.equal(await start(["--puerto", "0"], { lanzar: lanzadorQueCorta(abiertas), estaticos: dist }), 0);
  } finally {
    process.stderr.write = original;
  }
  assert.equal(abiertas.length, 1);
  return escrito.join("");
}

test("un dashboard de otra versión o sin version.txt avisa por stderr cómo reconstruirlo y sirve igual; uno al día no avisa", async () => {
  const { dist } = escenario();
  assert.doesNotMatch(await startAvisando(dist), /dashboard_desactualizado/);

  writeFileSync(join(dist, "version.txt"), "0.0.1\n");
  const otra = await startAvisando(dist);
  assert.match(otra, /warn dashboard_desactualizado construido="0\.0\.1" cli="[^"]+"/);
  assert.match(otra, /npm run build/);

  rmSync(join(dist, "version.txt"));
  assert.match(await startAvisando(dist), /dashboard_desactualizado construido="sin versión"/);
});

test("sin config global pide correr rastro init", async () => {
  const r = crearRepo();
  registrar(r.dir);
  await assert.rejects(start(["--puerto", "0"], { lanzar: () => Promise.resolve(), estaticos: tmpdir() }), (e: unknown) => e instanceof ErrorUsuario && /rastro init/.test(e.message));
});

test("si el navegador no abre, avisa por stderr y sigue sirviendo", async () => {
  const { dist } = escenario();
  const lanzar: Lanzador = () => {
    setImmediate(() => process.emit("SIGINT"));
    return Promise.reject(Object.assign(new Error("spawn xdg-open ENOENT"), { code: "ENOENT" }));
  };
  assert.equal(await start(["--puerto", "0"], { lanzar, estaticos: dist }), 0);
});

test("el comando para abrir depende de la plataforma", () => {
  assert.deepEqual(comandoParaAbrir("linux", "http://x"), { bin: "xdg-open", args: ["http://x"] });
  assert.deepEqual(comandoParaAbrir("darwin", "http://x"), { bin: "open", args: ["http://x"] });
  assert.equal(comandoParaAbrir("win32", "http://x").args.at(-1), "http://x");
});

test("rastro --help lista start", () => {
  const r = spawnSync(process.execPath, [BIN, "--help"], { encoding: "utf8" });
  assert.match(r.stdout, /rastro start/);
});

async function puertoLibre(): Promise<number> {
  const servidor = createServer();
  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  const { port } = servidor.address() as AddressInfo;
  await new Promise<void>((resolver) => servidor.close(() => resolver()));
  return port;
}

test("start corre desde una carpeta que no es un repo y un segundo start reconoce que ya está corriendo", async (t) => {
  const { dist, persona } = escenario();
  const fuera = mkdtempSync(join(tmpdir(), "rastro-fuera-"));
  const original = process.cwd();
  process.chdir(fuera);
  t.after(() => process.chdir(original));
  const puerto = await puertoLibre();
  const salida: string[] = [];
  t.mock.method(process.stdout, "write", (x: string) => (salida.push(String(x)), true));
  const lanzar: Lanzador = () => assert.fail("--sin-navegador no abre nada");
  const primero = start(["--puerto", String(puerto), "--sin-navegador"], { lanzar, estaticos: dist });
  for (let i = 0; i < 50 && !salida.some((l) => l.startsWith("Dashboard:")); i++) await new Promise((r) => setTimeout(r, 50));
  const url = `http://127.0.0.1:${puerto}/#/persona/${persona}/mi-dia`;
  t.after(() => process.emit("SIGINT"));
  assert.ok(salida.includes(`Dashboard: ${url}\n`));
  const sesion = (await (await fetch(`http://127.0.0.1:${puerto}/api/sesion`)).json()) as { personal: boolean; dir: string };
  assert.equal(sesion.personal, true);
  assert.equal(sesion.dir, rutasGlobales().dir);
  salida.length = 0;
  assert.equal(await start(["--puerto", String(puerto), "--sin-navegador"], { lanzar, estaticos: dist }), 0);
  assert.ok(salida.some((l) => l.includes(`ya estaba corriendo en el puerto ${puerto}`)));
  assert.ok(salida.includes(`Dashboard: ${url}\n`));
  process.emit("SIGINT");
  assert.equal(await primero, 0);
});

test("start sin repos registrados da error claro y no abre el puerto", async () => {
  process.env["RASTRO_HOME"] = mkdtempSync(join(tmpdir(), "rastro-vacio-"));
  const puerto = await puertoLibre();
  await assert.rejects(start(["--puerto", String(puerto)], { lanzar: () => Promise.resolve(), estaticos: tmpdir() }), (e: unknown) => e instanceof ErrorUsuario && /No hay repos observados.*rastro init/.test(e.message));
  await assert.rejects(fetch(`http://127.0.0.1:${puerto}/api/sesion`));
});

test("serve --personal y publish sin repos registrados salen con 1 y un error claro", () => {
  const cwd = mkdtempSync(join(tmpdir(), "rastro-fuera-"));
  const env = { ...process.env, RASTRO_HOME: join(cwd, "global") };
  for (const args of [["serve", "--personal", "--puerto", "0"], ["publish", "--yes"], ["start", "--puerto", "0", "--sin-navegador"]]) {
    const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", cwd, env, timeout: 15_000 });
    assert.equal(r.status, 1, args[0]);
    assert.match(r.stderr, /No hay repos observados.*rastro init/, args[0]);
  }
});

test("sin state.json avisa por stderr cuándo corre el próximo daily automático y sirve igual", async () => {
  const { dist } = escenario();
  const abiertas: string[] = [];
  const escrito: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((texto: string) => (escrito.push(texto), true)) as typeof process.stderr.write;
  try {
    assert.equal(await start(["--puerto", "0"], { lanzar: lanzadorQueCorta(abiertas), estaticos: dist, horaDaily: () => Promise.resolve("18:30") }), 0);
  } finally {
    process.stderr.write = original;
  }
  assert.equal(abiertas.length, 1);
  assert.match(escrito.join(""), /Todavía no corrió el daily: el dashboard va a estar casi vacío\. Corré `rastro daily` \(o decile a Claude «cerrá el día»\) o esperá al automático de las 18:30\./);
});

test("sin state.json y sin daily automático el aviso solo ofrece el comando", async () => {
  const { dist } = escenario();
  assert.match(await startAvisando(dist), /Corré `rastro daily` \(o decile a Claude «cerrá el día»\)\.\n/);
});

test("con state.json no avisa que falta el daily", async () => {
  const { dist } = escenario();
  guardarState(validarSnapshot(JSON.parse(readFileSync(new URL("../../frontend/ejemplos/persona-denis.json", import.meta.url), "utf8"))));
  assert.doesNotMatch(await startAvisando(dist), /Todavía no corrió el daily/);
});

test("una hora del automático ilegible no aborta start: avisa sin hora y sirve", async () => {
  const { dist } = escenario();
  const abiertas: string[] = [];
  const escrito: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((texto: string) => (escrito.push(texto), true)) as typeof process.stderr.write;
  try {
    assert.equal(await start(["--puerto", "0"], { lanzar: lanzadorQueCorta(abiertas), estaticos: dist, horaDaily: () => Promise.reject(new Error("EACCES")) }), 0);
  } finally {
    process.stderr.write = original;
  }
  assert.equal(abiertas.length, 1);
  assert.match(escrito.join(""), /Corré `rastro daily` \(o decile a Claude «cerrá el día»\)\.\n/);
});
