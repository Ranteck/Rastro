import type { Desvios, Plan } from "../contract/snapshot.ts";
import type { Fecha } from "../fechas.ts";
import type { Vinculo } from "./vinculo.ts";

type ConVinculo = { vinculo: Vinculo };

/** Pendientes cuyo último día sugerido ya pasó. Las hechas y las sacadas no se atrasan; las que no tienen días tampoco. */
export function tareasAtrasadas(plan: Plan | null, hoy: Fecha): Plan["tareas"] {
  if (plan === null) return [];
  return plan.tareas.filter((t) => t.estado === "pendiente" && (t.dias.at(-1) ?? hoy) < hoy);
}

/** Un commit sin tarea cuenta como fuera del plan aunque el usuario lo haya corregido a mano a "sin tarea". */
export function porcentajeFueraDelPlan(commits: readonly ConVinculo[]): number {
  return commits.length === 0 ? 0 : Math.round((commits.filter((c) => c.vinculo.tarea === null).length / commits.length) * 100);
}

export function calcularDesvios(e: {
  plan: Plan | null;
  commitsPeriodo: readonly ConVinculo[];
  commitsSemana: readonly ConVinculo[];
  umbralPct: number;
  hoy: Fecha;
  umbralAtrasadas: number;
}): Desvios {
  if (e.plan === null) return { fueraDelPlanPct: 0, alerta: false, tareasSinActividad: [], tareasAtrasadas: [] };
  const pct = porcentajeFueraDelPlan(e.commitsPeriodo);
  const conActividad = new Set(e.commitsSemana.map((c) => c.vinculo.tarea));
  const atrasadas = tareasAtrasadas(e.plan, e.hoy).map((t) => t.slug);
  return {
    fueraDelPlanPct: pct,
    alerta: pct > e.umbralPct || atrasadas.length >= e.umbralAtrasadas,
    tareasSinActividad: e.plan.tareas.filter((t) => t.estado === "pendiente" && !conActividad.has(t.slug)).map((t) => t.slug),
    tareasAtrasadas: atrasadas,
  };
}
