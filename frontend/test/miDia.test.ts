import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validarSnapshot, type EntradaBitacora, type Snapshot } from "../../backend/src/contract/snapshot.ts";
import { vistaMiDia } from "../src/views/miDia.ts";

const leer = (id: string): Snapshot => validarSnapshot(JSON.parse(readFileSync(`ejemplos/persona-${id}.json`, "utf8")));
const snapshot = leer("denis");
const tomas = leer("tomas");

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

  it("sin plan no presenta 0% fuera del plan: dice que no hay plan", () => {
    const raiz = montar({ ...snapshot, plan: null, desvios: { ...snapshot.desvios, fueraDelPlanPct: 0 } });
    expect(raiz.textContent).toContain("Sin plan esta semana");
    expect(raiz.textContent).not.toContain("0%");
    expect(raiz.textContent).not.toContain("FUERA DEL PLAN");
  });

  it("deja como texto el HTML hostil de la bitácora y del resumen", () => {
    const malo = "<img src=x onerror=alert(1)>";
    const raiz = montar({
      ...snapshot,
      resumen: { hice: [malo], avance: [], sigue: [], bloqueos: [] },
      bitacora: [{ ...base, texto: malo, rama: malo, razon: malo, evidencia: [{ tipo: "rama", ref: malo }] }],
    });
    expect(raiz.querySelector("img")).toBeNull();
    expect(raiz.querySelector(".entrada-texto")?.textContent).toBe(malo);
    expect(raiz.querySelector(".razon")?.textContent).toBe(malo);
    expect(raiz.querySelector(".resumen-lista li")?.textContent).toBe(malo);
  });

  it("la lámina sellada lleva el sello completo, con el texto en anillo", () => {
    const sello = montar(snapshot).querySelector("aside");
    expect(sello?.querySelector("textPath")?.textContent).toBe("RESUELTO · SIN CERRAR ·");
    expect(sello?.querySelector("a.boton-primario")).not.toBeNull();
  });

  it("muestra el foco con lo que hace ahora y lo que sigue, con su duración y días", () => {
    const foco = montar(snapshot).querySelector(".foco");
    expect(foco?.textContent).toContain("Ahora: Pendientes");
    expect(foco?.textContent).toContain("Sigue: Repeticiones · 4 h · vie");
    expect(foco?.textContent).not.toContain("Atrasadas");
  });

  it("si la tarea que sigue no entra esta semana, el renglón lo dice", () => {
    const plan = tomas.plan as NonNullable<Snapshot["plan"]>;
    const foco = { actual: "validacion", siguiente: "reintentos" };
    const texto = montar({ ...tomas, foco, plan }).querySelector(".foco")?.textContent;
    expect(texto).toContain("Sigue: Reintentos · 3 d · no entra esta semana");
    expect(montar(tomas).querySelector(".foco")?.textContent).not.toContain("no entra esta semana");
  });

  it("lista las atrasadas en el foco", () => {
    expect(montar(tomas).querySelector(".foco")?.textContent).toContain("Atrasadas: Ingesta de pedidos");
  });

  it("sin foco o con el foco vacío no muestra el bloque ni rompe", () => {
    expect(montar({ ...snapshot, foco: null }).querySelector(".foco")).toBeNull();
    expect(montar({ ...snapshot, foco: { actual: null, siguiente: null } }).querySelector(".foco")).toBeNull();
    expect(montar({ ...snapshot, foco: null }).querySelector(".bitacora")).not.toBeNull();
  });

  it("un foco que apunta a una tarea que ya no está en el plan la nombra por su slug", () => {
    const foco = montar({ ...snapshot, foco: { actual: "tarea-borrada", siguiente: "otra-borrada" } }).querySelector(".foco");
    expect(foco?.textContent).toContain("Ahora: tarea-borrada");
    expect(foco?.textContent).toContain("Sigue: otra-borrada");
  });

  it("marca la entrada corregida con su forma y su texto", () => {
    const entrada = [...montar(tomas).querySelectorAll(".entrada")].find((e) => e.textContent?.includes("corregido"));
    expect(entrada?.querySelector(".marca-estado")?.classList.contains("marca-rombo")).toBe(true);
    expect(entrada?.querySelector(".entrada-tarea")?.textContent).toBe("Validación de esquema");
    const formas = new Set([...montar(tomas).querySelectorAll(".entrada .marca-estado")].map((n) => n.className));
    expect(formas.has("marca-estado marca-rombo")).toBe(true);
  });

  it("con varios repos cada entrada lleva su repo junto a la rama", () => {
    const ramas = [...montar(snapshot).querySelectorAll(".entrada-cuerpo .dato")].map((n) => n.textContent);
    expect(ramas).toContain("central-api · main");
    expect(ramas).toContain("rastro · feat/pendientes");
  });

  it("con un solo repo no lo repite en cada entrada", () => {
    const ramas = [...montar(tomas).querySelectorAll(".entrada-cuerpo .dato")].map((n) => n.textContent ?? "");
    expect(ramas.length).toBeGreaterThan(0);
    expect(ramas.every((r) => !r.includes("pipeline-datos"))).toBe(true);
  });

  it("una entrada sin repo muestra solo la rama aunque haya varios repos", () => {
    const sinRepo: EntradaBitacora = { ...base, repo: null, rama: "feat/suelta" };
    const raiz = montar({ ...snapshot, bitacora: [...snapshot.bitacora, sinRepo] });
    expect([...raiz.querySelectorAll(".entrada-cuerpo .dato")].map((n) => n.textContent)).toContain("feat/suelta");
  });

  it("sin daily muestra primero la frase para Claude y el comando copiable como alternativa, con la hora del automático", () => {
    const raiz = document.createElement("div");
    raiz.append(vistaMiDia({ ...snapshot, bitacora: [] }, { edicion: null, repos: [], sinDaily: { proximoDaily: "18:30" } }));
    expect(raiz.textContent).toContain("Todavía no corrió el daily");
    expect(raiz.textContent).toContain("Decile a Claude «cerrá el día», o esperá al automático de las 18:30");
    expect(raiz.querySelector("pre code")?.textContent).toBe("rastro daily");
    expect([...raiz.querySelectorAll("button")].map((b) => b.textContent)).toContain("Copiar");
    const texto = raiz.textContent ?? "";
    expect(texto.indexOf("Decile a Claude")).toBeLessThan(texto.indexOf("o en la terminal:"));
    expect(texto.indexOf("o en la terminal:")).toBeLessThan(texto.indexOf("rastro daily"));
    expect(raiz.querySelector(".bitacora")).toBeNull();
  });

  it("sin daily y sin daily automático no menciona ninguna hora", () => {
    const raiz = document.createElement("div");
    raiz.append(vistaMiDia(snapshot, { edicion: null, repos: [], sinDaily: { proximoDaily: null } }));
    expect(raiz.textContent).toContain("rastro daily");
    expect(raiz.textContent).not.toContain("automático");
  });
});
