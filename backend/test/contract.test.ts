import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validarSnapshot } from "../src/contract/snapshot.ts";
import { ErrorValidacion } from "../src/contract/validar.ts";

const ejemplo = (): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL("../../frontend/ejemplos/persona-denis.json", import.meta.url), "utf8")) as Record<string, unknown>;

test("el ejemplo de frontend cumple el contrato", () => {
  const s = validarSnapshot(ejemplo());
  assert.equal(s.persona.id, "denis");
  assert.equal(s.gantt.mock, true);
  assert.equal(s.bitacora[1]?.razon, "El commit toca la validación del endpoint de publicación del central.");
});

test("rechaza un campo no admitido y dice dónde", () => {
  const raw = ejemplo();
  raw["extra"] = 1;
  assert.throws(() => validarSnapshot(raw), (e: unknown) => e instanceof ErrorValidacion && e.ruta === "snapshot.extra");
});

test("rechaza un tipo de pendiente desconocido", () => {
  const raw = ejemplo();
  raw["pendientes"] = [{ tipo: "otro", tarea: null, texto: "x", evidencia: [], proximoPaso: "y" }];
  assert.throws(() => validarSnapshot(raw), ErrorValidacion);
});

test("rechaza un id de persona que no es slug", () => {
  const raw = ejemplo();
  raw["persona"] = { id: "../etc", nombre: "X", equipo: "Y" };
  assert.throws(() => validarSnapshot(raw), /snapshot\.persona\.id/);
});

test("rechaza un gantt que no viene marcado como mock", () => {
  const raw = ejemplo();
  raw["gantt"] = { mock: false, barras: [] };
  assert.throws(() => validarSnapshot(raw), /snapshot\.gantt\.mock/);
});

test("rechaza un campo requerido ausente", () => {
  const raw = ejemplo();
  delete raw["costo"];
  assert.throws(() => validarSnapshot(raw), /snapshot\.costo/);
});

test("rechaza claves heredadas de Object.prototype como campos extra", () => {
  assert.throws(
    () => validarSnapshot({ ...ejemplo(), constructor: 1 }),
    (e: unknown) => e instanceof ErrorValidacion && e.ruta === "snapshot.constructor",
  );
  const conProto = JSON.parse(readFileSync(new URL("../../frontend/ejemplos/persona-denis.json", import.meta.url), "utf8").replace(/^\{/, '{"__proto__":1,')) as unknown;
  assert.throws(() => validarSnapshot(conProto), (e: unknown) => e instanceof ErrorValidacion && e.ruta === "snapshot.__proto__");
});
