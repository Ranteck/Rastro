import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validarSnapshot, type Snapshot } from "../../backend/src/contract/snapshot.ts";
import { gantt } from "../src/views/gantt.ts";
import { vistaPlan } from "../src/views/plan.ts";

const snapshot = validarSnapshot(JSON.parse(readFileSync("ejemplos/persona-denis.json", "utf8")));

function montar(nodo: Node): HTMLElement {
  const raiz = document.createElement("div");
  raiz.append(nodo);
  return raiz;
}

describe("vista Plan", () => {
  it("tacha la tarea sacada y marca cada estado", () => {
    const raiz = montar(vistaPlan(snapshot));
    expect(raiz.querySelector("s")?.textContent).toBe("Jira");
    const marcas = [...raiz.querySelectorAll(".plan-marca")].map((n) => n.textContent);
    expect(marcas).toEqual(["■", "□", "□", "□", "—"]);
  });

  it("muestra el porcentaje y la placa solo con alerta", () => {
    expect(montar(vistaPlan(snapshot)).textContent).toContain("25%");
    expect(montar(vistaPlan(snapshot)).querySelector(".placa-alerta")).toBeNull();
    const raiz = montar(vistaPlan({ ...snapshot, desvios: { ...snapshot.desvios, alerta: true } }));
    expect(raiz.querySelector(".placa-alerta")?.textContent).toContain("25%");
  });

  it("lista las tareas sin actividad", () => {
    expect(montar(vistaPlan(snapshot)).textContent).toContain("Sin actividad: Repeticiones");
  });

  it("dibuja dos barras por tarea con plan y real", () => {
    const raiz = montar(gantt(snapshot));
    const fila = raiz.querySelectorAll(".gantt-fila")[1];
    expect(fila?.querySelectorAll(".gantt-barra")).toHaveLength(2);
    expect(raiz.textContent).toContain("sin actividad");
    const repeticiones = [...raiz.querySelectorAll(".gantt-fila")].find((f) => f.textContent?.includes("Repeticiones"));
    expect(repeticiones?.querySelectorAll(".gantt-barra")).toHaveLength(1);
  });

  it("marca como fantasma la barra sin plan y con real", () => {
    const fantasma: Snapshot = { ...snapshot, gantt: { mock: true, barras: [{ tarea: "x", plan: null, real: { desde: "2026-10-09", hasta: "2026-10-09" } }] } };
    const raiz = montar(gantt(fantasma));
    expect(raiz.textContent).toContain("FANTASMA · NO ESTABA EN EL PLAN");
    expect(raiz.querySelectorAll(".gantt-barra")).toHaveLength(1);
    expect(raiz.querySelector(".gantt-barra-fantasma")).not.toBeNull();
  });

  it("muestra la etiqueta mock solo si el Gantt es mock", () => {
    expect(montar(vistaPlan(snapshot)).textContent).toContain("MOCK · VISIÓN");
    // El contrato fija `mock: true`; el caso falso protege la condición del brief si el contrato cambia.
    const sinMock = { ...snapshot, gantt: { ...snapshot.gantt, mock: false } } as unknown as Snapshot;
    expect(montar(vistaPlan(sinMock)).textContent).not.toContain("MOCK · VISIÓN");
  });

  it("recorta a 31 días un rango absurdo y lo avisa", () => {
    const largo: Snapshot = { ...snapshot, gantt: { mock: true, barras: [{ tarea: "bitacora", plan: null, real: { desde: "2026-10-05", hasta: "2099-12-31" } }] } };
    const raiz = montar(gantt(largo));
    expect(raiz.querySelectorAll(".gantt-dia")).toHaveLength(31);
    expect(raiz.textContent).toContain("Rango recortado a 31 días");
    expect(montar(gantt(snapshot)).textContent).not.toContain("Rango recortado");
  });

  it("sin plan muestra la frase y no un error", () => {
    const raiz = montar(vistaPlan({ ...snapshot, plan: null }));
    expect(raiz.textContent).toContain("No hay plan esta semana. Armalo con `rastro plan`.");
    expect(raiz.querySelector("[role=alert]")).toBeNull();
  });
});
