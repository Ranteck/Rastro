import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("build", () => {
  it("deja dist/index.html con assets en rutas relativas", () => {
    execFileSync("npx", ["vite", "build"], {
      cwd: process.cwd(),
      stdio: "pipe",
    });
    const html = readFileSync(resolve("dist/index.html"), "utf8");
    expect(html).toMatch(/src="\.\/assets\/[^"]+\.js"/);
    expect(html).toMatch(/href="\.\/assets\/[^"]+\.css"/);
    expect(html).not.toMatch(/(?:src|href)="\/assets/);
    // REQ-2: ni el HTML ni el CSS emitido pueden pedir recursos externos.
    const css = readdirSync(resolve("dist/assets"))
      .filter((f) => f.endsWith(".css"))
      .map((f) => readFileSync(resolve("dist/assets", f), "utf8"))
      .join("\n");
    expect(html).not.toMatch(/https?:\/\//);
    expect(css).not.toMatch(/https?:\/\//);
  });
}, 60_000);
