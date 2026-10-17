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
      { slug: "bitacora", nombre: "Bitácora", objetivo: "Registrar el día con evidencia.", estado: "hecha", duracion: null, dias: [], noEntra: false, repo: null },
      { slug: "pendientes", nombre: "Pendientes", objetivo: "Detectar lo resuelto sin cerrar.", estado: "pendiente", duracion: null, dias: [], noEntra: false, repo: null },
      { slug: "jira", nombre: "Jira", objetivo: "Leer tareas de Jira.", estado: "sacada", duracion: null, dias: [], noEntra: false, repo: null },
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
    { nombre: "Jira", objetivo: "Leer tareas.", estado: "sacada" },
  ]);
  assert.deepEqual(parsearPlan(md, "2026-10-07"), {
    semana: "2026-10-05",
    entregable: "Demo.",
    tareas: [
      { slug: "central", nombre: "Central", objetivo: "Recibir snapshots.", estado: "pendiente", duracion: null, dias: [], noEntra: false, repo: null },
      { slug: "bitacora", nombre: "Bitácora", objetivo: "Registrar el día.", estado: "hecha", duracion: null, dias: [], noEntra: false, repo: null },
      { slug: "jira", nombre: "Jira", objetivo: "Leer tareas.", estado: "sacada", duracion: null, dias: [], noEntra: false, repo: null },
    ],
  });
});

test("texto hostil se sanea y se relee sin tareas fantasma ni plan truncado", () => {
  const md = renderizarPlan("2026-10-05", "Demo\n## Otra\n- [x] **X:** y", [
    { nombre: "Uno: **dos**", objetivo: "Hace algo\n- [x] **B:** fantasma\n## Otra\n:** raro~~" },
    { nombre: "Tres", objetivo: "~~tachado~~", estado: "sacada" },
    { nombre: "Cuatro", objetivo: "Final.", estado: "hecha" },
  ]);
  assert.deepEqual(parsearPlan(md, "2026-10-05"), {
    semana: "2026-10-05",
    entregable: "Demo ## Otra - [x] X: y",
    tareas: [
      { slug: "uno-dos", nombre: "Uno dos", objetivo: "Hace algo - [x] B: fantasma ## Otra : raro", estado: "pendiente", duracion: null, dias: [], noEntra: false, repo: null },
      { slug: "tres", nombre: "Tres", objetivo: "tachado", estado: "sacada", duracion: null, dias: [], noEntra: false, repo: null },
      { slug: "cuatro", nombre: "Cuatro", objetivo: "Final.", estado: "hecha", duracion: null, dias: [], noEntra: false, repo: null },
    ],
  });
});

test("un nombre sin letras ni números se rechaza", () => {
  assert.throws(() => renderizarPlan("2026-10-05", "Demo.", [{ nombre: "***: ~~", objetivo: "x" }]), ErrorUsuario);
});

test("el sufijo de duración y días se lee y se vuelve a renderizar igual", () => {
  const md = renderizarPlan("2026-10-05", "Demo.", [
    { nombre: "Rango", objetivo: "Va varios días.", duracion: { valor: 2, unidad: "d" }, dias: ["2026-10-05", "2026-10-06", "2026-10-07"] },
    { nombre: "Sueltos", objetivo: "Salteado.", duracion: { valor: 1.5, unidad: "d" }, dias: ["2026-10-05", "2026-10-07", "2026-10-08"] },
    { nombre: "Corta", objetivo: "Una tarde.", duracion: { valor: 4, unidad: "h" }, dias: ["2026-10-08"] },
    { nombre: "Grande", objetivo: "No cabe.", duracion: { valor: 3, unidad: "d" }, noEntra: true },
    { nombre: "Sola", objetivo: "Sin reparto.", duracion: { valor: 0.25, unidad: "h" } },
  ]);
  assert.match(md, /\*\*Rango:\*\* Va varios días\. · 2d · lun–mié$/m);
  assert.match(md, /\*\*Sueltos:\*\* Salteado\. · 1,5d · lun, mié–jue$/m);
  assert.match(md, /\*\*Grande:\*\* No cabe\. · 3d · no entra$/m);
  const plan = parsearPlan(md, "2026-10-05");
  assert.deepEqual(plan?.tareas.map((t) => [t.objetivo, t.duracion, t.dias, t.noEntra]), [
    ["Va varios días.", { valor: 2, unidad: "d" }, ["2026-10-05", "2026-10-06", "2026-10-07"], false],
    ["Salteado.", { valor: 1.5, unidad: "d" }, ["2026-10-05", "2026-10-07", "2026-10-08"], false],
    ["Una tarde.", { valor: 4, unidad: "h" }, ["2026-10-08"], false],
    ["No cabe.", { valor: 3, unidad: "d" }, [], true],
    ["Sin reparto.", { valor: 0.25, unidad: "h" }, [], false],
  ]);
  assert.equal(renderizarPlan("2026-10-05", plan?.entregable ?? "", plan?.tareas ?? []), md);
});

test("acepta la duración con punto decimal y una tarea sacada conserva el sufijo", () => {
  const plan = parsearPlan("## Plan semana 05/10\n- [ ] ~~**Jira:** Leer tareas. · 0.5d · lun~~\n", "2026-10-05");
  assert.deepEqual(plan?.tareas[0], {
    slug: "jira", nombre: "Jira", objetivo: "Leer tareas.", estado: "sacada", duracion: { valor: 0.5, unidad: "d" }, dias: ["2026-10-05"], noEntra: false, repo: null,
  });
});

test("una duración fuera de rango en el archivo se lee como texto del objetivo y avisa con un warn", () => {
  const escrito: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((t: string) => (escrito.push(t), true)) as typeof process.stderr.write;
  try {
    const plan = parsearPlan("## Plan semana 05/10\n- [ ] **Uno:** Algo. · 11d\n- [ ] **Dos:** Revisar costos · 500h\n", "2026-10-05");
    assert.deepEqual(plan?.tareas.map((t) => [t.objetivo, t.duracion]), [["Algo. · 11d", null], ["Revisar costos · 500h", null]]);
  } finally {
    process.stderr.write = original;
  }
  assert.deepEqual(escrito.map((l) => /warn duracion_fuera_de_rango linea=(\d+)/.exec(l)?.[1]), ["2", "3"]);
});

test("un objetivo que termina con forma de sufijo no rompe la ida y vuelta, con o sin duración", () => {
  const dia = ["2026-10-05"];
  for (const objetivo of ["Hacer algo · 2d", "Revisar costos · 500h", "Algo · no entra", "Algo · 2d · lun–mar"]) {
    for (const extra of [{}, { duracion: { valor: 4, unidad: "h" as const }, dias: dia }, { duracion: { valor: 3, unidad: "d" as const }, noEntra: true }]) {
      const md = renderizarPlan("2026-10-05", "Demo.", [{ nombre: "Uno", objetivo, ...extra }]);
      const plan = parsearPlan(md, "2026-10-05");
      assert.equal(plan?.tareas.length, 1, md);
      assert.deepEqual(plan?.tareas[0]?.duracion ?? null, "duracion" in extra ? extra.duracion : null, md);
      assert.equal(renderizarPlan("2026-10-05", plan?.entregable ?? "", plan?.tareas ?? []), md);
    }
  }
});

test("un sufijo escrito a mano con guion ASCII o la unidad en mayúscula se lee igual", () => {
  const plan = parsearPlan("## Plan semana 05/10\n- [ ] **Uno:** Algo. · 2D · lun-mié\n", "2026-10-05");
  assert.deepEqual(plan?.tareas[0]?.duracion, { valor: 2, unidad: "d" });
  assert.deepEqual(plan?.tareas[0]?.dias, ["2026-10-05", "2026-10-06", "2026-10-07"]);
});

test("un plan viejo sin sufijos sigue leyéndose sin duración ni días", () => {
  const plan = parsearPlan(MD, "2026-10-09");
  assert.ok(plan?.tareas.every((t) => t.duracion === null && t.dias.length === 0 && !t.noEntra));
  assert.equal(plan?.tareas[0]?.objetivo, "Registrar el día con evidencia.");
});

test("una tarea con objetivo vacío conserva su duración y sus días al releer el plan", () => {
  const md = renderizarPlan("2026-10-05", "Demo.", [
    { nombre: "Uno", objetivo: "", duracion: { valor: 2, unidad: "d" }, dias: ["2026-10-05", "2026-10-06"] },
    { nombre: "Dos", objetivo: "   ", duracion: { valor: 4, unidad: "h" } },
  ]);
  const plan = parsearPlan(md, "2026-10-05");
  assert.deepEqual(plan?.tareas.map((t) => [t.objetivo, t.duracion, t.dias]), [
    ["", { valor: 2, unidad: "d" }, ["2026-10-05", "2026-10-06"]],
    ["", { valor: 4, unidad: "h" }, []],
  ]);
  assert.equal(renderizarPlan("2026-10-05", plan?.entregable ?? "", plan?.tareas ?? []), md);
});

test("el sufijo repo: hace ida y vuelta con y sin duración y días, antes o después", () => {
  const dur = { valor: 2, unidad: "d" } as const;
  const dias = ["2026-10-05", "2026-10-06"];
  const md = renderizarPlan("2026-10-05", "Demo.", [
    { nombre: "Solo", objetivo: "Nada más.", repo: "hunting" },
    { nombre: "Dur", objetivo: "Con duración.", duracion: dur, repo: "hunting" },
    { nombre: "Completa", objetivo: "Con todo.", duracion: dur, dias, repo: "rastro" },
    { nombre: "NoEntra", objetivo: "No cabe.", duracion: dur, noEntra: true, repo: "rastro" },
    { nombre: "Reunión", objetivo: "Sin repo.", duracion: dur },
  ]);
  assert.match(md, /\*\*Solo:\*\* Nada más\. · repo:hunting$/m);
  assert.match(md, /\*\*Completa:\*\* Con todo\. · 2d · lun–mar · repo:rastro$/m);
  const plan = parsearPlan(md, "2026-10-05");
  assert.deepEqual(plan?.tareas.map((t) => [t.objetivo, t.repo, t.duracion, t.dias]), [
    ["Nada más.", "hunting", null, []],
    ["Con duración.", "hunting", dur, []],
    ["Con todo.", "rastro", dur, dias],
    ["No cabe.", "rastro", dur, []],
    ["Sin repo.", null, dur, []],
  ]);
  assert.equal(renderizarPlan("2026-10-05", plan?.entregable ?? "", plan?.tareas ?? []), md);
});

test("el repo: también se lee antes de la duración y los días", () => {
  const plan = parsearPlan("## Plan semana 05/10\n- [ ] **Uno:** Algo. · repo:hunting · 2d · lun–mar\n- [ ] **Dos:** Otra. · repo:x · 3h\n", "2026-10-05");
  assert.deepEqual(plan?.tareas.map((t) => [t.objetivo, t.repo, t.duracion, t.dias.length]), [
    ["Algo.", "hunting", { valor: 2, unidad: "d" }, 2],
    ["Otra.", "x", { valor: 3, unidad: "h" }, 0],
  ]);
});

test("un repo: que no está registrado igual se lee, y un objetivo que termina como un repo: no rompe la ida y vuelta", () => {
  const plan = parsearPlan("## Plan semana 05/10\n- [ ] **Uno:** Algo. · repo:no-existe-en-ningun-lado\n", "2026-10-05");
  assert.equal(plan?.tareas[0]?.repo, "no-existe-en-ningun-lado");
  for (const repo of [null, "a"] as const) {
    const md = renderizarPlan("2026-10-05", "Demo.", [{ nombre: "Uno", objetivo: "Texto · repo:ajeno", repo, duracion: { valor: 1, unidad: "d" } }]);
    const t = parsearPlan(md, "2026-10-05")?.tareas[0];
    assert.deepEqual([t?.objetivo, t?.repo], ["Texto - repo:ajeno", repo]);
  }
});

test("los planes del formato anterior se leen con repo null", () => {
  const plan = parsearPlan("## Plan semana 05/10\n- [ ] **Uno:** Algo. · 2d · lun–mar\n- [ ] **Dos:** Otro.\n", "2026-10-05");
  assert.deepEqual(plan?.tareas.map((t) => t.repo), [null, null]);
});

test("los días sin duración hacen ida y vuelta, con o sin repo, y también 'no entra'", () => {
  const semana = "2026-10-05";
  const dias = ["2026-10-05", "2026-10-06", "2026-10-08"];
  const tareas = [
    { nombre: "Sola", objetivo: "Con días.", dias, duracion: null },
    { nombre: "Repo", objetivo: "Con días y repo.", dias: ["2026-10-09"], duracion: null, repo: "hunting" },
    { nombre: "Fuera", objetivo: "No entra.", dias: [], duracion: null, noEntra: true },
  ];
  const md = renderizarPlan(semana, "Demo.", tareas);
  assert.match(md, /^- \[ \] \*\*Sola:\*\* Con días\. · lun–mar, jue$/m);
  assert.match(md, /^- \[ \] \*\*Repo:\*\* Con días y repo\. · vie · repo:hunting$/m);
  assert.match(md, /^- \[ \] \*\*Fuera:\*\* No entra\. · no entra$/m);

  const leido = parsearPlan(md, semana);
  assert.deepEqual(leido?.tareas.map((t) => [t.nombre, t.objetivo, t.duracion, t.dias, t.noEntra, t.repo]), [
    ["Sola", "Con días.", null, dias, false, null],
    ["Repo", "Con días y repo.", null, ["2026-10-09"], false, "hunting"],
    ["Fuera", "No entra.", null, [], true, null],
  ]);
  assert.equal(renderizarPlan(semana, "Demo.", leido?.tareas ?? []), md);
});

test("un objetivo que termina en un día no se confunde con los días de la tarea", () => {
  const semana = "2026-10-05";
  const md = renderizarPlan(semana, "Demo.", [{ nombre: "Alfa", objetivo: "Entregar · jue", duracion: null }]);

  const leido = parsearPlan(md, semana);

  assert.equal(leido?.tareas[0]?.dias.length, 0);
  assert.equal(leido?.tareas[0]?.objetivo, "Entregar / jue");
  assert.equal(renderizarPlan(semana, "Demo.", leido?.tareas ?? []), md);
});

test("unos días sin duración al revés o desordenados se rechazan con su línea", () => {
  assert.throws(() => parsearPlan("## Plan semana 05/10\n- [ ] **Alfa:** Hacer. · mar–lun\n", "2026-10-05"), /línea 2: no pude leer los días/);
});

test("un objetivo que termina en dos días sueltos no se lee como un rango de días: el final se escapa y hace ida y vuelta", () => {
  const semana = "2026-10-05";
  const md = renderizarPlan(semana, "Demo.", [{ nombre: "Alfa", objetivo: "algo · lun · mar", duracion: null }]);

  const leido = parsearPlan(md, semana);

  assert.equal(leido?.tareas[0]?.dias.length, 0);
  assert.equal(leido?.tareas[0]?.objetivo, "algo · lun / mar");
  assert.equal(renderizarPlan(semana, "Demo.", leido?.tareas ?? []), md);
});
