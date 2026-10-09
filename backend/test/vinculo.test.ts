import { test } from "node:test";
import assert from "node:assert/strict";
import type { Tarea } from "../src/contract/snapshot.ts";
import { ramaContieneSlug, vincularPorNombre } from "../src/detectores/vinculo.ts";

const tareas: Tarea[] = [
  { slug: "plan", nombre: "Plan", objetivo: "", estado: "pendiente" },
  { slug: "docker-gui", nombre: "Docker GUI", objetivo: "", estado: "pendiente" },
  { slug: "bitacora", nombre: "Bitácora", objetivo: "", estado: "hecha" },
];

test("el slug tiene que ser un segmento completo de la rama", () => {
  assert.equal(ramaContieneSlug("feat/docker-gui", "docker-gui"), true);
  assert.equal(ramaContieneSlug("feat/planner", "plan"), false);
  assert.equal(ramaContieneSlug("fix/plan-semanal", "plan"), true);
});

test("vincula por [Nombre] en el mensaje, sin importar acentos ni mayúsculas", () => {
  assert.equal(vincularPorNombre({ rama: "main", asunto: "[bitacora] links", cuerpo: "" }, tareas), "bitacora");
  assert.equal(vincularPorNombre({ rama: "main", asunto: "arreglo", cuerpo: "Parte de [Docker GUI]" }, tareas), "docker-gui");
});

test("el [Nombre] del mensaje gana sobre la rama", () => {
  assert.equal(vincularPorNombre({ rama: "feat/plan", asunto: "[Bitácora] fix", cuerpo: "" }, tareas), "bitacora");
});

test("vincula por rama y, si no hay nada, devuelve null", () => {
  assert.equal(vincularPorNombre({ rama: "feat/docker-gui", asunto: "wip", cuerpo: "" }, tareas), "docker-gui");
  assert.equal(vincularPorNombre({ rama: "main", asunto: "fix parser", cuerpo: "" }, tareas), null);
});
