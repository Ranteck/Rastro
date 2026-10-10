import type { Desvios } from "../../../backend/src/contract/snapshot.ts";
import { h } from "./dom.ts";

/** El % fuera del plan; con alerta es la placa invertida de tinta. */
export function placaFueraDelPlan(desvios: Desvios): HTMLElement {
  return h(
    "div",
    { class: desvios.alerta ? "lamina fuera-del-plan placa-alerta" : "fuera-del-plan" },
    h("p", { class: "display" }, `${desvios.fueraDelPlanPct}%`),
    h("p", { class: "etiqueta" }, "FUERA DEL PLAN"),
  );
}
