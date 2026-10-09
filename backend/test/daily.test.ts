import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPorDefecto, escribirConfig } from "../src/config.ts";
import { validarSnapshot, type Snapshot } from "../src/contract/snapshot.ts";
import { generarSnapshot, textoDelDia } from "../src/daily.ts";
import { agregarEvento } from "../src/eventos.ts";
import { ddmm, fechaLocal, lunesDe } from "../src/fechas.ts";
import { leerTranscript, tituloDeSesion } from "../src/fuentes/claudeCode.ts";
import { pedidoVinculos } from "../src/llm/usos.ts";
import { FakeLlm } from "./helpers/fakeLlm.ts";
import { crearRepo, type RepoTemporal } from "./helpers/repo.ts";

const ZONA = "America/Argentina/Buenos_Aires";
const config = configPorDefecto({ id: "test", nombre: "Test", equipo: "QA" });
const resumenOk = { hice: ["Se hizo algo."], avance: [], sigue: ["Revisar algo."], bloqueos: [] };

function repoConPlan(): RepoTemporal {
  const r = crearRepo();
  escribirConfig(r.dir, config);
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

  const { snapshot } = await generarSnapshot({ repo: r.dir, config, llm: null, ahora: new Date() });

  const p = snapshot.pendientes.find((x) => x.tipo === "resuelto-sin-cerrar");
  assert.equal(p?.tarea, "pendientes");
  assert.equal(p?.proximoPaso, "Tildar Pendientes en el plan.");
  assert.ok(p?.evidencia.some((e) => e.ref === merge.slice(0, 7)));
  const entrada = snapshot.bitacora.find((e) => e.evidencia.some((x) => x.ref === enRama.slice(0, 7)));
  assert.equal(entrada?.rama, "feat/pendientes");
  assert.equal(entrada?.vinculo, "nombre");
  assert.deepEqual(entrada?.evidencia[1], { tipo: "rama", ref: "feat/pendientes" });
  assert.equal(snapshot.resumen, null);
  assert.equal(snapshot.gantt.mock, true);
});

test("las sesiones de Claude Code entran a la bitácora con su título", async () => {
  const r = repoConPlan();
  const transcript = join(r.dir, ".rastro", "t.jsonl");
  writeFileSync(transcript, `${JSON.stringify({ type: "ai-title", aiTitle: "Armar el detector de [Pendientes]", sessionId: "s1" })}\n`);
  agregarEvento(join(r.dir, ".rastro", "events.jsonl"), { tipo: "sesion", id: "s1234567890", transcript, rama: "main", en: new Date().toISOString() });
  const { snapshot } = await generarSnapshot({ repo: r.dir, config, llm: null, ahora: new Date() });
  const sesion = snapshot.bitacora.find((e) => e.evidencia[0]?.tipo === "sesion");
  assert.equal(sesion?.texto, "Sesión de Claude Code: Armar el detector de [Pendientes].");
  assert.equal(sesion?.tarea, "pendientes");
  assert.deepEqual(sesion?.evidencia, [{ tipo: "sesion", ref: "s1234567" }]);
});

test("sin LLM un commit sin etiqueta queda sin tarea; con LLM se infiere y se marca", async () => {
  const r = repoConPlan();
  const sha = r.commit("fix parser");
  const sinLlm = await generarSnapshot({ repo: r.dir, config, llm: null, ahora: new Date() });
  assert.equal(sinLlm.snapshot.bitacora.find((e) => e.texto === "fix parser")?.vinculo, "sin-tarea");

  const llm = new FakeLlm({
    vinculos: { vinculos: [{ sha, tarea: "central", razon: "Toca el parser del central." }] },
    bitacora: { entradas: [], resumen: resumenOk },
  });
  const conLlm = await generarSnapshot({ repo: r.dir, config, llm, ahora: new Date() });
  const e = conLlm.snapshot.bitacora.find((x) => x.texto === "fix parser");
  assert.equal(e?.vinculo, "inferido");
  assert.equal(e?.tarea, "central");
  assert.equal(e?.razon, "Toca el parser del central.");
});

test("con LLM hay resumen, y lo que quedó sin actividad aparece en sigue", async () => {
  const r = repoConPlan();
  r.commit("[Pendientes] avance");
  const llm = new FakeLlm({
    vinculos: { vinculos: [] },
    bitacora: { entradas: [{ id: "0", texto: "Se avanzó con el detector." }], resumen: resumenOk },
  });
  const { snapshot } = await generarSnapshot({ repo: r.dir, config, llm, ahora: new Date() });
  assert.deepEqual(snapshot.desvios.tareasSinActividad, ["central"]);
  assert.ok(snapshot.resumen?.sigue.includes("Central no tuvo actividad esta semana."));
  assert.ok(snapshot.resumen?.sigue.includes("Revisar algo."));
  assert.ok(snapshot.bitacora.some((e) => e.texto === "Se avanzó con el detector."));
  assert.equal(snapshot.costo.llamadas, 2);
});

test("con el LLM caído no hay resumen pero los pendientes salen completos", async () => {
  const r = repoConPlan();
  const { snapshot, avisos } = await generarSnapshot({ repo: r.dir, config, llm: new FakeLlm("falla"), ahora: new Date() });
  assert.equal(snapshot.resumen, null);
  assert.ok(snapshot.pendientes.some((p) => p.tipo === "cerrado-sin-evidencia" && p.tarea === "bitacora"));
  assert.ok(avisos.some((a) => a.startsWith("Sin vínculos inferidos")));
});

test("ningún secreto de un commit llega al prompt del LLM", async () => {
  const r = repoConPlan();
  const token = `ghp_${"b".repeat(36)}`;
  r.commit(`[Central] config con GITHUB_TOKEN=${token}`);
  const llm = new FakeLlm({ vinculos: { vinculos: [] }, bitacora: { entradas: [], resumen: resumenOk } });
  await generarSnapshot({ repo: r.dir, config, llm, ahora: new Date() });
  assert.ok(llm.prompts.length > 0);
  assert.ok(llm.prompts.every((p) => !p.includes(token)));
});

test("un repo sin commits ni plan produce un snapshot vacío y válido", async () => {
  const r = crearRepo();
  escribirConfig(r.dir, config);
  const { snapshot } = await generarSnapshot({ repo: r.dir, config, llm: null, ahora: new Date() });
  assert.deepEqual([snapshot.bitacora, snapshot.pendientes, snapshot.plan], [[], [], null]);
});

test("un repo con HEAD separado produce un snapshot válido sin excepción", async () => {
  const r = repoConPlan();
  r.git("checkout", "-q", "--detach");
  r.commit("[Central] trabajo suelto");
  const { snapshot } = await generarSnapshot({ repo: r.dir, config, llm: null, ahora: new Date() });
  // El commit hecho con HEAD separado no es alcanzable desde ninguna rama, así que no se recolecta; el resto sí.
  assert.ok(snapshot.bitacora.some((e) => e.texto === "inicio"));
  assert.doesNotThrow(() => validarSnapshot(snapshot));
});

test("el snapshot de un repo con actividad valida contra el contrato", async () => {
  const r = repoConPlan();
  r.commit("[Central] avance");
  const { snapshot } = await generarSnapshot({ repo: r.dir, config, llm: null, ahora: new Date() });
  assert.doesNotThrow(() => validarSnapshot(JSON.parse(JSON.stringify(snapshot))));
});

test("un commit que toca README o docs/ suma la evidencia de doc", async () => {
  const r = repoConPlan();
  r.escribir("README.md", "# hola\n");
  r.escribir("docs/uso.md", "uso\n");
  r.escribir("src/a.ts", "export {};\n");
  r.commit("[Central] documentar");
  const { snapshot } = await generarSnapshot({ repo: r.dir, config, llm: null, ahora: new Date() });
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
