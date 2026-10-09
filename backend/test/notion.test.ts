import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { ConectorNotionClaude } from "../src/conectores/notion.ts";
import { validarSnapshot, type Snapshot } from "../src/contract/snapshot.ts";
import type { Ejecutor } from "../src/llm/claudeCli.ts";

const snapshot = (): Snapshot =>
  validarSnapshot(JSON.parse(readFileSync(new URL("../../frontend/ejemplos/persona-denis.json", import.meta.url), "utf8")));

test("con claude usa solo herramientas de Notion, corre fuera del repo y manda las entradas", async () => {
  const llamadas: { args: readonly string[]; entrada: string; cwd: string | undefined }[] = [];
  const ejecutar: Ejecutor = async (_bin, args, entrada, _timeout, cwd) => {
    llamadas.push({ args, entrada, cwd });
    return { codigo: 0, stdout: JSON.stringify({ is_error: false, result: "listo" }), stderr: "" };
  };
  assert.match(await new ConectorNotionClaude({ modelo: "sonnet", ejecutar }).publicar(snapshot()), /Daily de Notion/);
  const l = llamadas[0];
  assert.equal(l?.cwd, tmpdir());
  const args = l?.args ?? [];
  assert.equal(args[args.indexOf("--allowedTools") + 1], "Skill,mcp__claude_ai_Notion__notion-fetch,mcp__claude_ai_Notion__notion-update-page");
  assert.match(l?.entrada ?? "", /^### 09\/10$/m);
});

test("si claude informa error, el conector falla con el motivo", async () => {
  const ejecutar: Ejecutor = async () => ({ codigo: 0, stdout: JSON.stringify({ is_error: true, result: "sin acceso a Notion" }), stderr: "" });
  await assert.rejects(new ConectorNotionClaude({ modelo: "sonnet", ejecutar }).publicar(snapshot()), /sin acceso a Notion/);
});
