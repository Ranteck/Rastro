import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorApi, type Api, type Sesion } from "../src/api.ts";
import { montarApp, type Vistas } from "../src/app.ts";
import { FRASES_CLAUDE } from "../src/ui/claude.ts";
import { h } from "../src/ui/dom.ts";
import { vistas as vistasReales } from "../src/views/index.ts";
import { vistaMiDia } from "../src/views/miDia.ts";
import { vistaPendientes } from "../src/views/pendientes.ts";
import { vistaPlan } from "../src/views/plan.ts";
import { validarSnapshot } from "../../backend/src/contract/snapshot.ts";
import { checkEquipo } from "../../backend/src/contract/equipo.ts";

const snapshot = validarSnapshot(JSON.parse(readFileSync("ejemplos/persona-denis.json", "utf8")));
const filas = checkEquipo(JSON.parse(readFileSync("ejemplos/equipo.json", "utf8")), "equipo").equipo;
const PERSONAL: Sesion = { personal: true, persona: { id: "denis", nombre: "Denis", equipo: "AI Day" }, dir: "/tmp/rastro", repos: [] };

const vistas: Vistas = {
  equipo: (f) => h("p", {}, `equipo:${f.length}`),
  persona: {
    "mi-dia": (s) => h("p", {}, `mi-dia:${s.persona.id}`),
    pendientes: (s) => h("p", {}, `pendientes:${s.persona.id}`),
    plan: (s) => h("p", {}, `plan:${s.persona.id}`),
    sugerencias: (s) => h("p", {}, `sugerencias:${s.persona.id}`),
  },
  chat: () => h("p", {}, "chat"),
};

const pausa = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function apiDoble(sesion: Sesion, over: Partial<Api> = {}): Api {
  return {
    cargarEquipo: vi.fn(async () => filas),
    cargarPersona: vi.fn(async () => snapshot),
    cargarSesion: vi.fn(async () => sesion),
    enviarCambios: vi.fn(async () => ({ vistaPrevia: [], aplicado: false })),
    enviarMensaje: vi.fn(async () => ({ respuesta: "", cambios: [], vistaPrevia: [] })),
    cargarChat: vi.fn(async () => null),
    ...over,
  };
}

let raiz: HTMLElement;
let desmontar: (() => void)[] = [];
const montar = async (api: Api, hash: string, v: Vistas = vistas): Promise<void> => {
  window.location.hash = hash;
  desmontar.push(montarApp({ raiz, api, vistas: v }));
  await pausa();
  await pausa();
};
const pestanas = (): string[] => [...raiz.querySelectorAll(".pestana")].map((p) => p.textContent ?? "");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: vi.fn(), configurable: true, writable: true });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: false, media: consulta, addEventListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
  document.body.innerHTML = '<div id="app"></div>';
  raiz = document.getElementById("app") as HTMLElement;
});
afterEach(() => {
  desmontar.forEach((f) => f());
  desmontar = [];
  vi.restoreAllMocks();
});

describe("modo personal: sin la vista Equipo", () => {
  it("no muestra la pestaña Equipo y la ruta por defecto es Mi día", async () => {
    const api = apiDoble(PERSONAL);
    await montar(api, "");

    expect(pestanas()).toEqual(["Mi día", "Pendientes", "Plan", "Sugerencias", "Chat"]);
    expect(raiz.querySelector("#contenido")?.textContent).toBe("mi-dia:denis");
    expect(window.location.hash).toBe("#/persona/denis/mi-dia");
    expect(api.cargarEquipo).not.toHaveBeenCalled();
  });

  it("#/equipo también cae en Mi día y no se pide el equipo", async () => {
    const api = apiDoble(PERSONAL);
    await montar(api, "#/equipo");

    expect(raiz.querySelector("#contenido")?.textContent).toBe("mi-dia:denis");
    expect(pestanas()).not.toContain("Equipo");
    expect(api.cargarEquipo).not.toHaveBeenCalled();
  });

  it("las rutas perdidas vuelven a Mi día y no a Equipo", async () => {
    await montar(apiDoble(PERSONAL), "#/nada");
    expect(raiz.querySelector("#contenido")?.textContent).toContain("No encontré esa página");
    expect(raiz.querySelector("#contenido a")?.getAttribute("href")).toBe("#/persona/denis/mi-dia");
    expect(raiz.querySelector("#contenido a")?.textContent).toBe("Ir a Mi día");

    desmontar.forEach((f) => f());
    desmontar = [];
    const api = apiDoble(PERSONAL, { cargarPersona: vi.fn(async () => Promise.reject(new ErrorApi("no-encontrada"))) });
    await montar(api, "#/persona/nadie/plan");
    expect(raiz.querySelector("#contenido a")?.getAttribute("href")).toBe("#/persona/denis/mi-dia");
  });

  it("el modo equipo sigue mostrando la pestaña Equipo y su vista", async () => {
    const api = apiDoble({ personal: false });
    await montar(api, "#/equipo");

    expect(pestanas()).toEqual(["Equipo"]);
    expect(raiz.querySelector("#contenido")?.textContent).toBe(`equipo:${filas.length}`);

    await montar(apiDoble({ personal: false }), "#/persona/denis/plan");
    expect(pestanas()).toEqual(["Equipo", "Mi día", "Pendientes", "Plan", "Sugerencias"]);
  });

  it("con las vistas reales, el modo equipo conserva el estado vacío sobre publish y el personal no llega a verlo", async () => {
    await montar(apiDoble({ personal: false }, { cargarEquipo: vi.fn(async () => []) }), "#/equipo", vistasReales);
    expect(raiz.querySelector("#contenido")?.textContent).toContain("rastro publish");

    desmontar.forEach((f) => f());
    desmontar = [];
    await montar(apiDoble(PERSONAL, { cargarEquipo: vi.fn(async () => []) }), "#/equipo", vistasReales);
    expect(raiz.textContent).not.toContain("rastro publish");
  });
});

describe("plan de la semana que viene en la respuesta del central", () => {
  it("la vista Plan recibe `queViene` en su contexto", async () => {
    let recibido: unknown;
    const conPlan: Vistas = { ...vistas, persona: { ...vistas.persona, plan: (_s, c) => h("p", {}, ((recibido = c.queViene), "plan")) } };
    const api = apiDoble(PERSONAL, { cargarPersona: vi.fn(async () => ({ ...snapshot, plan: null, queViene: { semana: "2026-10-19", tareas: 5 } })) });
    await montar(api, "#/persona/denis/plan", conPlan);
    expect(recibido).toEqual({ semana: "2026-10-19", tareas: 5 });
  });
});

describe("estados vacíos: primero lo que se le dice a Claude, el comando como alternativa", () => {
  const skill = readFileSync("../plugin/skills/rastro/SKILL.md", "utf8");
  const descripcion = /^description: (.+)$/m.exec(skill)?.[1] ?? "";
  const sinDaily = { edicion: null, repos: [], sinDaily: { proximoDaily: null } };

  const estados: [string, () => Node][] = [
    ["Mi día sin daily", () => vistaMiDia(snapshot, sinDaily)],
    ["Pendientes sin daily", () => vistaPendientes(snapshot, sinDaily)],
    ["Plan sin plan", () => vistaPlan({ ...snapshot, plan: null })],
    ["Plan sin daily", () => vistaPlan(snapshot, sinDaily)],
  ];

  for (const [nombre, vista] of estados) {
    it(`${nombre}: la frase para Claude va antes que el comando, y es un disparador de la skill`, () => {
      const contenedor = document.createElement("div");
      contenedor.append(vista());
      const texto = contenedor.textContent ?? "";
      const frases = [...texto.matchAll(/«([^»]+)»/g)].map((m) => m[1] ?? "");

      expect(frases.length).toBeGreaterThan(0);
      for (const frase of frases) expect(descripcion, frase).toContain(frase);
      expect([...contenedor.querySelectorAll("code")].some((c) => /^rastro /.test(c.textContent ?? ""))).toBe(true);
      expect(texto.indexOf("Decile a Claude")).toBeGreaterThanOrEqual(0);
      expect(texto.indexOf("Decile a Claude")).toBeLessThan(texto.indexOf("o en la terminal:"));
      expect(texto.indexOf("o en la terminal:")).toBeLessThan(texto.indexOf("rastro ", texto.indexOf("o en la terminal:")));
    });
  }

  it("Plan y Pendientes dan el comando en el mismo bloque copiable que Mi día", () => {
    for (const vista of [() => vistaPlan({ ...snapshot, plan: null }), () => vistaPendientes(snapshot, sinDaily), () => vistaPlan(snapshot, sinDaily), () => vistaMiDia(snapshot, sinDaily)]) {
      const contenedor = document.createElement("div");
      contenedor.append(vista());
      expect([...contenedor.querySelectorAll("button")].map((b) => b.textContent)).toContain("Copiar");
      expect([...contenedor.querySelectorAll("pre code")].some((c) => /^rastro /.test(c.textContent ?? ""))).toBe(true);
    }
  });

  it("Plan con plan solo para la semana que viene lo dice y no ofrece armar uno", () => {
    const contenedor = document.createElement("div");
    contenedor.append(vistaPlan({ ...snapshot, plan: null }, { edicion: null, repos: [], queViene: { semana: "2026-10-19", tareas: 2 } }));
    const texto = contenedor.textContent ?? "";
    expect(texto).toContain("No hay plan esta semana, pero ya está el de la semana del 19 de octubre de 2026 (2 tareas): arranca el lunes.");
    expect(texto).not.toContain("Decile a Claude");
    expect(contenedor.querySelector("code")).toBeNull();
  });

  it("todas las frases del dashboard son disparadores de SKILL.md", () => {
    for (const frase of Object.values(FRASES_CLAUDE)) expect(descripcion).toContain(frase);
  });
});
