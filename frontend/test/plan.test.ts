import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { validarSnapshot, type Snapshot } from "../../backend/src/contract/snapshot.ts";
import type { CommitVinculado } from "../../backend/src/detectores/pendientes.ts";
import { calcularGantt } from "../../backend/src/gantt.ts";
import { gantt } from "../src/views/gantt.ts";
import { vistaPlan } from "../src/views/plan.ts";

const leer = (id: string): Snapshot => validarSnapshot(JSON.parse(readFileSync(`ejemplos/persona-${id}.json`, "utf8")));
const snapshot = leer("denis");
const tomas = leer("tomas");

function montar(nodo: Node): HTMLElement {
  const raiz = document.createElement("div");
  raiz.append(nodo);
  return raiz;
}

describe("vista Plan", () => {
  it("tacha la tarea sacada y marca cada estado", () => {
    const raiz = montar(vistaPlan(snapshot));
    expect(raiz.querySelector("s")?.textContent).toBe("Jira");
    const marcas = [...raiz.querySelectorAll(".plan-tarea .marca-estado")].map((n) => n.className.replace("marca-estado ", ""));
    expect(marcas).toEqual(["marca-lleno", "marca-hueco", "marca-hueco", "marca-hueco", "marca-raya"]);
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
    const fantasma: Snapshot = { ...snapshot, gantt: { mock: true, barras: [{ tarea: "x", plan: null, real: { desde: "2026-10-09", hasta: "2026-10-09" }, atrasada: false }] } };
    const raiz = montar(gantt(fantasma));
    expect(raiz.textContent).toContain("FANTASMA · NO ESTABA EN EL PLAN");
    expect(raiz.querySelectorAll(".gantt-barra")).toHaveLength(1);
    expect(raiz.querySelector(".gantt-barra-fantasma")).not.toBeNull();
  });

  it("muestra la etiqueta mock solo si el Gantt es mock", () => {
    expect(montar(vistaPlan(snapshot)).textContent).not.toContain("MOCK · VISIÓN");
    const conMock: Snapshot = { ...snapshot, gantt: { ...snapshot.gantt, mock: true } };
    expect(montar(vistaPlan(conMock)).textContent).toContain("MOCK · VISIÓN");
  });

  it("recorta a 31 días un rango absurdo y lo avisa", () => {
    const largo: Snapshot = { ...snapshot, gantt: { mock: true, barras: [{ tarea: "bitacora", plan: null, real: { desde: "2026-10-05", hasta: "2099-12-31" }, atrasada: false }] } };
    const raiz = montar(gantt(largo));
    expect(raiz.querySelectorAll(".gantt-dia")).toHaveLength(31);
    expect(raiz.textContent).toContain("Rango recortado a 31 días");
    expect(montar(gantt(snapshot)).textContent).not.toContain("Rango recortado");
  });

  it("sin plan muestra la frase y no un error", () => {
    const raiz = montar(vistaPlan({ ...snapshot, plan: null }));
    expect(raiz.querySelector("section[aria-label='Plan'] h1")?.textContent).toBe("Plan");
    expect(raiz.textContent).toContain("No hay plan esta semana. Decile a Claude «sugerime el plan de este proyecto».");
    expect(raiz.querySelector("code")?.textContent).toBe("rastro plan --desde-proyecto");
    expect(raiz.textContent).toContain("o en la terminal:");
    expect(raiz.querySelector("[role=alert]")).toBeNull();
  });

  it("una fecha imposible se muestra cruda y no tira la vista", () => {
    const raiz = montar(
      vistaPlan({
        ...snapshot,
        // Sin días asignados la barra sale del rango del Gantt, que acá es el ilegible.
        plan: { ...(snapshot.plan as NonNullable<Snapshot["plan"]>), semana: "2026-13-45", tareas: (snapshot.plan as NonNullable<Snapshot["plan"]>).tareas.map((t) => ({ ...t, dias: [] })) },
        gantt: { mock: true, barras: [{ tarea: "bitacora", plan: { desde: "2026-13-45", hasta: "2026-14-01" }, real: null, atrasada: false }] },
      }),
    );
    expect(raiz.textContent).toContain("Semana del 2026-13-45");
    expect(raiz.querySelector("[aria-label='Plan: 2026-13-45 al 2026-14-01']")).not.toBeNull();
  });

  it("muestra la duración y los días de cada tarea", () => {
    const tareas = [...montar(vistaPlan(snapshot)).querySelectorAll(".plan-tarea")];
    const tiempos = tareas.map((t) => t.querySelector(".plan-tarea-tiempos")?.textContent ?? null);
    expect(tiempos).toEqual(["2 d lun–mar", "2 d jue–vie", "4 h vie", "2 d jue–vie", null]);
    expect(tareas[0]?.querySelector(".plan-tarea-tiempos")?.classList.contains("dato")).toBe(true);
  });

  it("una tarea sin duración dice sin estimar y sin días no inventa ninguno", () => {
    const plan = snapshot.plan as NonNullable<Snapshot["plan"]>;
    const tareas = plan.tareas.map((t) => (t.slug === "central" ? { ...t, duracion: null, dias: [] } : t));
    const central = [...montar(vistaPlan({ ...snapshot, plan: { ...plan, tareas } })).querySelectorAll(".plan-tarea")].find((t) =>
      t.textContent?.includes("Central"),
    );
    expect(central?.querySelector(".plan-tarea-tiempos")?.textContent).toBe("sin estimar");
  });

  it("la duración lleva coma decimal, como en es-AR", () => {
    const plan = snapshot.plan as NonNullable<Snapshot["plan"]>;
    const tareas = plan.tareas.map((t) => (t.slug === "central" ? { ...t, duracion: { valor: 1.5, unidad: "d" as const } } : t));
    const central = [...montar(vistaPlan({ ...snapshot, plan: { ...plan, tareas } })).querySelectorAll(".plan-tarea")].find((t) => t.textContent?.includes("Central"));
    expect(central?.querySelector(".plan-tarea-tiempos")?.textContent).toContain("1,5 d");
  });

  it("agrupa los días consecutivos y separa los salteados", () => {
    const plan = snapshot.plan as NonNullable<Snapshot["plan"]>;
    const tareas = plan.tareas.map((t) => (t.slug === "central" ? { ...t, dias: ["2026-10-05", "2026-10-07", "2026-10-08"] } : t));
    const central = [...montar(vistaPlan({ ...snapshot, plan: { ...plan, tareas } })).querySelectorAll(".plan-tarea")].find((t) =>
      t.textContent?.includes("Central"),
    );
    expect(central?.querySelector(".plan-tarea-tiempos")?.textContent).toBe("2 d lun, mié–jue");
  });

  it("avisa qué tarea no entra esta semana", () => {
    const raiz = montar(vistaPlan(tomas));
    const reintentos = [...raiz.querySelectorAll(".plan-tarea")].find((t) => t.textContent?.includes("Reintentos"));
    expect(reintentos?.textContent).toContain("No entra esta semana");
    expect(raiz.querySelectorAll(".plan-no-entra")).toHaveLength(1);
    expect(montar(vistaPlan(snapshot)).textContent).not.toContain("No entra esta semana");
  });

  it("marca ATRASADA solo en las tareas atrasadas, con texto", () => {
    const raiz = montar(vistaPlan(tomas));
    const marcadas = [...raiz.querySelectorAll(".plan-tarea")].filter((t) => t.textContent?.includes("ATRASADA"));
    expect(marcadas).toHaveLength(1);
    expect(marcadas[0]?.textContent).toContain("Ingesta de pedidos");
    expect(marcadas[0]?.querySelector(".marca-atrasada")?.textContent).toBe("ATRASADA");
    expect(montar(vistaPlan(snapshot)).querySelector(".plan-tarea .marca-atrasada")).toBeNull();
  });

  it("la placa suma solo las tareas atrasadas, sin repetir el porcentaje ni afirmar una causa", () => {
    const renglon = (s: Snapshot): string | undefined => montar(vistaPlan(s)).querySelector(".placa-atrasadas")?.textContent ?? undefined;
    expect(renglon(tomas)).toBe("1 tarea atrasada");
    expect(renglon({ ...tomas, desvios: { ...tomas.desvios, tareasAtrasadas: ["ingesta", "validacion"] } })).toBe("2 tareas atrasadas");
    expect(renglon({ ...tomas, desvios: { ...tomas.desvios, tareasAtrasadas: [] } })).toBeUndefined();
    expect(renglon(snapshot)).toBeUndefined();
    expect(montar(vistaPlan(tomas)).querySelector(".placa-alerta")?.textContent?.match(/70%/g)).toHaveLength(1);
  });

  it("la marca ATRASADA va junto al nombre de la tarea", () => {
    const marca = montar(vistaPlan(tomas)).querySelector(".plan-tarea-nombre .marca-atrasada");
    expect(marca?.parentElement?.textContent).toBe("Ingesta de pedidos ATRASADA");
  });
});

describe("Gantt", () => {
  const barras = (s: Snapshot, tarea: string): Element[] => {
    const fila = [...montar(gantt(s)).querySelectorAll(".gantt-fila")].find((f) => f.querySelector(".gantt-nombre")?.textContent === tarea);
    return [...(fila?.querySelectorAll(".gantt-barra") ?? [])];
  };

  it("dibuja la barra de plan desde el rango de los días", () => {
    const [plan] = barras(snapshot, "Pendientes");
    expect(plan?.getAttribute("aria-label")).toBe("Plan: jue–vie");
    expect(plan?.getAttribute("style")).toBe("grid-column: 4 / 6");
  });

  it("una tarea en dos tramos se dibuja con un segmento por tramo, no como un bloque continuo", () => {
    const plan = snapshot.plan as NonNullable<Snapshot["plan"]>;
    const partido: Snapshot = {
      ...snapshot,
      plan: { ...plan, tareas: plan.tareas.map((t) => (t.slug === "central" ? { ...t, dias: ["2026-10-05", "2026-10-08", "2026-10-09"] } : t)) },
      gantt: { ...snapshot.gantt, barras: snapshot.gantt.barras.map((b) => (b.tarea === "central" ? { ...b, plan: { desde: "2026-10-05", hasta: "2026-10-09" } } : b)) },
    };
    const barrasDePlan = barras(partido, "Central").filter((b) => b.classList.contains("gantt-barra-plan"));
    expect(barrasDePlan.map((b) => b.getAttribute("aria-label"))).toEqual(["Plan: lun", "Plan: jue–vie"]);
    expect(barrasDePlan.map((b) => b.getAttribute("style"))).toEqual(["grid-column: 1 / 2", "grid-column: 4 / 6"]);
  });

  it("sin plan no hay barra de plan y se dice por qué", () => {
    const reintentos = [...montar(gantt(tomas)).querySelectorAll(".gantt-fila")].find((f) => f.textContent?.includes("Reintentos"));
    expect(reintentos?.querySelector(".gantt-barra-plan")).toBeNull();
    expect(reintentos?.textContent).toContain("no entra esta semana");
    const sinDuracion = tomas.plan === null ? tomas : { ...tomas, plan: { ...tomas.plan, tareas: tomas.plan.tareas.map((t) => (t.slug === "reintentos" ? { ...t, noEntra: false, duracion: null } : t)) } };
    expect([...montar(gantt(sinDuracion)).querySelectorAll(".gantt-fila")].find((f) => f.textContent?.includes("Reintentos"))?.textContent).toContain("sin estimar");
  });

  it("no trata como fantasma a una tarea del plan sin días", () => {
    const sinDias: Snapshot = { ...tomas, gantt: { ...tomas.gantt, barras: [{ tarea: "reintentos", plan: null, real: { desde: "2026-10-09", hasta: "2026-10-09" }, atrasada: false }] } };
    expect(montar(gantt(sinDias)).textContent).not.toContain("FANTASMA");
  });

  it("un periodo.hasta ilegible no vacía el Gantt: conserva columnas y barras y no dibuja la línea", () => {
    const raiz = montar(gantt({ ...tomas, periodo: { desde: "2026-10-09", hasta: "2026-13-45" } }));
    expect(raiz.querySelectorAll(".gantt-dia").length).toBeGreaterThan(0);
    expect(raiz.querySelectorAll(".gantt-barra").length).toBeGreaterThan(0);
    expect(raiz.querySelector(".gantt-hoy")).toBeNull();
    expect(raiz.querySelector(".gantt-hoy-etiqueta")).toBeNull();
  });

  it("la etiqueta de hoy lleva la fecha para lectores de pantalla", () => {
    const etiqueta = montar(gantt(snapshot)).querySelector(".gantt-hoy-etiqueta");
    expect(etiqueta?.querySelector("[aria-hidden]")?.textContent).toBe("HOY");
    expect(etiqueta?.querySelector(".solo-lectores")?.textContent).toBe("Hoy: vie, 9 oct");
  });

  it("al montarse centra la región desplazable en hoy sin tocar la página", async () => {
    const rect = (left: number, width: number): DOMRect => ({ left, width, right: left + width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) });
    const medir = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return this.classList.contains("gantt-hoy-etiqueta") ? rect(500, 20) : this.classList.contains("gantt-scroll") ? rect(0, 300) : rect(0, 0);
    });
    const scrollTo = vi.spyOn(window, "scrollTo");
    const raiz = montar(gantt(snapshot));
    document.body.append(raiz);
    await new Promise((r) => requestAnimationFrame(r));
    expect(raiz.querySelector(".gantt-scroll")?.scrollLeft).toBe(360);
    expect(scrollTo).not.toHaveBeenCalled();
    raiz.remove();
    medir.mockRestore();
  });

  it("dibuja la línea de hoy con su etiqueta en el día del snapshot", () => {
    const raiz = montar(gantt(snapshot));
    const lineas = raiz.querySelectorAll(".gantt-hoy");
    expect(lineas).toHaveLength(snapshot.gantt.barras.length);
    expect(lineas[0]?.getAttribute("style")).toBe("grid-column: 5 / 6");
    expect(raiz.querySelector(".gantt-hoy-etiqueta")?.textContent).toContain("HOY");
  });

  it("la línea de hoy usa la fecha del snapshot y amplía las columnas si hace falta", () => {
    const manana: Snapshot = { ...snapshot, periodo: { desde: "2026-10-09", hasta: "2026-10-12" } };
    const raiz = montar(gantt(manana));
    expect(raiz.querySelectorAll(".gantt-dia")).toHaveLength(8);
    expect(raiz.querySelector(".gantt-hoy")?.getAttribute("style")).toBe("grid-column: 8 / 9");
  });

  it("la línea de hoy ocupa solo su columna aunque no sea la última: un fin en auto la correría hasta el borde", () => {
    const miercoles: Snapshot = { ...snapshot, periodo: { desde: "2026-10-07", hasta: "2026-10-07" } };
    const raiz = montar(gantt(miercoles));
    expect(raiz.querySelectorAll(".gantt-dia").length).toBeGreaterThan(3);
    const etiqueta = raiz.querySelector<HTMLElement>(".gantt-hoy-etiqueta");
    expect(etiqueta?.getAttribute("style")).toContain("grid-column: 3");
    expect(raiz.querySelector(".gantt-hoy")?.getAttribute("style")).toBe("grid-column: 3 / 4");
  });

  it("marca la barra atrasada por forma y por texto", () => {
    const [plan] = barras(tomas, "Ingesta de pedidos");
    expect(plan?.classList.contains("gantt-barra-atrasada")).toBe(true);
    expect(plan?.getAttribute("aria-label")).toMatch(/^Plan, atrasada/);
    const fila = [...montar(gantt(tomas)).querySelectorAll(".gantt-fila")].find((f) => f.textContent?.includes("Ingesta de pedidos"));
    expect(fila?.textContent).toContain("ATRASADA");
    expect(barras(tomas, "Validación de esquema")[0]?.classList.contains("gantt-barra-atrasada")).toBe(false);
  });

  it("la leyenda suma atrasada y hoy", () => {
    const leyenda = montar(gantt(snapshot)).querySelector(".gantt-leyenda")?.textContent ?? "";
    expect(leyenda).toContain("ATRASADA");
    expect(leyenda).toContain("HOY");
  });

  it("muestra el repo de la tarea como metadato y nada en una tarea sin repo", () => {
    const tareas = [...montar(vistaPlan(snapshot)).querySelectorAll(".plan-tarea")];
    const de = (nombre: string): Element | undefined => tareas.find((t) => t.querySelector(".plan-tarea-nombre")?.textContent?.startsWith(nombre));
    expect(de("Bitácora")?.querySelector(".plan-tarea-repo")?.textContent).toBe("rastro");
    expect(de("Central")?.querySelector(".plan-tarea-repo")?.textContent).toBe("central-api");
    expect(de("Repeticiones")?.querySelector(".plan-tarea-repo")).toBeNull();
  });

  it("distingue dos barras main de repos distintos en la etiqueta", () => {
    const rango = { desde: "2026-10-09", hasta: "2026-10-09" };
    const dos: Snapshot = {
      ...snapshot,
      gantt: {
        mock: false,
        barras: [
          { tarea: "main", repo: "rastro", plan: null, real: rango, atrasada: false },
          { tarea: "main", repo: "central-api", plan: null, real: rango, atrasada: false },
        ],
      },
    };
    const etiquetas = [...montar(gantt(dos)).querySelectorAll(".gantt-tarea")].map((n) => n.textContent ?? "");
    expect(etiquetas[0]).toContain("main");
    expect(etiquetas[0]).toContain("rastro");
    expect(etiquetas[1]).toContain("central-api");
    expect(etiquetas[0]).not.toEqual(etiquetas[1]);
  });

  it("con la salida real de calcularGantt, las barras fantasma de dos repos muestran su repo y la del plan no", () => {
    const commit = (repo: string, rama: string, tarea: string | null): CommitVinculado => ({
      sha: `${repo}${rama}`,
      fecha: new Date("2026-10-09T15:00:00Z"),
      padres: [],
      asunto: "trabajo",
      cuerpo: "",
      archivos: [],
      rama,
      repo,
      vinculo: { tarea, tipo: tarea === null ? "sin-tarea" : "nombre" },
    });
    const plan = snapshot.plan;
    const tarea = plan?.tareas.find((t) => t.repo === "rastro");
    expect(tarea).toBeDefined();
    const barras = calcularGantt(plan, [commit("rastro", "main", null), commit("central-api", "main", null), commit("rastro", "feat/x", tarea?.slug ?? null)], [], "America/Argentina/Buenos_Aires", []);
    const filas = [...montar(gantt({ ...snapshot, gantt: barras })).querySelectorAll(".gantt-fila")];
    const fantasmas = filas.filter((f) => f.classList.contains("gantt-fantasma"));
    expect(fantasmas.map((f) => f.querySelector(".gantt-repo")?.textContent)).toEqual(["rastro", "central-api"]);
    expect(fantasmas.map((f) => f.querySelector(".gantt-nombre")?.textContent)).toEqual(["main", "main"]);
    const delPlan = filas.find((f) => f.querySelector(".gantt-nombre")?.textContent === tarea?.nombre);
    expect(delPlan?.querySelector(".gantt-repo")).toBeNull();
  });

  it("una barra de tarea del plan no repite el repo en la etiqueta", () => {
    const fila = [...montar(gantt(snapshot)).querySelectorAll(".gantt-tarea")].find((f) => f.textContent?.includes("Bitácora"));
    expect(fila?.querySelector(".gantt-repo")).toBeNull();
  });

  it("el ofrecimiento muestra su repo, el estado con que entra y el porque", () => {
    const oferta = montar(vistaPlan(snapshot)).querySelector(".ofrecimiento");
    expect(oferta?.querySelector(".ofrecimiento-duracion")?.textContent).toContain("central-api");
    expect(oferta?.querySelector(".ofrecimiento-duracion")?.textContent).toContain("entra pendiente");
    expect(oferta?.querySelector(".ofrecimiento-porque")?.textContent).toContain("Tres commits");
    const hecha: Snapshot = { ...snapshot, ofrecimientos: [{ ...(snapshot.ofrecimientos[0] as Snapshot["ofrecimientos"][number]), estadoSugerido: "hecha" }] };
    expect(montar(vistaPlan(hecha)).querySelector(".ofrecimiento-duracion")?.textContent).toContain("entra hecha");
  });

  it("un ofrecimiento sin repo ni estado entra pendiente y no inventa repo", () => {
    const { repo: _repo, estadoSugerido: _estado, ...sinNada } = snapshot.ofrecimientos[0] as Snapshot["ofrecimientos"][number];
    const texto = montar(vistaPlan({ ...snapshot, ofrecimientos: [sinNada] })).querySelector(".ofrecimiento-duracion")?.textContent;
    expect(texto).toContain("entra pendiente");
    expect(texto).not.toContain("central-api");
  });

  it("sin daily muestra las tareas de plan.md con su duración, días y repo, y avisa que la bitácora y el Gantt llegan después", () => {
    const sinDaily: Snapshot = {
      ...snapshot,
      bitacora: [],
      desvios: { fueraDelPlanPct: 0, alerta: false, tareasSinActividad: [], tareasAtrasadas: [] },
      ofrecimientos: [],
      gantt: { mock: false, barras: [] },
    };
    const raiz = montar(vistaPlan(sinDaily, { edicion: null, repos: [], sinDaily: { proximoDaily: null } }));
    const nombres = [...raiz.querySelectorAll(".plan-tarea-nombre")].map((n) => n.textContent);
    expect(nombres).toEqual(snapshot.plan?.tareas.map((t) => t.nombre));
    expect(raiz.querySelector(".plan-tarea-tiempos")?.textContent).not.toBe("");
    expect(raiz.querySelector(".gantt")).toBeNull();
    expect(raiz.querySelector(".plan-desvio")).toBeNull();
    expect(raiz.textContent).toContain("después del primer daily. Decile a Claude «cerrá el día».");
    expect(raiz.querySelector("code")?.textContent).toBe("rastro daily");
  });

  it("sin daily el editor de cada tarea sigue disponible cuando hay edición", () => {
    const edicion = { proponer: vi.fn(), cancelar: vi.fn() };
    const raiz = montar(vistaPlan({ ...snapshot, bitacora: [] }, { edicion, repos: [], sinDaily: { proximoDaily: null } }));
    const botones = [...raiz.querySelectorAll("button")].map((b) => b.textContent);
    expect(botones.filter((t) => t?.toLowerCase().includes("editar")).length).toBeGreaterThan(0);
  });
});
