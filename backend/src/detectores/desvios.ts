import type { Desvios, Plan } from "../contract/snapshot.ts";
import type { Vinculo } from "./vinculo.ts";

type ConVinculo = { vinculo: Vinculo };

export function calcularDesvios(e: {
  plan: Plan | null;
  commitsPeriodo: readonly ConVinculo[];
  commitsSemana: readonly ConVinculo[];
  umbralPct: number;
}): Desvios {
  if (e.plan === null) return { fueraDelPlanPct: 0, alerta: false, tareasSinActividad: [] };
  const total = e.commitsPeriodo.length;
  const fuera = e.commitsPeriodo.filter((c) => c.vinculo.tipo === "sin-tarea").length;
  const pct = total === 0 ? 0 : Math.round((fuera / total) * 100);
  const conActividad = new Set(e.commitsSemana.map((c) => c.vinculo.tarea));
  return {
    fueraDelPlanPct: pct,
    alerta: pct > e.umbralPct,
    tareasSinActividad: e.plan.tareas.filter((t) => t.estado === "pendiente" && !conActividad.has(t.slug)).map((t) => t.slug),
  };
}
