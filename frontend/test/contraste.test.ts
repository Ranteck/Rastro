import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve("src/styles/tokens.css"), "utf8");

function bloque(selector: string): Record<string, string> {
  const inicio = css.indexOf(`${selector} {`);
  expect(inicio, `no está el bloque ${selector}`).toBeGreaterThanOrEqual(0);
  const cuerpo = css.slice(inicio, css.indexOf("}", inicio));
  const tokens: Record<string, string> = {};
  for (const [, nombre, valor] of cuerpo.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)) {
    if (nombre && valor) tokens[nombre] = valor;
  }
  return tokens;
}

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (claro + 0.05) / (oscuro + 0.05);
}

// Texto sobre fondo: los pares que la UI realmente combina.
const pares: [string, string][] = [
  ["tinta", "papel"],
  ["tinta", "papel-tibio"],
  ["tinta", "papel-frio"],
  ["tinta-secundaria", "papel"],
  ["tinta-secundaria", "papel-tibio"],
  ["tinta-secundaria", "papel-frio"],
  ["alerta", "papel"],
  ["alerta", "papel-tibio"],
  ["alerta", "papel-frio"],
  ["placa-texto", "placa"],
  ["sello-tinta", "sello"],
];

const temas: Record<string, Record<string, string>> = {
  claro: bloque(":root"),
  oscuro: bloque('[data-theme="dark"]'),
};

describe("contraste WCAG AA", () => {
  for (const [tema, tokens] of Object.entries(temas)) {
    for (const [texto, fondo] of pares) {
      it(`${tema}: ${texto} sobre ${fondo} >= 4.5:1`, () => {
        const t = tokens[texto];
        const f = tokens[fondo];
        expect(t, `falta --${texto}`).toBeDefined();
        expect(f, `falta --${fondo}`).toBeDefined();
        expect(contraste(t!, f!)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("el oscuro por preferencia del sistema usa los mismos valores que el manual", () => {
    expect(bloque(':root:not([data-theme="light"])')).toEqual(temas["oscuro"]);
  });
});
