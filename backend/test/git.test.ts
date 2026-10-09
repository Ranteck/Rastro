import { test } from "node:test";
import assert from "node:assert/strict";
import { commitsDe, diffResumido, lineasAgregadas, recolectarGit, urlBaseDe } from "../src/git.ts";
import { crearRepo } from "./helpers/repo.ts";

test("los commits de una rama mergeada conservan su rama y se marca la rama como mergeada", () => {
  const r = crearRepo();
  r.escribir("README.md", "hola\n");
  r.commit("inicio", "2026-10-09T10:00:00-03:00");
  r.git("checkout", "-q", "-b", "feat/pendientes");
  r.escribir("src/a.ts", "export const a = 1;\n");
  const enRama = r.commit("[Pendientes] detector", "2026-10-09T11:00:00-03:00");
  r.git("checkout", "-q", "main");
  r.git("merge", "-q", "--no-ff", "feat/pendientes", "-m", "Merge branch 'feat/pendientes'");

  const datos = recolectarGit(r.dir, "2026-10-08");
  const c = datos.commits.find((x) => x.sha === enRama);
  assert.equal(c?.rama, "feat/pendientes");
  assert.deepEqual(c?.archivos, ["src/a.ts"]);
  assert.equal(c?.asunto, "[Pendientes] detector");
  assert.equal(datos.ramaPrincipal, "main");
  assert.equal(datos.ramas.find((x) => x.nombre === "feat/pendientes")?.mergeada, true);
  assert.ok(datos.commits.some((x) => x.padres.length === 2 && x.rama === "main"));
  assert.equal(datos.urlBase, null);
});

test("una rama recién cortada de main sin commits no cuenta como mergeada", () => {
  const r = crearRepo();
  r.escribir("README.md", "hola\n");
  r.commit("inicio", "2026-10-09T10:00:00-03:00");
  r.git("branch", "feat/vacia");

  const datos = recolectarGit(r.dir, "2026-10-08");
  assert.equal(datos.ramas.find((x) => x.nombre === "feat/vacia")?.mergeada, false);
});

test("un commit hecho en main antes de bifurcar la rama de feature conserva la rama principal", () => {
  const r = crearRepo();
  r.escribir("README.md", "hola\n");
  const enMain = r.commit("inicio en main", "2026-10-09T10:00:00-03:00");
  r.git("checkout", "-q", "-b", "feat/nueva");
  r.escribir("src/b.ts", "export const b = 1;\n");
  const enRama = r.commit("trabajo en la rama", "2026-10-09T11:00:00-03:00");

  const datos = recolectarGit(r.dir, "2026-10-08");
  assert.equal(datos.commits.find((x) => x.sha === enMain)?.rama, "main");
  assert.equal(datos.commits.find((x) => x.sha === enRama)?.rama, "feat/nueva");
});

test("un repo sin commits no rompe", () => {
  const datos = recolectarGit(crearRepo().dir, "2026-10-01");
  assert.deepEqual(datos.commits, []);
  assert.deepEqual(datos.ramas, []);
  assert.equal(datos.ramaPrincipal, "main");
});

test("la URL base nunca conserva credenciales", () => {
  assert.equal(urlBaseDe("git@github.com:flock/rastro.git"), "https://github.com/flock/rastro");
  assert.equal(urlBaseDe("https://usuario:ghp_secreto@github.com/flock/rastro.git"), "https://github.com/flock/rastro");
  assert.equal(urlBaseDe("https://u:p@ss@github.com/flock/rastro.git"), "https://github.com/flock/rastro");
  assert.equal(urlBaseDe("/ruta/local/repo"), null);
});

test("el token del remoto no llega a los datos recolectados", () => {
  const r = crearRepo();
  r.commit("inicio", "2026-10-09T10:00:00-03:00");
  r.git("remote", "add", "origin", "https://usuario:ghp_secreto@github.com/flock/rastro.git");
  const datos = recolectarGit(r.dir, "2026-10-08");
  assert.equal(datos.urlBase, "https://github.com/flock/rastro");
  assert.ok(!JSON.stringify(datos).includes("ghp_secreto"));
});

test("las líneas agregadas de un commit", () => {
  const r = crearRepo();
  r.escribir("a.ts", "uno\n");
  r.commit("uno", "2026-10-09T10:00:00-03:00");
  r.escribir("a.ts", "uno\n// TODO: dos\n");
  const sha = r.commit("dos", "2026-10-09T10:05:00-03:00");
  assert.deepEqual(lineasAgregadas(r.dir, sha), [{ archivo: "a.ts", texto: "// TODO: dos" }]);
});

test("una rama con el nombre de un directorio no rompe la recolección", () => {
  const r = crearRepo();
  r.escribir("frontend/index.ts", "export const a = 1;\n");
  r.commit("inicio", "2026-10-09T10:00:00-03:00");
  r.git("checkout", "-q", "-b", "frontend");
  r.escribir("frontend/b.ts", "export const b = 1;\n");
  r.commit("trabajo", "2026-10-09T11:00:00-03:00");
  const datos = recolectarGit(r.dir, "2026-10-08");
  assert.ok(datos.commits.some((c) => c.asunto === "trabajo" && c.rama === "frontend"));
});

test("un archivo con el nombre de la rama principal no rompe la recolección", () => {
  const r = crearRepo();
  r.escribir("main", "no soy una rama\n");
  r.commit("inicio", "2026-10-09T10:00:00-03:00");
  const datos = recolectarGit(r.dir, "2026-10-08");
  assert.equal(datos.commits.length, 1);
  assert.equal(commitsDe(r.dir, "HEAD", "2026-10-08").length, 1);
});

test("el diff se redacta antes de truncarlo, así un token cortado no se filtra", () => {
  const r = crearRepo();
  r.escribir("a.ts", "uno\n");
  r.commit("uno", "2026-10-09T10:00:00-03:00");
  const token = `ghp_${"a".repeat(36)}`;
  r.escribir("a.ts", `uno\nconst t = "${token}";\n`);
  const sha = r.commit("dos", "2026-10-09T10:05:00-03:00");
  const completo = diffResumido(r.dir, sha, 100_000);
  assert.ok(!completo.includes("ghp_"));
  const corte = completo.indexOf("[redactado]") + 3;
  assert.ok(!diffResumido(r.dir, sha, corte).includes("ghp_"));
});
