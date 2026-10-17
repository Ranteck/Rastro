import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { textoAviso, textoSiguiente } from "../src/aviso.ts";
import { escribirConfig, leerConfig } from "../src/config.ts";
import { BIN_RASTRO, inicializar } from "../src/init.ts";
import { crearRepo } from "./helpers/repo.ts";

const BIN = fileURLToPath(new URL("../bin/rastro.js", import.meta.url));

function repoConPlan(): ReturnType<typeof crearRepo> {
  const r = crearRepo();
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  r.escribir(
    ".rastro/plan.md",
    [
      "## Plan semana 05/10",
      "- **Entregable del viernes:** Demo.",
      "- [ ] **Bitácora:** Registrar. · 2d · lun–mar",
      "- [ ] **Central:** Recibir. · 1d · jue",
      "- [ ] **Dashboard:** Mostrar. · 3d · no entra",
      "",
    ].join("\n"),
  );
  r.commit("[Bitácora] inicio", "2026-10-05T15:00:00Z");
  return r;
}

test("aviso imprime el atraso con una tarea atrasada y nada cuando no hay desvío", () => {
  const r = repoConPlan();
  assert.equal(textoAviso(r.dir, new Date("2026-10-07T15:00:00Z")), "rastro: vas atrasado en Bitácora (terminaba el mar).\n");
  assert.equal(textoAviso(r.dir, new Date("2026-10-06T15:00:00Z")), "");
});

test("siguiente muestra la actual, la siguiente, las atrasadas y lo que no entra", () => {
  const texto = textoSiguiente(new Date("2026-10-07T15:00:00Z"));
  assert.match(texto, /^Ahora: Bitácora\.$/m);
  assert.match(texto, /^Sigue: Central \(1d, jue\)\.$/m);
  assert.match(texto, /^Atrasadas: Bitácora \(terminaba el mar\)\.$/m);
  assert.match(texto, /^No entran esta semana: Dashboard \(3d\)\.$/m);
});

test("siguiente sin plan vigente lo dice y sugiere rastro plan", () => {
  const r = crearRepo();
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  const texto = textoSiguiente(new Date("2026-10-07T15:00:00Z"));
  assert.match(texto, /No hay un plan vigente/);
  assert.match(texto, /rastro plan <propuesta\.md>/);
});

test("siguiente sin plan vigente nombra también plan sincronizar solo si Notion está en los conectores", () => {
  const r = crearRepo();
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  const ahora = new Date("2026-10-07T15:00:00Z");
  const config = leerConfig();
  escribirConfig({ ...config, conectores: ["central"] });
  assert.doesNotMatch(textoSiguiente(ahora), /plan sincronizar/);
  escribirConfig({ ...config, conectores: ["central", "notion"] });
  assert.match(textoSiguiente(ahora), /rastro plan <propuesta\.md>` o, si lo llevás en Notion, traelo con `rastro plan sincronizar`\./);
});

test("aviso y siguiente no invocan al LLM", () => {
  const r = repoConPlan();
  const marca = join(r.dir, "llm-invocado");
  r.escribir("bin/claude", `#!/bin/sh\ntouch "${marca}"\n`);
  chmodSync(join(r.dir, "bin/claude"), 0o755);
  for (const comando of ["aviso", "siguiente"]) {
    const res = spawnSync(process.execPath, [BIN, comando], { cwd: r.dir, encoding: "utf8", env: { ...r.env, PATH: `${join(r.dir, "bin")}:${process.env.PATH ?? ""}` } });
    assert.equal(res.status, 0, res.stderr);
  }
  assert.equal(existsSync(marca), false);
});

test("aviso sale con 0 y en silencio fuera de un repo de Rastro", () => {
  const res = spawnSync(process.execPath, [BIN, "aviso"], { cwd: mkdtempSync(join(tmpdir(), "rastro-fuera-")), encoding: "utf8" });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, "");
});

const ESTADO_BASE = {
  schemaVersion: 2,
  generadoEn: "2026-10-07T15:00:00.000Z",
  persona: { id: "qa", nombre: "QA", equipo: "QA" },
  repo: { nombre: "r" },
  periodo: { desde: "2026-10-05", hasta: "2026-10-07" },
  bitacora: [],
  pendientes: [],
  resumen: null,
  sugerencias: [],
  costo: { llamadas: 0, usd: 0, tokens: 0 },
  plan: null,
  desvios: { fueraDelPlanPct: 0, alerta: false, tareasSinActividad: [], tareasAtrasadas: [] },
  gantt: { mock: false, barras: [] },
  foco: null,
  ofrecimientos: [],
};

const entradaInferida = (sha: string, tarea: string) => ({
  fecha: "2026-10-07", hora: "10:00", tarea, rama: "main", texto: "avance", vinculo: "inferido", evidencia: [{ tipo: "commit", ref: sha.slice(0, 7) }],
});

test("siguiente toma la tarea actual del vínculo inferido del último daily, si la tarea sigue en el plan", () => {
  const r = repoConPlan();
  const sha = r.commit("avance sin nombre", "2026-10-07T10:00:00Z");
  const escribirState = (tarea: string) =>
    r.escribir(".rastro/state.json", JSON.stringify({ ...ESTADO_BASE, bitacora: [entradaInferida(sha, tarea)] }));
  const ahora = new Date("2026-10-07T15:00:00Z");
  escribirState("central");
  assert.match(textoSiguiente(ahora), /^Ahora: Central\.$/m);
  // Un daily viejo que apunta a una tarea que ya no está en el plan no sirve de vínculo: la actual vuelve al commit por nombre.
  escribirState("tarea-que-ya-no-existe");
  assert.match(textoSiguiente(ahora), /^Ahora: Bitácora\.$/m);
});

test("siguiente sigue sin un state.json inválido y deja el aviso en el log", (t) => {
  const r = repoConPlan();
  r.escribir(".rastro/state.json", "{no es json");
  const notas: string[] = [];
  t.mock.method(process.stderr, "write", (x: string) => (notas.push(x), true));
  const texto = textoSiguiente(new Date("2026-10-07T15:00:00Z"));
  assert.match(texto, /^Sigue: Central/m);
  assert.match(notas.join(""), /state_ignorado/);
});
