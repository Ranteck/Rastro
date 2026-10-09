import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validarSnapshot, type EntradaBitacora, type Snapshot } from "../../backend/src/contract/snapshot.ts";
import { vistaMiDia } from "../src/views/miDia.ts";

const snapshot = validarSnapshot(JSON.parse(readFileSync("ejemplos/persona-denis.json", "utf8")));

function montar(s: Snapshot): HTMLElement {
  const raiz = document.createElement("div");
  raiz.append(vistaMiDia(s));
  return raiz;
}

const base = snapshot.bitacora[0] as EntradaBitacora;

describe("vista Mi día", () => {
  it("ordena la bitácora de lo más reciente a lo más antiguo", () => {
    const entradas: EntradaBitacora[] = [
      { ...base, fecha: "2026-10-08", hora: "23:00", texto: "ayer tarde" },
      { ...base, fecha: "2026-10-09", hora: "09:00", texto: "hoy temprano" },
      { ...base, fecha: "2026-10-09", hora: "18:00", texto: "hoy tarde" },
    ];
    const textos = [...montar({ ...snapshot, bitacora: entradas }).querySelectorAll(".entrada-texto")].map((n) => n.textContent);
    expect(textos).toEqual(["hoy tarde", "hoy temprano", "ayer tarde"]);
  });

  it("muestra la entrada inferida con su razón", () => {
    const entrada = [...montar(snapshot).querySelectorAll(".entrada")].find((e) => e.textContent?.includes("inferido"));
    expect(entrada?.textContent).toContain("El commit toca la validación del endpoint de publicación del central.");
    expect(entrada?.querySelector(".entrada-margen a")?.textContent).toBe("4e81d07");
    expect(entrada?.querySelector(".entrada-tarea")?.textContent).toBe("Central");
  });

  it("muestra el vínculo por nombre y las entradas sin tarea", () => {
    const sinTarea: EntradaBitacora = { ...base, tarea: null, vinculo: "sin-tarea", texto: "algo suelto" };
    const raiz = montar({ ...snapshot, bitacora: [base, sinTarea] });
    expect(raiz.textContent).toContain("por nombre");
    expect(raiz.textContent).toContain("sin tarea");
  });

  it("muestra los cuatro bloques del resumen", () => {
    const titulos = [...montar(snapshot).querySelectorAll(".resumen-titulo")].map((n) => n.textContent);
    expect(titulos).toEqual(["Hice", "Avancé", "Sigue", "Bloqueos"]);
  });

  it("marca con una raya las columnas vacías del resumen", () => {
    const resumen = { hice: [], avance: [], sigue: [], bloqueos: [] };
    const columnas = [...montar({ ...snapshot, resumen }).querySelectorAll(".resumen-columna")];
    expect(columnas.map((c) => c.querySelector("p")?.textContent)).toEqual(["—", "—", "—", "—"]);
  });

  it("sin resumen avisa y deja ver la bitácora entera", () => {
    const raiz = montar({ ...snapshot, resumen: null });
    expect(raiz.textContent).toContain("Sin resumen: el LLM no estuvo disponible en esta corrida.");
    expect(raiz.querySelectorAll(".entrada")).toHaveLength(snapshot.bitacora.length);
  });

  it("da formato es-AR al costo", () => {
    const raiz = montar(snapshot);
    expect(raiz.querySelector(".costo")?.textContent).toBe("4 llamadas · US$0,0812 · 18.450 tokens");
  });

  it("muestra la placa solo con alerta", () => {
    expect(montar(snapshot).querySelector(".placa-alerta")).toBeNull();
    const raiz = montar({ ...snapshot, desvios: { ...snapshot.desvios, alerta: true } });
    expect(raiz.querySelector(".placa-alerta")?.textContent).toContain("FUERA DEL PLAN");
  });

  it("linkea a pendientes solo si hay resueltos sin cerrar", () => {
    const con = montar(snapshot);
    expect(con.textContent).toContain("1 resuelto sin cerrar");
    expect(con.querySelector("aside a")?.getAttribute("href")).toBe(`#/persona/${snapshot.persona.id}/pendientes`);
    const sin = montar({ ...snapshot, pendientes: snapshot.pendientes.filter((p) => p.tipo !== "resuelto-sin-cerrar") });
    expect(sin.querySelector("aside")).toBeNull();
  });

  it("muestra la frase cuando la bitácora está vacía", () => {
    expect(montar({ ...snapshot, bitacora: [] }).textContent).toContain("Hoy no hay actividad registrada.");
  });

  it("renderiza las 49 entradas con el texto completo", () => {
    const largo = "commit ".repeat(80);
    const muchas = Array.from({ length: 49 }, (_, i): EntradaBitacora => ({ ...base, hora: `${String(i % 24).padStart(2, "0")}:00`, texto: largo }));
    const entradas = montar({ ...snapshot, bitacora: muchas }).querySelectorAll(".entrada");
    expect(entradas).toHaveLength(49);
    expect(entradas[0]?.querySelector(".entrada-texto")?.textContent).toBe(largo);
  });

  it("muestra la fecha cruda si el periodo no es una fecha real", () => {
    const raiz = montar({ ...snapshot, periodo: { desde: "2026-13-45", hasta: "2026-13-45" } });
    expect(raiz.textContent).toContain("2026-13-45");
  });

  it("omite la lista de evidencia cuando una entrada no tiene", () => {
    const raiz = montar({ ...snapshot, bitacora: [{ ...base, evidencia: [] }] });
    expect(raiz.querySelector(".entrada ul")).toBeNull();
  });
});
