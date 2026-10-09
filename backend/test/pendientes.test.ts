import { test } from "node:test";
import assert from "node:assert/strict";
import type { Plan } from "../src/contract/snapshot.ts";
import { detectarPendientes, ramaDeMerge, type CommitVinculado, type EntradaPendientes } from "../src/detectores/pendientes.ts";
import type { Commit } from "../src/git.ts";

const plan: Plan = {
  semana: "2026-10-05",
  entregable: "Demo.",
  tareas: [
    { slug: "pendientes", nombre: "Pendientes", objetivo: "", estado: "pendiente" },
    { slug: "bitacora", nombre: "Bitácora", objetivo: "", estado: "hecha" },
    { slug: "central", nombre: "Central", objetivo: "", estado: "pendiente" },
  ],
};

const commit = (p: Partial<CommitVinculado> & { sha: string }): CommitVinculado => ({
  fecha: new Date("2026-10-09T15:00:00-03:00"),
  padres: ["p1"],
  asunto: "",
  cuerpo: "",
  archivos: [],
  rama: "main",
  vinculo: { tarea: null, tipo: "sin-tarea" },
  ...p,
});

const merge = (sha: string, asunto: string): Commit => ({
  sha, fecha: new Date("2026-10-09T16:00:00-03:00"), padres: ["a", "b"], asunto, cuerpo: "", archivos: [], rama: "main",
});

const entrada = (o: Partial<EntradaPendientes> = {}): EntradaPendientes => ({
  plan,
  commitsSemana: [],
  commitsPeriodo: [],
  merges: [],
  ramas: [],
  ramaPrincipal: "main",
  lineasAgregadas: () => [],
  evidenciaCommit: (sha) => ({ tipo: "commit", ref: sha.slice(0, 7) }),
  ahora: new Date("2026-10-09T18:00:00-03:00"),
  ramaQuietaDias: 3,
  ...o,
});

const deTipo = (e: EntradaPendientes, tipo: string) => detectarPendientes(e).filter((p) => p.tipo === tipo);

test("lee la rama de un merge local o de un PR de GitHub", () => {
  assert.equal(ramaDeMerge("Merge branch 'feat/pendientes'"), "feat/pendientes");
  assert.equal(ramaDeMerge("Merge pull request #12 from flock/feat/pendientes"), "feat/pendientes");
  assert.equal(ramaDeMerge("fix parser"), null);
});

test("resuelto sin cerrar: el merge de la rama de una tarea abierta", () => {
  const [p] = deTipo(entrada({ merges: [merge("abcdef1234", "Merge pull request #12 from flock/feat/pendientes")] }), "resuelto-sin-cerrar");
  assert.equal(p?.tarea, "pendientes");
  assert.equal(p?.proximoPaso, "Tildar Pendientes en el plan.");
  assert.deepEqual(p?.evidencia, [{ tipo: "commit", ref: "abcdef1" }]);
});

test("resuelto sin cerrar: un commit que dice cierra [Central]", () => {
  const c = commit({ sha: "1234567890", asunto: "Cierra [Central] con la API lista", vinculo: { tarea: "central", tipo: "nombre" } });
  const [p] = deTipo(entrada({ commitsSemana: [c] }), "resuelto-sin-cerrar");
  assert.equal(p?.tarea, "central");
});

test("resuelto sin cerrar: una rama mergeada con el slug de una tarea abierta", () => {
  const rama = { nombre: "feat/central", ultimoCommit: new Date("2026-10-08T10:00:00-03:00"), sha: "abcdef9999", mergeada: true };
  const [p] = deTipo(entrada({ ramas: [rama] }), "resuelto-sin-cerrar");
  assert.equal(p?.tarea, "central");
  assert.deepEqual(p?.evidencia, [{ tipo: "rama", ref: "feat/central" }, { tipo: "commit", ref: "abcdef9" }]);
});

test("no es resuelto sin cerrar: rama sin mergear, o cierre de una tarea que ya está hecha", () => {
  const sinMergear = { nombre: "feat/central", ultimoCommit: new Date("2026-10-08T10:00:00-03:00"), sha: "abcdef9999", mergeada: false };
  assert.equal(deTipo(entrada({ ramas: [sinMergear] }), "resuelto-sin-cerrar").length, 0);
  const c = commit({ sha: "1234567890", asunto: "Cierra [Bitácora]", vinculo: { tarea: "bitacora", tipo: "nombre" } });
  assert.equal(deTipo(entrada({ commitsSemana: [c] }), "resuelto-sin-cerrar").length, 0);
});

test("cerrado sin evidencia: tarea hecha sin commits vinculados", () => {
  assert.deepEqual(deTipo(entrada(), "cerrado-sin-evidencia").map((p) => p.tarea), ["bitacora"]);
  const c = commit({ sha: "aaaaaaa1", vinculo: { tarea: "bitacora", tipo: "nombre" } });
  assert.equal(deTipo(entrada({ commitsSemana: [c] }), "cerrado-sin-evidencia").length, 0);
});

test("rama quieta: sin mergear y sin commits hace N días", () => {
  const ramas = [
    { nombre: "feat/central", ultimoCommit: new Date("2026-10-04T10:00:00-03:00"), sha: "bbbbbbb1", mergeada: false },
    { nombre: "feat/vieja-mergeada", ultimoCommit: new Date("2026-10-01T10:00:00-03:00"), sha: "ccccccc1", mergeada: true },
    { nombre: "feat/reciente", ultimoCommit: new Date("2026-10-08T10:00:00-03:00"), sha: "ddddddd1", mergeada: false },
  ];
  const quietas = deTipo(entrada({ ramas }), "rama-quieta");
  assert.deepEqual(quietas.map((p) => p.tarea), ["central"]);
  assert.match(quietas[0]?.texto ?? "", /hace 5 días/);
});

const agregadas = (archivo: string, ...textos: string[]): (() => { archivo: string; texto: string }[]) => () => textos.map((texto) => ({ archivo, texto }));

test("TODO o FIXME nuevo en un comentario de código", () => {
  const c = commit({ sha: "eeeeeee1", vinculo: { tarea: "central", tipo: "nombre" } });
  const [p] = deTipo(entrada({ commitsPeriodo: [c], lineasAgregadas: agregadas("src/a.ts", "// TODO: limitar el tamaño", "x") }), "todo-nuevo");
  assert.equal(p?.tarea, "central");
  assert.match(p?.texto ?? "", /^Se agregó un TODO\/FIXME: "\/\/ TODO: limitar el tamaño"\.$/);
});

test("varios TODO nuevos usan el plural", () => {
  const c = commit({ sha: "eeeeeee2" });
  const [p] = deTipo(entrada({ commitsPeriodo: [c], lineasAgregadas: agregadas("src/a.ts", "// TODO: uno", "# FIXME: dos") }), "todo-nuevo");
  assert.match(p?.texto ?? "", /^Se agregaron 2 TODO\/FIXME, por ejemplo: "\/\/ TODO: uno"\.$/);
});

test("un TODO en markdown, en un string, en una regex o en un test no cuenta", () => {
  const c = commit({ sha: "eeeeeee3" });
  const sin = (archivo: string, texto: string): number => deTipo(entrada({ commitsPeriodo: [c], lineasAgregadas: agregadas(archivo, texto) }), "todo-nuevo").length;
  assert.equal(sin("intent/plan.md", "- TODO: algo"), 0);
  assert.equal(sin("src/a.ts", 'const marca = "TODO: algo";'), 0);
  assert.equal(sin("src/a.ts", "const re = /\\b(TODO|FIXME)\\b/;"), 0);
  assert.equal(sin("test/a.test.ts", "// TODO: algo"), 0);
  assert.equal(sin("src/a.py", "# TODO: algo"), 1);
});

test("código sin doc: por tarea, salvo que se toque README o docs/ o solo tests", () => {
  const conCodigo = commit({ sha: "fffffff1", archivos: ["src/a.ts"], vinculo: { tarea: "central", tipo: "nombre" } });
  assert.equal(deTipo(entrada({ commitsPeriodo: [conCodigo] }), "codigo-sin-doc").length, 1);
  const conDoc = commit({ sha: "fffffff2", archivos: ["src/a.ts", "README.md"], vinculo: { tarea: "central", tipo: "nombre" } });
  assert.equal(deTipo(entrada({ commitsPeriodo: [conDoc] }), "codigo-sin-doc").length, 0);
  const soloTests = commit({ sha: "fffffff3", archivos: ["test/a.test.ts"] });
  assert.equal(deTipo(entrada({ commitsPeriodo: [soloTests] }), "codigo-sin-doc").length, 0);
});
