import { test } from "node:test";
import assert from "node:assert/strict";
import { textoParaPegar } from "../src/contract/textos.ts";
import type { Snapshot } from "../src/contract/snapshot.ts";

const entrada = (tarea: string | null, hora: string, texto: string): Snapshot["bitacora"][number] => ({
  fecha: "2026-10-07",
  repo: null,
  hora,
  tarea,
  rama: "main",
  texto,
  vinculo: "nombre",
  evidencia: [],
});
const snapshot = { bitacora: [entrada("central", "16:30", "Se agregó el endpoint."), entrada("bitacora", "10:00", "Otra cosa."), entrada("central", "09:15", "Se validó el contrato.")] } as Snapshot;

test("las entradas de la tarea salen como bullets, en orden de hora y sin hora ni prefijo de tarea", () => {
  assert.equal(textoParaPegar(snapshot, "central"), "- Se validó el contrato.\n- Se agregó el endpoint.");
});

test("una tarea sin entradas no devuelve nada", () => {
  assert.equal(textoParaPegar(snapshot, "jira"), null);
});
