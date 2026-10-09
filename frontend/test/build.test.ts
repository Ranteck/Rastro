import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
  });
}, 60_000);
