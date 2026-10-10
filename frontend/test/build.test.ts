import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RASTRO = resolve("../backend/bin/rastro.js");
// Namespaces que el DOM necesita como identificador y que nunca se piden por red.
const NAMESPACES = ["http://www.w3.org/2000/svg", "http://www.w3.org/1999/xlink", "http://www.w3.org/XML/1998/namespace"];

function archivosDeTexto(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(html|js|css)$/.test(f))
    .map((f) => resolve(dir, f));
}

function esperarCentral(hijo: ChildProcess): Promise<string> {
  return new Promise((resolver, rechazar) => {
    let salida = "";
    const timer = setTimeout(() => rechazar(new Error(`El central no arrancó: ${salida}`)), 15_000);
    hijo.stdout?.on("data", (d: Buffer) => {
      salida += d.toString();
      const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(salida);
      if (m) {
        clearTimeout(timer);
        resolver(`http://127.0.0.1:${m[1]}`);
      }
    });
    hijo.once("exit", (codigo) => {
      clearTimeout(timer);
      rechazar(new Error(`El central salió con código ${codigo}: ${salida}`));
    });
  });
}

function esperarSalida(hijo: ChildProcess): Promise<void> {
  return new Promise((resolver) => hijo.once("exit", () => resolver()));
}

describe("build", () => {
  beforeAll(() => {
    execFileSync("npx", ["vite", "build"], { cwd: process.cwd(), stdio: "pipe" });
  }, 60_000);

  it("deja dist/index.html con assets en rutas relativas", () => {
    const html = readFileSync(resolve("dist/index.html"), "utf8");
    expect(html).toMatch(/src="\.\/assets\/[^"]+\.js"/);
    expect(html).toMatch(/href="\.\/assets\/[^"]+\.css"/);
    expect(html).not.toMatch(/(?:src|href)="\/assets/);
  });

  it("REQ-2: ningún html, js ni css de dist/ nombra URLs absolutas a otros hosts", () => {
    const archivos = archivosDeTexto(resolve("dist"));
    expect(archivos.length).toBeGreaterThan(2);
    for (const archivo of archivos) {
      let texto = readFileSync(archivo, "utf8");
      for (const ns of NAMESPACES) texto = texto.replaceAll(ns, "");
      expect(texto, archivo).not.toMatch(/(?:https?:)?\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+/i);
    }
  });

  it("dist/ no incluye los JSON de ejemplos", () => {
    expect(existsSync(resolve("dist/ejemplos"))).toBe(false);
    const jsons = readdirSync(resolve("dist"), { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".json"));
    expect(jsons).toEqual([]);
  });
});

describe("dist servido por el central real", () => {
  let central: ChildProcess;
  let datos: string;
  let base: string;

  beforeAll(async () => {
    datos = mkdtempSync(resolve(tmpdir(), "rastro-t6-"));
    // Puerto 0: el SO elige uno libre y el central lo imprime al arrancar.
    central = spawn("node", [RASTRO, "serve", "--puerto", "0", "--datos", datos], { stdio: ["ignore", "pipe", "pipe"] });
    base = await esperarCentral(central);
    execFileSync("node", [RASTRO, "seed-demo", "--central", base], { stdio: "pipe" });
  }, 30_000);

  afterAll(async () => {
    if (central && central.exitCode === null) {
      const salio = esperarSalida(central);
      central.kill("SIGTERM");
      await salio;
    }
    if (datos) rmSync(datos, { recursive: true, force: true });
  });

  it("sirve el index, la API del equipo y un asset del build", async () => {
    const index = await fetch(`${base}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
    const html = await index.text();

    const equipo = await fetch(`${base}/api/equipo`);
    expect(equipo.status).toBe(200);
    expect(equipo.headers.get("content-type")).toContain("application/json");
    const cuerpo = (await equipo.json()) as { equipo: unknown[] };
    expect(cuerpo.equipo.length).toBeGreaterThan(0);

    const ruta = /src="\.\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(ruta).toBeDefined();
    const js = await fetch(`${base}/${ruta}`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
  });
});
