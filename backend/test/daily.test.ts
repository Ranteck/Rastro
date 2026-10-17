import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { aplicarCambios } from "../src/cambios.ts";
import { configPorDefecto, escribirConfig } from "../src/config.ts";
import { validarSnapshot, type Snapshot } from "../src/contract/snapshot.ts";
import { generarSnapshot, reposObservados, textoDelDia } from "../src/daily.ts";
import { agregarEvento } from "../src/eventos.ts";
import { ddmm, fechaLocal, lunesDe } from "../src/fechas.ts";
import { leerTranscript, tituloDeSesion } from "../src/fuentes/claudeCode.ts";
import { pedidoVinculos } from "../src/llm/usos.ts";
import { FakeLlm } from "./helpers/fakeLlm.ts";
import { crearRepoRegistrado, type RepoTemporal } from "./helpers/repo.ts";

const ZONA = "America/Argentina/Buenos_Aires";
const config = configPorDefecto({ id: "test", nombre: "Test", equipo: "QA" });
const resumenOk = { hice: ["Se hizo algo."], avance: [], sigue: ["Revisar algo."], bloqueos: [] };

function repoConPlan(): RepoTemporal {
  const r = crearRepoRegistrado();
  escribirConfig(config);
  const hoy = fechaLocal(new Date(), ZONA);
  r.escribir(".gitignore", ".rastro/\n");
  r.escribir(
    ".rastro/plan.md",
    [
      `## Plan semana ${ddmm(lunesDe(hoy))}`,
      "- **Entregable del viernes:** Demo.",
      "- [ ] **Pendientes:** Detectar lo resuelto.",
      "- [x] **Bitácora:** Registrar el día.",
      "- [ ] **Central:** Recibir snapshots.",
      "",
    ].join("\n"),
  );
  r.commit("inicio");
  return r;
}

test("resuelto sin cerrar de punta a punta, con la bitácora y su evidencia", async () => {
  const r = repoConPlan();
  r.git("checkout", "-q", "-b", "feat/pendientes");
  r.escribir("src/detector.ts", "export const x = 1;\n");
  const enRama = r.commit("[Pendientes] detector");
  r.git("checkout", "-q", "main");
  r.git("merge", "-q", "--no-ff", "feat/pendientes", "-m", "Merge branch 'feat/pendientes'");
  const merge = r.git("rev-parse", "HEAD");

  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: new Date() });

  const p = snapshot.pendientes.find((x) => x.tipo === "resuelto-sin-cerrar");
  assert.equal(p?.tarea, "pendientes");
  assert.equal(p?.proximoPaso, "Tildar Pendientes en el plan.");
  assert.ok(p?.evidencia.some((e) => e.ref === merge.slice(0, 7)));
  const entrada = snapshot.bitacora.find((e) => e.evidencia.some((x) => x.ref === enRama.slice(0, 7)));
  assert.equal(entrada?.rama, "feat/pendientes");
  assert.equal(entrada?.vinculo, "nombre");
  assert.deepEqual(entrada?.evidencia[1], { tipo: "rama", ref: "feat/pendientes" });
  assert.equal(snapshot.resumen, null);
  assert.equal(snapshot.gantt.mock, false);
});

test("las sesiones de Claude Code entran a la bitácora con su título", async () => {
  const r = repoConPlan();
  const transcript = join(r.dir, ".rastro", "t.jsonl");
  writeFileSync(transcript, `${JSON.stringify({ type: "ai-title", aiTitle: "Armar el detector de [Pendientes]", sessionId: "s1" })}\n`);
  agregarEvento(join(r.dir, ".rastro", "events.jsonl"), { tipo: "sesion", id: "s1234567890", transcript, rama: "main", en: new Date().toISOString() });
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: new Date() });
  const sesion = snapshot.bitacora.find((e) => e.evidencia[0]?.tipo === "sesion");
  assert.equal(sesion?.texto, "Sesión de Claude Code: Armar el detector de [Pendientes].");
  assert.equal(sesion?.tarea, "pendientes");
  assert.deepEqual(sesion?.evidencia, [{ tipo: "sesion", ref: "s1234567" }]);
});

test("sin LLM un commit sin etiqueta queda sin tarea; con LLM se infiere y se marca", async () => {
  const r = repoConPlan();
  const sha = r.commit("fix parser");
  const sinLlm = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: new Date() });
  assert.equal(sinLlm.snapshot.bitacora.find((e) => e.texto === "fix parser")?.vinculo, "sin-tarea");

  const llm = new FakeLlm({
    vinculos: { vinculos: [{ sha, tarea: "central", razon: "Toca el parser del central." }] },
    bitacora: { entradas: [], resumen: resumenOk },
  });
  const conLlm = await generarSnapshot({ repos: reposObservados(), config, llm, ahora: new Date() });
  const e = conLlm.snapshot.bitacora.find((x) => x.texto === "fix parser");
  assert.equal(e?.vinculo, "inferido");
  assert.equal(e?.tarea, "central");
  assert.equal(e?.razon, "Toca el parser del central.");
});

test("una corrección de vínculo manda sobre el tag y la inferencia, y el LLM no ve ese commit", async () => {
  const r = repoConPlan();
  const corregido = r.commit("fix parser del central");
  const aSinTarea = r.commit("[Pendientes] detector");
  const libre = r.commit("fix logger");
  const hoy = fechaLocal(new Date(), ZONA);
  aplicarCambios({
    repos: [r.dir],
    config,
    cambios: [
      { tipo: "vinculo", commit: corregido.slice(0, 7), tarea: "central" },
      { tipo: "vinculo", commit: aSinTarea, tarea: null },
    ],
    destino: "vigente",
    confirmar: true,
    hoy,
  });
  const llm = new FakeLlm({
    vinculos: { vinculos: [{ sha: libre, tarea: "bitacora", razon: "Toca el logger." }, { sha: corregido, tarea: "bitacora", razon: "Ignorada." }] },
    bitacora: { entradas: [], resumen: resumenOk },
  });
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm, ahora: new Date() });
  const entrada = (texto: string) => snapshot.bitacora.find((e) => e.texto === texto);
  assert.deepEqual([entrada("fix parser del central")?.vinculo, entrada("fix parser del central")?.tarea], ["corregido", "central"]);
  assert.deepEqual([entrada("[Pendientes] detector")?.vinculo, entrada("[Pendientes] detector")?.tarea], ["corregido", null]);
  assert.deepEqual([entrada("fix logger")?.vinculo, entrada("fix logger")?.tarea], ["inferido", "bitacora"]);
  const pedidoVinculos = llm.prompts.find((p) => p.includes("fix logger")) ?? "";
  assert.ok(!pedidoVinculos.includes("fix parser del central") && !pedidoVinculos.includes("[Pendientes] detector"));
});

test("con LLM hay resumen, y lo que quedó sin actividad aparece en sigue", async () => {
  const r = repoConPlan();
  r.commit("[Pendientes] avance");
  const llm = new FakeLlm({
    vinculos: { vinculos: [] },
    bitacora: { entradas: [{ id: "0", texto: "Se avanzó con el detector." }], resumen: resumenOk },
  });
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm, ahora: new Date() });
  assert.deepEqual(snapshot.desvios.tareasSinActividad, ["central"]);
  assert.ok(snapshot.resumen?.sigue.includes("Central no tuvo actividad esta semana."));
  assert.ok(snapshot.resumen?.sigue.includes("Revisar algo."));
  assert.ok(snapshot.bitacora.some((e) => e.texto === "Se avanzó con el detector."));
  assert.equal(snapshot.costo.llamadas, 2);
});

test("con el LLM caído no hay resumen pero los pendientes salen completos", async () => {
  const r = repoConPlan();
  const { snapshot, avisos } = await generarSnapshot({ repos: reposObservados(), config, llm: new FakeLlm("falla"), ahora: new Date() });
  assert.equal(snapshot.resumen, null);
  assert.ok(snapshot.pendientes.some((p) => p.tipo === "cerrado-sin-evidencia" && p.tarea === "bitacora"));
  assert.ok(avisos.some((a) => a.startsWith("Sin vínculos inferidos")));
});

test("ningún secreto de un commit llega al prompt del LLM", async () => {
  const r = repoConPlan();
  const token = `ghp_${"b".repeat(36)}`;
  r.commit(`[Central] config con GITHUB_TOKEN=${token}`);
  const llm = new FakeLlm({ vinculos: { vinculos: [] }, bitacora: { entradas: [], resumen: resumenOk } });
  await generarSnapshot({ repos: reposObservados(), config, llm, ahora: new Date() });
  assert.ok(llm.prompts.length > 0);
  assert.ok(llm.prompts.every((p) => !p.includes(token)));
});

test("un repo sin commits ni plan produce un snapshot vacío y válido", async () => {
  const r = crearRepoRegistrado();
  escribirConfig(config);
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: new Date() });
  assert.deepEqual([snapshot.bitacora, snapshot.pendientes, snapshot.plan], [[], [], null]);
});

test("un repo con HEAD separado produce un snapshot válido sin excepción", async () => {
  const r = repoConPlan();
  r.git("checkout", "-q", "--detach");
  r.commit("[Central] trabajo suelto");
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: new Date() });
  // El commit hecho con HEAD separado no es alcanzable desde ninguna rama, así que no se recolecta; el resto sí.
  assert.ok(snapshot.bitacora.some((e) => e.texto === "inicio"));
  assert.doesNotThrow(() => validarSnapshot(snapshot));
});

test("el snapshot de un repo con actividad valida contra el contrato", async () => {
  const r = repoConPlan();
  r.commit("[Central] avance");
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: new Date() });
  assert.doesNotThrow(() => validarSnapshot(JSON.parse(JSON.stringify(snapshot))));
});

test("un commit que toca README o docs/ suma la evidencia de doc", async () => {
  const r = repoConPlan();
  r.escribir("README.md", "# hola\n");
  r.escribir("docs/uso.md", "uso\n");
  r.escribir("src/a.ts", "export {};\n");
  r.commit("[Central] documentar");
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: new Date() });
  const e = snapshot.bitacora.find((x) => x.texto === "[Central] documentar");
  assert.deepEqual(
    e?.evidencia.filter((x) => x.tipo === "doc"),
    [
      { tipo: "doc", ref: "README.md" },
      { tipo: "doc", ref: "docs/uso.md" },
    ],
  );
});

test("el prompt sigue siendo JSON válido después de redactar", async () => {
  const pedido = pedidoVinculos({
    commits: [{ sha: "abc", asunto: `usa "comillas" y GITHUB_TOKEN=ghp_${"c".repeat(36)}`, archivos: ["a\\b.ts"] }],
    tareas: [{ slug: "central", nombre: "Central", objetivo: "Recibir." }],
  });
  const json = pedido.prompt.slice(pedido.prompt.indexOf("Datos (JSON):\n") + "Datos (JSON):\n".length);
  const datos = JSON.parse(json) as { commits: { asunto: string }[] };
  assert.ok(!datos.commits[0]?.asunto.includes("ghp_"));
});

test("las líneas ilegibles de un transcript se saltean y se cuentan", () => {
  const dir = mkdtempSync(join(tmpdir(), "rastro-transcript-"));
  const archivo = join(dir, "t.jsonl");
  writeFileSync(
    archivo,
    [
      JSON.stringify({ type: "ai-title", aiTitle: "Primero" }),
      '{"type":"ai-ti',
      "[1,2]",
      JSON.stringify({ type: "user", message: "hola" }),
      JSON.stringify({ type: "ai-title", aiTitle: "Último" }),
      "",
    ].join("\n"),
  );
  assert.deepEqual(leerTranscript(archivo), { titulo: "Último", ilegibles: 2 });
  assert.equal(tituloDeSesion(archivo), "Último");
  assert.equal(tituloDeSesion(join(dir, "no-existe.jsonl")), null);
});

test("el texto del día lista las tareas sin actividad también sin resumen", () => {
  const s = validarSnapshot(JSON.parse(readFileSync(new URL("../../frontend/ejemplos/persona-denis.json", import.meta.url), "utf8"))) as Snapshot;
  const nombre = s.plan?.tareas.find((t) => t.slug === "repeticiones")?.nombre;
  assert.ok(nombre !== undefined);
  for (const resumen of [s.resumen, null]) {
    assert.match(textoDelDia({ ...s, resumen }), new RegExp(`^Sin actividad: ${nombre}$`, "m"));
  }
  assert.doesNotMatch(textoDelDia({ ...s, desvios: { ...s.desvios, tareasSinActividad: [] } }), /Sin actividad/);
});

const PLAN_CON_REPARTO = [
  "## Plan semana 05/10",
  "- **Entregable del viernes:** Demo.",
  "- [ ] **Bitácora:** Registrar el día. · 2d · lun–mar",
  "- [ ] **Central:** Recibir snapshots. · 1d · jue",
  "- [ ] **Jira:** Publicar. · 1d · vie",
  "",
].join("\n");

function repoConReparto(plan = PLAN_CON_REPARTO): RepoTemporal {
  const r = crearRepoRegistrado();
  r.escribir(".gitignore", ".rastro/\n");
  r.escribir(".rastro/plan.md", plan);
  r.commit("inicio", "2026-10-05T12:00:00Z");
  return r;
}

const MIERCOLES = new Date("2026-10-07T15:00:00Z");

test("el Gantt sale de los días del plan y de la evidencia, y deja de ser mock", async () => {
  const r = repoConReparto();
  r.commit("[Bitácora] primera", "2026-10-06T15:00:00Z");
  r.commit("arreglo suelto", "2026-10-07T13:00:00Z");
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: MIERCOLES });
  assert.equal(snapshot.gantt.mock, false);
  const barra = (tarea: string) => snapshot.gantt.barras.find((b) => b.tarea === tarea);
  assert.deepEqual(barra("bitacora"), { tarea: "bitacora", plan: { desde: "2026-10-05", hasta: "2026-10-06" }, real: { desde: "2026-10-06", hasta: "2026-10-06" }, atrasada: true });
  assert.deepEqual(barra("central")?.plan, { desde: "2026-10-08", hasta: "2026-10-08" });
  assert.equal(barra("central")?.atrasada, false);
  // El commit "inicio" y el arreglo suelto no tienen tarea: una sola barra fantasma por rama, con real y sin plan.
  assert.deepEqual(snapshot.gantt.barras.filter((b) => b.plan === null), [{ tarea: "main", plan: null, real: { desde: "2026-10-05", hasta: "2026-10-07" }, atrasada: false, repo: basename(r.dir) }]);
});

test("una tarea sin días tiene plan null en el Gantt", async () => {
  const r = repoConReparto("## Plan semana 05/10\n- **Entregable del viernes:** Demo.\n- [ ] **Bitácora:** Registrar.\n");
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: MIERCOLES });
  assert.deepEqual(snapshot.gantt.barras.find((b) => b.tarea === "bitacora"), { tarea: "bitacora", plan: null, real: null, atrasada: false });
});

test("atraso: el miércoles la pendiente sugerida para lun–mar está atrasada; hecha o el martes, no", async () => {
  const r = repoConReparto();
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: MIERCOLES });
  assert.deepEqual(snapshot.desvios.tareasAtrasadas, ["bitacora"]);
  assert.equal(snapshot.desvios.alerta, true);
  const martes = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: new Date("2026-10-06T15:00:00Z") });
  assert.deepEqual(martes.snapshot.desvios.tareasAtrasadas, []);
  const hecha = repoConReparto(PLAN_CON_REPARTO.replace("- [ ] **Bitácora", "- [x] **Bitácora"));
  const sinAtraso = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: MIERCOLES });
  assert.deepEqual(sinAtraso.snapshot.desvios.tareasAtrasadas, []);
  assert.equal(sinAtraso.snapshot.gantt.barras.find((b) => b.tarea === "bitacora")?.atrasada, false);
});

test("foco: actual es la tarea del último commit vinculado y siguiente la pendiente más cercana", async () => {
  const r = repoConReparto();
  r.commit("[Jira] algo", "2026-10-05T15:00:00Z");
  r.commit("[Bitácora] otro", "2026-10-06T15:00:00Z");
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: MIERCOLES });
  assert.deepEqual(snapshot.foco, { actual: "bitacora", siguiente: "central" });
});

test("foco sin commits vinculados: actual null; con todo hecho: siguiente null", async () => {
  repoConReparto();
  const sin = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: MIERCOLES });
  assert.deepEqual(sin.snapshot.foco, { actual: null, siguiente: "central" });
  const hecho = repoConReparto(PLAN_CON_REPARTO.replaceAll("- [ ]", "- [x]"));
  const todo = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: MIERCOLES });
  assert.deepEqual(todo.snapshot.foco, { actual: null, siguiente: null });
});

test("foco: si ninguna pendiente tiene días por venir, siguiente es la primera del plan distinta de actual", async () => {
  const r = repoConReparto("## Plan semana 05/10\n- **Entregable del viernes:** Demo.\n- [ ] **Uno:** A.\n- [ ] **Dos:** B.\n");
  r.commit("[Uno] algo", "2026-10-06T15:00:00Z");
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: MIERCOLES });
  assert.deepEqual(snapshot.foco, { actual: "uno", siguiente: "dos" });
});

test("el snapshot trae solo los ofrecimientos pendientes, sin el estado interno", async () => {
  const r = repoConReparto();
  const o = { nombre: "Deploy", objetivo: "Automatizar.", duracion: null, porque: "Sí." };
  r.escribir(".rastro/ofrecimientos.json", JSON.stringify([{ id: "deploy", ...o, estado: "pendiente" }, { id: "otro", ...o, nombre: "Otro", estado: "descartado" }]));
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: MIERCOLES });
  assert.deepEqual(snapshot.ofrecimientos, [{ id: "deploy", ...o }]);
});

test("zona horaria: a las 23:00 del miércoles en Buenos Aires (jueves en UTC) la de lun–mar está atrasada y la del jueves no", async () => {
  const r = repoConReparto();
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: new Date("2026-10-08T02:00:00Z") });
  assert.deepEqual(snapshot.desvios.tareasAtrasadas, ["bitacora"]);
  const martes = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: new Date("2026-10-07T02:30:00Z") });
  assert.deepEqual(martes.snapshot.desvios.tareasAtrasadas, []);
});

test("un ofrecimiento cuya tarea ya está en el plan no viaja en el snapshot", async () => {
  const r = repoConReparto();
  const oferta = (id: string) => ({ id, nombre: id, objetivo: "x", duracion: null, porque: "y", estado: "pendiente" });
  r.escribir(".rastro/ofrecimientos.json", JSON.stringify([oferta("bitacora"), oferta("deploy")]));
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: MIERCOLES });
  assert.deepEqual(snapshot.ofrecimientos.map((x) => x.id), ["deploy"]);
});
