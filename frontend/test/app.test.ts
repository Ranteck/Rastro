import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorApi, type Api } from "../src/api.ts";
import { montarApp, type Vistas } from "../src/app.ts";
import { parsearRuta } from "../src/router.ts";
import { h } from "../src/ui/dom.ts";
import { vistas as vistasReales } from "../src/views/index.ts";
import { validarSnapshot } from "../../backend/src/contract/snapshot.ts";
import { checkEquipo } from "../../backend/src/contract/equipo.ts";

const snapshot = validarSnapshot(JSON.parse(readFileSync("ejemplos/persona-denis.json", "utf8")));
const filas = checkEquipo(JSON.parse(readFileSync("ejemplos/equipo.json", "utf8")), "equipo").equipo;

const vistas: Vistas = {
  equipo: (f) => h("p", {}, `equipo:${f.length}`),
  persona: {
    "mi-dia": (s) => h("p", {}, `mi-dia:${s.persona.id}`),
    pendientes: (s) => h("p", {}, `pendientes:${s.persona.id}`),
    plan: (s) => h("p", {}, `plan:${s.persona.id}`),
    sugerencias: (s) => h("p", {}, `sugerencias:${s.persona.id}`),
  },
};

async function irA(hash: string): Promise<void> {
  window.location.hash = hash;
  await pausa();
}

const pausa = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function apiDoble(over: Partial<Api> = {}): Api {
  return {
    cargarEquipo: vi.fn(async () => filas),
    cargarPersona: vi.fn(async () => snapshot),
    ...over,
  };
}

let raiz: HTMLElement;
let desmontar: (() => void)[] = [];
const montar = (o: Parameters<typeof montarApp>[0]): void => void desmontar.push(montarApp(o));
afterEach(() => {
  desmontar.forEach((f) => f());
  desmontar = [];
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  // jsdom no implementa ninguno de los dos.
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: vi.fn(), configurable: true, writable: true });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: false, media: consulta, addEventListener: vi.fn() }));
  document.body.innerHTML = '<div id="app"></div>';
  raiz = document.getElementById("app") as HTMLElement;
});

describe("router", () => {
  it("parsea las rutas conocidas", () => {
    expect(parsearRuta("")).toEqual({ tipo: "equipo" });
    expect(parsearRuta("#/")).toEqual({ tipo: "equipo" });
    expect(parsearRuta("#/equipo")).toEqual({ tipo: "equipo" });
    expect(parsearRuta("#/persona/denis/mi-dia")).toEqual({ tipo: "persona", id: "denis", vista: "mi-dia" });
    expect(parsearRuta("#/persona/denis/otra")).toEqual({ tipo: "desconocida" });
  });
});

describe("montarApp", () => {
  it("abrir directo #/persona/denis/pendientes monta esa vista con el snapshot", async () => {
    await irA("#/persona/denis/pendientes");
    const api = apiDoble();
    montar({ raiz, api, vistas });
    await pausa();
    expect(raiz.querySelector("#contenido")?.textContent).toBe("pendientes:denis");
    expect(api.cargarPersona).toHaveBeenCalledWith("denis");
    const activa = raiz.querySelector('[aria-current="page"]');
    expect(activa?.textContent).toBe("Pendientes");
    expect(raiz.querySelector(".token-persona")?.textContent).toBe(snapshot.persona.nombre);
  });

  it("cambiar de pestaña de la misma persona reusa el snapshot", async () => {
    await irA("#/persona/denis/pendientes");
    const api = apiDoble();
    montar({ raiz, api, vistas });
    await pausa();
    window.location.hash = "#/persona/denis/plan";
    await pausa();
    expect(raiz.querySelector("#contenido")?.textContent).toBe("plan:denis");
    expect(api.cargarPersona).toHaveBeenCalledTimes(1);
  });

  it("volver a una persona o a Equipo pide los datos de nuevo", async () => {
    await irA("#/persona/denis/mi-dia");
    const api = apiDoble();
    montar({ raiz, api, vistas });
    await pausa();
    await irA("#/equipo");
    await irA("#/persona/denis/mi-dia");
    expect(api.cargarPersona).toHaveBeenCalledTimes(2);
    expect(api.cargarEquipo).toHaveBeenCalledTimes(1);
  });

  it("al cambiar de vista vuelve arriba, y no en la carga inicial", async () => {
    await irA("#/persona/denis/pendientes");
    montar({ raiz, api: apiDoble(), vistas });
    await pausa();
    expect(window.scrollTo).not.toHaveBeenCalled();
    await irA("#/persona/denis/plan");
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    expect(document.activeElement).toBe(raiz.querySelector("#contenido"));
  });

  it("lleva la pestaña activa a la vista", async () => {
    await irA("#/persona/denis/plan");
    montar({ raiz, api: apiDoble(), vistas });
    await pausa();
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
    const llamada = scrollIntoView.mock.contexts.at(-1) as HTMLElement;
    expect(llamada.textContent).toBe("Plan");
  });

  it("una ruta desconocida muestra el aviso con link a Equipo", async () => {
    for (const hash of ["#/nada", "#/persona/denis/otra"]) {
      await irA(hash);
      montar({ raiz, api: apiDoble(), vistas });
      await pausa();
      expect(raiz.querySelector("#contenido")?.textContent).toContain("No encontré esa página");
      expect(raiz.querySelector("#contenido a")?.getAttribute("href")).toBe("#/equipo");
    }
  });

  it("Reintentar vuelve a pedir y renderiza cuando el central responde", async () => {
    await irA("#/equipo");
    const cargarEquipo = vi
      .fn<Api["cargarEquipo"]>()
      .mockRejectedValueOnce(new ErrorApi("central"))
      .mockResolvedValue(filas);
    montar({ raiz, api: apiDoble({ cargarEquipo }), vistas });
    await pausa();
    expect(raiz.querySelector("#contenido")?.textContent).toContain("No pude hablar con el central");
    const boton = [...raiz.querySelectorAll("button")].find((b) => b.textContent === "Reintentar");
    boton?.click();
    await pausa();
    expect(cargarEquipo).toHaveBeenCalledTimes(2);
    expect(raiz.querySelector("#contenido")?.textContent).toBe(`equipo:${filas.length}`);
  });

  it("una persona inexistente muestra el aviso y el link a #/equipo", async () => {
    await irA("#/persona/nadie/plan");
    const api = apiDoble({ cargarPersona: vi.fn(async () => Promise.reject(new ErrorApi("no-encontrada"))) });
    montar({ raiz, api, vistas });
    await pausa();
    const contenido = raiz.querySelector("#contenido");
    expect(contenido?.textContent).toContain("No encontré a esa persona");
    expect(contenido?.querySelector("a")?.getAttribute("href")).toBe("#/equipo");
  });

  it("una vista que tira muestra el error con Reintentar, no Cargando", async () => {
    await irA("#/equipo");
    const rechazos: unknown[] = [];
    const registrar = (e: unknown): number => rechazos.push(e);
    process.on("unhandledRejection", registrar);
    const rota: Vistas = { ...vistas, equipo: () => { throw new Error("bug"); } };
    montar({ raiz, api: apiDoble(), vistas: rota });
    await pausa();
    process.off("unhandledRejection", registrar);
    const contenido = raiz.querySelector("#contenido");
    expect(contenido?.textContent).toContain("No pude mostrar esta vista");
    expect(contenido?.textContent).not.toContain("Cargando");
    expect([...raiz.querySelectorAll("button")].some((b) => b.textContent === "Reintentar")).toBe(true);
    expect(rechazos).toEqual([]);
  });

  it("un error inesperado de la api también cae en el estado de error", async () => {
    await irA("#/equipo");
    const api = apiDoble({ cargarEquipo: vi.fn(async () => Promise.reject(new TypeError("raro"))) });
    montar({ raiz, api, vistas });
    await pausa();
    expect(raiz.querySelector("#contenido")?.textContent).toContain("No pude mostrar esta vista");
  });

  it("una persona inexistente es un rechazo esperado: no se registra como error", async () => {
    await irA("#/persona/nadie/plan");
    const api = apiDoble({ cargarPersona: vi.fn(async () => Promise.reject(new ErrorApi("no-encontrada"))) });
    montar({ raiz, api, vistas });
    await pausa();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("la etiqueta de modo ejemplos está en la barra solo en ese modo", async () => {
    await irA("#/equipo");
    montar({ raiz, api: apiDoble(), vistas });
    expect(raiz.querySelector(".barra .etiqueta-mock")).toBeNull();
    document.body.innerHTML = '<div id="app"></div>';
    const otra = document.getElementById("app") as HTMLElement;
    montar({ raiz: otra, api: apiDoble(), vistas, modoEjemplos: true });
    expect(otra.querySelector(".barra .etiqueta-mock")?.textContent).toBe("MODO EJEMPLOS");
  });

  it("el botón de tema sigue en la barra", async () => {
    await irA("#/equipo");
    montar({ raiz, api: apiDoble(), vistas });
    expect(raiz.querySelector(".boton-tema")).not.toBeNull();
  });
});

describe("montarApp con las vistas reales", () => {
  const secciones: [string, string][] = [
    ["#/equipo", "Equipo"],
    ["#/persona/denis/mi-dia", "Mi día"],
    ["#/persona/denis/pendientes", "Pendientes"],
    ["#/persona/denis/plan", "Plan"],
    ["#/persona/denis/sugerencias", "Sugerencias"],
  ];

  it("cada hash monta su vista", async () => {
    await irA("#/equipo");
    montar({ raiz, api: apiDoble(), vistas: vistasReales });
    await pausa();
    for (const [hash, etiqueta] of secciones) {
      await irA(hash);
      const seccion = raiz.querySelector("#contenido > section");
      expect(seccion?.getAttribute("aria-label"), hash).toBe(etiqueta);
      expect(seccion?.querySelector("h1"), hash).not.toBeNull();
    }
  });
});
