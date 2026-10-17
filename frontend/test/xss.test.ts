import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkEquipo } from "../../backend/src/contract/equipo.ts";
import { validarSnapshot } from "../../backend/src/contract/snapshot.ts";
import type { Api } from "../src/api.ts";
import { montarApp } from "../src/app.ts";
import { vistas } from "../src/views/index.ts";

const PAYLOAD = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';
// Campos que el contrato exige con un formato fijo (slugs, fechas, enums, URLs): el resto es texto libre de commits o del LLM.
const FORMATO_FIJO = new Set([
  "id", "slug", "tarea", "tareasSinActividad", "tipo", "vinculo", "estado", "fuente", "fecha", "hora",
  "desde", "hasta", "semana", "generadoEn", "ultimoUpdate", "url", "unidad", "dias", "tareasAtrasadas", "actual", "siguiente", "estadoSugerido",
]);

function hostil(valor: unknown, clave = ""): unknown {
  if (typeof valor === "string") return FORMATO_FIJO.has(clave) ? valor : `${PAYLOAD}${valor}`;
  if (Array.isArray(valor)) return valor.map((v) => hostil(v, clave));
  if (valor !== null && typeof valor === "object") {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, hostil(v, k)]));
  }
  return valor;
}

const leer = (archivo: string): unknown => JSON.parse(readFileSync(`ejemplos/${archivo}`, "utf8"));
const snapshot = validarSnapshot(hostil(leer("persona-denis.json")));
const filas = checkEquipo(hostil(leer("equipo.json")), "equipo").equipo;

const pausa = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
let desmontar: () => void;

beforeEach(() => {
  vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: false, media: consulta, addEventListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: vi.fn(), configurable: true, writable: true });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  desmontar();
  vi.restoreAllMocks();
});

describe("XSS de punta a punta", () => {
  it("el texto hostil del snapshot y del equipo llega como texto en las cinco vistas", async () => {
    const api: Api = {
      cargarEquipo: async () => filas,
      cargarPersona: async () => snapshot,
      cargarSesion: async () => ({ personal: false }),
      enviarCambios: async () => ({ vistaPrevia: [], aplicado: false }),
      enviarMensaje: async () => ({ respuesta: "", cambios: [], vistaPrevia: [] }),
      cargarChat: async () => null,
    };
    window.location.hash = "#/equipo";
    const raiz = document.getElementById("app") as HTMLElement;
    desmontar = montarApp({ raiz, api, vistas });
    await pausa();

    for (const hash of ["#/equipo", "#/persona/denis/mi-dia", "#/persona/denis/pendientes", "#/persona/denis/plan", "#/persona/denis/sugerencias"]) {
      window.location.hash = hash;
      await pausa();
      const contenido = raiz.querySelector("#contenido") as HTMLElement;
      expect(contenido.textContent, hash).toContain(PAYLOAD);
      expect(contenido.querySelector("img, script, iframe, [onerror], [onclick]"), hash).toBeNull();
    }
    expect(raiz.querySelector(".token-persona")?.textContent).toContain(PAYLOAD);
    expect(raiz.querySelector("img, script")).toBeNull();
    expect((window as unknown as Record<string, unknown>)["__xss"]).toBeUndefined();
  });

  it("el editor de tarea escapa un nombre de repo hostil y no ofrece los que el contrato rechaza", async () => {
    // Sin espacios: es un nombre que el cambio `repo` acepta, así que llega al <select> y tiene que salir como texto.
    const hostilValido = "<img/src=x/onerror=window.__xss=1>";
    const conEspacios = '<img src=x onerror="window.__xss=1">';
    const original = validarSnapshot(leer("persona-denis.json"));
    const tareas = (original.plan?.tareas ?? []).map((t, i) => ({ ...t, repo: i === 0 ? hostilValido : conEspacios }));
    const propio = { ...original, plan: original.plan === null ? null : { ...original.plan, tareas } };
    const api: Api = {
      cargarEquipo: async () => filas,
      cargarPersona: async () => propio,
      cargarSesion: async () => ({ personal: true, persona: { id: "denis", nombre: "Denis", equipo: "AI Day" }, dir: "/r", repos: [], token: "t" }),
      enviarCambios: async () => ({ vistaPrevia: [], aplicado: false }),
      enviarMensaje: async () => ({ respuesta: "", cambios: [], vistaPrevia: [] }),
      cargarChat: async () => null,
    };
    window.location.hash = "#/persona/denis/plan";
    const raiz = document.getElementById("app") as HTMLElement;
    desmontar = montarApp({ raiz, api, vistas });
    await pausa();
    const editar = [...raiz.querySelectorAll("button")].find((b) => b.textContent === "Editar");
    editar?.click();
    await pausa();

    const opciones = [...raiz.querySelectorAll<HTMLOptionElement>(".plan-tarea select option")].map((o) => o.value);
    expect(opciones).toContain(hostilValido);
    expect(opciones).not.toContain(conEspacios);
    expect(raiz.querySelector("#contenido")?.textContent).toContain(hostilValido);
    expect(raiz.querySelector("#contenido img, #contenido script, #contenido [onerror]")).toBeNull();
    expect((window as unknown as Record<string, unknown>)["__xss"]).toBeUndefined();
  });
});
