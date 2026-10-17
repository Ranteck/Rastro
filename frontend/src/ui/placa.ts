import type { Desvios } from "../../../backend/src/contract/snapshot.ts";
import { h } from "./dom.ts";

/** Lo que el % no dice: el umbral no viaja en el snapshot, así que no se afirma cuál de los dos números disparó la alerta. */
function atrasadas(desvios: Desvios): HTMLElement[] {
  const cantidad = desvios.tareasAtrasadas.length;
  if (cantidad === 0) return [];
  return [h("p", { class: "etiqueta placa-atrasadas" }, `${cantidad} ${cantidad === 1 ? "tarea atrasada" : "tareas atrasadas"}`)];
}

/** El % fuera del plan; con alerta es la placa invertida de tinta y suma las tareas atrasadas. */
export function placaFueraDelPlan(desvios: Desvios): HTMLElement {
  return h(
    "div",
    { class: desvios.alerta ? "lamina fuera-del-plan placa-alerta" : "fuera-del-plan" },
    h("p", { class: "display" }, `${desvios.fueraDelPlanPct}%`),
    h("p", { class: "etiqueta" }, "FUERA DEL PLAN"),
    ...(desvios.alerta ? atrasadas(desvios) : []),
  );
}
