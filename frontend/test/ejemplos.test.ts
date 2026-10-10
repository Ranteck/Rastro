import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkEquipo, filaDe } from "../../backend/src/contract/equipo.ts";
import { validarSnapshot } from "../../backend/src/contract/snapshot.ts";

const leer = (archivo: string): unknown => JSON.parse(readFileSync(`ejemplos/${archivo}`, "utf8"));
const filas = checkEquipo(leer("equipo.json"), "equipo").equipo;

describe("ejemplos del modo ejemplos", () => {
  for (const fila of filas) {
    it(`persona-${fila.persona.id}.json cumple el contrato y coincide con su fila de equipo.json`, () => {
      const snapshot = validarSnapshot(leer(`persona-${fila.persona.id}.json`));
      expect(filaDe(snapshot)).toEqual(fila);
    });
  }

  it("Tomás tiene un desvío real: entradas sin tarea, tareas sin actividad y un resuelto sin cerrar", () => {
    const tomas = validarSnapshot(leer("persona-tomas.json"));
    expect(tomas.desvios.alerta).toBe(true);
    expect(tomas.bitacora.filter((e) => e.vinculo === "sin-tarea").length).toBeGreaterThanOrEqual(3);
    expect(tomas.desvios.tareasSinActividad.length).toBeGreaterThan(0);
    expect(tomas.pendientes.some((p) => p.tipo === "resuelto-sin-cerrar")).toBe(true);
  });
});
