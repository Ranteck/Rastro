import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";
import { aplicarCambios, cambioDeArgumentos, validarCambios, type Cambio } from "../src/cambios.ts";
import { configPorDefecto, escribirConfig } from "../src/config.ts";
import { tareasAtrasadas } from "../src/detectores/desvios.ts";
import { ErrorUsuario } from "../src/errores.ts";
import { ddmm, fechaLocal, lunesDe } from "../src/fechas.ts";
import { parsearPlan } from "../src/plan.ts";
import { confirmarPlan } from "../src/planCmd.ts";
import { registrar } from "../src/repos.ts";
import { crearRepo, type RepoTemporal } from "./helpers/repo.ts";

const config = configPorDefecto({ id: "test", nombre: "Test", equipo: "QA" });
const LUN = "2026-10-05";
const MIE = "2026-10-07";
const d = (valor: number, unidad: "h" | "d") => ({ valor, unidad });
const leer = (r: RepoTemporal, archivo: string): string => readFileSync(join(r.dir, ".rastro", archivo), "utf8");
const existe = (r: RepoTemporal, archivo: string): boolean => existsSync(join(r.dir, ".rastro", archivo));

/** Plan vigente de la semana del 05/10, ya repartido el lunes: Bitácora lun–mar, Central mié, Docs mié–jue. */
function repoConPlan(): RepoTemporal {
  const r = crearRepo();
  r.escribir("src/codigo.ts", "export const x = 1;\n");
  r.escribir(
    ".rastro/plan.sugerido.md",
    [
      "## Plan semana 05/10",
      "- **Entregable del viernes:** Demo.",
      "- [ ] **Bitácora:** Registrar el día. · 2d",
      "- [ ] **Central:** Recibir snapshots. · 4h",
      "- [ ] **Docs:** Escribir el README. · 1d",
      "",
    ].join("\n"),
  );
  r.commit("inicio");
  confirmarPlan({ config, hoy: LUN });
  r.escribir(".rastro/plan.md", `${leer(r, "plan.md")}  - 06/10 nota suelta que no es una tarea\n`);
  return r;
}

const aplicar = (r: RepoTemporal, cambios: Cambio[], extra: { confirmar?: boolean; destino?: "vigente" | "propuesta"; hoy?: string } = {}) =>
  aplicarCambios({ repos: [r.dir], config, cambios, destino: extra.destino ?? "vigente", confirmar: extra.confirmar ?? true, hoy: extra.hoy ?? LUN });

test("el plan de partida queda repartido como espera el resto de los tests", () => {
  const md = repoConPlan();
  assert.match(leer(md, "plan.md"), /Registrar el día\. · 2d · lun–mar$/m);
  assert.match(leer(md, "plan.md"), /Recibir snapshots\. · 4h · mié$/m);
});

test("duración: la vista previa muestra antes → después y la aplicación reescribe solo las tareas", () => {
  const r = repoConPlan();
  const res = aplicar(r, [{ tipo: "duracion", tarea: "bitacora", duracion: d(4, "d") }]);
  assert.equal(res.aplicado, true);
  assert.equal(res.vistaPrevia[0], "Bitácora: 2d → 4d · lun–mar → lun–jue");
  const md = leer(r, "plan.md");
  assert.match(md, /Registrar el día\. · 4d · lun–jue$/m);
  assert.match(md, /^ {2}- 06\/10 nota suelta que no es una tarea$/m);
  assert.equal(parsearPlan(md, LUN)?.entregable, "Demo.");
});

test("duración sin valor la quita, y una fuera de rango se rechaza", () => {
  const r = repoConPlan();
  assert.equal(aplicar(r, [{ tipo: "duracion", tarea: "central", duracion: null }]).vistaPrevia[0], "Central: 4h → sin duración · mié → sin días");
  assert.throws(() => aplicar(r, [{ tipo: "duracion", tarea: "central", duracion: d(500, "h") }]), ErrorUsuario);
});

test("día: fija la tarea a esos días y los guarda por semana", () => {
  const r = repoConPlan();
  const res = aplicar(r, [{ tipo: "dia", tarea: "bitacora", dias: ["2026-10-08", "2026-10-09"] }]);
  assert.equal(res.vistaPrevia[0], "Bitácora: lun–mar → jue–vie");
  assert.match(leer(r, "plan.md"), /Registrar el día\. · 2d · jue–vie$/m);
  assert.deepEqual(JSON.parse(leer(r, "fijados.json")), { [LUN]: { bitacora: ["2026-10-08", "2026-10-09"] } });
});

test("estado: marcar hecha tilda la tarea, conserva sus días y libera su lugar en el reparto", () => {
  const r = repoConPlan();
  const res = aplicar(r, [{ tipo: "estado", tarea: "bitacora", estado: "hecha" }]);
  assert.equal(res.vistaPrevia[0], "Bitácora: pendiente → hecha");
  assert.match(leer(r, "plan.md"), /^- \[x\] \*\*Bitácora:\*\* Registrar el día\. · 2d · lun–mar$/m);
  assert.match(leer(r, "plan.md"), /Recibir snapshots\. · 4h · lun$/m);
});

test("estado: volver de hecha a pendiente vuelve a ocupar su lugar", () => {
  const r = repoConPlan();
  aplicar(r, [{ tipo: "estado", tarea: "bitacora", estado: "hecha" }]);
  aplicar(r, [{ tipo: "estado", tarea: "bitacora", estado: "pendiente" }]);
  assert.match(leer(r, "plan.md"), /^- \[ \] \*\*Bitácora:\*\* Registrar el día\. · 2d · lun–mar$/m);
  assert.match(leer(r, "plan.md"), /Recibir snapshots\. · 4h · mié$/m);
});

test("día: fijar los días que la tarea ya tiene también la fija, y la vista previa lo dice", () => {
  const r = repoConPlan();
  const res = aplicar(r, [{ tipo: "dia", tarea: "bitacora", dias: ["2026-10-05", "2026-10-06"] }]);
  assert.equal(res.aplicado, true);
  assert.deepEqual(res.vistaPrevia, ["Bitácora: queda fijada en lun–mar"]);
  assert.deepEqual(JSON.parse(leer(r, "fijados.json")), { [LUN]: { bitacora: ["2026-10-05", "2026-10-06"] } });
  aplicar(r, [{ tipo: "duracion", tarea: "central", duracion: d(1, "d") }, { tipo: "duracion", tarea: "docs", duracion: d(3, "d") }]);
  assert.match(leer(r, "plan.md"), /Registrar el día\. · 2d · lun–mar$/m);
});

test("día: una tarea sin duración queda fijada igual y la vista previa avisa que no se reparte", () => {
  const r = repoConPlan();
  aplicar(r, [{ tipo: "duracion", tarea: "central", duracion: null }]);
  const res = aplicar(r, [{ tipo: "dia", tarea: "central", dias: ["2026-10-09"] }]);
  assert.deepEqual(res.vistaPrevia, ["Central: queda fijada en vie (sin duración: no se reparte hasta que la tenga)"]);
  assert.deepEqual(JSON.parse(leer(r, "fijados.json")), { [LUN]: { central: ["2026-10-09"] } });
});

test("un lote que solo cambia un vínculo no toca el plan ni la propuesta", () => {
  const r = repoConPlan();
  r.escribir(".rastro/plan.sugerido.md", leer(r, "plan.md"));
  const sha = r.commit("otro");
  const viejo = new Date("2020-01-01T00:00:00Z");
  for (const f of ["plan.md", "plan.sugerido.md"]) utimesSync(join(r.dir, ".rastro", f), viejo, viejo);
  aplicar(r, [{ tipo: "vinculo", commit: sha, tarea: null }]);
  for (const f of ["plan.md", "plan.sugerido.md"]) assert.equal(statSync(join(r.dir, ".rastro", f)).mtimeMs, viejo.getTime(), f);
});

test("un vínculo busca el commit en todos los repos y falla si no está en ninguno", () => {
  const otro = crearRepo();
  const sha = otro.commit("en el otro repo");
  const propio = crearRepo();
  propio.commit("en este");
  const base = { config, destino: "vigente", confirmar: true, hoy: LUN } as const;
  const res = aplicarCambios({ ...base, repos: [propio.dir, otro.dir], cambios: [{ tipo: "vinculo", commit: sha, tarea: null }] });
  assert.equal(res.aplicado, true);
  assert.throws(() => aplicarCambios({ ...base, repos: [propio.dir], cambios: [{ tipo: "vinculo", commit: sha, tarea: null }] }), /No existe un commit/);
});

test("un prefijo de SHA que coincide con más de un commit da un error claro y no escribe", () => {
  const r = repoConPlan();
  const real = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  // Un prefijo de 7 hex ambiguo no se fabrica con commits reales: un git falso lista dos commits para el prefijo y delega todo lo demás.
  const bin = mkdtempSync(join(tmpdir(), "rastro-gitfalso-"));
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\ncase "$1" in\n  rev-parse) case "$2" in --disambiguate=*) printf 'abcdef1aaa\\nabcdef1bbb\\n'; exit 0;; esac;;\n  cat-file) echo commit; exit 0;;\nesac\nexec '${real}' "$@"\n`,
  );
  chmodSync(join(bin, "git"), 0o755);
  const pathOriginal = process.env["PATH"];
  process.env["PATH"] = `${bin}${delimiter}${pathOriginal ?? ""}`;
  try {
    assert.throws(() => aplicar(r, [{ tipo: "vinculo", commit: "abcdef1", tarea: null }]), (e) => e instanceof ErrorUsuario && /El prefijo abcdef1 es ambiguo/.test(e.message));
  } finally {
    process.env["PATH"] = pathOriginal;
    rmSync(bin, { recursive: true, force: true });
  }
  assert.equal(existe(r, "correcciones.json"), false);
});

test("el mismo prefijo en dos repos con commits distintos es ambiguo; con el mismo commit en los dos (un clon) no", () => {
  const real = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  const a = repoConPlan();
  const b = crearRepo();
  b.commit("en el otro");
  // Un git falso que devuelve, para cualquier prefijo, un commit propio de cada carpeta; lo demás va al git real.
  const bin = mkdtempSync(join(tmpdir(), "rastro-gitfalso-"));
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\ncase "$1" in\n  rev-parse) case "$2" in --disambiguate=*) printf 'abcdef1-%s\\n' "$(basename "$PWD")"; exit 0;; esac;;\n  cat-file) echo commit; exit 0;;\nesac\nexec '${real}' "$@"\n`,
  );
  chmodSync(join(bin, "git"), 0o755);
  const pathOriginal = process.env["PATH"];
  process.env["PATH"] = `${bin}${delimiter}${pathOriginal ?? ""}`;
  try {
    const dos = { config, destino: "vigente", confirmar: true, hoy: LUN, repos: [a.dir, b.dir] } as const;
    assert.throws(() => aplicarCambios({ ...dos, cambios: [{ tipo: "vinculo", commit: "abcdef1", tarea: null }] }), (e) => e instanceof ErrorUsuario && /El prefijo abcdef1 es ambiguo/.test(e.message));
  } finally {
    process.env["PATH"] = pathOriginal;
    rmSync(bin, { recursive: true, force: true });
  }
  // crearRepo apunta RASTRO_HOME a su carpeta: la global de este test es la de `b`.
  assert.equal(existe(b, "correcciones.json"), false);

  const clon = mkdtempSync(join(tmpdir(), "rastro-clon-"));
  const sha = a.commit("compartido");
  spawnSync(real, ["clone", "-q", a.dir, clon], { encoding: "utf8" });
  const res = aplicarCambios({ config, destino: "vigente", confirmar: true, hoy: LUN, repos: [a.dir, clon], cambios: [{ tipo: "vinculo", commit: sha.slice(0, 8), tarea: null }] });
  assert.equal(res.aplicado, true);
  assert.equal(existe(b, "correcciones.json"), true);
  rmSync(clon, { recursive: true, force: true });
});

test("corregir un vínculo a sin tarea no exige que haya plan", () => {
  const r = crearRepo();
  const sha = r.commit("suelto");
  assert.equal(aplicar(r, [{ tipo: "vinculo", commit: sha, tarea: null }]).aplicado, true);
  assert.throws(() => aplicar(r, [{ tipo: "vinculo", commit: sha, tarea: "central" }]), /No hay plan/);
});

test("si falla una escritura no queda ningún archivo reemplazado ni temporal", () => {
  const r = repoConPlan();
  const antes = leer(r, "plan.md");
  mkdirSync(join(r.dir, ".rastro/correcciones.json.tmp"));
  const sha = r.commit("otro");
  assert.throws(() => aplicar(r, [{ tipo: "duracion", tarea: "bitacora", duracion: d(4, "d") }, { tipo: "dia", tarea: "docs", dias: ["2026-10-09"] }, { tipo: "vinculo", commit: sha, tarea: null }]));
  assert.equal(leer(r, "plan.md"), antes);
  assert.equal(existe(r, "fijados.json"), false);
  assert.equal(existe(r, "fijados.json.tmp"), false);
});

test("vínculo: la corrección se guarda con el SHA completo y puede ser sin tarea", () => {
  const r = repoConPlan();
  const sha = r.commit("arreglo suelto");
  const res = aplicar(r, [{ tipo: "vinculo", commit: sha.slice(0, 7), tarea: "central" }]);
  assert.deepEqual(res.vistaPrevia, [`Commit ${sha.slice(0, 7)}: sin corrección → Central`]);
  assert.deepEqual(JSON.parse(leer(r, "correcciones.json")), { [sha]: "central" });
  const otra = aplicar(r, [{ tipo: "vinculo", commit: sha, tarea: null }]);
  assert.deepEqual(otra.vistaPrevia, [`Commit ${sha.slice(0, 7)}: Central → sin tarea`]);
  assert.deepEqual(JSON.parse(leer(r, "correcciones.json")), { [sha]: null });
});

test("un commit inexistente o una tarea inexistente en el vínculo dan un error claro y no escriben", () => {
  const r = repoConPlan();
  const sha = r.commit("otro");
  assert.throws(() => aplicar(r, [{ tipo: "vinculo", commit: "abcdef1", tarea: null }]), /No existe un commit/);
  assert.throws(() => aplicar(r, [{ tipo: "vinculo", commit: sha, tarea: "fantasma" }]), /fantasma/);
  assert.equal(existe(r, "correcciones.json"), false);
});

test("sin confirmar no se escribe nada: ni el plan ni los archivos nuevos", () => {
  const r = repoConPlan();
  const antes = { plan: leer(r, "plan.md"), archivos: readdirSync(join(r.dir, ".rastro")).sort() };
  const sha = r.commit("otro");
  const res = aplicar(
    r,
    [
      { tipo: "duracion", tarea: "bitacora", duracion: d(4, "d") },
      { tipo: "dia", tarea: "central", dias: ["2026-10-09"] },
      { tipo: "estado", tarea: "docs", estado: "sacada" },
      { tipo: "vinculo", commit: sha, tarea: "docs" },
    ],
    { confirmar: false },
  );
  assert.equal(res.aplicado, false);
  assert.ok(res.vistaPrevia.length >= 4);
  assert.equal(leer(r, "plan.md"), antes.plan);
  assert.deepEqual(readdirSync(join(r.dir, ".rastro")).sort(), antes.archivos);
});

test("todo o nada: una tarea inexistente en el medio del lote no deja aplicar ningún cambio", () => {
  const r = repoConPlan();
  const antes = leer(r, "plan.md");
  assert.throws(
    () =>
      aplicar(r, [
        { tipo: "duracion", tarea: "bitacora", duracion: d(4, "d") },
        { tipo: "estado", tarea: "no-existe", estado: "hecha" },
        { tipo: "dia", tarea: "central", dias: ["2026-10-09"] },
      ]),
    (e: unknown) => e instanceof ErrorUsuario && /no-existe/.test(e.message),
  );
  assert.equal(leer(r, "plan.md"), antes);
  assert.equal(existe(r, "fijados.json"), false);
});

test("un día fuera de la semana se rechaza sin aplicar nada", () => {
  const r = repoConPlan();
  const antes = leer(r, "plan.md");
  assert.throws(() => aplicar(r, [{ tipo: "dia", tarea: "bitacora", dias: ["2026-10-12"] }]), /fuera de la semana/);
  assert.equal(leer(r, "plan.md"), antes);
});

test("fijar un día y después cambiar la duración de otra tarea no mueve a la fijada", () => {
  const r = repoConPlan();
  aplicar(r, [{ tipo: "dia", tarea: "docs", dias: ["2026-10-05", "2026-10-06"] }]);
  aplicar(r, [{ tipo: "duracion", tarea: "central", duracion: d(2, "d") }]);
  const tareas = parsearPlan(leer(r, "plan.md"), LUN)?.tareas ?? [];
  assert.deepEqual(tareas.find((t) => t.slug === "docs")?.dias, ["2026-10-05", "2026-10-06"]);
  assert.ok((tareas.find((t) => t.slug === "central")?.dias ?? []).every((dia) => dia > "2026-10-06"));
});

const dias = (r: RepoTemporal, slug: string, hoy = MIE) => parsearPlan(leer(r, "plan.md"), hoy)?.tareas.find((t) => t.slug === slug)?.dias;

test("un miércoles, cambiar otra tarea no mueve a la pendiente que ya empezó y sigue atrasada", () => {
  const r = repoConPlan();
  aplicar(r, [{ tipo: "duracion", tarea: "central", duracion: d(2, "d") }], { hoy: MIE });
  assert.deepEqual(dias(r, "bitacora"), ["2026-10-05", "2026-10-06"]);
  const tareas = parsearPlan(leer(r, "plan.md"), MIE)?.tareas ?? [];
  assert.deepEqual(tareasAtrasadas({ semana: LUN, entregable: "", tareas }, MIE).map((t) => t.slug), ["bitacora"]);
  assert.ok((dias(r, "central") ?? []).every((dia) => dia >= MIE));
});

test("re-estimar la duración de la que ya empezó la recalcula desde su primer día y deja de estar atrasada", () => {
  const r = repoConPlan();
  aplicar(r, [{ tipo: "duracion", tarea: "bitacora", duracion: d(4, "d") }], { hoy: MIE });
  assert.deepEqual(dias(r, "bitacora"), ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
  const tareas = parsearPlan(leer(r, "plan.md"), MIE)?.tareas ?? [];
  assert.deepEqual(tareasAtrasadas({ semana: LUN, entregable: "", tareas }, MIE), []);
});

test("día: sobre una tarea que ya empezó la mueve a los días pedidos", () => {
  const r = repoConPlan();
  const res = aplicar(r, [{ tipo: "dia", tarea: "bitacora", dias: ["2026-10-08", "2026-10-09"] }], { hoy: MIE });
  assert.equal(res.vistaPrevia[0], "Bitácora: lun–mar → jue–vie");
  assert.deepEqual(dias(r, "bitacora"), ["2026-10-08", "2026-10-09"]);
  const tareas = parsearPlan(leer(r, "plan.md"), MIE)?.tareas ?? [];
  assert.deepEqual(tareasAtrasadas({ semana: LUN, entregable: "", tareas }, MIE), []);
});

test("duración: cambiarla a una tarea con días fijados la recalcula desde su primer día fijado", () => {
  const r = repoConPlan();
  aplicar(r, [{ tipo: "dia", tarea: "bitacora", dias: ["2026-10-05", "2026-10-06"] }]);
  const res = aplicar(r, [{ tipo: "duracion", tarea: "bitacora", duracion: d(4, "d") }]);
  assert.equal(res.vistaPrevia[0], "Bitácora: 2d → 4d · lun–mar → lun–jue");
  assert.match(leer(r, "plan.md"), /Registrar el día\. · 4d · lun–jue$/m);
  assert.deepEqual(JSON.parse(leer(r, "fijados.json")), { [LUN]: { bitacora: ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"] } });
  // Lo recalculado queda fijado: otro cambio posterior no lo devuelve a los días de la duración vieja.
  aplicar(r, [{ tipo: "duracion", tarea: "central", duracion: d(2, "h") }]);
  assert.deepEqual(dias(r, "bitacora", LUN), ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
});

test("duración y después día sobre la misma tarea: valen los días pedidos", () => {
  const r = repoConPlan();
  aplicar(r, [{ tipo: "duracion", tarea: "bitacora", duracion: d(4, "d") }, { tipo: "dia", tarea: "bitacora", dias: ["2026-10-08", "2026-10-09"] }]);
  assert.deepEqual(dias(r, "bitacora", LUN), ["2026-10-08", "2026-10-09"]);
});

test("una tarea que arranca el jueves sí se reparte de nuevo cuando cambia el plan", () => {
  const r = repoConPlan();
  r.escribir(".rastro/plan.md", leer(r, "plan.md").replace(/(Escribir el README\. · 1d) · .*$/m, "$1 · jue"));
  aplicar(r, [{ tipo: "duracion", tarea: "bitacora", duracion: d(1, "d") }], { hoy: MIE });
  assert.deepEqual(dias(r, "docs")?.[0], "2026-10-07");
});

test("destino propuesta cambia plan.sugerido.md y deja el plan vigente como está", () => {
  const r = repoConPlan();
  r.escribir(".rastro/plan.sugerido.md", leer(r, "plan.md"));
  const vigente = leer(r, "plan.md");
  aplicar(r, [{ tipo: "duracion", tarea: "bitacora", duracion: d(1, "d") }], { destino: "propuesta" });
  assert.equal(leer(r, "plan.md"), vigente);
  assert.match(leer(r, "plan.sugerido.md"), /Registrar el día\. · 1d · lun$/m);
});

test("sin plan o sin propuesta el error dice qué hacer", () => {
  assert.throws(() => aplicar(crearRepo(), [{ tipo: "estado", tarea: "x", estado: "hecha" }]), /No hay plan para esta semana/);
  assert.throws(() => aplicar(repoConPlan(), [{ tipo: "estado", tarea: "bitacora", estado: "hecha" }], { destino: "propuesta" }), /No hay una propuesta/);
});

function archivosFuera(dir: string, base = dir): Record<string, string> {
  const res: Record<string, string> = {};
  for (const nombre of readdirSync(dir)) {
    if (nombre === ".git" || nombre === ".rastro") continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) Object.assign(res, archivosFuera(ruta, base));
    else res[relative(base, ruta)] = readFileSync(ruta, "utf8");
  }
  return res;
}

test("ningún archivo se escribe fuera de .rastro/", () => {
  const r = repoConPlan();
  const sha = r.commit("otro");
  const antes = archivosFuera(r.dir);
  aplicar(r, [
    { tipo: "duracion", tarea: "bitacora", duracion: d(4, "d") },
    { tipo: "dia", tarea: "central", dias: ["2026-10-09"] },
    { tipo: "estado", tarea: "docs", estado: "hecha" },
    { tipo: "vinculo", commit: sha, tarea: "docs" },
  ]);
  assert.deepEqual(archivosFuera(r.dir), antes);
  assert.equal(r.git("status", "--porcelain").includes("src/"), false);
});

test("validarCambios rechaza formas que el contrato no admite", () => {
  const malos: unknown[] = [
    {},
    [{ tipo: "borrar", tarea: "x" }],
    [{ tipo: "estado", tarea: "x", estado: "terminada" }],
    [{ tipo: "vinculo", commit: "xyz", tarea: null }],
    [{ tipo: "dia", tarea: "x", dias: [] }],
    [{ tipo: "dia", tarea: "x", dias: ["2026-10-06", "2026-10-05"] }],
    [{ tipo: "duracion", tarea: "x", duracion: { valor: 0, unidad: "d" } }],
    [{ tipo: "estado", tarea: "x", estado: "hecha", extra: 1 }],
    [{ tipo: "estado", tarea: "No Slug", estado: "hecha" }],
  ];
  for (const malo of malos) assert.throws(() => validarCambios(malo), ErrorUsuario, JSON.stringify(malo));
  assert.equal(validarCambios([{ tipo: "vinculo", commit: "ABCDEF1", tarea: null }]).length, 1);
});

test("los argumentos de la CLI se traducen al mismo cambio que el JSON", () => {
  assert.deepEqual(cambioDeArgumentos("duracion", "bitacora", "1,5d", LUN), { tipo: "duracion", tarea: "bitacora", duracion: d(1.5, "d") });
  assert.deepEqual(cambioDeArgumentos("dia", "bitacora", "lun–mar, jue", LUN), { tipo: "dia", tarea: "bitacora", dias: ["2026-10-05", "2026-10-06", "2026-10-08"] });
  assert.deepEqual(cambioDeArgumentos("dia", "bitacora", "mié-vie", LUN), { tipo: "dia", tarea: "bitacora", dias: ["2026-10-07", "2026-10-08", "2026-10-09"] });
  assert.deepEqual(cambioDeArgumentos("vinculo", "4b48aec", "sin-tarea", LUN), { tipo: "vinculo", commit: "4b48aec", tarea: null });
  assert.throws(() => cambioDeArgumentos("dia", "bitacora", "mar–lun", LUN), ErrorUsuario);
  assert.throws(() => cambioDeArgumentos("duracion", "bitacora", "mucho", LUN), ErrorUsuario);
  assert.throws(() => cambioDeArgumentos("mover", "bitacora", "x", LUN), /no existe/);
});

function repoDeLaSemanaActual(): RepoTemporal {
  const r = crearRepo();
  escribirConfig(config);
  registrar(r.dir);
  const hoy = fechaLocal(new Date(), config.zonaHoraria);
  r.escribir(".rastro/plan.md", `## Plan semana ${ddmm(lunesDe(hoy))}\n- **Entregable del viernes:** Demo.\n- [ ] **Bitácora:** Registrar. · 2d\n- [ ] **Central:** Recibir. · 4h\n`);
  r.commit("inicio");
  return r;
}

const rastro = (r: RepoTemporal, args: string[], input?: string) =>
  spawnSync(process.execPath, [new URL("../bin/rastro.js", import.meta.url).pathname, "plan", "cambiar", ...args], {
    cwd: r.dir,
    env: r.env,
    encoding: "utf8",
    ...(input === undefined ? {} : { input }),
  });

test("la CLI sin --confirmar imprime la vista previa, sale con 0 y no escribe", () => {
  const r = repoDeLaSemanaActual();
  const antes = leer(r, "plan.md");
  const res = rastro(r, ["duracion", "bitacora", "4d"]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Vista previa/);
  assert.match(res.stdout, /Bitácora: 2d → 4d/);
  assert.equal(leer(r, "plan.md"), antes);
});

test("la CLI con argumentos y con --json por stdin producen el mismo plan", () => {
  const porArgumentos = repoDeLaSemanaActual();
  const porJson = repoDeLaSemanaActual();
  const a = rastro(porArgumentos, ["duracion", "bitacora", "4d", "--confirmar"]);
  const b = rastro(porJson, ["--json", "--confirmar"], JSON.stringify([{ tipo: "duracion", tarea: "bitacora", duracion: { valor: 4, unidad: "d" } }]));
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.equal(leer(porJson, "plan.md"), leer(porArgumentos, "plan.md"));
  assert.match(leer(porJson, "plan.md"), /Registrar\. · 4d/);
  assert.equal(a.stdout, b.stdout);
});

test("la CLI muestra el error de un cambio inválido sin detalles internos y sale con 1", () => {
  const r = repoDeLaSemanaActual();
  const res = rastro(r, ["--json"], "no es json");
  assert.equal(res.status, 1);
  assert.match(res.stderr, /rastro: Lo que llegó por stdin no es un JSON válido/);
  assert.equal(res.stderr.includes("at "), false);
});

test("fijar más de lo que entra en los días libres marca el faltante en la vista previa", () => {
  const r = repoConPlan();
  const jue = "2026-10-08";
  const res = aplicar(r, [
    { tipo: "dia", tarea: "bitacora", dias: [jue] },
    { tipo: "dia", tarea: "central", dias: [jue] },
  ]);
  const lineas = res.vistaPrevia.filter((l) => l.includes("no entran"));
  assert.equal(lineas.length, 2);
  assert.match(lineas[0] ?? "", /^Bitácora: 2d no entran en jue; faltan 1d$/);
  assert.match(lineas[1] ?? "", /^Central: 4h no entran en jue; faltan 4h$/);
  // Lo que entra no genera la línea.
  assert.equal(aplicar(r, [{ tipo: "dia", tarea: "docs", dias: ["2026-10-09"] }], { confirmar: false }).vistaPrevia.some((l) => l.includes("no entran")), false);
});

test("la CLI y plan.md leen igual los días y la unidad: sab, mie, 2D, 1,5d y 1.5d", () => {
  assert.deepEqual(cambioDeArgumentos("dia", "docs", "lun-mie", LUN), { tipo: "dia", tarea: "docs", dias: ["2026-10-05", "2026-10-06", "2026-10-07"] });
  assert.deepEqual(cambioDeArgumentos("dia", "docs", "mié, sáb", LUN), { tipo: "dia", tarea: "docs", dias: ["2026-10-07", "2026-10-10"] });
  assert.deepEqual(cambioDeArgumentos("dia", "docs", "sab", LUN), { tipo: "dia", tarea: "docs", dias: ["2026-10-10"] });
  assert.deepEqual(cambioDeArgumentos("duracion", "docs", "2D", LUN), { tipo: "duracion", tarea: "docs", duracion: d(2, "d") });
  assert.deepEqual(cambioDeArgumentos("duracion", "docs", "1,5d", LUN), { tipo: "duracion", tarea: "docs", duracion: d(1.5, "d") });
  assert.deepEqual(cambioDeArgumentos("duracion", "docs", "1.5H", LUN), { tipo: "duracion", tarea: "docs", duracion: d(1.5, "h") });
  const plan = parsearPlan(["## Plan semana 05/10", "- [ ] **A:** Uno · 2d · lun-mie", "- [ ] **B:** Dos · 1,5d · sab", "- [ ] **C:** Tres · 2D · Mié, sáb", ""].join("\n"), LUN);
  assert.deepEqual(plan?.tareas.map((t) => [t.objetivo, t.duracion, t.dias]), [
    ["Uno", d(2, "d"), ["2026-10-05", "2026-10-06", "2026-10-07"]],
    ["Dos", d(1.5, "d"), ["2026-10-10"]],
    ["Tres", d(2, "d"), ["2026-10-07", "2026-10-10"]],
  ]);
});

test("una línea de plan.md con forma de sufijo que no se puede leer corta con su número de línea", () => {
  const md = ["## Plan semana 05/10", "- [ ] **A:** Uno · 2d · lunes", ""].join("\n");
  assert.throws(() => parsearPlan(md, LUN), (e: unknown) => e instanceof ErrorUsuario && /línea 2/.test(e.message));
});

test("repo: la vista previa muestra antes → después y solo --confirmar escribe", () => {
  const r = repoConPlan();
  const nombre = registrar(r.dir).nombre;
  const antes = leer(r, "plan.md");
  const previa = aplicar(r, [{ tipo: "repo", tarea: "central", repo: nombre }], { confirmar: false });
  assert.deepEqual(previa, { vistaPrevia: [`Central: repo sin repo → ${nombre}`], aplicado: false });
  assert.equal(leer(r, "plan.md"), antes);
  const res = aplicar(r, [{ tipo: "repo", tarea: "central", repo: nombre }]);
  assert.equal(res.aplicado, true);
  assert.match(leer(r, "plan.md"), new RegExp(`Recibir snapshots\\. · 4h · mié · repo:${nombre}$`, "m"));
  assert.equal(parsearPlan(leer(r, "plan.md"), LUN)?.tareas.find((t) => t.slug === "central")?.repo, nombre);
});

test("repo: ninguno saca el repo y un nombre no registrado se acepta con un aviso en la vista previa", () => {
  const r = repoConPlan();
  const nuevo = aplicar(r, [{ tipo: "repo", tarea: "docs", repo: "hunting" }], { confirmar: false });
  assert.equal(nuevo.vistaPrevia[0], "Docs: repo sin repo → hunting");
  assert.match(nuevo.vistaPrevia[1] ?? "", /"hunting" no es un repo registrado/);
  aplicar(r, [{ tipo: "repo", tarea: "docs", repo: "hunting" }]);
  const quita = aplicar(r, [{ tipo: "repo", tarea: "docs", repo: null }]);
  assert.equal(quita.vistaPrevia[0], "Docs: repo hunting → sin repo");
  assert.equal(parsearPlan(leer(r, "plan.md"), LUN)?.tareas.find((t) => t.slug === "docs")?.repo, null);
});

test("repo: por argumentos de la CLI, con ninguno y con un nombre que no es válido", () => {
  assert.deepEqual(cambioDeArgumentos("repo", "central", "hunting", LUN), { tipo: "repo", tarea: "central", repo: "hunting" });
  assert.deepEqual(cambioDeArgumentos("repo", "central", "ninguno", LUN), { tipo: "repo", tarea: "central", repo: null });
  assert.throws(() => cambioDeArgumentos("repo", "central", "dos palabras", LUN), ErrorUsuario);
});

test("repo: un repo con espacios en el nombre se registra con un nombre usable en plan cambiar repo", () => {
  const r = repoConPlan();
  const dir = join(mkdtempSync(join(tmpdir(), "rastro-nombre-")), "Mi Proyecto");
  mkdirSync(dir);
  const { nombre } = registrar(dir);
  assert.equal(nombre, "Mi-Proyecto");
  const cambio = cambioDeArgumentos("repo", "central", nombre, LUN);
  const res = aplicar(r, [cambio]);
  assert.deepEqual(res.vistaPrevia, ["Central: repo sin repo → Mi-Proyecto"]);
  assert.match(leer(r, "plan.md"), /Recibir snapshots\. · 4h · mié · repo:Mi-Proyecto$/m);
});

test("repo: un repo registrado cuya carpeta se movió no dispara el aviso de no registrado", () => {
  const r = repoConPlan();
  const dir = join(mkdtempSync(join(tmpdir(), "rastro-movido-")), "viejo");
  mkdirSync(dir);
  registrar(dir);
  rmSync(dir, { recursive: true });
  const res = aplicar(r, [{ tipo: "repo", tarea: "central", repo: "viejo" }], { confirmar: false });
  assert.deepEqual(res.vistaPrevia, ["Central: repo sin repo → viejo"]);
});
