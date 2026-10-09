import type { Snapshot, Tarea } from "../../../backend/src/contract/snapshot.ts";
import { h } from "../ui/dom.ts";
import { vacio } from "../ui/estado.ts";
import { nombreDeTarea } from "../ui/tarea.ts";
import { gantt } from "./gantt.ts";

const SEMANA = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });

const MARCAS: Record<Tarea["estado"], { marca: string; texto: string }> = {
  hecha: { marca: "■", texto: "hecha" },
  pendiente: { marca: "□", texto: "pendiente" },
  sacada: { marca: "—", texto: "sacada" },
};

function desvio(snapshot: Snapshot): HTMLElement {
  const { fueraDelPlanPct, alerta, tareasSinActividad } = snapshot.desvios;
  return h(
    "div",
    { class: "plan-desvio" },
    h(
      "div",
      { class: alerta ? "lamina fuera-del-plan placa-alerta" : "fuera-del-plan" },
      h("p", { class: "display" }, `${fueraDelPlanPct}%`),
      h("p", { class: "etiqueta" }, "FUERA DEL PLAN"),
    ),
    ...(tareasSinActividad.length === 0
      ? []
      : [h("p", { class: "cuerpo" }, `Sin actividad: ${tareasSinActividad.map((t) => nombreDeTarea(snapshot, t)).join(", ")}`)]),
  );
}

function tarea(t: Tarea): HTMLElement {
  const { marca, texto } = MARCAS[t.estado];
  return h(
    "li",
    { class: "plan-tarea" },
    h("span", { class: "plan-marca", "aria-hidden": "true" }, marca),
    h(
      "div",
      {},
      h("p", { class: "plan-tarea-nombre" }, t.estado === "sacada" ? h("s", {}, t.nombre) : t.nombre),
      h("p", { class: "meta" }, t.objetivo),
    ),
    h("span", { class: "etiqueta meta" }, texto),
  );
}

export function vistaPlan(snapshot: Snapshot): Node {
  if (snapshot.plan === null) return vacio("No hay plan esta semana. Armalo con `rastro plan`.");
  return h(
    "section",
    { class: "plan", "aria-label": "Plan" },
    h(
      "header",
      { class: "plan-cabecera" },
      h("h1", { class: "titulo" }, snapshot.plan.entregable),
      h("p", { class: "cuerpo meta" }, `Semana del ${SEMANA.format(new Date(`${snapshot.plan.semana}T00:00:00Z`))}`),
    ),
    desvio(snapshot),
    h("ul", { class: "plan-tareas" }, ...snapshot.plan.tareas.map(tarea)),
    gantt(snapshot),
  );
}
