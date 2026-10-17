import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { textoAviso } from "../src/aviso.ts";
import { configPorDefecto, escribirConfig, rutasGlobales, rutasRepo } from "../src/config.ts";
import { agregarEvento } from "../src/eventos.ts";
import { ddmm, fechaLocal, lunesDe } from "../src/fechas.ts";
import { registrar } from "../src/repos.ts";
import { crearRepo, type RepoTemporal } from "./helpers/repo.ts";

const BIN = fileURLToPath(new URL("../bin/rastro.js", import.meta.url));
const ZONA = "America/Argentina/Buenos_Aires";
const config = { ...configPorDefecto({ id: "test", nombre: "Test", equipo: "QA" }), llm: { proveedor: "ninguno" as const, modelo: "haiku" } };

/** Dos repos observados con su tarea cada uno, una tarea sin repo y un tercer repo sin registrar, todos con la misma carpeta global. */
function escenario(): { a: RepoTemporal; b: RepoTemporal; c: RepoTemporal; nombreA: string; nombreB: string } {
  const repos = [crearRepo(), crearRepo(), crearRepo()] as const;
  const [a, b, c] = repos;
  for (const r of repos) {
    r.escribir(".gitignore", ".rastro/\n");
    r.commit("inicio");
  }
  process.env["RASTRO_HOME"] = mkdtempSync(join(tmpdir(), "rastro-home-"));
  escribirConfig(config);
  const nombreA = registrar(a.dir).nombre;
  const nombreB = registrar(b.dir).nombre;
  const lunes = lunesDe(fechaLocal(new Date(), ZONA));
  writeFileSync(
    rutasGlobales().plan,
    [
      `## Plan semana ${ddmm(lunes)}`,
      "- **Entregable del viernes:** Demo.",
      `- [ ] **Alfa:** Lo de A. · 2h · repo:${nombreA}`,
      `- [ ] **Beta:** Lo de B. · 3h · repo:${nombreB}`,
      "- [ ] **Gamma:** Sin repo. · 1h",
      "",
    ].join("\n"),
  );
  return { a, b, c, nombreA, nombreB };
}

const correr = (cwd: string, ...args: string[]) =>
  spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", RASTRO_HOME: process.env["RASTRO_HOME"] ?? "" } });

test("siguiente da el mismo texto desde cualquier repo registrado y ve las tareas de los dos", () => {
  const { a, b, nombreA } = escenario();
  b.commit("[Beta] avance");

  const desdeA = correr(a.dir, "siguiente");
  const desdeB = correr(b.dir, "siguiente");

  assert.equal(desdeA.status, 0, desdeA.stderr);
  assert.equal(desdeA.stdout, desdeB.stdout);
  assert.match(desdeA.stdout, /^Ahora: Beta\.$/m);
  assert.match(desdeA.stdout, new RegExp(`^Sigue: Alfa \\(2h\\) · ${nombreA}\\.$`, "m"));
});

test("siguiente corre desde una carpeta que no es un repo, con repos registrados", () => {
  const { b } = escenario();
  b.commit("[Beta] avance");

  const corrida = correr(mkdtempSync(join(tmpdir(), "rastro-fuera-")), "siguiente");

  assert.equal(corrida.status, 0, corrida.stderr);
  assert.match(corrida.stdout, /^Ahora: Beta\.$/m);
});

test("siguiente sin repos registrados falla con el mismo error claro que el daily", () => {
  process.env["RASTRO_HOME"] = mkdtempSync(join(tmpdir(), "rastro-home-"));
  const corrida = correr(mkdtempSync(join(tmpdir(), "rastro-fuera-")), "siguiente");
  assert.notEqual(corrida.status, 0);
  assert.match(corrida.stderr, /No hay repos observados/);
});

test("siguiente no lee el git de un repo sin registrar", () => {
  const { c } = escenario();
  c.commit("[Alfa] en un repo sin registrar");
  c.commit("[Gamma] sin repo, en un repo sin registrar");

  const corrida = correr(c.dir, "siguiente");

  assert.equal(corrida.status, 0, corrida.stderr);
  assert.match(corrida.stdout, /^Ahora: sin tarea en curso\.$/m);
});

test("una sesión de un repo que nombra una tarea de otro repo no la pone en curso", () => {
  const { b } = escenario();
  agregarEvento(rutasRepo(b.dir).eventos, { tipo: "sesion", id: "sesion-de-b", transcript: join(b.dir, "no-existe.jsonl"), rama: "feat/alfa", en: new Date().toISOString() });

  const corrida = correr(b.dir, "siguiente");

  assert.equal(corrida.status, 0, corrida.stderr);
  assert.match(corrida.stdout, /^Ahora: sin tarea en curso\.$/m);
});

test("el aviso de fuera del plan da lo mismo desde cualquier repo y vincula cada commit con las tareas de su repo", () => {
  const { a, b } = escenario();
  const hace = (segundos: number): string => new Date(Date.now() - segundos * 1000).toISOString();
  a.commit("[Alfa] en su repo", hace(120));
  b.commit("[Alfa] pero en el repo de Beta", hace(60));

  // Tres de los cuatro commits de hoy (los dos "inicio" y el de Beta) no nombran una tarea de su repo.
  const esperado = "rastro: 3 de 4 commits de hoy están fuera del plan (75%).\n";
  assert.equal(textoAviso(b.dir, new Date()), esperado);
  assert.equal(textoAviso(a.dir, new Date()), esperado);
});

test("un repo observado sin commits todavía no rompe el aviso de los demás", () => {
  const { a } = escenario();
  const home = process.env["RASTRO_HOME"];
  const vacio = crearRepo();
  process.env["RASTRO_HOME"] = home;
  registrar(vacio.dir);
  a.commit("trabajo suelto");

  assert.match(textoAviso(a.dir, new Date()), /de hoy están fuera del plan/);
});

test("siguiente --si-registrado no traga un repos.json ilegible", () => {
  const { a } = escenario();
  writeFileSync(rutasGlobales().repos, "{no es json");

  const corrida = correr(a.dir, "siguiente", "--si-registrado");

  assert.notEqual(corrida.status, 0);
  assert.match(corrida.stderr, /no es válido/);
});

test("siguiente --si-registrado calla fuera de un repo observado y da el plan dentro de uno", () => {
  const { a, c } = escenario();

  const sinRegistrar = correr(c.dir, "siguiente", "--si-registrado");
  const registrado = correr(a.dir, "siguiente", "--si-registrado");
  const fueraDeUnRepo = correr(mkdtempSync(join(tmpdir(), "rastro-fuera-")), "siguiente", "--si-registrado");

  assert.deepEqual([sinRegistrar.status, sinRegistrar.stdout], [0, ""]);
  assert.deepEqual([fueraDeUnRepo.status, fueraDeUnRepo.stdout], [0, ""]);
  assert.equal(registrado.status, 0, registrado.stderr);
  assert.match(registrado.stdout, /^Plan de la semana del /);
});
