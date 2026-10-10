import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validarSnapshot, type Pendiente, type Snapshot } from "../../backend/src/contract/snapshot.ts";
import { vistaPendientes } from "../src/views/pendientes.ts";

const snapshot = validarSnapshot(JSON.parse(readFileSync("ejemplos/persona-denis.json", "utf8")));

function montar(s: Snapshot): HTMLElement {
  const raiz = document.createElement("div");
  raiz.append(vistaPendientes(s));
  return raiz;
}

function conPendientes(pendientes: Pendiente[]): Snapshot {
  return { ...snapshot, pendientes };
}

describe("vista Pendientes", () => {
  it("pone primero el resuelto sin cerrar, con el sello y el tipo escrito", () => {
    const desordenado = conPendientes([...snapshot.pendientes].reverse());
    const laminas = [...montar(desordenado).querySelectorAll("article")];
    const primera = laminas[0];
    expect(primera?.textContent).toContain("Resuelto sin cerrar");
    expect(primera?.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(primera?.querySelector("textPath")?.textContent).toBe("RESUELTO · SIN CERRAR ·");
    expect(laminas.slice(1).some((l) => l.querySelector("svg"))).toBe(false);
  });

  it("el tipo es el encabezado de cada lámina y el próximo paso no es una caja", () => {
    const laminas = [...montar(snapshot).querySelectorAll("article")];
    expect(laminas.length).toBeGreaterThan(1);
    for (const lamina of laminas) {
      expect(lamina.querySelector("h2")?.textContent).toMatch(/\S/);
      expect(lamina.querySelector(".proximo-paso")?.textContent).toContain("Próximo paso");
    }
    expect(laminas[0]?.querySelector("h2")?.textContent).toBe("Resuelto sin cerrar");
  });

  it("muestra tarea (nombre del plan, slug o sin tarea), texto y próximo paso", () => {
    const base = snapshot.pendientes[0] as Pendiente;
    const raiz = montar(
      conPendientes([
        { ...base, tipo: "rama-quieta", tarea: "pendientes" },
        { ...base, tipo: "todo-nuevo", tarea: "inexistente" },
        { ...base, tipo: "codigo-sin-doc", tarea: null, proximoPaso: "Documentar la función." },
      ]),
    );
    const texto = raiz.textContent ?? "";
    expect(texto).toContain("Rama quieta");
    expect(texto).toContain("TODO nuevo");
    expect(texto).toContain("Código sin documentar");
    expect(texto).toContain("inexistente");
    expect(texto).toContain("sin tarea");
    expect(texto).toContain("Documentar la función.");
    expect(texto).toContain(base.texto);
  });

  it("muestra de la tarea el nombre del plan y, si no está, el slug", () => {
    const base = snapshot.pendientes[0] as Pendiente;
    const raiz = montar(
      conPendientes([
        { ...base, texto: "x", tarea: "bitacora" },
        { ...base, texto: "x", tarea: "inexistente" },
      ]),
    );
    const tareas = [...raiz.querySelectorAll(".pendiente-tarea")].map((n) => n.textContent);
    expect(tareas).toEqual(["Bitácora", "inexistente"]);
  });

  it("deja que un token largo se parta en vez de desbordar la lámina", () => {
    const css = readFileSync("src/styles/base.css", "utf8");
    expect(css).toMatch(/\.lamina \{[^}]*overflow-wrap: anywhere/);
  });

  it("muestra la evidencia sin url como texto, sin link", () => {
    const base = snapshot.pendientes[0] as Pendiente;
    const raiz = montar(conPendientes([{ ...base, evidencia: [{ tipo: "rama", ref: "feat/pendientes" }] }]));
    expect(raiz.querySelector("article a")).toBeNull();
    expect(raiz.querySelector("article")?.textContent).toContain("feat/pendientes");
  });

  it("linkea la evidencia con url a otra pestaña y sin opener", () => {
    const base = snapshot.pendientes[0] as Pendiente;
    const url = "https://github.com/ejemplo/rastro/commit/9f3c2ab";
    const raiz = montar(conPendientes([{ ...base, evidencia: [{ tipo: "commit", ref: "9f3c2ab", url }] }]));
    const link = raiz.querySelector("article a");
    expect(link?.getAttribute("href")).toBe(url);
    expect(link?.textContent).toBe("9f3c2ab");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("no convierte en link una url que no es http(s)", () => {
    const base = snapshot.pendientes[0] as Pendiente;
    const raiz = montar(conPendientes([{ ...base, evidencia: [{ tipo: "commit", ref: "abc", url: "data:text/html,x" }] }]));
    expect(raiz.querySelector("article a")).toBeNull();
  });

  it("muestra la frase cuando no hay pendientes", () => {
    const vacia = montar(conPendientes([]));
    expect(vacia.querySelector("section[aria-label='Pendientes'] h1")?.textContent).toBe("Pendientes");
    expect(vacia.textContent).toContain("No hay pendientes: todo lo resuelto está cerrado.");
  });
});
