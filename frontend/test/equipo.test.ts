import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkEquipo } from "../../backend/src/contract/equipo.ts";
import { formatearUltimoUpdate, vistaEquipo } from "../src/views/equipo.ts";

const filas = checkEquipo(JSON.parse(readFileSync("ejemplos/equipo.json", "utf8")), "equipo").equipo;
const AHORA = new Date("2026-10-09T21:00:00Z");

function montar(f = filas): HTMLElement {
  const raiz = document.createElement("div");
  raiz.append(vistaEquipo(f, AHORA));
  return raiz;
}

describe("vista Equipo", () => {
  it("renderiza una lámina por persona, cada una un único link a su Mi día", () => {
    const laminas = [...montar().querySelectorAll("a.lamina")];
    expect(laminas).toHaveLength(filas.length);
    const destinos = laminas.map((a) => a.getAttribute("href"));
    expect(destinos).toContain("#/persona/denis/mi-dia");
    expect(destinos).toContain("#/persona/lucia/mi-dia");
  });

  it("marca con la placa y DESVÍO solo a la persona con alerta, y la pone primero", () => {
    const laminas = [...montar().querySelectorAll("a.lamina")];
    const placas = laminas.filter((a) => a.classList.contains("placa-alerta"));
    expect(placas).toHaveLength(1);
    expect(placas[0]?.getAttribute("href")).toBe("#/persona/tomas/mi-dia");
    expect(placas[0]?.textContent).toContain("DESVÍO");
    expect(laminas[0]).toBe(placas[0]);
    expect(laminas.filter((a) => a.textContent?.includes("DESVÍO"))).toHaveLength(1);
  });

  it("ordena el resto por nombre, no por porcentaje", () => {
    const nombres = [...montar().querySelectorAll(".persona-nombre")].map((n) => n.textContent);
    expect(nombres).toEqual(["Tomás Ríos", "Denis", "Lucía Gómez"]);
  });

  it("muestra el número de personas con desvío y el total", () => {
    const raiz = montar();
    expect(raiz.querySelector(".display")?.textContent).toBe("1");
    expect(raiz.querySelector(".protagonista")?.textContent).toContain("CON DESVÍO");
    expect(raiz.querySelector(".protagonista")?.textContent).toContain("de 3 personas");
  });

  it("muestra hechas sobre totales, pendientes, % fuera del plan y último update", () => {
    const denis = montar().querySelector('a[href="#/persona/denis/mi-dia"]');
    expect(denis?.textContent).toContain("AI Day · rastro");
    expect(denis?.textContent).toContain("1 de 4");
    expect(denis?.textContent).toContain("25%");
    expect(denis?.textContent).toContain("hoy 18:30");
  });

  it("muestra la frase cuando no hay nadie", () => {
    expect(montar([]).textContent).toBe("Todavía nadie publicó su día. Cuando alguien corra `rastro publish`, aparece acá.");
  });
});

describe("formatearUltimoUpdate", () => {
  it("usa hora de Buenos Aires y distingue hoy de otro día", () => {
    expect(formatearUltimoUpdate("2026-10-09T18:30:00-03:00", AHORA)).toBe("hoy 18:30");
    expect(formatearUltimoUpdate("2026-10-08T17:45:00-03:00", AHORA)).toBe("8 oct 17:45");
    expect(formatearUltimoUpdate("2026-10-09T23:30:00Z", new Date("2026-10-10T02:00:00Z"))).toBe("hoy 20:30");
  });

  it("devuelve el texto original si no es una fecha", () => {
    expect(formatearUltimoUpdate("ayer", AHORA)).toBe("ayer");
  });
});
