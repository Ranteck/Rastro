import type { Gantt, Plan } from "./contract/snapshot.ts";
import type { CommitVinculado } from "./detectores/pendientes.ts";
import { fechaLocal, type Fecha } from "./fechas.ts";
import type { Sesion } from "./foco.ts";
import { slugDe } from "./texto.ts";

function rango(fechas: readonly Fecha[] | undefined): { desde: Fecha; hasta: Fecha } | null {
  if (fechas === undefined || fechas.length === 0) return null;
  const orden = [...fechas].sort();
  return { desde: orden[0] ?? "", hasta: orden[orden.length - 1] ?? "" };
}

/** Plan contra real: lo sugerido sale de los días de cada tarea y lo real, de la primera a la última evidencia de la semana (commits y sesiones vinculadas). */
export function calcularGantt(plan: Plan | null, commitsSemana: readonly CommitVinculado[], sesiones: readonly Sesion[], zona: string, atrasadas: readonly string[]): Gantt {
  const fechas = new Map<string, Fecha[]>();
  // Dos repos pueden tener una rama con el mismo nombre: la barra es de la rama de un repo.
  const ramas = new Map<string, { repo: string | undefined; rama: string; fechas: Fecha[] }>();
  for (const c of commitsSemana) {
    const fecha = fechaLocal(c.fecha, zona);
    if (c.vinculo.tarea !== null) {
      fechas.set(c.vinculo.tarea, [...(fechas.get(c.vinculo.tarea) ?? []), fecha]);
      continue;
    }
    const clave = `${c.repo ?? ""}\0${c.rama}`;
    const acumulada = ramas.get(clave) ?? { repo: c.repo, rama: c.rama, fechas: [] };
    acumulada.fechas.push(fecha);
    ramas.set(clave, acumulada);
  }
  for (const e of sesiones) if (e.tarea !== null) fechas.set(e.tarea, [...(fechas.get(e.tarea) ?? []), e.fecha]);
  const barras: Gantt["barras"] = [];
  if (plan !== null) {
    for (const t of plan.tareas) {
      if (t.estado === "sacada") continue;
      barras.push({ tarea: t.slug, plan: rango(t.dias), real: rango(fechas.get(t.slug)), atrasada: atrasadas.includes(t.slug), ...(t.repo === null ? {} : { repo: t.repo }) });
    }
  }
  // Trabajo sin tarea: "tareas fantasma", con barra real y sin plan.
  for (const g of ramas.values()) barras.push({ tarea: slugDe(g.rama), plan: null, real: rango(g.fechas), atrasada: false, ...(g.repo === undefined ? {} : { repo: g.repo }) });
  return { mock: false, barras };
}
