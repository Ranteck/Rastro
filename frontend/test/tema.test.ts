import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { montarShell } from "../src/shell.ts";
import { alternarTema, iniciarTema, temaActual } from "../src/tema.ts";

let avisarCambio: () => void = () => {};

function simularSistema(oscuro: boolean): void {
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: oscuro && consulta.includes("dark"),
    media: consulta,
    addEventListener: (_: string, escucha: () => void) => {
      avisarCambio = escucha;
    },
  }));
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset["theme"];
  document.body.replaceChildren();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("tema", () => {
  it("sin elección sigue al sistema", () => {
    simularSistema(true);
    expect(iniciarTema()).toBe("dark");
    simularSistema(false);
    expect(iniciarTema()).toBe("light");
  });

  it("alternar cambia data-theme y persiste la elección", () => {
    simularSistema(false);
    expect(alternarTema()).toBe("dark");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(localStorage.getItem("rastro.tema")).toBe("dark");
    expect(alternarTema()).toBe("light");
    expect(localStorage.getItem("rastro.tema")).toBe("light");
  });

  it("la elección guardada pesa más que el sistema", () => {
    simularSistema(true);
    localStorage.setItem("rastro.tema", "light");
    expect(iniciarTema()).toBe("light");
  });

  it("ignora un valor guardado inválido", () => {
    simularSistema(false);
    localStorage.setItem("rastro.tema", "violeta");
    expect(iniciarTema()).toBe("light");
    expect(document.documentElement.dataset["theme"]).toBeUndefined();
  });

  it("si localStorage tira error la UI sigue funcionando", () => {
    simularSistema(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(iniciarTema()).toBe("light");
    expect(alternarTema()).toBe("dark");
    expect(temaActual()).toBe("dark");
  });
});

describe("shell", () => {
  it("el botón de tema nombra su acción y alterna", () => {
    simularSistema(false);
    const raiz = document.createElement("div");
    document.body.append(raiz);
    const principal = montarShell(raiz);
    expect(principal.tagName).toBe("MAIN");
    expect(raiz.querySelector(".marca")?.textContent).toBe("RASTRO");

    const boton = raiz.querySelector("button");
    expect(boton?.textContent).toBe("Tema oscuro");
    boton?.click();
    expect(boton?.textContent).toBe("Tema claro");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
  });

  it("sin elección manual, el botón sigue los cambios del sistema", () => {
    simularSistema(false);
    const raiz = document.createElement("div");
    document.body.append(raiz);
    montarShell(raiz);
    const boton = raiz.querySelector(".boton-tema");
    expect(boton?.textContent).toBe("Tema oscuro");
    simularSistema(true);
    // El stub nuevo reemplaza matchMedia: el listener viejo consulta el sistema actualizado.
    avisarCambio();
    expect(boton?.textContent).toBe("Tema claro");
  });

  it("con elección manual ignora los cambios del sistema", () => {
    simularSistema(false);
    const raiz = document.createElement("div");
    document.body.append(raiz);
    montarShell(raiz);
    const boton = raiz.querySelector<HTMLButtonElement>(".boton-tema");
    boton?.click();
    simularSistema(false);
    avisarCambio();
    expect(boton?.textContent).toBe("Tema claro");
  });
});
