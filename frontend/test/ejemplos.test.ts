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

  it("todas las entradas caen dentro del periodo y el % fuera del plan es el de entradas sin tarea", () => {
    for (const fila of filas) {
      const { bitacora, periodo, desvios } = validarSnapshot(leer(`persona-${fila.persona.id}.json`));
      expect(bitacora.every((e) => e.fecha >= periodo.desde && e.fecha <= periodo.hasta), fila.persona.id).toBe(true);
      const sinTarea = bitacora.filter((e) => e.vinculo === "sin-tarea").length;
      expect(desvios.fueraDelPlanPct, fila.persona.id).toBe(Math.round((sinTarea / bitacora.length) * 100));
    }
  });

  it("los commits de la bitácora no se repiten dentro de una persona", () => {
    for (const fila of filas) {
      const { bitacora } = validarSnapshot(leer(`persona-${fila.persona.id}.json`));
      const commits = bitacora.flatMap((e) => e.evidencia.filter((ev) => ev.tipo === "commit").map((ev) => ev.ref));
      expect(new Set(commits).size, fila.persona.id).toBe(commits.length);
    }
  });

  it("Tomás tiene un desvío real: entradas sin tarea, tareas sin actividad y un resuelto sin cerrar", () => {
    const tomas = validarSnapshot(leer("persona-tomas.json"));
    expect(tomas.desvios.alerta).toBe(true);
    expect(tomas.bitacora.filter((e) => e.vinculo === "sin-tarea").length).toBeGreaterThanOrEqual(3);
    expect(tomas.desvios.tareasSinActividad.length).toBeGreaterThan(0);
    expect(tomas.pendientes.some((p) => p.tipo === "resuelto-sin-cerrar")).toBe(true);
  });
});
