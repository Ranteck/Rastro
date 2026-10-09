import { test } from "node:test";
import assert from "node:assert/strict";
import { pedidoPlan } from "../src/llm/usos.ts";

test("la propuesta se redacta antes de cortarla, así un token en el límite no se filtra", () => {
  const token = `ghp_${"a".repeat(36)}`;
  const propuesta = `${"x".repeat(30_000 - 15)} ${token}`;
  const { prompt } = pedidoPlan(propuesta, "2026-10-05");
  assert.ok(!prompt.includes("ghp_"));
});
