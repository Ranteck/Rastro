import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validarSnapshot } from "../src/contract/snapshot.ts";
import { filaDe } from "../src/contract/equipo.ts";
import { ErrorValidacion, fechasOrdenadas, numPositivo } from "../src/contract/validar.ts";

const ejemploV3Crudo = (): Record<string, any> =>
  JSON.parse(readFileSync(new URL("../../frontend/ejemplos/persona-denis.json", import.meta.url), "utf8")) as Record<string, any>;

/** El ejemplo del frontend es v3; los casos de v2 lo bajan a lo que mandaba un v2 (sin repo en tareas, entradas, barras ni ofrecimientos). */
const ejemploV2 = (): Record<string, unknown> => {
  const raw = ejemploV3Crudo();
  raw["schemaVersion"] = 2;
  for (const t of raw["plan"].tareas) delete t.repo;
  for (const e of raw["bitacora"]) delete e.repo;
  for (const b of raw["gantt"].barras) delete b.repo;
  raw["ofrecimientos"] = raw["ofrecimientos"].map(({ repo: _r, estadoSugerido: _e, ...o }: Record<string, unknown>) => o);
  return raw;
};

test("el ejemplo de frontend es v3: dos repos, una tarea sin repo y un ofrecimiento con repo", () => {
  const s = validarSnapshot(ejemploV3Crudo());
  assert.equal(s.schemaVersion, 3);
  assert.deepEqual([...new Set((s.plan?.tareas ?? []).map((t) => t.repo).filter((r) => r !== null))].sort(), ["central-api", "rastro"]);
  assert.ok((s.plan?.tareas ?? []).some((t) => t.repo === null));
  assert.equal(s.ofrecimientos[0]?.repo, "central-api");
});

/** El ejemplo del frontend ya es v3; los casos de v1 lo bajan a lo que mandaba un v1 para seguir probando la compatibilidad. */
const ejemplo = (): Record<string, unknown> => {
  const raw = structuredClone(ejemploV2()) as Record<string, any>;
  raw["schemaVersion"] = 1;
  for (const t of raw["plan"].tareas) for (const campo of ["duracion", "dias", "noEntra"]) delete t[campo];
  delete raw["desvios"].tareasAtrasadas;
  delete raw["foco"];
  delete raw["ofrecimientos"];
  raw["gantt"] = { mock: true, barras: raw["gantt"].barras.map(({ atrasada: _, ...barra }: Record<string, unknown>) => barra) };
  return raw;
};

test("el ejemplo de frontend cumple el contrato v2 y sale como v3", () => {
  const s = validarSnapshot(ejemploV2());
  assert.equal(s.schemaVersion, 3);
  assert.ok(s.bitacora.every((e) => e.repo === null));
  assert.ok((s.plan?.tareas ?? []).every((t) => t.repo === null));
  assert.equal(s.persona.id, "denis");
  assert.equal(s.gantt.mock, false);
  assert.equal(s.bitacora[1]?.razon, "El commit toca la validación del endpoint de publicación del central.");
});

test("el ejemplo de frontend bajado a v1 cumple el contrato", () => {
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

test("rechaza un gantt v1 que no viene marcado como mock", () => {
  const raw = ejemplo();
  raw["gantt"] = { mock: false, barras: [] };
  assert.throws(() => validarSnapshot(raw), /snapshot\.gantt\.mock/);
});

test("un v1 sale normalizado a v3 con los valores vacíos", () => {
  const s = validarSnapshot(ejemplo());
  assert.equal(s.schemaVersion, 3);
  assert.ok(s.bitacora.every((e) => e.repo === null) && (s.plan?.tareas ?? []).every((t) => t.repo === null));
  assert.ok((s.plan?.tareas.length ?? 0) > 0);
  for (const t of s.plan?.tareas ?? []) assert.deepEqual([t.duracion, t.dias, t.noEntra], [null, [], false]);
  assert.deepEqual(s.desvios.tareasAtrasadas, []);
  assert.equal(s.foco, null);
  assert.deepEqual(s.ofrecimientos, []);
  assert.equal(s.gantt.mock, true);
  assert.ok(s.gantt.barras.length > 0 && s.gantt.barras.every((b) => b.atrasada === false));
});

type Obj = Record<string, unknown>;
const primero = (lista: unknown): Obj => (lista as Obj[])[0] ?? {};

test("un v1 con cualquier campo de v2 se rechaza y dice dónde", () => {
  const conCambio = (cambio: (raw: Obj) => void): Obj => {
    const raw = ejemplo();
    cambio(raw);
    return raw;
  };
  const casos: [string, Obj][] = [
    ["snapshot.plan.tareas[0].duracion", conCambio((r) => (primero((r["plan"] as Obj)["tareas"])["duracion"] = null))],
    ["snapshot.plan.tareas[0].dias", conCambio((r) => (primero((r["plan"] as Obj)["tareas"])["dias"] = []))],
    ["snapshot.plan.tareas[0].noEntra", conCambio((r) => (primero((r["plan"] as Obj)["tareas"])["noEntra"] = false))],
    ["snapshot.gantt.barras[0].atrasada", conCambio((r) => (primero((r["gantt"] as Obj)["barras"])["atrasada"] = false))],
    ["snapshot.foco", conCambio((r) => (r["foco"] = null))],
    ["snapshot.ofrecimientos", conCambio((r) => (r["ofrecimientos"] = []))],
    ["snapshot.desvios.tareasAtrasadas", conCambio((r) => ((r["desvios"] as Obj)["tareasAtrasadas"] = []))],
    ["snapshot.bitacora[0].vinculo", conCambio((r) => (primero(r["bitacora"])["vinculo"] = "corregido"))],
  ];
  for (const [ruta, raw] of casos) assert.throws(() => validarSnapshot(raw), (e: unknown) => e instanceof ErrorValidacion && e.message.includes(ruta), ruta);
});

test("un v2 acepta el vínculo corregido", () => {
  const raw = structuredClone(validarSnapshot(ejemplo())) as unknown as Obj;
  primero(raw["bitacora"])["vinculo"] = "corregido";
  assert.equal(validarSnapshot(raw).bitacora[0]?.vinculo, "corregido");
});

const v2Completo = (): Record<string, unknown> => {
  const raw = structuredClone(validarSnapshot(ejemplo())) as unknown as Record<string, unknown>;
  const tareas = (raw["plan"] as { tareas: Record<string, unknown>[] }).tareas;
  tareas[0] = { ...tareas[0], duracion: { valor: 3, unidad: "h" }, dias: ["2026-10-05", "2026-10-06"], noEntra: false };
  tareas[1] = { ...tareas[1], duracion: { valor: 1.5, unidad: "d" }, noEntra: true };
  (raw["desvios"] as Record<string, unknown>)["tareasAtrasadas"] = ["pendientes"];
  raw["foco"] = { actual: "bitacora", siguiente: null };
  raw["ofrecimientos"] = [{ id: "docs", nombre: "Docs", objetivo: "Actualizar README.", duracion: { valor: 2, unidad: "h" }, porque: "Hubo 3 commits sin tarea." }];
  return raw;
};

test("un v2 completo valida y conserva sus campos", () => {
  const s = validarSnapshot(v2Completo());
  assert.deepEqual(s.plan?.tareas[0]?.duracion, { valor: 3, unidad: "h" });
  assert.deepEqual(s.foco, { actual: "bitacora", siguiente: null });
  assert.equal(s.ofrecimientos[0]?.id, "docs");
  assert.equal(filaDe(s).persona.id, s.persona.id);
});

test("un v2 con mock en false y barras atrasadas valida", () => {
  const raw = v2Completo();
  raw["gantt"] = { mock: false, barras: [{ tarea: "bitacora", plan: { desde: "2026-10-05", hasta: "2026-10-09" }, real: null, atrasada: true }] };
  const s = validarSnapshot(raw);
  assert.equal(s.gantt.mock, false);
  assert.equal(s.gantt.barras[0]?.atrasada, true);
});

test("un v2 sin los campos nuevos o con campos de más se rechaza", () => {
  const sinFoco = v2Completo();
  delete sinFoco["foco"];
  assert.throws(() => validarSnapshot(sinFoco), /snapshot\.foco/);
  const sinDuracion = v2Completo();
  delete (sinDuracion["plan"] as { tareas: Record<string, unknown>[] }).tareas[0]?.["noEntra"];
  assert.throws(() => validarSnapshot(sinDuracion), /noEntra/);
  assert.throws(() => validarSnapshot({ ...v2Completo(), extra: 1 }), /snapshot\.extra/);
});

test("rechaza duraciones inválidas y días repetidos o desordenados", () => {
  const con = (campos: Record<string, unknown>): Record<string, unknown> => {
    const raw = v2Completo();
    const tareas = (raw["plan"] as { tareas: Record<string, unknown>[] }).tareas;
    tareas[0] = { ...tareas[0], ...campos };
    return raw;
  };
  assert.throws(() => validarSnapshot(con({ duracion: { valor: 0, unidad: "h" } })), /duracion\.valor/);
  assert.throws(() => validarSnapshot(con({ duracion: { valor: -2, unidad: "h" } })), /duracion\.valor/);
  assert.throws(() => validarSnapshot(con({ duracion: { valor: 1, unidad: "min" } })), /duracion\.unidad/);
  assert.throws(() => validarSnapshot(con({ duracion: { valor: 1, unidad: "h", extra: 1 } })), /duracion\.extra/);
  assert.throws(() => validarSnapshot(con({ dias: ["2026-10-05", "2026-10-05"] })), /dias\[1\]/);
  assert.throws(() => validarSnapshot(con({ dias: ["2026-10-06", "2026-10-05"] })), /dias\[1\]/);
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

test("fechasOrdenadas admite listas vacías y crecientes; numPositivo rechaza cero y negativos", () => {
  assert.deepEqual(fechasOrdenadas([], "x"), []);
  assert.deepEqual(fechasOrdenadas(["2026-10-05", "2026-10-06"], "x"), ["2026-10-05", "2026-10-06"]);
  assert.throws(() => fechasOrdenadas(["2026-10-05", "no"], "x"), /x\[1\]/);
  assert.equal(numPositivo(0.5, "x"), 0.5);
  assert.throws(() => numPositivo(0, "x"), ErrorValidacion);
  assert.throws(() => numPositivo("1", "x"), ErrorValidacion);
});

/** El ejemplo con el repo de cada tarea y de cada entrada: lo que emite un v3. */
const ejemploV3 = (): Record<string, any> => {
  const raw = structuredClone(ejemploV2()) as Record<string, any>;
  raw["schemaVersion"] = 3;
  raw["plan"].tareas.forEach((t: Record<string, unknown>, i: number) => (t["repo"] = i === 0 ? "hunting" : null));
  for (const e of raw["bitacora"]) e.repo = "hunting";
  raw["gantt"].barras[0].repo = "hunting";
  return raw;
};

test("un v3 se acepta tal cual, con una tarea sin repo (null) válida", () => {
  const s = validarSnapshot(ejemploV3());
  assert.equal(s.schemaVersion, 3);
  assert.equal(s.plan?.tareas[0]?.repo, "hunting");
  assert.equal(s.plan?.tareas[1]?.repo, null);
  assert.equal(s.gantt.barras[0]?.repo, "hunting");
});

test("un v3 con un repo de tipo inválido se rechaza y dice dónde", () => {
  const enTarea = ejemploV3();
  enTarea["plan"].tareas[0].repo = 7;
  assert.throws(() => validarSnapshot(enTarea), (e: unknown) => e instanceof ErrorValidacion && e.ruta === "snapshot.plan.tareas[0].repo");
  const enEntrada = ejemploV3();
  enEntrada["bitacora"][0].repo = false;
  assert.throws(() => validarSnapshot(enEntrada), (e: unknown) => e instanceof ErrorValidacion && e.ruta === "snapshot.bitacora[0].repo");
});

test("un v3 sin el repo de una tarea se rechaza: null es la forma de decir sin repo", () => {
  const raw = ejemploV3();
  delete raw["plan"].tareas[0].repo;
  assert.throws(() => validarSnapshot(raw), (e: unknown) => e instanceof ErrorValidacion && e.ruta === "snapshot.plan.tareas[0].repo");
});

test("un v3 con un repo inválido en una barra del gantt o un repo vacío se rechaza con la ruta", () => {
  const barra = ejemploV3();
  barra["gantt"].barras[0].repo = 3;
  assert.throws(() => validarSnapshot(barra), (e: unknown) => e instanceof ErrorValidacion && e.ruta === "snapshot.gantt.barras[0].repo");
  const vacio = ejemploV3();
  vacio["plan"].tareas[0].repo = "";
  assert.throws(() => validarSnapshot(vacio), (e: unknown) => e instanceof ErrorValidacion && e.ruta === "snapshot.plan.tareas[0].repo");
});

test("un ofrecimiento v3 lleva el repo y el estado sugerido, y rechaza un estado que no existe", () => {
  const raw = v2Completo();
  const oferta = { id: "docs", nombre: "Docs", objetivo: "Actualizar README.", duracion: null, porque: "Sí." };
  raw["schemaVersion"] = 3;
  raw["ofrecimientos"] = [{ ...oferta, repo: "rastro", estadoSugerido: "hecha" }];
  assert.deepEqual(validarSnapshot(raw).ofrecimientos[0], { ...oferta, repo: "rastro", estadoSugerido: "hecha" });
  raw["ofrecimientos"] = [{ ...oferta, estadoSugerido: "en-curso" }];
  assert.throws(() => validarSnapshot(raw), /estadoSugerido/);
});
