import type { Snapshot, Tarea } from "../../../backend/src/contract/snapshot.ts";
import { h } from "../ui/dom.ts";
import { vistaVacia } from "../ui/estado.ts";
import { formatearDia } from "../ui/fecha.ts";
import { placaFueraDelPlan } from "../ui/placa.ts";
import { nombreDeTarea } from "../ui/tarea.ts";
import { gantt } from "./gantt.ts";

const SEMANA = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });

const MARCAS: Record<Tarea["estado"], { clase: string; texto: string }> = {
  hecha: { clase: "marca-lleno", texto: "hecha" },
  pendiente: { clase: "marca-hueco", texto: "pendiente" },
  sacada: { clase: "marca-raya", texto: "sacada" },
};

function desvio(snapshot: Snapshot): HTMLElement {
  const { tareasSinActividad } = snapshot.desvios;
  return h(
    "div",
    { class: "plan-desvio" },
    placaFueraDelPlan(snapshot.desvios),
    ...(tareasSinActividad.length === 0
      ? []
      : [h("p", { class: "cuerpo" }, `Sin actividad: ${tareasSinActividad.map((t) => nombreDeTarea(snapshot, t)).join(", ")}`)]),
  );
}

function tarea(t: Tarea): HTMLElement {
  const { clase, texto } = MARCAS[t.estado];
  return h(
    "li",
    { class: "plan-tarea" },
    h("span", { class: `marca-estado ${clase}`, "aria-hidden": "true" }),
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
  if (snapshot.plan === null) return vistaVacia("plan", "Plan", "No hay plan esta semana. Armalo con ", h("code", {}, "rastro plan"), ".");
  return h(
    "section",
    { class: "plan", "aria-label": "Plan" },
    h(
      "header",
      { class: "plan-cabecera" },
      h("h1", { class: "titulo" }, snapshot.plan.entregable),
      h("p", { class: "cuerpo meta" }, `Semana del ${formatearDia(SEMANA, snapshot.plan.semana)}`),
    ),
    desvio(snapshot),
    h("ul", { class: "plan-tareas" }, ...snapshot.plan.tareas.map(tarea)),
    gantt(snapshot),
  );
}
