import { test } from "node:test";
import assert from "node:assert/strict";
import type { Plan } from "../src/contract/snapshot.ts";
import { calcularDesvios } from "../src/detectores/desvios.ts";
import type { Vinculo } from "../src/detectores/vinculo.ts";

const plan: Plan = {
  semana: "2026-10-05",
  entregable: "Demo.",
  tareas: [
    { slug: "pendientes", nombre: "Pendientes", objetivo: "", estado: "pendiente", duracion: null, dias: [], noEntra: false, repo: null },
    { slug: "central", nombre: "Central", objetivo: "", estado: "pendiente", duracion: null, dias: [], noEntra: false, repo: null },
    { slug: "jira", nombre: "Jira", objetivo: "", estado: "sacada", duracion: null, dias: [], noEntra: false, repo: null },
  ],
};
const v = (tarea: string | null, tipo: Vinculo["tipo"] = tarea === null ? "sin-tarea" : "nombre") => ({ vinculo: { tarea, tipo } });

test("porcentaje fuera del plan, alerta sobre el umbral y tareas sin actividad", () => {
  const periodo = [v("pendientes"), v(null), v(null), v(null)];
  assert.deepEqual(calcularDesvios({ plan, commitsPeriodo: periodo, commitsSemana: periodo, umbralPct: 50, hoy: "2026-10-07", umbralAtrasadas: 1 }), {
    fueraDelPlanPct: 75,
    alerta: true,
    tareasSinActividad: ["central"],
    tareasAtrasadas: [],
  });
});

test("un vínculo inferido cuenta como dentro del plan", () => {
  const periodo = [v("central", "inferido"), v(null)];
  const d = calcularDesvios({ plan, commitsPeriodo: periodo, commitsSemana: periodo, umbralPct: 50, hoy: "2026-10-07", umbralAtrasadas: 1 });
  assert.equal(d.fueraDelPlanPct, 50);
  assert.equal(d.alerta, false);
});

test("sin plan no hay desvío que medir", () => {
  assert.deepEqual(calcularDesvios({ plan: null, commitsPeriodo: [v(null)], commitsSemana: [], umbralPct: 50, hoy: "2026-10-07", umbralAtrasadas: 1 }), {
    fueraDelPlanPct: 0,
    alerta: false,
    tareasSinActividad: [],
    tareasAtrasadas: [],
  });
});

const conDias = (estado: "pendiente" | "hecha"): Plan => ({
  semana: "2026-10-05",
  entregable: "Demo.",
  tareas: [{ slug: "bitacora", nombre: "Bitácora", objetivo: "", estado, duracion: { valor: 2, unidad: "d" }, dias: ["2026-10-05", "2026-10-06"], noEntra: false, repo: null }],
});
const atraso = (p: Plan, hoy: string, umbralAtrasadas = 1) => calcularDesvios({ plan: p, commitsPeriodo: [], commitsSemana: [], umbralPct: 50, hoy, umbralAtrasadas });

test("pendiente con último día sugerido anterior a hoy está atrasada; el último día mismo todavía no", () => {
  assert.deepEqual(atraso(conDias("pendiente"), "2026-10-07").tareasAtrasadas, ["bitacora"]);
  assert.deepEqual(atraso(conDias("pendiente"), "2026-10-06").tareasAtrasadas, []);
});

test("la misma tarea hecha, o una pendiente sin días, no está atrasada", () => {
  assert.deepEqual(atraso(conDias("hecha"), "2026-10-07").tareasAtrasadas, []);
  assert.deepEqual(atraso(plan, "2026-10-07").tareasAtrasadas, []);
});

test("la alerta se levanta por la cantidad de atrasadas contra su umbral", () => {
  assert.equal(atraso(conDias("pendiente"), "2026-10-07", 1).alerta, true);
  assert.equal(atraso(conDias("pendiente"), "2026-10-07", 2).alerta, false);
});

test("un commit corregido a sin tarea cuenta como fuera del plan", () => {
  const periodo = [v("pendientes"), v(null, "corregido")];
  assert.equal(calcularDesvios({ plan, commitsPeriodo: periodo, commitsSemana: periodo, umbralPct: 40, hoy: "2026-10-07", umbralAtrasadas: 1 }).fueraDelPlanPct, 50);
});
