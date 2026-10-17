import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { horaInstalada, type EntornoCron } from "../src/cron.ts";
import { programador } from "../src/programador.ts";
import { rutasGlobales } from "../src/config.ts";
import type { Ejecutor } from "../src/llm/claudeCli.ts";
import { registrar } from "../src/repos.ts";
import { BIN_RASTRO, inicializar } from "../src/init.ts";
import { crearRepo } from "./helpers/repo.ts";

const cron = (args: string[], ejecutar: Ejecutor, entorno: () => EntornoCron): Promise<string> =>
  programador(args, ejecutar, entorno, { home: mkdtempSync(join(tmpdir(), "rastro-home-")), plataforma: "linux", uid: 1000 });

const BIN = fileURLToPath(new URL("../bin/rastro.js", import.meta.url));
const ENTORNO: EntornoCron = { node: "/opt/n v/bin/node", bin: "/r/backend/bin/rastro.js", path: "/opt/n v/bin:/opt/c/bin:/usr/bin" };

/** Un crontab en memoria detrás del ejecutor: ningún test toca el crontab real. */
function crontabFalso(inicial: string | null): { ejecutar: Ejecutor; contenido: () => string | null } {
  let contenido = inicial;
  const ejecutar: Ejecutor = (bin, args, entrada) => {
    // Sin systemd: esta suite prueba el caso `crontab`.
    if (bin === "systemctl") return Promise.reject(Object.assign(new Error("spawn systemctl ENOENT"), { code: "ENOENT" }));
    assert.equal(bin, "crontab");
    if (args[0] === "-l") {
      return Promise.resolve(contenido === null ? { codigo: 1, stdout: "", stderr: "no crontab for denis-legion\n" } : { codigo: 0, stdout: contenido, stderr: "" });
    }
    assert.deepEqual(args, ["-"]);
    contenido = entrada;
    return Promise.resolve({ codigo: 0, stdout: "", stderr: "" });
  };
  return { ejecutar, contenido: () => contenido };
}

/** Un repo ya observado: deja la carpeta global lista para `cron instalar`. */
function repoInicializado(): string {
  const r = crearRepo();
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  return r.dir;
}

const VIEJA_A = "30 18 * * 1-5 cd '/p/app' && PATH='/usr/bin' '/n/node' '/r/rastro.js' daily >> .rastro/cron.log 2>&1 # rastro:/p/app";
const VIEJA_B = "0 9 * * 1-5 cd '/p/app-2' && PATH='/usr/bin' '/n/node' '/r/rastro.js' daily >> .rastro/cron.log 2>&1 # rastro:/p/app-2";
const AJENA = "0 3 * * * /usr/bin/backup # nocturno";

test("instalar desde cualquier carpeta deja una línea global con RASTRO_HOME, cd a la carpeta global y el log ahí", async () => {
  repoInicializado();
  const { dir, cronLog } = rutasGlobales();
  const ct = crontabFalso(null);
  const salida = await cron(["instalar"], ct.ejecutar, () => ENTORNO);
  assert.match(salida, /18:30/);
  assert.ok(salida.includes(cronLog), "el mensaje dice dónde queda el log de verdad");
  const lineas = (ct.contenido() ?? "").trimEnd().split("\n");
  assert.equal(lineas.length, 1);
  assert.equal(
    lineas[0],
    `30 18 * * 1-5 cd '${dir}' && RASTRO_HOME='${dir}' PATH='/opt/n v/bin:/opt/c/bin:/usr/bin' '/opt/n v/bin/node' '/r/backend/bin/rastro.js' daily >> '${cronLog}' 2>&1 # rastro:global`,
  );
  assert.equal(horaInstalada(ct.contenido() ?? ""), "18:30");
});

test("instalar saca las líneas por repo de la versión anterior, deja la ajena y no duplica al reinstalar", async () => {
  repoInicializado();
  const ct = crontabFalso(`${VIEJA_A}\n${AJENA}\n${VIEJA_B}\n`);
  await cron(["instalar"], ct.ejecutar, () => ENTORNO);
  const lineas = (ct.contenido() ?? "").trimEnd().split("\n");
  assert.equal(lineas.length, 2);
  assert.equal(lineas[0], AJENA);
  assert.match(lineas[1] ?? "", / # rastro:global$/);
  await cron(["instalar", "--hora", "7:05"], ct.ejecutar, () => ENTORNO);
  const luego = (ct.contenido() ?? "").trimEnd().split("\n");
  assert.equal(luego.length, 2);
  assert.match(luego[1] ?? "", /^5 7 \* \* 1-5 /);
  assert.match(await cron([], ct.ejecutar, () => ENTORNO), /07:05/);
});

test("sin acción informa las líneas viejas por repo, con o sin la global, y cómo sacarlas", async () => {
  repoInicializado();
  const sinGlobal = crontabFalso(`${VIEJA_A}\n${AJENA}\n${VIEJA_B}\n`);
  const salida = await cron([], sinGlobal.ejecutar, () => ENTORNO);
  assert.match(salida, /no está instalado/);
  assert.match(salida, /Hay 2 líneas viejas por repo \(\/p\/app, \/p\/app-2\) que también corren el daily de todos los repos: `rastro cron quitar` o `rastro cron instalar` las saca\./);
  assert.equal(sinGlobal.contenido(), `${VIEJA_A}\n${AJENA}\n${VIEJA_B}\n`);

  const conGlobal = crontabFalso(`${AJENA}\n`);
  await cron(["instalar"], conGlobal.ejecutar, () => ENTORNO);
  assert.doesNotMatch(await cron([], conGlobal.ejecutar, () => ENTORNO), /vieja/);

  const una = crontabFalso(`${VIEJA_A}\n`);
  assert.match(await cron([], una.ejecutar, () => ENTORNO), /Hay 1 línea vieja por repo \(\/p\/app\) que también corre el daily de todos los repos: .* la saca\./);
});

test("quitar saca la global y las viejas por repo y deja solo la ajena", async () => {
  repoInicializado();
  const ct = crontabFalso(`MAILTO=yo@example.com\n${AJENA}\n${VIEJA_A}\n`);
  await cron(["instalar"], ct.ejecutar, () => ENTORNO);
  assert.match(await cron(["quitar"], ct.ejecutar, () => ENTORNO), /quitado/);
  assert.equal(ct.contenido(), `MAILTO=yo@example.com\n${AJENA}\n`);
  assert.match(await cron([], ct.ejecutar, () => ENTORNO), /no está instalado/);
  assert.match(await cron(["quitar"], ct.ejecutar, () => ENTORNO), /No había/);
});

test("quitar también limpia una línea vieja por repo sin que haya una global", async () => {
  repoInicializado();
  const ct = crontabFalso(`${VIEJA_B}\n${AJENA}\n`);
  await cron(["quitar"], ct.ejecutar, () => ENTORNO);
  assert.equal(ct.contenido(), `${AJENA}\n`);
});

test("el % de la ruta global se escapa para que cron no lo tome como salto de línea", async () => {
  const repo = crearRepo().dir;
  const dir = join(mkdtempSync(join(tmpdir(), "rastro-pct-")), "100%");
  process.env["RASTRO_HOME"] = dir;
  registrar(repo);
  const ct = crontabFalso(null);
  await cron(["instalar"], ct.ejecutar, () => ENTORNO);
  assert.match(ct.contenido() ?? "", /cd '.*100\\%' && RASTRO_HOME='.*100\\%'/);
  assert.doesNotMatch(ct.contenido() ?? "", /[^\\]%/);
});

test("una hora inválida da error de usuario y no escribe el crontab", async () => {
  repoInicializado();
  const ct = crontabFalso(null);
  for (const hora of ["25:00", "18:60", "18", "abc", "18:5"]) {
    await assert.rejects(cron(["instalar", "--hora", hora], ct.ejecutar, () => ENTORNO), /no es válida/, hora);
  }
  assert.equal(ct.contenido(), null);
});

test("instalar sin repos registrados da error claro y no toca el crontab", async () => {
  process.env["RASTRO_HOME"] = mkdtempSync(join(tmpdir(), "rastro-vacio-"));
  const ct = crontabFalso(null);
  await assert.rejects(cron(["instalar"], ct.ejecutar, () => ENTORNO), /No hay repos observados.*rastro init/);
  assert.equal(ct.contenido(), null);
});

test("rastro --help lista cron", () => {
  const ayuda = spawnSync(process.execPath, [BIN, "--help"], { encoding: "utf8", cwd: mkdtempSync(join(tmpdir(), "rastro-cron-")) });
  assert.match(ayuda.stdout, /rastro cron/);
});

test("si crontab falla distinto de no existir, es un error de usuario sin detalle interno", async () => {
  const roto: Ejecutor = (bin) => (bin === "systemctl" ? Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" })) : Promise.resolve({ codigo: 1, stdout: "", stderr: "boom interno" }));
  await assert.rejects(cron([], roto, () => ENTORNO), (e: Error) => e.name === "ErrorUsuario" && !e.message.includes("boom"));
});
