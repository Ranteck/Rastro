import type { Gantt, Plan } from "./contract/snapshot.ts";
import type { CommitVinculado } from "./detectores/pendientes.ts";
import { fechaLocal, sumarDias, type Fecha } from "./fechas.ts";
import { slugDe } from "./texto.ts";

function rango(fechas: readonly Fecha[] | undefined): { desde: Fecha; hasta: Fecha } | null {
  if (fechas === undefined || fechas.length === 0) return null;
  const orden = [...fechas].sort();
  return { desde: orden[0] ?? "", hasta: orden[orden.length - 1] ?? "" };
}

/** Mock: plan.md no tiene fechas por tarea, así que el plan de cada barra es la semana entera. Lo real sale de los commits. */
export function ganttMock(plan: Plan | null, commitsSemana: readonly CommitVinculado[], zona: string): Gantt {
  const fechas = new Map<string, Fecha[]>();
  for (const c of commitsSemana) {
    const clave = c.vinculo.tarea ?? `rama:${c.rama}`;
    fechas.set(clave, [...(fechas.get(clave) ?? []), fechaLocal(c.fecha, zona)]);
  }
  const barras: Gantt["barras"] = [];
  if (plan !== null) {
    for (const t of plan.tareas) {
      if (t.estado === "sacada") continue;
      barras.push({ tarea: t.slug, plan: { desde: plan.semana, hasta: sumarDias(plan.semana, 4) }, real: rango(fechas.get(t.slug)) });
    }
  }
  // Trabajo sin tarea: "tareas fantasma", con barra real y sin plan.
  for (const [clave, fs] of fechas) if (clave.startsWith("rama:")) barras.push({ tarea: slugDe(clave.slice(5)), plan: null, real: rango(fs) });
  return { mock: true, barras };
}
