import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { configPorDefecto, escribirConfig, rutasGlobales } from "../src/config.ts";
import { ErrorUsuario } from "../src/errores.ts";
import { cmdDaily, generarSnapshot, recalcularConPlan, reposObservados } from "../src/daily.ts";
import { ddmm, fechaLocal, lunesDe } from "../src/fechas.ts";
import { quitar, registrar } from "../src/repos.ts";
import { FakeLlm } from "./helpers/fakeLlm.ts";
import { crearRepo, type RepoTemporal } from "./helpers/repo.ts";

const BIN = fileURLToPath(new URL("../bin/rastro.js", import.meta.url));
const ZONA = "America/Argentina/Buenos_Aires";
const config = { ...configPorDefecto({ id: "test", nombre: "Test", equipo: "QA" }), llm: { proveedor: "ninguno" as const, modelo: "haiku" } };
const resumenOk = { hice: ["Se hizo algo."], avance: [], sigue: ["Revisar algo."], bloqueos: [] };

/** Repos con commit inicial que comparten una carpeta global propia y un plan con tres tareas: una de cada repo y una sin repo. */
function escenario(): { a: RepoTemporal; b: RepoTemporal; c: RepoTemporal; nombreA: string; nombreB: string; home: string } {
  const repos = [crearRepo(), crearRepo(), crearRepo()] as const;
  const [a, b, c] = repos;
  for (const r of repos) {
    r.escribir(".gitignore", ".rastro/\n");
    // Con fecha fija y vieja: el mismo commit raíz en los tres repos (mismo sha) y fuera de la semana.
    r.commit("inicio", "2026-01-01T00:00:00Z");
  }
  for (const r of [a, b]) r.git("remote", "add", "origin", `https://github.com/x/${basename(r.dir)}.git`);
  const home = mkdtempSync(join(tmpdir(), "rastro-home-"));
  process.env["RASTRO_HOME"] = home;
  escribirConfig(config);
  const nombreA = registrar(a.dir).nombre;
  const nombreB = registrar(b.dir).nombre;
  const lunes = lunesDe(fechaLocal(new Date(), ZONA));
  writeFileSync(
    rutasGlobales().plan,
    [
      `## Plan semana ${ddmm(lunes)}`,
      "- **Entregable del viernes:** Demo.",
      `- [ ] **Alfa:** Lo de A. · repo:${nombreA}`,
      `- [ ] **Beta:** Lo de B. · repo:${nombreB}`,
      "- [ ] **Gama:** Sin repo.",
      "",
    ].join("\n"),
  );
  return { a, b, c, nombreA, nombreB, home };
}

test("un daily con commits en dos repos arma una bitácora con repo, rama y tarea de cada uno", async () => {
  const { a, b, c, nombreA, nombreB } = escenario();
  a.commit("[Alfa] uno");
  b.git("checkout", "-q", "-b", "feat/beta");
  b.commit("[Beta] dos");
  c.commit("[Alfa] de un repo sin registrar");

  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: new Date() });

  const entrada = (texto: string) => snapshot.bitacora.find((e) => e.texto === texto);
  assert.deepEqual([entrada("[Alfa] uno")?.repo, entrada("[Alfa] uno")?.rama, entrada("[Alfa] uno")?.tarea], [nombreA, "main", "alfa"]);
  assert.deepEqual([entrada("[Beta] dos")?.repo, entrada("[Beta] dos")?.rama, entrada("[Beta] dos")?.tarea], [nombreB, "feat/beta", "beta"]);
  assert.equal(entrada("[Alfa] de un repo sin registrar"), undefined);
  assert.deepEqual(snapshot.repo, { nombre: `${nombreA}, ${nombreB}` });
});

test("un repo sin registrar no aparece en nada, aunque el daily corra desde ahí", () => {
  const { a, c } = escenario();
  a.commit("[Alfa] uno");
  c.commit("[Gama] de un repo sin registrar");

  const corrida = spawnSync(process.execPath, [BIN, "daily"], { cwd: c.dir, encoding: "utf8", env: { ...c.env, RASTRO_HOME: process.env["RASTRO_HOME"] ?? "" } });

  assert.equal(corrida.status, 0, corrida.stderr);
  const state = JSON.parse(readFileSync(rutasGlobales().state, "utf8"));
  // El repo sin registrar no suma su commit.
  assert.deepEqual(state.bitacora.map((e: { texto: string }) => e.texto).sort(), ["[Alfa] uno"]);
});

test("un repo registrado que se borró del disco se avisa y el daily sigue con los otros", async (t) => {
  const { a, b, nombreB } = escenario();
  b.commit("[Beta] dos");
  rmSync(a.dir, { recursive: true });
  const escrito: string[] = [];
  t.mock.method(process.stderr, "write", (s: string) => (escrito.push(s), true));

  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: new Date() });

  assert.deepEqual(snapshot.bitacora.map((e) => [e.repo, e.texto]), [[nombreB, "[Beta] dos"]]);
  assert.match(escrito.join(""), /warn repo-inexistente/);
});

test("una tarea de otro repo no se vincula con un commit que la nombra, ni por nombre ni por inferencia; una tarea sin repo sí", async () => {
  const { a } = escenario();
  const delLlm = a.commit("arreglo suelto");
  a.commit("[Beta] nombra la tarea de B");
  a.commit("[Gama] nombra la tarea sin repo");
  const llm = new FakeLlm({
    vinculos: { vinculos: [{ sha: delLlm, tarea: "beta", razon: "Parece de B." }] },
    bitacora: { entradas: [], resumen: resumenOk },
  });

  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm, ahora: new Date() });

  const entrada = (texto: string) => snapshot.bitacora.find((e) => e.texto === texto);
  assert.deepEqual([entrada("[Beta] nombra la tarea de B")?.tarea, entrada("[Beta] nombra la tarea de B")?.vinculo], [null, "sin-tarea"]);
  assert.deepEqual([entrada("arreglo suelto")?.tarea, entrada("arreglo suelto")?.vinculo], [null, "sin-tarea"]);
  assert.equal(entrada("[Gama] nombra la tarea sin repo")?.tarea, "gama");
  assert.equal(llm.usos.filter((u) => u === "vinculos").length, 1);
});

test("con más de un repo, cada pendiente nombra el suyo", async () => {
  const { a, b, nombreB } = escenario();
  a.commit("[Alfa] uno");
  b.escribir("src/x.ts", "// TODO: resolver esto\n");
  b.commit("[Beta] con pendiente");

  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: new Date() });

  const todo = snapshot.pendientes.find((p) => p.tipo === "todo-nuevo");
  assert.match(todo?.texto ?? "", new RegExp(`^\\[${nombreB}\\] `));
});

test("sin repos observados el daily falla con un error claro antes de llamar al LLM", async () => {
  process.env["RASTRO_HOME"] = mkdtempSync(join(tmpdir(), "rastro-home-"));
  await assert.rejects(cmdDaily([]), (e) => e instanceof ErrorUsuario && /No hay repos observados.*rastro init/.test(e.message));
});

test("recalcular rehace la bitácora de todos los repos registrados", async () => {
  const { a, b, nombreA, nombreB } = escenario();
  a.commit("[Alfa] uno");
  b.commit("[Beta] dos");
  const hoy = fechaLocal(new Date(), ZONA);
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: new Date() });

  const recalculado = recalcularConPlan(snapshot, { config, hoy });

  assert.deepEqual(recalculado.bitacora.filter((e) => e.tarea !== null).map((e) => [e.repo, e.tarea]).sort(), [[nombreA, "alfa"], [nombreB, "beta"]].sort());
  assert.deepEqual(recalculado.gantt.barras.find((x) => x.tarea === "beta")?.real, snapshot.gantt.barras.find((x) => x.tarea === "beta")?.real);
});

test("la evidencia de cada commit lleva la URL de su propio repo; el repo del snapshot lleva url solo con uno", async () => {
  const { a, b, nombreA, nombreB } = escenario();
  const shaA = a.commit("[Alfa] uno");
  const shaB = b.commit("[Beta] dos");

  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: new Date() });

  const urlDe = (texto: string) => snapshot.bitacora.find((e) => e.texto === texto)?.evidencia[0]?.url;
  assert.equal(urlDe("[Alfa] uno"), `https://github.com/x/${nombreA}/commit/${shaA}`);
  assert.equal(urlDe("[Beta] dos"), `https://github.com/x/${nombreB}/commit/${shaB}`);
  assert.deepEqual(snapshot.repo, { nombre: `${nombreA}, ${nombreB}` });

  quitar(b.dir);
  const solo = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: new Date() });
  assert.deepEqual(solo.snapshot.repo, { nombre: nombreA, url: `https://github.com/x/${nombreA}` });
});

test("dos ramas main de repos distintos son dos barras del Gantt, cada una con su repo", async () => {
  const { a, b, nombreA, nombreB } = escenario();
  a.commit("suelto en a");
  b.commit("suelto en b");

  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: new Date() });

  assert.deepEqual(snapshot.gantt.barras.filter((x) => x.tarea === "main").map((x) => x.repo).sort(), [nombreA, nombreB].sort());
});

test("recalcular empareja cada commit con su tarea por repo, aunque dos repos tengan el mismo sha", async () => {
  const { a, b, nombreA, nombreB } = escenario();
  const fecha = new Date(Date.now() - 60_000).toISOString().replace(/\.\d+Z$/, "Z");
  const enA = a.commit("[Alfa] igual", fecha);
  const enB = b.commit("[Alfa] igual", fecha);
  assert.equal(enA, enB);
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: new Date() });

  const recalculado = recalcularConPlan(snapshot, { config, hoy: fechaLocal(new Date(), ZONA) });

  assert.deepEqual(
    recalculado.bitacora.map((e) => [e.repo, e.tarea]).sort(),
    [[nombreA, "alfa"], [nombreB, null]].sort(),
  );
});

test("una carpeta registrada que ya no es un repo git se saltea con el aviso de repo inexistente", async (t) => {
  const { a, nombreA } = escenario();
  a.commit("[Alfa] uno");
  const sinGit = mkdtempSync(join(tmpdir(), "rastro-singit-"));
  registrar(sinGit);
  const escrito: string[] = [];
  t.mock.method(process.stderr, "write", (x: string) => (escrito.push(x), true));

  const repos = reposObservados();
  const { snapshot } = await generarSnapshot({ repos, config, llm: null, ahora: new Date() });

  assert.ok(repos.every((r) => r.ruta !== sinGit));
  assert.match(escrito.join(""), /warn repo-inexistente/);
  assert.ok(snapshot.bitacora.every((e) => e.repo === nombreA));
});
