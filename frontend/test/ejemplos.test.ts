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

  it("los días sugeridos caen dentro de la semana del plan y la semana contiene el periodo", () => {
    for (const fila of filas) {
      const { plan, periodo } = validarSnapshot(leer(`persona-${fila.persona.id}.json`));
      if (plan === null) continue;
      const fin = new Date(Date.parse(`${plan.semana}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
      expect(periodo.hasta >= plan.semana && periodo.hasta <= fin, fila.persona.id).toBe(true);
      for (const t of plan.tareas) expect(t.dias.every((d) => d >= plan.semana && d <= fin), `${fila.persona.id}/${t.slug}`).toBe(true);
    }
  });

  it("el Gantt es real y su plan sale de los días de cada tarea", () => {
    for (const fila of filas) {
      const { plan, gantt } = validarSnapshot(leer(`persona-${fila.persona.id}.json`));
      expect(gantt.mock, fila.persona.id).toBe(false);
      for (const b of gantt.barras) {
        const dias = plan?.tareas.find((t) => t.slug === b.tarea)?.dias ?? [];
        expect(b.plan, `${fila.persona.id}/${b.tarea}`).toEqual(dias.length === 0 ? null : { desde: dias[0], hasta: dias[dias.length - 1] });
      }
    }
  });

  it("los SHA no se repiten entre las personas", () => {
    const commits = filas.flatMap((fila) =>
      validarSnapshot(leer(`persona-${fila.persona.id}.json`)).bitacora.flatMap((e) => e.evidencia.filter((ev) => ev.tipo === "commit").map((ev) => ev.ref)),
    );
    expect(new Set(commits).size).toBe(commits.length);
  });

  it("toda tarea atrasada existe, está pendiente y tiene los días vencidos respecto del periodo", () => {
    for (const fila of filas) {
      const { plan, periodo, desvios, gantt } = validarSnapshot(leer(`persona-${fila.persona.id}.json`));
      for (const slug of desvios.tareasAtrasadas) {
        const t = plan?.tareas.find((x) => x.slug === slug);
        expect(t?.estado, `${fila.persona.id}/${slug}`).toBe("pendiente");
        expect((t?.dias.length ?? 0) > 0 && (t?.dias[t.dias.length - 1] ?? "") < periodo.hasta, `${fila.persona.id}/${slug}`).toBe(true);
        expect(gantt.barras.find((b) => b.tarea === slug)?.atrasada, `${fila.persona.id}/${slug}`).toBe(true);
      }
      const pendientesVencidas = plan?.tareas.filter((t) => t.estado === "pendiente" && t.dias.length > 0 && (t.dias[t.dias.length - 1] ?? "") < periodo.hasta) ?? [];
      expect(pendientesVencidas.map((t) => t.slug).sort(), fila.persona.id).toEqual([...desvios.tareasAtrasadas].sort());
    }
  });

  it("el foco apunta a tareas del plan, y lo que sigue está pendiente y no es lo de ahora", () => {
    for (const fila of filas) {
      const { plan, foco } = validarSnapshot(leer(`persona-${fila.persona.id}.json`));
      for (const slug of [foco?.actual, foco?.siguiente]) if (slug) expect(plan?.tareas.some((t) => t.slug === slug), fila.persona.id).toBe(true);
      if (foco?.siguiente) {
        expect(plan?.tareas.find((t) => t.slug === foco.siguiente)?.estado, fila.persona.id).toBe("pendiente");
        expect(foco.siguiente, fila.persona.id).not.toBe(foco.actual);
      }
    }
  });

  it("todas las entradas de la bitácora caen entre el inicio y el fin del periodo", () => {
    for (const fila of filas) {
      const { bitacora, periodo } = validarSnapshot(leer(`persona-${fila.persona.id}.json`));
      for (const e of bitacora) expect(e.fecha >= periodo.desde && e.fecha <= periodo.hasta, `${fila.persona.id} ${e.hora}`).toBe(true);
    }
  });

  it("Tomás tiene una atrasada, una tarea que no entra y una entrada corregida; Denis y Lucía van en fecha", () => {
    const tomas = validarSnapshot(leer("persona-tomas.json"));
    expect(tomas.desvios.tareasAtrasadas).toEqual(["ingesta"]);
    expect(tomas.plan?.tareas.filter((t) => t.noEntra).map((t) => t.slug)).toEqual(["reintentos"]);
    expect(tomas.bitacora.filter((e) => e.vinculo === "corregido")).toHaveLength(1);
    for (const id of ["denis", "lucia"]) expect(validarSnapshot(leer(`persona-${id}.json`)).desvios.tareasAtrasadas, id).toEqual([]);
  });

  it("Lucía está a mitad de semana: hoy cae en una columna del Gantt que no es la última", () => {
    const { periodo, plan } = validarSnapshot(leer("persona-lucia.json"));
    const ultimaDelPlan = plan?.tareas.flatMap((t) => t.dias).sort().at(-1) ?? "";
    expect(periodo.hasta < ultimaDelPlan).toBe(true);
  });

  it("los ejemplos son v3 y el de Denis trabaja en dos repos, con una tarea sin repo y un ofrecimiento con repo", () => {
    for (const fila of filas) expect((leer(`persona-${fila.persona.id}.json`) as { schemaVersion: number }).schemaVersion, fila.persona.id).toBe(3);
    const denis = validarSnapshot(leer("persona-denis.json"));
    const repos = (lista: ReadonlyArray<{ repo: string | null }>): string[] => [...new Set(lista.map((x) => x.repo).filter((r) => r !== null))].sort();
    expect(repos(denis.plan?.tareas ?? [])).toEqual(["central-api", "rastro"]);
    expect(repos(denis.bitacora)).toEqual(["central-api", "rastro"]);
    expect(denis.plan?.tareas.some((t) => t.repo === null)).toBe(true);
    expect(denis.ofrecimientos.some((o) => typeof o.repo === "string")).toBe(true);
    expect(denis.repo.nombre).toBe("rastro, central-api");
  });
});
