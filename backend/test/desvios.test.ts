import { test } from "node:test";
import assert from "node:assert/strict";
import type { Plan } from "../src/contract/snapshot.ts";
import { calcularDesvios } from "../src/detectores/desvios.ts";
import type { Vinculo } from "../src/detectores/vinculo.ts";

const plan: Plan = {
  semana: "2026-10-05",
  entregable: "Demo.",
  tareas: [
    { slug: "pendientes", nombre: "Pendientes", objetivo: "", estado: "pendiente" },
    { slug: "central", nombre: "Central", objetivo: "", estado: "pendiente" },
    { slug: "jira", nombre: "Jira", objetivo: "", estado: "sacada" },
  ],
};
const v = (tarea: string | null, tipo: Vinculo["tipo"] = tarea === null ? "sin-tarea" : "nombre") => ({ vinculo: { tarea, tipo } });

test("porcentaje fuera del plan, alerta sobre el umbral y tareas sin actividad", () => {
  const periodo = [v("pendientes"), v(null), v(null), v(null)];
  assert.deepEqual(calcularDesvios({ plan, commitsPeriodo: periodo, commitsSemana: periodo, umbralPct: 50 }), {
    fueraDelPlanPct: 75,
    alerta: true,
    tareasSinActividad: ["central"],
  });
});

test("un vínculo inferido cuenta como dentro del plan", () => {
  const periodo = [v("central", "inferido"), v(null)];
  const d = calcularDesvios({ plan, commitsPeriodo: periodo, commitsSemana: periodo, umbralPct: 50 });
  assert.equal(d.fueraDelPlanPct, 50);
  assert.equal(d.alerta, false);
});

test("sin plan no hay desvío que medir", () => {
  assert.deepEqual(calcularDesvios({ plan: null, commitsPeriodo: [v(null)], commitsSemana: [], umbralPct: 50 }), {
    fueraDelPlanPct: 0,
    alerta: false,
    tareasSinActividad: [],
  });
});
