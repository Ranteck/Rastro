import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { leerConfig, rutasGlobales } from "../src/config.ts";
import { ErrorUsuario } from "../src/errores.ts";
import { leerEventos } from "../src/eventos.ts";
import { hookCommit, hookSesion } from "../src/hooks.ts";
import { BIN_RASTRO, inicializar } from "../src/init.ts";
import { estaRegistrado, listar, quitar, registrar } from "../src/repos.ts";
import { fileURLToPath } from "node:url";
import { crearRepo } from "./helpers/repo.ts";

const BIN = fileURLToPath(new URL("../bin/rastro.js", import.meta.url));

/** Una carpeta global propia: el ~/.rastro/ real no se toca nunca. */
function homeTemporal(): string {
  const home = mkdtempSync(join(tmpdir(), "rastro-home-"));
  process.env["RASTRO_HOME"] = home;
  return home;
}

function repoEnHome(home: string, nombre: string) {
  const r = crearRepo();
  process.env["RASTRO_HOME"] = home;
  return { ...r, nombre };
}

test("dos repos con init comparten una configuración global con los valores por defecto y el nombre de git", () => {
  const home = homeTemporal();
  const a = repoEnHome(home, "a");
  const b = repoEnHome(home, "b");
  inicializar(a.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  inicializar(b.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  const config = leerConfig();
  assert.deepEqual(config.persona, { id: "test", nombre: "Test", equipo: "QA" });
  assert.equal(config.disponibilidad.horasDia, 8);
  assert.equal(config.umbrales.atrasadas, 1);
  assert.deepEqual(listar().map((r) => r.ruta), [a.dir, b.dir]);
});

test("un segundo init no pisa la configuración global", () => {
  const home = homeTemporal();
  const a = repoEnHome(home, "a");
  inicializar(a.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  const editada = { ...JSON.parse(readFileSync(rutasGlobales().config, "utf8")), zonaHoraria: "Europe/Madrid" };
  writeFileSync(rutasGlobales().config, JSON.stringify(editada));
  const b = repoEnHome(home, "b");
  inicializar(b.dir, { equipo: "Otro", binRastro: BIN_RASTRO });
  inicializar(a.dir, { equipo: "Otro", binRastro: BIN_RASTRO });
  assert.equal(leerConfig().zonaHoraria, "Europe/Madrid");
  assert.equal(leerConfig().persona.equipo, "QA");
});

test("init registra el repo y no crea plan.md ni config.json dentro del repo", () => {
  const home = homeTemporal();
  const r = repoEnHome(home, "r");
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  assert.equal(estaRegistrado(r.dir), true);
  assert.equal(existsSync(join(r.dir, ".rastro")), true);
  for (const archivo of ["plan.md", "config.json", "repos.json"]) assert.equal(existsSync(join(r.dir, ".rastro", archivo)), false, archivo);
  assert.equal(existsSync(join(home, "config.json")), true);
});

test("un repo con el .rastro/config.json anterior y sin registrar se trata como no registrado", () => {
  homeTemporal();
  const r = crearRepo();
  process.env["RASTRO_HOME"] = mkdtempSync(join(tmpdir(), "rastro-home-"));
  mkdirSync(join(r.dir, ".rastro"));
  writeFileSync(join(r.dir, ".rastro", "config.json"), "{}");
  assert.equal(estaRegistrado(r.dir), false);
  r.commit("primero");
  assert.equal(hookCommit(r.dir, new Date()), null);
  assert.equal(existsSync(join(r.dir, ".rastro", "events.jsonl")), false);
});

test("un repo sin registrar no escribe eventos con los hooks; uno registrado sí", () => {
  const home = homeTemporal();
  const sin = repoEnHome(home, "sin");
  const con = repoEnHome(home, "con");
  sin.commit("uno");
  con.commit("uno");
  registrar(con.dir);
  hookCommit(sin.dir, new Date());
  hookSesion(JSON.stringify({ session_id: "s-1", transcript_path: "t.jsonl", cwd: sin.dir }), new Date());
  assert.equal(existsSync(join(sin.dir, ".rastro")), false);
  hookCommit(con.dir, new Date());
  hookSesion(JSON.stringify({ session_id: "s-1", transcript_path: "t.jsonl", cwd: con.dir }), new Date());
  assert.deepEqual(leerEventos(join(con.dir, ".rastro", "events.jsonl")).eventos.map((e) => e.tipo), ["commit", "sesion"]);
});

test("repos.json: el registro hace ida y vuelta y un nombre repetido lleva sufijo", () => {
  const home = homeTemporal();
  const dirs = [0, 1].map(() => {
    const d = join(mkdtempSync(join(tmpdir(), "rastro-repos-")), "app");
    mkdirSync(d, { recursive: true });
    return d;
  });
  assert.equal(dirs.length, 2);
  const [a = "", b = ""] = dirs;
  assert.equal(registrar(a).nombre, "app");
  assert.equal(registrar(b).nombre, "app-2");
  assert.equal(registrar(a).nombre, "app");
  assert.deepEqual(listar(), [{ ruta: a, nombre: "app" }, { ruta: b, nombre: "app-2" }]);
  assert.equal(existsSync(join(home, "repos.json.tmp")), false);
  assert.equal(quitar(a), true);
  assert.equal(quitar(a), false);
  assert.deepEqual(listar().map((r) => r.ruta), [b]);
});

test("un repo registrado que ya no existe se saltea con un warn", (t) => {
  homeTemporal();
  const d = mkdtempSync(join(tmpdir(), "rastro-repos-"));
  const vivo = mkdtempSync(join(tmpdir(), "rastro-repos-"));
  registrar(d);
  registrar(vivo);
  rmSync(d, { recursive: true });
  const escrito: string[] = [];
  t.mock.method(process.stderr, "write", (s: string) => (escrito.push(s), true));
  assert.deepEqual(listar().map((r) => r.ruta), [vivo]);
  assert.match(escrito.join(""), /warn repo-inexistente/);
});

test("un repos.json inválido da un error claro", () => {
  const home = homeTemporal();
  writeFileSync(join(home, "repos.json"), JSON.stringify({ repos: [{ ruta: 1 }] }));
  assert.throws(() => listar(), (e) => e instanceof ErrorUsuario && /repos\.json no es válido/.test(e.message));
  writeFileSync(join(home, "repos.json"), "{roto");
  assert.throws(() => estaRegistrado("/x"), ErrorUsuario);
});

test("hookSesion en un repo con solo el .rastro/config.json anterior no escribe nada", () => {
  const r = crearRepo();
  process.env["RASTRO_HOME"] = mkdtempSync(join(tmpdir(), "rastro-home-"));
  mkdirSync(join(r.dir, ".rastro"));
  writeFileSync(join(r.dir, ".rastro", "config.json"), "{}");
  hookSesion(JSON.stringify({ session_id: "s-1", transcript_path: "t.jsonl", cwd: r.dir }), new Date());
  assert.equal(existsSync(join(r.dir, ".rastro", "events.jsonl")), false);
});

test("un repos.json con rutas relativas, vacías o repetidas da un error claro", () => {
  const home = homeTemporal();
  for (const repos of [[{ ruta: "relativa", nombre: "a" }], [{ ruta: "", nombre: "a" }], [{ ruta: "/x", nombre: "a" }, { ruta: "/x", nombre: "b" }], [{ ruta: "/x", nombre: "a" }, { ruta: "/y", nombre: "a" }]]) {
    writeFileSync(join(home, "repos.json"), JSON.stringify({ repos }));
    assert.throws(() => listar(), (e) => e instanceof ErrorUsuario && /repos\.json no es válido/.test(e.message), JSON.stringify(repos));
  }
});

test("registrar no deja temporales en la carpeta global", () => {
  const home = homeTemporal();
  registrar(mkdtempSync(join(tmpdir(), "rastro-repos-")));
  assert.deepEqual(readdirSync(home), ["repos.json"]);
});

function correr(r: ReturnType<typeof crearRepo>, ...args: string[]) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd: r.dir, encoding: "utf8", env: r.env });
}

test("aviso en un repo sin registrar no imprime nada y sale con 0; plan cambiar pide repos observados; siguiente y daily, globales, piden un repo registrado", () => {
  const r = crearRepo();
  r.commit("primero");
  const aviso = correr(r, "aviso");
  assert.equal(aviso.status, 0);
  assert.equal(aviso.stdout, "");
  const plan = correr(r, "plan", "cambiar", "duracion", "x", "1d");
  assert.equal(plan.status, 1);
  // plan cambiar es global como el dashboard: sin repos observados no hay dónde buscar un commit.
  assert.match(plan.stderr, /No hay repos observados.*rastro init/);
  // daily y siguiente son globales: no miran el repo donde corren, y sin repos observados no hay qué juntar.
  for (const comando of ["daily", "siguiente"]) {
    const res = correr(r, comando);
    assert.equal(res.status, 1, comando);
    assert.match(res.stderr, /No hay repos observados.*rastro init/, comando);
  }
  assert.equal(existsSync(join(r.dir, ".rastro")), false);
});

test("plan cambiar vinculo resuelve el commit en un repo observado desde una carpeta que no es un repo", () => {
  const r = crearRepo();
  const sha = r.commit("primero");
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  const fuera = mkdtempSync(join(tmpdir(), "rastro-fuera-"));
  const res = spawnSync(process.execPath, [BIN, "plan", "cambiar", "vinculo", sha.slice(0, 7), "sin-tarea"], { cwd: fuera, encoding: "utf8", env: r.env });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes(`Commit ${sha.slice(0, 7)}`));
});
