import { test } from "node:test";
import assert from "node:assert/strict";
import { ddmm, desdeDdmm, diasEntre, fechaLocal, horaLocal, lunesDe, sumarDias } from "../src/fechas.ts";
import { slugDe } from "../src/texto.ts";

const BA = "America/Argentina/Buenos_Aires";

test("la fecha y la hora locales salen de la zona configurada, no de UTC", () => {
  const d = new Date("2026-10-10T01:30:00Z");
  assert.equal(fechaLocal(d, BA), "2026-10-09");
  assert.equal(horaLocal(d, BA), "22:30");
});

test("el lunes de la semana", () => {
  assert.equal(lunesDe("2026-10-09"), "2026-10-05");
  assert.equal(lunesDe("2026-10-05"), "2026-10-05");
  assert.equal(lunesDe("2026-10-11"), "2026-10-05");
});

test("sumar días cruza meses y años", () => {
  assert.equal(sumarDias("2026-12-30", 3), "2027-01-02");
  assert.equal(sumarDias("2026-10-01", -1), "2026-09-30");
});

test("DD/MM de daily-flock se resuelve con el año correcto", () => {
  assert.equal(ddmm("2026-10-05"), "05/10");
  assert.equal(desdeDdmm("05/10", "2026-10-09"), "2026-10-05");
  assert.equal(desdeDdmm("29/12", "2027-01-02"), "2026-12-29");
});

test("días entre dos instantes", () => {
  assert.equal(diasEntre(new Date("2026-10-04T12:00:00Z"), new Date("2026-10-09T12:00:00Z")), 5);
});

test("slug sin acentos ni signos", () => {
  assert.equal(slugDe("Bitácora"), "bitacora");
  assert.equal(slugDe("Docker GUI"), "docker-gui");
  assert.equal(slugDe("  Tests e2e! "), "tests-e2e");
});
