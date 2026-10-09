import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConectorNotionClaude } from "../src/conectores/notion.ts";
import { validarSnapshot, type Snapshot } from "../src/contract/snapshot.ts";
import type { Ejecutor } from "../src/llm/claudeCli.ts";

const snapshot = (): Snapshot =>
  validarSnapshot(JSON.parse(readFileSync(new URL("../../frontend/ejemplos/persona-denis.json", import.meta.url), "utf8")));

type Llamada = { args: readonly string[]; entrada: string; cwd: string | undefined; existiaCwd: boolean };

function conClaude(home: string, pagina?: string): { llamadas: Llamada[]; conector: ConectorNotionClaude } {
  const llamadas: Llamada[] = [];
  const ejecutar: Ejecutor = async (_bin, args, entrada, _timeout, cwd) => {
    llamadas.push({ args, entrada, cwd, existiaCwd: cwd !== undefined && existsSync(cwd) });
    return { codigo: 0, stdout: JSON.stringify({ is_error: false, result: "listo" }), stderr: "" };
  };
  return { llamadas, conector: new ConectorNotionClaude({ modelo: "sonnet", ejecutar, home, ...(pagina !== undefined ? { pagina } : {}) }) };
}

const homeTemporal = (settings?: string): string => {
  const home = mkdtempSync(join(tmpdir(), "rastro-home-"));
  if (settings !== undefined) {
    mkdirSync(join(home, ".claude"));
    writeFileSync(join(home, ".claude", "settings.json"), settings);
  }
  return home;
};

const PERMITIDAS = "Skill(daily-flock),mcp__claude_ai_Notion__notion-fetch,mcp__claude_ai_Notion__notion-update-page";

const PAGINA = "0123456789abcdef0123456789abcdef";

test("sin pagina el prompt es el de la Daily con daily-flock", async () => {
  const { llamadas, conector } = conClaude(homeTemporal());
  await conector.publicar(snapshot());
  const entrada = llamadas[0]?.entrada ?? "";
  assert.ok(entrada.startsWith("Usá la skill daily-flock (Flujo A: registrar entradas) para agregar a la página Daily estas entradas, respetando la fecha y la hora de cada una. No agregues nada más ni cambies lo que ya está.\n\n### "));
  assert.doesNotMatch(entrada, /notion-fetch/);
});

test("con pagina el prompt apunta a esa página, mantiene los flags y lo informa", async () => {
  const { llamadas, conector } = conClaude(homeTemporal(), PAGINA);
  const mensaje = await conector.publicar(snapshot());
  const l = llamadas[0];
  assert.ok(l?.entrada.startsWith(`Usá notion-fetch para leer la página ${PAGINA} y, con notion-update-page, agregá al final estas entradas tal cual (formato de la Daily de daily-flock). No toques ninguna otra página ni cambies lo que ya está. No uses la skill daily-flock ni escribas en la página Daily.\n\n### `));
  assert.match(l?.entrada ?? "", /^### 09\/10$/m);
  assert.deepEqual(l?.args, [
    "-p", "--output-format", "json", "--model", "sonnet", "--no-session-persistence",
    "--tools", "Skill", "--permission-mode", "dontAsk", "--setting-sources", "user", "--allowedTools", PERMITIDAS,
  ]);
  assert.ok(mensaje.includes(PAGINA));
});

test("con claude arma exactamente los flags de la excepción documentada y manda las entradas", async () => {
  const { llamadas, conector } = conClaude(homeTemporal());
  assert.match(await conector.publicar(snapshot()), /Daily de Notion/);
  const l = llamadas[0];
  assert.deepEqual(l?.args, [
    "-p", "--output-format", "json", "--model", "sonnet", "--no-session-persistence",
    "--tools", "Skill", "--permission-mode", "dontAsk", "--setting-sources", "user", "--allowedTools", PERMITIDAS,
  ]);
  assert.match(l?.entrada ?? "", /^### 09\/10$/m);
});

test("prohíbe todo permiso global que no sea de la publicación", async () => {
  const settings = JSON.stringify({
    permissions: { allow: ["Bash(node:*)", "mcp__plugin_playwright_playwright__browser_run_code", "mcp__claude_ai_Notion__notion-fetch"] },
  });
  const { llamadas, conector } = conClaude(homeTemporal(settings));
  await conector.publicar(snapshot());
  const args = llamadas[0]?.args ?? [];
  assert.equal(args[args.indexOf("--disallowedTools") + 1], "Bash(node:*),mcp__plugin_playwright_playwright__browser_run_code");
});

test("con settings inválidos falla cerrado sin llamar a claude", async () => {
  const { llamadas, conector } = conClaude(homeTemporal("{no es json"));
  await assert.rejects(conector.publicar(snapshot()), /settings\.json/);
  assert.equal(llamadas.length, 0);
});

test("corre en un directorio privado bajo ~/.cache que se borra al terminar", async () => {
  const home = homeTemporal();
  const { llamadas, conector } = conClaude(home);
  await conector.publicar(snapshot());
  const l = llamadas[0];
  assert.ok(l?.cwd?.startsWith(join(home, ".cache", "rastro-notion-")));
  assert.equal(l?.existiaCwd, true);
  assert.equal(existsSync(l?.cwd ?? ""), false);
});

test("sin entradas no llama a claude", async () => {
  const { llamadas, conector } = conClaude(homeTemporal());
  const vacio = { ...snapshot(), bitacora: [] };
  assert.match(await conector.publicar(vacio), /nada para publicar/);
  assert.equal(llamadas.length, 0);
});

test("si claude informa error, el conector falla con el motivo", async () => {
  const ejecutar: Ejecutor = async () => ({ codigo: 0, stdout: JSON.stringify({ is_error: true, result: "sin acceso a Notion" }), stderr: "" });
  await assert.rejects(new ConectorNotionClaude({ modelo: "sonnet", ejecutar }).publicar(snapshot()), /sin acceso a Notion/);
});
