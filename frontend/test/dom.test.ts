import { describe, expect, it } from "vitest";
import { h, svg } from "../src/ui/dom.ts";

describe("dom", () => {
  it("deja el HTML de un string como texto", () => {
    const malo = "<img src=x onerror=alert(1)>";
    const nodo = h("p", {}, malo);
    expect(nodo.textContent).toBe(malo);
    expect(nodo.querySelector("img")).toBeNull();
  });

  it("rechaza handlers como texto y URLs javascript:", () => {
    expect(() => h("button", { onclick: "alert(1)" })).toThrow();
    expect(() => h("a", { href: "javascript:alert(1)" })).toThrow();
  });

  it("registra eventos y atributos", () => {
    let clics = 0;
    const boton = h("button", { type: "button", onclick: () => clics++ }, "ok");
    boton.click();
    expect(clics).toBe(1);
    expect(boton.getAttribute("type")).toBe("button");
  });

  it("crea SVG con su namespace", () => {
    const el = svg("circle", { r: 4 });
    expect(el.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(el.getAttribute("r")).toBe("4");
  });
});
