import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { aplicarCambios, guardarBase } from "../src/cambios.ts";
import { configPorDefecto, escribirConfig } from "../src/config.ts";
import { ErrorUsuario } from "../src/errores.ts";
import { ddmm, fechaLocal, lunesDe } from "../src/fechas.ts";
import { tareasAtrasadas } from "../src/detectores/desvios.ts";
import { parsearPlan } from "../src/plan.ts";
import { armarPlan, confirmarPlan, sugerirTareas, textoDeConfirmacion, textoDePropuesta } from "../src/planCmd.ts";
import { FakeLlm } from "./helpers/fakeLlm.ts";
import { crearRepo } from "./helpers/repo.ts";

const config = configPorDefecto({ id: "test", nombre: "Test", equipo: "QA" });
const d = (valor: number, unidad: "h" | "d") => ({ valor, unidad });
const respuestaPlan = {
  plan: {
    entregable: "Demo el viernes.",
    tareas: [
      { nombre: "Bitácora", objetivo: "Registrar el día.", duracion: d(2, "d") },
      { nombre: "Central: API", objetivo: "Recibir snapshots.", duracion: d(4, "h") },
      { nombre: "bitacora", objetivo: "Duplicada.", duracion: d(1, "d") },
      { nombre: "Enorme", objetivo: "No cabe en la semana.", duracion: d(10, "d") },
    ],
  },
};
const leer = (dir: string, archivo: string): string => readFileSync(join(dir, ".rastro", archivo), "utf8");

test("arma la propuesta en plan.sugerido.md con duraciones y reparto, sin nombres duplicados", async () => {
  const r = crearRepo();
  const res = await armarPlan({ nombre: "test", config, llm: new FakeLlm(respuestaPlan), propuesta: "# Propuesta", hoy: "2026-10-09" });
  assert.equal(res.archivo, join(r.dir, ".rastro/plan.sugerido.md"));
  assert.equal(existsSync(join(r.dir, ".rastro/plan.md")), false);
  const md = leer(r.dir, "plan.sugerido.md");
  assert.match(md, /- \[ \] \*\*Bitácora:\*\* Registrar el día\. · 2d · lun–mar · repo:test$/m);
  assert.match(md, /- \[ \] \*\*Central API:\*\* Recibir snapshots\. · 4h · mié · repo:test$/m);
  assert.match(md, /- \[ \] \*\*Enorme:\*\* No cabe en la semana\. · 10d · no entra · repo:test$/m);
  const plan = parsearPlan(md, "2026-10-09");
  assert.equal(plan?.entregable, "Demo el viernes.");
  assert.deepEqual(plan?.tareas.map((t) => t.nombre), ["Bitácora", "Central API", "Enorme"]);
});

test("una duración inválida deja la tarea sin duración y avisa con un warn", async () => {
  const r = crearRepo();
  const llm = new FakeLlm({
    plan: {
      entregable: "Demo.",
      tareas: [
        { nombre: "Uno", objetivo: "Primera.", duracion: d(500, "h") },
        { nombre: "Dos", objetivo: "Segunda.", duracion: { valor: "mucho", unidad: "d" } },
        { nombre: "Tres", objetivo: "Tercera.", duracion: d(1, "d") },
      ],
    },
  });
  const escrito: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((texto: string) => (escrito.push(texto), true)) as typeof process.stderr.write;
  try {
    await armarPlan({ nombre: "test", config, llm, propuesta: "# P", hoy: "2026-10-09" });
  } finally {
    process.stderr.write = original;
  }
  const plan = parsearPlan(leer(r.dir, "plan.sugerido.md"), "2026-10-09");
  assert.deepEqual(plan?.tareas.map((t) => t.duracion), [null, null, d(1, "d")]);
  assert.equal(escrito.filter((l) => l.includes("warn duracion_invalida")).length, 2);
});

test("una respuesta fuera del esquema se rechaza", async () => {
  const llm = new FakeLlm({ plan: { entregable: "Demo.", tareas: [{ objetivo: "Sin nombre.", duracion: d(1, "d") }] } });
  await assert.rejects(armarPlan({ nombre: "test", config, llm, propuesta: "x", hoy: "2026-10-09" }), /nombre/);
});

test("un objetivo del LLM con salto de línea sigue dando un plan.sugerido.md legible", async () => {
  const r = crearRepo();
  const llm = new FakeLlm({ plan: { entregable: "Demo.", tareas: [{ nombre: "Bitácora", objetivo: "Registrar\n- [ ] **Falsa:** otra\n", duracion: d(1, "d") }] } });
  await armarPlan({ nombre: "test", config, llm, propuesta: "# Propuesta", hoy: "2026-10-09" });
  const plan = parsearPlan(leer(r.dir, "plan.sugerido.md"), "2026-10-09");
  assert.equal(plan?.tareas.length, 1);
});

test("plan no modifica el plan.md vigente: la propuesta queda aparte", async () => {
  const r = crearRepo();
  r.escribir(".rastro/plan.md", "mi plan\n");
  await armarPlan({ nombre: "test", config, llm: new FakeLlm(respuestaPlan), propuesta: "# Propuesta", hoy: "2026-10-09" });
  assert.equal(leer(r.dir, "plan.md"), "mi plan\n");
  assert.ok(existsSync(join(r.dir, ".rastro/plan.sugerido.md")));
});

test("--confirmar reemplaza la semana en plan.md, conserva las otras y borra la propuesta", async () => {
  const r = crearRepo();
  r.escribir(".rastro/plan.md", "## Plan semana 05/10\n- **Entregable del viernes:** Viejo.\n- [x] **Vieja:** Se reemplaza. · repo:test\n\n## Plan semana 28/09\n- [ ] **Anterior:** Sigue igual.\n");
  await armarPlan({ nombre: "test", config, llm: new FakeLlm(respuestaPlan), propuesta: "# Propuesta", hoy: "2026-10-09" });
  confirmarPlan({ config, hoy: "2026-10-09" });
  const md = leer(r.dir, "plan.md");
  assert.deepEqual(parsearPlan(md, "2026-10-09")?.tareas.map((t) => t.nombre), ["Bitácora", "Central API", "Enorme"]);
  assert.deepEqual(parsearPlan(md, "2026-09-30")?.tareas.map((t) => t.nombre), ["Anterior"]);
  assert.equal(existsSync(join(r.dir, ".rastro/plan.sugerido.md")), false);
});

test("--confirmar desde un repo conserva las tareas de los otros repos y las sin repo, y solo reemplaza las de ese repo", async () => {
  const r = crearRepo();
  r.escribir(
    ".rastro/plan.md",
    "## Plan semana 05/10\n- **Entregable del viernes:** Viejo.\n- [x] **Alfa:** Hecha en a. · 1d · lun · repo:a\n- [ ] **Beta:** En b. · 1d · mié · repo:b\n- [ ] **Reunión:** Sin repo. · 2h · jue\n- [ ] **Gama:** Vieja de c. · 1d · vie · repo:c\n",
  );
  await armarPlan({ nombre: "c", config, llm: new FakeLlm(respuestaPlan), propuesta: "# Propuesta", hoy: "2026-10-09" });
  const res = confirmarPlan({ config, hoy: "2026-10-09" });
  const tareas = parsearPlan(leer(r.dir, "plan.md"), "2026-10-09")?.tareas ?? [];
  assert.deepEqual(tareas.map((t) => [t.slug, t.estado, t.repo]), [
    ["alfa", "hecha", "a"],
    ["beta", "pendiente", "b"],
    ["reunion", "pendiente", null],
    ["bitacora", "pendiente", "c"],
    ["central-api", "pendiente", "c"],
    ["enorme", "pendiente", "c"],
  ]);
  assert.deepEqual(tareas.find((t) => t.slug === "beta")?.dias, ["2026-10-07"]);
  assert.deepEqual(tareas.find((t) => t.slug === "reunion")?.dias, ["2026-10-08"]);
  assert.deepEqual(res.quitadas, ["Gama"]);
  assert.match(textoDeConfirmacion(res), /Se quitaron del plan, porque la propuesta no las trae: Gama\./);
});

test("--confirmar reemplaza las tareas de los repos que trae la propuesta, no las del repo donde se corre", async () => {
  const r = crearRepo();
  r.escribir(
    ".rastro/plan.md",
    "## Plan semana 05/10\n- **Entregable del viernes:** Viejo.\n- [ ] **Vieja de a:** Se reemplaza. · 1d · lun · repo:a\n- [x] **Beta:** En b. · 1d · mié · repo:b\n",
  );
  const llm = new FakeLlm({ plan: { entregable: "Demo.", tareas: [{ nombre: "Gama", objetivo: "Nueva de a.", duracion: d(1, "d") }] } });
  // La propuesta se arma en `a`; la confirmación no sabe en qué carpeta corre y no depende de ella.
  await armarPlan({ nombre: "a", config, llm, propuesta: "# Propuesta", hoy: "2026-10-09" });
  const res = confirmarPlan({ config, hoy: "2026-10-09" });
  const tareas = parsearPlan(leer(r.dir, "plan.md"), "2026-10-09")?.tareas ?? [];
  assert.deepEqual(tareas.map((t) => [t.slug, t.estado, t.repo]), [["beta", "hecha", "b"], ["gama", "pendiente", "a"]]);
  assert.deepEqual(res.quitadas, ["Vieja de a"]);
});

test("--confirmar no menciona nada quitado cuando el repo no perdió tareas", async () => {
  crearRepo();
  await armarPlan({ nombre: "c", config, llm: new FakeLlm(respuestaPlan), propuesta: "# Propuesta", hoy: "2026-10-09" });
  const res = confirmarPlan({ config, hoy: "2026-10-09" });
  assert.deepEqual(res.quitadas, []);
  assert.doesNotMatch(textoDeConfirmacion(res), /Se quitaron/);
});

test("--confirmar crea plan.md si no existía", async () => {
  const r = crearRepo();
  await armarPlan({ nombre: "test", config, llm: new FakeLlm(respuestaPlan), propuesta: "# Propuesta", hoy: "2026-10-09" });
  confirmarPlan({ config, hoy: "2026-10-09" });
  assert.equal(parsearPlan(leer(r.dir, "plan.md"), "2026-10-09")?.tareas.length, 3);
});

test("--confirmar sin propuesta da un error claro", () => {
  assert.throws(() => confirmarPlan({ config, hoy: "2026-10-09" }), (e: unknown) => e instanceof ErrorUsuario && /No hay una propuesta/.test(e.message));
});

test("confirmar tras corregir a mano 5min por 5d reparte con 5 días", () => {
  const r = crearRepo();
  r.escribir(".rastro/plan.sugerido.md", "## Plan semana 05/10\n- **Entregable del viernes:** Demo.\n- [ ] **Central:** Recibir snapshots. · 5min\n");
  const corregido = leer(r.dir, "plan.sugerido.md").replace("5min", "5d");
  r.escribir(".rastro/plan.sugerido.md", corregido);
  confirmarPlan({ config, hoy: "2026-10-05" });
  const tarea = parsearPlan(leer(r.dir, "plan.md"), "2026-10-05")?.tareas[0];
  assert.deepEqual(tarea?.duracion, d(5, "d"));
  assert.deepEqual(tarea?.dias, ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
  assert.match(leer(r.dir, "plan.md"), /· 5d · lun–vie$/m);
});

test("confirmar un miércoles nunca asigna lunes ni martes a lo que todavía no tenía días", () => {
  const r = crearRepo();
  r.escribir(".rastro/plan.sugerido.md", "## Plan semana 05/10\n- **Entregable del viernes:** Demo.\n- [ ] **Central:** Recibir snapshots. · 2d\n");
  confirmarPlan({ config, hoy: "2026-10-07" });
  assert.deepEqual(parsearPlan(leer(r.dir, "plan.md"), "2026-10-07")?.tareas[0]?.dias, ["2026-10-07", "2026-10-08"]);
});

test("confirmar un miércoles no mueve a la pendiente que ya empezó en el plan vigente, salvo que se haya cambiado su duración", () => {
  const r = crearRepo();
  const propuesta = (duracion: string) => `## Plan semana 05/10\n- **Entregable del viernes:** Demo.\n- [ ] **Central:** Recibir snapshots. · ${duracion} · lun–mar\n`;
  r.escribir(".rastro/plan.md", propuesta("2d"));
  r.escribir(".rastro/plan.sugerido.md", propuesta("2d"));
  guardarBase("2026-10-05", [{ slug: "central", duracion: d(2, "d"), dias: ["2026-10-05", "2026-10-06"] }]);
  confirmarPlan({ config, hoy: "2026-10-07" });
  assert.deepEqual(parsearPlan(leer(r.dir, "plan.md"), "2026-10-07")?.tareas[0]?.dias, ["2026-10-05", "2026-10-06"]);
  r.escribir(".rastro/plan.sugerido.md", propuesta("4d"));
  guardarBase("2026-10-05", [{ slug: "central", duracion: d(2, "d"), dias: ["2026-10-05", "2026-10-06"] }]);
  confirmarPlan({ config, hoy: "2026-10-07" });
  assert.deepEqual(parsearPlan(leer(r.dir, "plan.md"), "2026-10-07")?.tareas[0]?.dias, ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
});

test("una propuesta del lunes confirmada el miércoles se reparte desde el miércoles y no nace con tareas atrasadas", () => {
  const r = crearRepo();
  r.escribir(".rastro/plan.sugerido.md", "## Plan semana 05/10\n- **Entregable del viernes:** Demo.\n- [ ] **Central:** Recibir snapshots. · 2d · lun–mar\n");
  guardarBase("2026-10-05", [{ slug: "central", duracion: d(2, "d"), dias: ["2026-10-05", "2026-10-06"] }]);
  confirmarPlan({ config, hoy: "2026-10-07" });
  const plan = parsearPlan(leer(r.dir, "plan.md"), "2026-10-07");
  assert.deepEqual(plan?.tareas[0]?.dias, ["2026-10-07", "2026-10-08"]);
  assert.deepEqual(plan === null ? [] : tareasAtrasadas(plan, "2026-10-07"), []);
});

test("confirmar respeta los días corregidos a mano en la propuesta y reparte el resto alrededor", () => {
  const r = crearRepo();
  r.escribir(".rastro/plan.sugerido.md", "## Plan semana 05/10\n- **Entregable del viernes:** Demo.\n- [ ] **Uno:** Algo. · 1d · vie\n- [ ] **Dos:** Otro. · 4h · jue\n- [ ] **Tres:** Sin días. · 1d\n");
  confirmarPlan({ config, hoy: "2026-10-05" });
  const tareas = parsearPlan(leer(r.dir, "plan.md"), "2026-10-05")?.tareas ?? [];
  assert.deepEqual(tareas.map((t) => t.dias), [["2026-10-09"], ["2026-10-08"], ["2026-10-05"]]);
});

test("confirmar respeta los días fijados con `plan cambiar dia` aunque la propuesta diga otra cosa", () => {
  const r = crearRepo();
  r.escribir(".rastro/plan.sugerido.md", "## Plan semana 05/10\n- **Entregable del viernes:** Demo.\n- [ ] **Uno:** Algo. · 1d · lun\n- [ ] **Dos:** Otro. · 1d · mar\n");
  r.escribir(".rastro/fijados.json", JSON.stringify({ "2026-10-05": { uno: ["2026-10-08"] } }));
  confirmarPlan({ config, hoy: "2026-10-05" });
  assert.deepEqual(parsearPlan(leer(r.dir, "plan.md"), "2026-10-05")?.tareas.map((t) => t.dias), [["2026-10-08"], ["2026-10-06"]]);
});

test("confirmar conserva los días de las tareas hechas, los sub-bullets y el Cierre de la semana", () => {
  const r = crearRepo();
  r.escribir(
    ".rastro/plan.md",
    "## Plan semana 05/10\n- **Entregable del viernes:** Viejo.\n- [x] **Uno:** Hecha. · 1d · lun\n  - 07/10: nota mía\n- [ ] **Dos:** Sigue. · 1d\n- **Cierre (09/10):** Entregado.\n\n## Plan semana 28/09\n- [ ] **Anterior:** Sigue igual.\n",
  );
  r.escribir(".rastro/plan.sugerido.md", "## Plan semana 05/10\n- **Entregable del viernes:** Demo.\n- [x] **Uno:** Hecha. · 1d · lun\n- [ ] **Dos:** Sigue. · 1d\n");
  confirmarPlan({ config, hoy: "2026-10-08" });
  const md = leer(r.dir, "plan.md");
  assert.match(md, /^- \[x\] \*\*Uno:\*\* Hecha\. · 1d · lun\n {2}- 07\/10: nota mía\n- \[ \] \*\*Dos:\*\*/m);
  assert.match(md, /^- \*\*Cierre \(09\/10\):\*\* Entregado\.$/m);
  assert.match(md, /^## Plan semana 28\/09\n- \[ \] \*\*Anterior:\*\* Sigue igual\.$/m);
  assert.deepEqual(parsearPlan(md, "2026-10-08")?.tareas.map((t) => t.dias), [["2026-10-05"], ["2026-10-08"]]);
});

test("confirmar avisa con un warn de cada tarea pendiente que quedó sin duración", () => {
  const r = crearRepo();
  r.escribir(".rastro/plan.sugerido.md", "## Plan semana 05/10\n- [ ] **Uno:** Algo. · 5 días\n- [x] **Dos:** Hecha.\n");
  const escrito: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((t: string) => (escrito.push(t), true)) as typeof process.stderr.write;
  try {
    confirmarPlan({ config, hoy: "2026-10-05" });
  } finally {
    process.stderr.write = original;
  }
  assert.deepEqual(escrito.filter((l) => l.includes("tarea_sin_duracion")).map((l) => /tarea="([^"]+)"/.exec(l)?.[1]), ["uno"]);
});

test("el texto de la propuesta avisa cuando reemplaza a la anterior y solo entonces", () => {
  const base = { archivo: ".rastro/plan.sugerido.md", tareas: [{ nombre: "Uno", objetivo: "x" }] };
  assert.match(textoDePropuesta({ ...base, reemplazo: true }), /^Se reemplazó la propuesta anterior\.\n/);
  assert.doesNotMatch(textoDePropuesta({ ...base, reemplazo: false }), /reemplazó/);
});

test("rearmar la propuesta avisa que reemplaza la anterior", async () => {
  const r = crearRepo();
  const primera = await armarPlan({ nombre: "test", config, llm: new FakeLlm(respuestaPlan), propuesta: "# A", hoy: "2026-10-09" });
  const segunda = await armarPlan({ nombre: "test", config, llm: new FakeLlm(respuestaPlan), propuesta: "# B", hoy: "2026-10-09" });
  assert.deepEqual([primera.reemplazo, segunda.reemplazo], [false, true]);
});

test("una propuesta de otra semana no se confirma", () => {
  const r = crearRepo();
  r.escribir(".rastro/plan.sugerido.md", "## Plan semana 28/09\n- [ ] **Central:** Recibir. · 1d\n");
  assert.throws(() => confirmarPlan({ config, hoy: "2026-10-09" }), ErrorUsuario);
});

test("sin LLM disponible, el plan falla con un mensaje para el usuario", async () => {
  await assert.rejects(armarPlan({ nombre: "test", config, llm: new FakeLlm("falla"), propuesta: "x", hoy: "2026-10-09" }), ErrorUsuario);
});

test("--sugerir guarda los ofrecimientos con su porqué y no toca el plan ni la propuesta", async () => {
  const r = crearRepo();
  escribirConfig(config);
  const ahora = new Date("2026-10-07T15:00:00Z");
  const hoy = fechaLocal(ahora, "America/Argentina/Buenos_Aires");
  r.escribir(".gitignore", ".rastro/\n");
  const planMd = `## Plan semana ${ddmm(lunesDe(hoy))}\n- **Entregable del viernes:** Demo.\n- [x] **Bitácora:** Registrar.\n`;
  r.escribir(".rastro/plan.md", planMd);
  r.commit("script de deploy a staging", "2026-10-07T14:00:00Z");
  const llm = new FakeLlm({
    "sugerir-plan": {
      tareas: [
        { nombre: "Deploy", objetivo: "Automatizar el deploy a staging.", duracion: d(4, "h"), porque: "Hubo un script de deploy fuera del plan." },
        { nombre: "Bitácora", objetivo: "Ya existe.", duracion: d(1, "h"), porque: "Repetida." },
      ],
    },
  });
  const res = await sugerirTareas({ repo: r.dir, nombre: "test", config, llm, ahora });
  assert.equal(res.nuevas, 1);
  assert.deepEqual(JSON.parse(leer(r.dir, "ofrecimientos.json")), [
    { id: "deploy", nombre: "Deploy", objetivo: "Automatizar el deploy a staging.", duracion: d(4, "h"), porque: "Hubo un script de deploy fuera del plan.", estado: "pendiente", repo: "test" },
  ]);
  assert.equal(existsSync(join(r.dir, ".rastro/plan.sugerido.md")), false);
  assert.equal(leer(r.dir, "plan.md"), planMd);
  assert.match(llm.prompts[0] ?? "", /porque/);
});

test("un ofrecimiento descartado no vuelve a proponerse con el mismo slug", async () => {
  const r = crearRepo();
  escribirConfig(config);
  const ahora = new Date("2026-10-07T15:00:00Z");
  const hoy = fechaLocal(ahora, "America/Argentina/Buenos_Aires");
  r.escribir(".gitignore", ".rastro/\n");
  r.escribir(".rastro/plan.md", `## Plan semana ${ddmm(lunesDe(hoy))}\n- **Entregable del viernes:** Demo.\n- [x] **Bitácora:** Registrar.\n`);
  r.commit("script de deploy a staging", "2026-10-07T14:00:00Z");
  const respuesta = { "sugerir-plan": { tareas: [{ nombre: "Deploy", objetivo: "Automatizar.", duracion: d(4, "h"), porque: "Sí." }] } };
  await sugerirTareas({ repo: r.dir, nombre: "test", config, llm: new FakeLlm(respuesta), ahora });
  aplicarCambios({ repos: [r.dir], config, cambios: [{ tipo: "ofrecimiento", id: "deploy", accion: "descartar" }], destino: "vigente", confirmar: true, hoy });
  const otra = await sugerirTareas({ repo: r.dir, nombre: "test", config, llm: new FakeLlm(respuesta), ahora });
  assert.equal(otra.nuevas, 0);
  assert.deepEqual((JSON.parse(leer(r.dir, "ofrecimientos.json")) as { estado: string }[]).map((x) => x.estado), ["descartado"]);
});

test("aceptar un ofrecimiento agrega la tarea al plan, la reparte y la saca de los ofrecimientos", () => {
  const r = crearRepo();
  r.escribir(".rastro/plan.md", "## Plan semana 05/10\n- **Entregable del viernes:** Demo.\n- [ ] **Uno:** Algo. · 1d · lun\n  - nota mía\n- **Cierre (09/10):** Nada.\n");
  r.escribir(".rastro/ofrecimientos.json", JSON.stringify([{ id: "deploy", nombre: "Deploy", objetivo: "Automatizar.", duracion: d(1, "d"), porque: "Sí.", estado: "pendiente" }]));
  const res = aplicarCambios({ repos: [r.dir], config, cambios: [{ tipo: "ofrecimiento", id: "deploy", accion: "aceptar" }], destino: "vigente", confirmar: true, hoy: "2026-10-05" });
  assert.equal(res.aplicado, true);
  const md = leer(r.dir, "plan.md");
  assert.match(md, /^- \[ \] \*\*Uno:\*\* Algo\. · 1d · lun\n {2}- nota mía\n- \[ \] \*\*Deploy:\*\* Automatizar\. · 1d · mar\n- \*\*Cierre/m);
  assert.deepEqual(JSON.parse(leer(r.dir, "ofrecimientos.json")), []);
});

test("aceptar o descartar un ofrecimiento que no existe da un error claro", () => {
  const r = crearRepo();
  r.escribir(".rastro/plan.md", "## Plan semana 05/10\n- **Entregable del viernes:** Demo.\n- [ ] **Uno:** Algo. · 1d\n");
  assert.throws(
    () => aplicarCambios({ repos: [r.dir], config, cambios: [{ tipo: "ofrecimiento", id: "nada", accion: "aceptar" }], destino: "vigente", confirmar: true, hoy: "2026-10-05" }),
    (e: unknown) => e instanceof ErrorUsuario && /ofrecimiento pendiente/.test(e.message),
  );
});

const propuestaConUnaTarea = async (r: ReturnType<typeof crearRepo>) => {
  const llm = new FakeLlm({ plan: { entregable: "Demo.", tareas: [{ nombre: "Central", objetivo: "Recibir.", duracion: d(1, "h") }, { nombre: "Otra", objetivo: "Algo.", duracion: d(1, "h") }] } });
  await armarPlan({ nombre: "test", config, llm, propuesta: "# P", hoy: "2026-10-05" });
};

test("corregir 1h por 5d sin tocar los días y confirmar reparte la tarea en 5 días", async () => {
  const r = crearRepo();
  await propuestaConUnaTarea(r);
  assert.match(leer(r.dir, "plan.sugerido.md"), /\*\*Central:\*\* Recibir\. · 1h · lun · repo:test$/m);
  r.escribir(".rastro/plan.sugerido.md", leer(r.dir, "plan.sugerido.md").replace("· 1h · lun", "· 5d · lun"));
  confirmarPlan({ config, hoy: "2026-10-05" });
  const tareas = parsearPlan(leer(r.dir, "plan.md"), "2026-10-05")?.tareas ?? [];
  assert.deepEqual(tareas[0]?.dias, ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
  assert.equal(existsSync(join(r.dir, ".rastro/fijados.json")), false);
  assert.equal(existsSync(join(r.dir, ".rastro/plan.base.json")), false);
});

test("cambiar los días a mano en la propuesta y confirmar los deja fijados", async () => {
  const r = crearRepo();
  await propuestaConUnaTarea(r);
  r.escribir(".rastro/plan.sugerido.md", leer(r.dir, "plan.sugerido.md").replace("Recibir. · 1h · lun", "Recibir. · 1h · jue"));
  confirmarPlan({ config, hoy: "2026-10-05" });
  const tareas = parsearPlan(leer(r.dir, "plan.md"), "2026-10-05")?.tareas ?? [];
  assert.deepEqual(tareas.map((t) => t.dias), [["2026-10-08"], ["2026-10-05"]]);
  assert.deepEqual(JSON.parse(leer(r.dir, "fijados.json")), { "2026-10-05": { central: ["2026-10-08"] } });
});

test("una tarea nueva escrita en la propuesta con base se reparte aunque traiga días", async () => {
  const r = crearRepo();
  await propuestaConUnaTarea(r);
  r.escribir(".rastro/plan.sugerido.md", `${leer(r.dir, "plan.sugerido.md")}- [ ] **Nueva:** A mano. · 2d · vie\n`);
  confirmarPlan({ config, hoy: "2026-10-05" });
  const nueva = parsearPlan(leer(r.dir, "plan.md"), "2026-10-05")?.tareas.find((t) => t.slug === "nueva");
  // Lunes ya tiene horas ocupadas por las otras tareas, así que 2d abarcan hasta el miércoles; lo que importa es que no quedó el viernes escrito.
  assert.deepEqual(nueva?.dias, ["2026-10-05", "2026-10-06", "2026-10-07"]);
});

test("sin base valen los días escritos en la propuesta y se reparten las demás", () => {
  const r = crearRepo();
  r.escribir(".rastro/plan.sugerido.md", "## Plan semana 05/10\n- **Entregable del viernes:** Demo.\n- [ ] **Uno:** A. · 1d · vie\n- [ ] **Dos:** B. · 1d\n");
  confirmarPlan({ config, hoy: "2026-10-05" });
  assert.deepEqual(parsearPlan(leer(r.dir, "plan.md"), "2026-10-05")?.tareas.map((t) => t.dias), [["2026-10-09"], ["2026-10-05"]]);
});
