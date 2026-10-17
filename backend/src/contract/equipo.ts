import type { Snapshot } from "./snapshot.ts";
import { arr, bool, num, obj, slug, str, type Infer } from "./validar.ts";

export const checkFilaEquipo = obj({
  persona: obj({ id: slug, nombre: str, equipo: str }),
  repo: str,
  ultimoUpdate: str,
  tareasHechas: num,
  tareasTotales: num,
  pendientesAbiertos: num,
  fueraDelPlanPct: num,
  alerta: bool,
});

export const checkEquipo = obj({ equipo: arr(checkFilaEquipo) });

export type FilaEquipo = Infer<typeof checkFilaEquipo>;

/** Campos elegidos uno por uno: lo que se agregue al snapshot no aparece solo en la vista de equipo. */
export function filaDe(s: Snapshot): FilaEquipo {
  const tareas = s.plan?.tareas ?? [];
  return {
    persona: { id: s.persona.id, nombre: s.persona.nombre, equipo: s.persona.equipo },
    repo: s.repo.nombre,
    ultimoUpdate: s.generadoEn,
    tareasHechas: tareas.filter((t) => t.estado === "hecha").length,
    tareasTotales: tareas.filter((t) => t.estado !== "sacada").length,
    pendientesAbiertos: s.pendientes.length,
    fueraDelPlanPct: s.desvios.fueraDelPlanPct,
    alerta: s.desvios.alerta,
  };
}
