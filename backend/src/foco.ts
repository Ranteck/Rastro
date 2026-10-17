import type { Plan, Snapshot } from "./contract/snapshot.ts";
import type { CommitVinculado } from "./detectores/pendientes.ts";
import { fechaLocal, horaLocal, type Fecha } from "./fechas.ts";

/** Una entrada de la bitácora que cuenta como evidencia de una tarea sin ser un commit: una sesión de Claude Code vinculada. */
export type Sesion = Pick<Snapshot["bitacora"][number], "tarea" | "fecha" | "hora">;

/** Las sesiones de la bitácora vinculadas a una tarea que sigue en el plan. */
export function sesionesVinculadas(bitacora: Snapshot["bitacora"], plan: Plan | null): Sesion[] {
  return bitacora.filter((e) => e.evidencia[0]?.tipo === "sesion" && e.tarea !== null && (plan?.tareas ?? []).some((t) => t.slug === e.tarea));
}

/**
 * Actual: la tarea de la evidencia vinculada más reciente de la semana (un commit o una sesión de Claude Code).
 * Siguiente: la pendiente cuyo primer día sugerido desde hoy es el más cercano; sin ninguna con días por venir, la primera pendiente del plan.
 */
export function calcularFoco(plan: Plan | null, commitsSemana: readonly CommitVinculado[], sesiones: readonly Sesion[], hoy: Fecha, zona: string): Snapshot["foco"] {
  if (plan === null) return null;
  const evidencias = [
    ...commitsSemana.map((c) => ({ tarea: c.vinculo.tarea, cuando: `${fechaLocal(c.fecha, zona)} ${horaLocal(c.fecha, zona)}` })),
    ...sesiones.map((e) => ({ tarea: e.tarea, cuando: `${e.fecha} ${e.hora}` })),
  ];
  const reciente = evidencias.filter((e) => e.tarea !== null).sort((a, b) => b.cuando.localeCompare(a.cuando))[0];
  const actual = reciente?.tarea ?? null;
  const candidatas = plan.tareas.filter((t) => t.estado === "pendiente" && t.slug !== actual);
  let siguiente: string | null = null;
  let primerDia: Fecha | null = null;
  for (const t of candidatas) {
    const proximo = t.dias.find((d) => d >= hoy);
    // Con el mismo día gana la que está antes en el plan: el orden del plan desempata.
    if (proximo !== undefined && (primerDia === null || proximo < primerDia)) {
      siguiente = t.slug;
      primerDia = proximo;
    }
  }
  return { actual, siguiente: siguiente ?? candidatas[0]?.slug ?? null };
}
