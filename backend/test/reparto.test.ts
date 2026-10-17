import { test } from "node:test";
import assert from "node:assert/strict";
import { disponibilidadPorDefecto, type Disponibilidad } from "../src/config.ts";
import { repartir, type TareaARepartir } from "../src/reparto.ts";

const LUN = "2026-10-05";
const MAR = "2026-10-06";
const MIE = "2026-10-07";
const JUE = "2026-10-08";
const VIE = "2026-10-09";
const SAB = "2026-10-10";
const DOM = "2026-10-11";

const pendiente = (slug: string, valor: number, unidad: "h" | "d"): TareaARepartir => ({ slug, estado: "pendiente", duracion: { valor, unidad } });
const reparto = (tareas: TareaARepartir[], disponibilidad: Disponibilidad = disponibilidadPorDefecto, desde = LUN) =>
  repartir({ tareas, desde, hasta: VIE, disponibilidad });
const semanaCompleta = (tareas: TareaARepartir[], disponibilidad: Disponibilidad = disponibilidadPorDefecto) =>
  repartir({ tareas, desde: LUN, hasta: DOM, disponibilidad });

test("semana por defecto: lunes a miércoles 7,75 h libres y jueves y viernes 6,25 h", () => {
  const r = reparto([pendiente("a", 7.75, "h"), pendiente("b", 7.75, "h"), pendiente("c", 7.75, "h"), pendiente("d", 6.25, "h"), pendiente("e", 6.25, "h"), pendiente("f", 0.5, "h")]);
  assert.deepEqual(r.map((x) => x.dias), [[LUN], [MAR], [MIE], [JUE], [VIE], []]);
  assert.equal(r[5]?.noEntra, true);
});

test("una tarea de 2d toca lunes y martes: un día de la tarea es un día de tiempo libre", () => {
  assert.deepEqual(reparto([pendiente("a", 2, "d")])[0], { slug: "a", dias: [LUN, MAR], noEntra: false });
});

test("5d entran justo de lunes a viernes aunque haya horas fijas, y una hora más ya no entra", () => {
  assert.deepEqual(reparto([pendiente("a", 5, "d")])[0], { slug: "a", dias: [LUN, MAR, MIE, JUE, VIE], noEntra: false });
  assert.equal(reparto([pendiente("a", 5, "d"), pendiente("b", 1, "h")])[1]?.noEntra, true);
});

test("0,5d un jueves consume la mitad de las horas libres de ese día, y las horas siguen siendo horas", () => {
  const r = reparto([pendiente("a", 0.5, "d"), pendiente("b", 3.125, "h"), pendiente("c", 0.5, "h")], disponibilidadPorDefecto, JUE);
  assert.deepEqual(r.map((x) => x.dias), [[JUE], [JUE], [VIE]]);
});

test("la siguiente tarea arranca en las horas que dejó la anterior", () => {
  const r = reparto([pendiente("a", 4, "h"), pendiente("b", 5, "h")]);
  assert.deepEqual(r.map((x) => x.dias), [[LUN], [LUN, MAR]]);
});

test("una excepción que ocupa el jueves entero lo saca del reparto", () => {
  const disp: Disponibilidad = { ...disponibilidadPorDefecto, excepciones: [{ fecha: JUE, horas: 8 }] };
  const r = reparto([pendiente("a", 23.25, "h"), pendiente("b", 6, "h")], disp);
  assert.deepEqual(r[0]?.dias, [LUN, MAR, MIE]);
  assert.deepEqual(r[1]?.dias, [VIE]);
  assert.equal(reparto([pendiente("a", 23.25, "h"), pendiente("b", 6, "h"), pendiente("c", 1, "h")], disp)[2]?.noEntra, true);
});

test("los días no laborables no tienen horas libres: 6d no entran aunque la semana llegue al domingo", () => {
  const r = semanaCompleta([pendiente("a", 6, "d")]);
  assert.deepEqual(r[0], { slug: "a", dias: [], noEntra: true });
});

test("una excepción en un día no laborable no lo vuelve laborable", () => {
  const disp: Disponibilidad = { ...disponibilidadPorDefecto, excepciones: [{ fecha: SAB, horas: 2 }] };
  const r = semanaCompleta([pendiente("a", 5, "d"), pendiente("b", 1, "h")], disp);
  assert.deepEqual(r[0]?.dias, [LUN, MAR, MIE, JUE, VIE]);
  assert.equal(r[1]?.noEntra, true);
});

test("los días laborables de la disponibilidad definen dónde cae el reparto", () => {
  const disp: Disponibilidad = { ...disponibilidadPorDefecto, dias: ["mar", "sab"], fijos: [] };
  assert.deepEqual(semanaCompleta([pendiente("a", 2, "d")], disp)[0]?.dias, [MAR, SAB]);
});

test("la suma de horas decimales no deja afuera una tarea que cierra justo el día", () => {
  const disp: Disponibilidad = { horasDia: 1, dias: ["lun"], fijos: [], excepciones: [] };
  const r = repartir({ tareas: [pendiente("a", 0.07, "h"), pendiente("b", 0.93, "h")], desde: LUN, hasta: LUN, disponibilidad: disp });
  assert.deepEqual(r.map((x) => [x.dias, x.noEntra]), [[[LUN], false], [[LUN], false]]);
});

test("una tarea de 10d no entra y las siguientes igual se reparten", () => {
  const r = reparto([pendiente("grande", 10, "d"), pendiente("chica", 1, "d")]);
  assert.deepEqual(r[0], { slug: "grande", dias: [], noEntra: true });
  assert.deepEqual(r[1], { slug: "chica", dias: [LUN], noEntra: false });
});

test("las hechas, sacadas y sin duración no consumen horas", () => {
  const r = reparto([
    { slug: "h", estado: "hecha", duracion: { valor: 3, unidad: "d" } },
    { slug: "s", estado: "sacada", duracion: { valor: 3, unidad: "d" } },
    { slug: "n", estado: "pendiente", duracion: null },
    pendiente("a", 7.75, "h"),
  ]);
  assert.deepEqual(r.map((x) => [x.dias, x.noEntra]), [[[], false], [[], false], [[], false], [[LUN], false]]);
});

test("replanificar a mitad de semana no usa días anteriores a desde", () => {
  const r = reparto([pendiente("a", 2, "d")], disponibilidadPorDefecto, MIE);
  assert.deepEqual(r[0]?.dias, [MIE, JUE]);
});

test("horasDia cambia las horas libres de cada día, y 1d sigue valiendo un día entero", () => {
  const disp: Disponibilidad = { horasDia: 4, dias: ["lun", "mar", "mie", "jue", "vie"], fijos: [], excepciones: [] };
  assert.deepEqual(reparto([pendiente("a", 4, "h"), pendiente("b", 1, "h")], disp).map((x) => x.dias), [[LUN], [MAR]]);
  assert.deepEqual(reparto([pendiente("a", 1, "d"), pendiente("b", 1, "h")], disp).map((x) => x.dias), [[LUN], [MAR]]);
});

test("las fijadas consumen primero sus horas en sus días, aunque vengan después en el plan", () => {
  const fijadas = new Map([["fija", [MIE]]]);
  const r = repartir({ tareas: [pendiente("libre", 3, "d"), pendiente("fija", 1, "d")], desde: LUN, hasta: VIE, disponibilidad: disponibilidadPorDefecto, fijadas });
  assert.deepEqual(r.map((x) => x.dias), [[LUN, MAR, JUE], [MIE]]);
});

test("una fijada con horas las reparte parejo entre sus días", () => {
  const fijadas = new Map([["fija", [LUN, MAR]]]);
  const r = repartir({ tareas: [pendiente("fija", 4, "h"), pendiente("a", 5.75, "h"), pendiente("b", 0.5, "h")], desde: LUN, hasta: MAR, disponibilidad: disponibilidadPorDefecto, fijadas });
  assert.deepEqual(r.map((x) => x.dias), [[LUN, MAR], [LUN], [MAR]]);
});

test("una fijada conserva sus días aunque hayan pasado, y una hecha no consume ni muestra días", () => {
  const fijadas = new Map([["pasada", [LUN]], ["hecha", [MIE]]]);
  const r = reparto([pendiente("pasada", 1, "d"), { slug: "hecha", estado: "hecha", duracion: { valor: 1, unidad: "d" } }, pendiente("a", 1, "d")], disponibilidadPorDefecto, MIE);
  const conFijadas = repartir({ tareas: [pendiente("pasada", 1, "d"), { slug: "hecha", estado: "hecha", duracion: { valor: 1, unidad: "d" } }, pendiente("a", 1, "d")], desde: MIE, hasta: VIE, disponibilidad: disponibilidadPorDefecto, fijadas });
  assert.deepEqual(r.map((x) => x.dias), [[MIE], [], [JUE]]);
  assert.deepEqual(conFijadas.map((x) => x.dias), [[LUN], [], [MIE]]);
});
