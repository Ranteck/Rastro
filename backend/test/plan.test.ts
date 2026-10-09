import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorUsuario } from "../src/errores.ts";
import { parsearPlan, renderizarPlan } from "../src/plan.ts";

const MD = `## Por hacer
- [ ] Revisar algo.

## Plan semana 05/10
- ~~**Entregable del viernes:** Algo viejo.~~
- **Entregable del viernes:** Demo de Rastro en el AI Day.
- [x] **Bitácora:** Registrar el día con evidencia.
- [ ] **Pendientes:** Detectar lo resuelto sin cerrar.
\t- 08/10: Pasa a mañana.
- [ ] ~~**Jira:** Leer tareas de Jira.~~
\t- 07/10: Se sacó del plan.
- **Cierre (09/10):** Entregado.

## Plan semana 28/09
- [ ] **Vieja:** No es de esta semana.
`;

test("lee el plan de la semana de hoy con estados, tachados y comentarios", () => {
  const plan = parsearPlan(MD, "2026-10-09");
  assert.deepEqual(plan, {
    semana: "2026-10-05",
    entregable: "Demo de Rastro en el AI Day.",
    tareas: [
      { slug: "bitacora", nombre: "Bitácora", objetivo: "Registrar el día con evidencia.", estado: "hecha" },
      { slug: "pendientes", nombre: "Pendientes", objetivo: "Detectar lo resuelto sin cerrar.", estado: "pendiente" },
      { slug: "jira", nombre: "Jira", objetivo: "Leer tareas de Jira.", estado: "sacada" },
    ],
  });
});

test("sin plan para la semana devuelve null", () => {
  assert.equal(parsearPlan(MD, "2026-10-14"), null);
});

test("una línea mal formada corta con su número de línea", () => {
  const roto = "## Plan semana 05/10\n- [ ] Tarea sin nombre en negrita\n";
  assert.throws(() => parsearPlan(roto, "2026-10-09"), (e: unknown) => e instanceof ErrorUsuario && e.message.includes("línea 2"));
});

test("lo renderizado se vuelve a leer igual", () => {
  const md = renderizarPlan("2026-10-05", "Demo.", [
    { nombre: "Central", objetivo: "Recibir snapshots." },
    { nombre: "Bitácora", objetivo: "Registrar el día.", estado: "hecha" },
  ]);
  const plan = parsearPlan(md, "2026-10-07");
  assert.equal(plan?.entregable, "Demo.");
  assert.deepEqual(plan?.tareas.map((t) => [t.slug, t.estado]), [["central", "pendiente"], ["bitacora", "hecha"]]);
});
