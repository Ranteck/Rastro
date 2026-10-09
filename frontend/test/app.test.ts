import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorApi, type Api } from "../src/api.ts";
import { montarApp, type Vistas } from "../src/app.ts";
import { parsearRuta } from "../src/router.ts";
import { h } from "../src/ui/dom.ts";
import { validarSnapshot } from "../../backend/src/contract/snapshot.ts";
import { checkEquipo } from "../../backend/src/contract/equipo.ts";

const snapshot = validarSnapshot(JSON.parse(readFileSync("ejemplos/persona-denis.json", "utf8")));
const filas = checkEquipo(JSON.parse(readFileSync("ejemplos/equipo.json", "utf8")), "equipo").equipo;

const vistas: Vistas = {
  equipo: (f) => h("p", {}, `equipo:${f.length}`),
  persona: {
    pendientes: (s) => h("p", {}, `pendientes:${s.persona.id}`),
    plan: (s) => h("p", {}, `plan:${s.persona.id}`),
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
beforeEach(() => {
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
    montarApp({ raiz, api, vistas });
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
    montarApp({ raiz, api, vistas });
    await pausa();
    window.location.hash = "#/persona/denis/plan";
    await pausa();
    expect(raiz.querySelector("#contenido")?.textContent).toBe("plan:denis");
    expect(api.cargarPersona).toHaveBeenCalledTimes(1);
  });

  it("una ruta desconocida o sin vista registrada muestra el aviso con link a Equipo", async () => {
    for (const hash of ["#/nada", "#/persona/denis/sugerencias"]) {
      await irA(hash);
      montarApp({ raiz, api: apiDoble(), vistas });
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
    montarApp({ raiz, api: apiDoble({ cargarEquipo }), vistas });
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
    montarApp({ raiz, api, vistas });
    await pausa();
    const contenido = raiz.querySelector("#contenido");
    expect(contenido?.textContent).toContain("No encontré a esa persona");
    expect(contenido?.querySelector("a")?.getAttribute("href")).toBe("#/equipo");
  });

  it("el botón de tema sigue en la barra", async () => {
    await irA("#/equipo");
    montarApp({ raiz, api: apiDoble(), vistas });
    expect(raiz.querySelector(".boton-tema")).not.toBeNull();
  });
});
