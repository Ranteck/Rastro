import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validarSnapshot } from "../../backend/src/contract/snapshot.ts";
import { vistaSugerencias } from "../src/views/sugerencias.ts";

const snapshot = validarSnapshot(JSON.parse(readFileSync("ejemplos/persona-denis.json", "utf8")));
const primera = snapshot.sugerencias[0];
if (primera === undefined) throw new Error("El ejemplo necesita al menos una sugerencia");

function montar(s = snapshot): HTMLElement {
  const raiz = document.createElement("div");
  raiz.append(vistaSugerencias(s));
  return raiz;
}

function simularClipboard(writeText: () => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

afterEach(() => vi.restoreAllMocks());

describe("vista Sugerencias", () => {
  it("muestra patrón, fuente, repeticiones y propuesta", () => {
    const texto = montar().textContent ?? "";
    expect(texto).toContain(primera.patron);
    expect(texto).toContain("Claude Code");
    expect(texto).toContain("6 veces en 4 días");
    expect(texto).toContain(primera.propuesta.porque);
  });

  it("copia el contenido exacto y avisa", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    simularClipboard(writeText);
    const raiz = montar();
    raiz.querySelector("button")?.click();
    await vi.waitFor(() => expect(raiz.querySelector(".copiar-aviso")?.textContent).toBe("Copiado"));
    expect(writeText).toHaveBeenCalledWith(primera.propuesta.contenido);
  });

  it("avisa cuando no puede copiar", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    simularClipboard(() => Promise.reject(new Error("denegado")));
    const raiz = montar();
    raiz.querySelector("button")?.click();
    await vi.waitFor(() => expect(raiz.querySelector(".copiar-aviso")?.textContent).toBe("No pude copiar; seleccioná el texto"));
  });

  it("avisa cuando el navegador no tiene portapapeles", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const raiz = montar();
    raiz.querySelector("button")?.click();
    await vi.waitFor(() => expect(raiz.querySelector(".copiar-aviso")?.textContent).toBe("No pude copiar; seleccioná el texto"));
  });

  it("vacía el aviso antes de cada intento", async () => {
    let resolver: () => void = () => undefined;
    simularClipboard(() => new Promise<void>((r) => (resolver = r)));
    const raiz = montar();
    const aviso = raiz.querySelector(".copiar-aviso");
    if (aviso) aviso.textContent = "Copiado";
    raiz.querySelector("button")?.click();
    expect(aviso?.textContent).toBe("");
    resolver();
    await vi.waitFor(() => expect(aviso?.textContent).toBe("Copiado"));
  });

  it("con la lista vacía muestra una frase neutra", () => {
    const vacia = montar({ ...snapshot, sugerencias: [] });
    expect(vacia.querySelector("section[aria-label='Sugerencias'] h1")?.textContent).toBe("Sugerencias");
    expect(vacia.textContent).toContain("No hay sugerencias compartidas.");
  });
});
