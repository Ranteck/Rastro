import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ErrorApi, crearApi } from "../src/api.ts";

const leer = (n: string): string => readFileSync(`ejemplos/${n}`, "utf8");
const json = (cuerpo: string, status = 200): Response =>
  new Response(cuerpo, { status, headers: { "content-type": "application/json" } });

describe("api", () => {
  it("devuelve las filas del equipo de ejemplo", async () => {
    const f = vi.fn(async () => json(leer("equipo.json")));
    const filas = await crearApi({ fuente: "central", fetch: f }).cargarEquipo();
    expect(filas.length).toBeGreaterThan(0);
    expect(filas[0]?.persona.id).toBe("denis");
  });

  it("un payload inválido da el error de contrato", async () => {
    const api = crearApi({ fuente: "central", fetch: async () => json('{"equipo":[{"x":1}]}') });
    const error = await api.cargarEquipo().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error).toMatchObject({ tipo: "contrato", message: "El central devolvió datos que no entiendo" });
    expect((error as ErrorApi).cause).toBeDefined();
  });

  it("si fetch rechaza o responde 5xx, da el error del central", async () => {
    const caido = crearApi({ fuente: "central", fetch: async () => Promise.reject(new TypeError("red")) });
    await expect(caido.cargarEquipo()).rejects.toMatchObject({ tipo: "central", message: "No pude hablar con el central" });
    const roto = crearApi({ fuente: "central", fetch: async () => json("{}", 503) });
    await expect(roto.cargarEquipo()).rejects.toMatchObject({ tipo: "central" });
  });

  it("un 404 da persona inexistente", async () => {
    const api = crearApi({ fuente: "central", fetch: async () => json("{}", 404) });
    await expect(api.cargarPersona("nadie")).rejects.toMatchObject({
      tipo: "no-encontrada",
      message: "No encontré a esa persona",
    });
  });

  it("valida el id antes de pedir y todas las URLs son relativas a /api/", async () => {
    const f = vi.fn(async () => json(leer("persona-denis.json")));
    const api = crearApi({ fuente: "central", fetch: f });
    await expect(api.cargarPersona("../x")).rejects.toMatchObject({ tipo: "no-encontrada" });
    expect(f).not.toHaveBeenCalled();
    await api.cargarPersona("denis");
    f.mockImplementation(async () => json(leer("equipo.json")));
    await api.cargarEquipo();
    const urls = f.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls).toEqual(["/api/persona/denis", "/api/equipo"]);
  });

  it("modo ejemplos pide ./ejemplos/ y valida; otras personas dan 404", async () => {
    const f = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith("persona-denis.json")) return json(leer("persona-denis.json"));
      if (u.endsWith("equipo.json")) return json(leer("equipo.json"));
      return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
    });
    const api = crearApi({ fuente: "ejemplos", fetch: f as typeof fetch });
    expect((await api.cargarPersona("denis")).persona.id).toBe("denis");
    expect((await api.cargarEquipo()).length).toBeGreaterThan(0);
    await expect(api.cargarPersona("otra")).rejects.toMatchObject({ tipo: "no-encontrada" });
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual([
      "./ejemplos/persona-denis.json",
      "./ejemplos/equipo.json",
      "./ejemplos/persona-otra.json",
    ]);
  });
});
