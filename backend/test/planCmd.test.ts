import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configPorDefecto, escribirConfig } from "../src/config.ts";
import { ErrorUsuario } from "../src/errores.ts";
import { ddmm, fechaLocal, lunesDe } from "../src/fechas.ts";
import { parsearPlan } from "../src/plan.ts";
import { armarPlan, sugerirTareas } from "../src/planCmd.ts";
import { FakeLlm } from "./helpers/fakeLlm.ts";
import { crearRepo } from "./helpers/repo.ts";

const config = configPorDefecto({ id: "test", nombre: "Test", equipo: "QA" });
const respuestaPlan = {
  plan: {
    entregable: "Demo el viernes.",
    tareas: [
      { nombre: "Bitácora", objetivo: "Registrar el día." },
      { nombre: "Central: API", objetivo: "Recibir snapshots." },
      { nombre: "bitacora", objetivo: "Duplicada." },
    ],
  },
};

test("arma plan.md desde una propuesta, con nombres saneados y sin duplicados", async () => {
  const r = crearRepo();
  const res = await armarPlan({ repo: r.dir, llm: new FakeLlm(respuestaPlan), propuesta: "# Propuesta", hoy: "2026-10-09" });
  assert.equal(res.sugerido, false);
  const plan = parsearPlan(readFileSync(join(r.dir, ".rastro/plan.md"), "utf8"), "2026-10-09");
  assert.equal(plan?.entregable, "Demo el viernes.");
  assert.deepEqual(plan?.tareas.map((t) => t.nombre), ["Bitácora", "Central API"]);
});

test("un objetivo del LLM con salto de línea sigue dando un plan.md legible", async () => {
  const r = crearRepo();
  const llm = new FakeLlm({ plan: { entregable: "Demo.", tareas: [{ nombre: "Bitácora", objetivo: "Registrar\n- [ ] **Falsa:** otra\n" }] } });
  await armarPlan({ repo: r.dir, llm, propuesta: "# Propuesta", hoy: "2026-10-09" });
  const plan = parsearPlan(readFileSync(join(r.dir, ".rastro/plan.md"), "utf8"), "2026-10-09");
  assert.equal(plan?.tareas.length, 1);
});

test("si ya hay plan no lo pisa: escribe plan.sugerido.md", async () => {
  const r = crearRepo();
  r.escribir(".rastro/plan.md", "mi plan\n");
  const res = await armarPlan({ repo: r.dir, llm: new FakeLlm(respuestaPlan), propuesta: "# Propuesta", hoy: "2026-10-09" });
  assert.equal(res.sugerido, true);
  assert.equal(readFileSync(join(r.dir, ".rastro/plan.md"), "utf8"), "mi plan\n");
  assert.ok(existsSync(join(r.dir, ".rastro/plan.sugerido.md")));
});

test("sin LLM disponible, el plan falla con un mensaje para el usuario", async () => {
  await assert.rejects(armarPlan({ repo: crearRepo().dir, llm: new FakeLlm("falla"), propuesta: "x", hoy: "2026-10-09" }), ErrorUsuario);
});

test("--sugerir propone tareas nuevas a partir del trabajo fuera del plan", async () => {
  const r = crearRepo();
  escribirConfig(r.dir, config);
  const hoy = fechaLocal(new Date(), "America/Argentina/Buenos_Aires");
  r.escribir(".gitignore", ".rastro/\n");
  r.escribir(".rastro/plan.md", `## Plan semana ${ddmm(lunesDe(hoy))}\n- **Entregable del viernes:** Demo.\n- [x] **Bitácora:** Registrar.\n`);
  r.commit("script de deploy a staging");
  const llm = new FakeLlm({
    "sugerir-plan": {
      tareas: [
        { nombre: "Deploy", objetivo: "Automatizar el deploy a staging." },
        { nombre: "Bitácora", objetivo: "Ya existe." },
      ],
    },
  });
  const res = await sugerirTareas({ repo: r.dir, config, llm, ahora: new Date() });
  assert.equal(res.nuevas, 1);
  const sugerido = readFileSync(join(r.dir, ".rastro/plan.sugerido.md"), "utf8");
  assert.match(sugerido, /- \[x\] \*\*Bitácora:\*\*/);
  assert.match(sugerido, /- \[ \] \*\*Deploy:\*\* Automatizar el deploy a staging\./);
});
