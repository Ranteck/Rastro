import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { configPorDefecto, escribirConfig, rutasGlobales } from "../src/config.ts";
import { ErrorUsuario } from "../src/errores.ts";
import { fechaLocal, lunesDe } from "../src/fechas.ts";
import { armarPlan, confirmarPlan, textoDePropuesta } from "../src/planCmd.ts";
import { parsearPlan, renderizarPlan } from "../src/plan.ts";
import { registrar } from "../src/repos.ts";
import { aplicarCambios } from "../src/cambios.ts";
import { aceptarOfrecimientosDelRepo, confirmarDesdeProyecto, sugerirDesdeProyecto, textoDeProyecto, type ResultadoProyecto } from "../src/sugerirProyecto.ts";
import { FakeLlm } from "./helpers/fakeLlm.ts";
import { crearRepo, crearRepoRegistrado } from "./helpers/repo.ts";

const config = { ...configPorDefecto({ id: "test", nombre: "Test", equipo: "QA" }), llm: { proveedor: "ninguno" as const, modelo: "haiku" } };
const ahora = new Date("2026-10-07T15:00:00Z");
const hoy = fechaLocal(ahora, config.zonaHoraria);
const d = (valor: number, unidad: "h" | "d") => ({ valor, unidad });
const tarea = (nombre: string, estado: "hecha" | "en-curso" | "pendiente", duracion = d(2, "h")) => ({ nombre, objetivo: `Hacer ${nombre}.`, duracion, estado, porque: `Por ${nombre}.` });
const respuesta = (...tareas: ReturnType<typeof tarea>[]) => ({ "desde-proyecto": { entregable: "Demo el viernes.", tareas } });
const algo = (r: ResultadoProyecto): Exclude<ResultadoProyecto, { tipo: "nada" }> => {
  if (r.tipo === "nada") throw new Error("se esperaban tareas");
  return r;
};
const BIN = fileURLToPath(new URL("../bin/rastro.js", import.meta.url));

function proyecto() {
  const r = crearRepoRegistrado();
  escribirConfig(config);
  r.escribir(".gitignore", ".rastro/\n");
  r.escribir("Docs/propuesta-x.md", "# Propuesta\nUn login y un registro.\n");
  r.escribir("intent/login/intent.md", "# Login\nAutor: Yo · Estado: aceptado\n");
  r.escribir("intent/login/spec.md", "# Spec\nEstado: borrador\n");
  r.commit("inicio");
  return r;
}

test("con el intent aceptado y el spec en borrador propone aprobar el spec, con duración, y no toca plan.md", async () => {
  const r = proyecto();
  const global = rutasGlobales();
  writeFileSync(global.plan, "## Plan semana 28/09\n- **Entregable del viernes:** Antes.\n- [ ] **Vieja:** Algo. · 1d\n");
  const antes = readFileSync(global.plan, "utf8");
  const llm = new FakeLlm(respuesta(tarea("Login", "pendiente", d(1, "d")), tarea("Aprobar spec login", "pendiente", d(1, "h")), tarea("Armar plan", "pendiente", d(2, "h"))));
  const res = algo(await sugerirDesdeProyecto({ repo: r.dir, config, llm, ahora }));
  assert.equal(res.tipo, "propuesta");
  assert.equal(readFileSync(global.plan, "utf8"), antes);
  const pasos = res.pasos;
  assert.deepEqual(pasos.map((p) => [p.nombre, p.objetivo, p.duracion]), [["Aprobar spec login", "Aprobar el spec de login", d(1, "h")]]);
  assert.match(llm.prompts[0] ?? "", /Aprobar spec login/);
  assert.match(llm.prompts[0] ?? "", /Un login y un registro/);
  const propuesta = parsearPlan(readFileSync(global.planSugerido, "utf8"), hoy);
  assert.deepEqual(propuesta?.tareas.map((t) => [t.nombre, t.repo]), [["Login", registrar(r.dir).nombre], ["Armar plan", registrar(r.dir).nombre], ["Aprobar spec login", registrar(r.dir).nombre]]);
  assert.match(textoDeProyecto(res), /Falta del proceso:\n {2}Aprobar spec login {2}1h[\s\S]*rastro plan --desde-proyecto --confirmar/);
});

test("un paso del proceso que el LLM no estima entra sin duración", async () => {
  const r = proyecto();
  const res = algo(await sugerirDesdeProyecto({ repo: r.dir, config, llm: new FakeLlm(respuesta(tarea("Login", "pendiente"))), ahora }));
  assert.equal(res.pasos[0]?.duracion, null);
  assert.equal(parsearPlan(readFileSync(rutasGlobales().planSugerido, "utf8"), hoy)?.tareas.at(-1)?.duracion, null);
});

test("el tope de tareas no le quita la duración a un paso del proceso que el LLM estimó al final de la lista", async () => {
  const r = proyecto();
  const muchas = Array.from({ length: 14 }, (_, i) => tarea(`Tarea número ${i + 1}`, "pendiente"));
  const res = algo(await sugerirDesdeProyecto({ repo: r.dir, config, llm: new FakeLlm(respuesta(...muchas, tarea("Aprobar spec login", "pendiente", d(3, "h")))), ahora }));
  assert.equal(res.tareas.length, 12);
  assert.deepEqual(res.pasos.map((p) => [p.nombre, p.duracion]), [["Aprobar spec login", d(3, "h")]]);
});

test("el objetivo que da el LLM sale en una línea, sin caracteres de control", async () => {
  const r = proyecto();
  const sucia = { ...tarea("Login", "pendiente"), objetivo: "Hacer el login.\u001b[31m\nOtra línea\u0007 y más" };
  const res = algo(await sugerirDesdeProyecto({ repo: r.dir, config, llm: new FakeLlm(respuesta(sucia)), ahora }));
  assert.equal(res.tareas[0]?.objetivo, "Hacer el login. [31m Otra línea y más");
});

test("el estado de cada documento sale de la cadena: borrador de intent, spec faltante, plan sin armar y plan en borrador", async () => {
  const r = crearRepoRegistrado();
  escribirConfig(config);
  r.escribir("intent/intent.md", "# Raíz\nEstado: borrador\n");
  r.escribir("intent/a/intent.md", "Estado: aceptado\n");
  r.escribir("intent/b/intent.md", "Estado: aceptado\n");
  r.escribir("intent/b/spec.md", "Estado: aceptado\n");
  r.escribir("intent/c/intent.md", "Estado: aceptado\n");
  r.escribir("intent/c/spec.md", "Estado: aceptado\n");
  r.escribir("intent/c/plan.md", "Estado: borrador\n- [ ] Algo\n");
  const res = algo(await sugerirDesdeProyecto({ repo: r.dir, config, llm: new FakeLlm(respuesta(tarea("Algo", "pendiente"))), ahora }));
  assert.deepEqual(res.pasos.map((p) => p.nombre), ["Aprobar intent proyecto", "Escribir spec a", "Armar plan b", "Aprobar plan c"]);
});

test("el LLM dice hecha sin commit ni casilla que la nombre: sale pendiente, y la vista previa dice por qué", async () => {
  const r = proyecto();
  const res = algo(await sugerirDesdeProyecto({ repo: r.dir, config, llm: new FakeLlm(respuesta(tarea("Login", "hecha"))), ahora }));
  assert.equal(res.tareas[0]?.estado, "pendiente");
  assert.match(textoDeProyecto(res), /Login .*ningún commit ni casilla marcada la nombra/);
  assert.match(readFileSync(rutasGlobales().planSugerido, "utf8"), /- \[ \] \*\*Login:\*\*/);
});

test("hecha con un commit que la nombra, o con una casilla marcada, sale hecha", async () => {
  const r = proyecto();
  r.escribir("intent/login/plan.md", "Estado: aceptado\n- [x] Registro: de usuarios\n- [ ] Recuperar clave\n");
  r.commit("[Login] primer formulario");
  const llm = new FakeLlm(respuesta(tarea("Login", "hecha"), tarea("Registro", "hecha"), tarea("Recuperar", "hecha"), tarea("Perfil", "en-curso")));
  const res = algo(await sugerirDesdeProyecto({ repo: r.dir, config, llm, ahora }));
  assert.deepEqual(res.tareas.map((t) => [t.nombre, t.estado, t.enCurso]), [["Login", "hecha", false], ["Registro", "hecha", false], ["Recuperar", "pendiente", false], ["Perfil", "pendiente", true]]);
  const md = readFileSync(rutasGlobales().planSugerido, "utf8");
  assert.match(md, /- \[x\] \*\*Login:\*\*/);
  assert.match(md, /- \[x\] \*\*Registro:\*\*/);
  assert.match(md, /- \[ \] \*\*Perfil:\*\*/);
  assert.match(textoDeProyecto(res), /En curso:\n {2}Perfil .*en curso/);
});

test("sin propuesta ni intent/ no llama al LLM", async () => {
  const r = crearRepoRegistrado();
  r.commit("inicio");
  const llm = new FakeLlm(respuesta(tarea("Algo", "pendiente")));
  const res = await sugerirDesdeProyecto({ repo: r.dir, config, llm, ahora });
  assert.equal(res.tipo, "nada");
  assert.deepEqual(llm.usos, []);
});

test("un repo sin registrar da un error claro y no se lee", async () => {
  const r = crearRepo();
  r.escribir("propuesta.md", "# P\n");
  const llm = new FakeLlm(respuesta(tarea("Algo", "pendiente")));
  await assert.rejects(sugerirDesdeProyecto({ repo: r.dir, config, llm, ahora }), (e: unknown) => e instanceof ErrorUsuario && /no está observado/.test(e.message));
  assert.deepEqual(llm.usos, []);
});

test("con plan vigente quedan ofrecimientos con repo y estado, sin las que ya están en el plan, y --confirmar las vuelve tareas con su repo", async () => {
  const r = proyecto();
  r.commit("[Login] primer formulario");
  const global = rutasGlobales();
  const lunes = lunesDe(hoy).slice(8) + "/" + lunesDe(hoy).slice(5, 7);
  const plan = `## Plan semana ${lunes}\n- **Entregable del viernes:** Demo.\n- [ ] **Existente:** Ya está. · 1h\n`;
  writeFileSync(global.plan, plan);
  const nombre = registrar(r.dir).nombre;
  const llm = new FakeLlm(respuesta(tarea("Existente", "pendiente"), tarea("Login", "hecha"), tarea("Perfil", "pendiente", d(3, "h")), tarea("Aprobar spec login", "pendiente")));
  const res = algo(await sugerirDesdeProyecto({ repo: r.dir, config, llm, ahora }));
  assert.equal(res.tipo === "ofrecimientos" ? res.nuevas : -1, 3);
  assert.equal(readFileSync(global.plan, "utf8"), plan);
  assert.equal(existsSync(global.planSugerido), false);
  const guardados = JSON.parse(readFileSync(global.ofrecimientos, "utf8")) as { id: string; repo: string; estadoSugerido: string; estado: string }[];
  assert.deepEqual(guardados.map((g) => [g.id, g.repo, g.estadoSugerido, g.estado]), [["login", nombre, "hecha", "pendiente"], ["perfil", nombre, "pendiente", "pendiente"], ["aprobar-spec-login", nombre, "pendiente", "pendiente"]]);

  const salida = aceptarOfrecimientosDelRepo({ repo: r.dir, config, hoy });
  assert.match(salida, /Se sumaron 3 tareas/);
  const vigente = parsearPlan(readFileSync(global.plan, "utf8"), hoy);
  assert.deepEqual(vigente?.tareas.map((t) => [t.slug, t.estado, t.repo]), [["existente", "pendiente", null], ["login", "hecha", nombre], ["perfil", "pendiente", nombre], ["aprobar-spec-login", "pendiente", nombre]]);
  assert.deepEqual(JSON.parse(readFileSync(global.ofrecimientos, "utf8")), []);
  assert.match(aceptarOfrecimientosDelRepo({ repo: r.dir, config, hoy }), /No hay ofrecimientos pendientes/);
});

test("aceptar solo toma los ofrecimientos del repo donde se corre", async () => {
  // crearRepo apunta RASTRO_HOME a su carpeta: el de último es el que manda.
  const otro = crearRepo();
  const r = proyecto();
  const global = rutasGlobales();
  const lunes = lunesDe(hoy).slice(8) + "/" + lunesDe(hoy).slice(5, 7);
  writeFileSync(global.plan, `## Plan semana ${lunes}\n- **Entregable del viernes:** Demo.\n- [ ] **Existente:** Ya está. · 1h\n`);
  const nombre = registrar(r.dir).nombre;
  const nombreOtro = registrar(otro.dir).nombre;
  const base = { objetivo: "x", duracion: null, porque: "y", estado: "pendiente" };
  writeFileSync(global.ofrecimientos, JSON.stringify([{ ...base, id: "mio", nombre: "Mio", repo: nombre }, { ...base, id: "ajeno", nombre: "Ajeno", repo: nombreOtro }]));
  aceptarOfrecimientosDelRepo({ repo: r.dir, config, hoy });
  assert.deepEqual(parsearPlan(readFileSync(global.plan, "utf8"), hoy)?.tareas.map((t) => t.slug), ["existente", "mio"]);
  assert.deepEqual((JSON.parse(readFileSync(global.ofrecimientos, "utf8")) as { id: string }[]).map((o) => o.id), ["ajeno"]);
});

test("sin plan vigente queda plan.sugerido.md y plan --confirmar lo vuelve vigente con el repo y el estado", async () => {
  const r = proyecto();
  r.commit("[Login] primer formulario");
  const llm = new FakeLlm(respuesta(tarea("Login", "hecha"), tarea("Perfil", "pendiente", d(3, "h"))));
  await sugerirDesdeProyecto({ repo: r.dir, config, llm, ahora });
  const global = rutasGlobales();
  assert.equal(existsSync(global.plan), false);
  confirmarPlan({ config, hoy });
  const nombre = registrar(r.dir).nombre;
  assert.deepEqual(parsearPlan(readFileSync(global.plan, "utf8"), hoy)?.tareas.map((t) => [t.slug, t.estado, t.repo]), [["login", "hecha", nombre], ["perfil", "pendiente", nombre], ["aprobar-spec-login", "pendiente", nombre]]);
  assert.equal(existsSync(global.planSugerido), false);
});

test("--desde-proyecto --confirmar sin plan vigente confirma la propuesta que salió de --desde-proyecto", async () => {
  const r = proyecto();
  const llm = new FakeLlm(respuesta(tarea("Perfil", "pendiente", d(3, "h"))));
  await sugerirDesdeProyecto({ repo: r.dir, config, llm, ahora });
  const global = rutasGlobales();
  const salida = confirmarDesdeProyecto({ repo: r.dir, config, hoy });
  assert.match(salida, /Plan de la semana confirmado/);
  assert.deepEqual(parsearPlan(readFileSync(global.plan, "utf8"), hoy)?.tareas.map((t) => t.slug), ["perfil", "aprobar-spec-login"]);
  assert.equal(existsSync(global.planSugerido), false);
});

test("--desde-proyecto --confirmar no confirma una propuesta con tareas sin repo, como la que se escribe a mano", () => {
  const r = proyecto();
  const global = rutasGlobales();
  const lunes = lunesDe(hoy);
  writeFileSync(global.planSugerido, renderizarPlan(lunes, "Demo.", [{ nombre: "Ajena", objetivo: "x", estado: "pendiente", duracion: d(1, "h") }]));
  const salida = confirmarDesdeProyecto({ repo: r.dir, config, hoy });
  assert.match(salida, /No hay ofrecimientos pendientes/);
  assert.match(salida, /propuesta de plan sin confirmar[^\n]*`rastro plan --confirmar`/);
  assert.equal(existsSync(global.plan), false);
  assert.equal(existsSync(global.planSugerido), true);
});

test("--desde-proyecto --confirmar avisa de una propuesta con tareas de un repo no registrado, mezcladas con las de este repo", () => {
  const r = proyecto();
  const lunes = lunesDe(hoy);
  const otro = "repo-que-no-existe";
  const propia = registrar(r.dir).nombre;
  writeFileSync(rutasGlobales().planSugerido, renderizarPlan(lunes, "Demo.", [
    { nombre: "Ajena", objetivo: "x", estado: "pendiente", duracion: d(1, "h"), repo: otro },
    { nombre: "Propia", objetivo: "x", estado: "pendiente", duracion: d(1, "h"), repo: propia },
  ]));
  assert.match(confirmarDesdeProyecto({ repo: r.dir, config, hoy }), /propuesta de plan sin confirmar[^\n]*`rastro plan --confirmar`/);
  assert.equal(existsSync(rutasGlobales().plan), false);
});

test("dos --desde-proyecto seguidos sin plan vigente conservan las tareas de los dos repos y un solo --confirmar las confirma", async () => {
  // crearRepo apunta RASTRO_HOME a su carpeta: el de último es el que manda, y ahí se registran los dos.
  const primero = proyecto();
  const segundo = crearRepo();
  segundo.escribir(".gitignore", ".rastro/\n");
  segundo.escribir("intent/checkout/intent.md", "# Checkout\nEstado: aceptado\n");
  segundo.escribir("intent/checkout/spec.md", "# Spec\nEstado: borrador\n");
  segundo.commit("[Facturas] primer informe");
  const nombrePrimero = registrar(primero.dir).nombre;
  const nombreSegundo = registrar(segundo.dir).nombre;
  const global = rutasGlobales();
  const uno = algo(await sugerirDesdeProyecto({ repo: primero.dir, config, llm: new FakeLlm(respuesta(tarea("Perfil", "pendiente", d(3, "h")))), ahora }));
  assert.deepEqual(uno.tipo === "propuesta" ? uno.conservadas : null, []);
  const dos = algo(await sugerirDesdeProyecto({ repo: segundo.dir, config, llm: new FakeLlm(respuesta(tarea("Facturas", "hecha"), tarea("Informes", "pendiente", d(1, "h")))), ahora }));
  assert.deepEqual(dos.tipo === "propuesta" ? dos.conservadas : null, ["Perfil", "Aprobar spec login"]);
  assert.match(textoDeProyecto(dos), /Se reemplazó la propuesta anterior; se conservaron sus tareas de otros repos: Perfil, Aprobar spec login\./);
  const propuesta = parsearPlan(readFileSync(global.planSugerido, "utf8"), hoy);
  assert.deepEqual(propuesta?.tareas.map((t) => [t.slug, t.repo]), [
    ["perfil", nombrePrimero],
    ["aprobar-spec-login", nombrePrimero],
    ["facturas", nombreSegundo],
    ["informes", nombreSegundo],
    ["aprobar-spec-checkout", nombreSegundo],
  ]);
  assert.match(confirmarDesdeProyecto({ repo: segundo.dir, config, hoy }), /Plan de la semana confirmado/);
  const vigente = parsearPlan(readFileSync(global.plan, "utf8"), hoy);
  assert.deepEqual(vigente?.tareas.map((t) => [t.slug, t.estado, t.repo]), [
    ["perfil", "pendiente", nombrePrimero],
    ["aprobar-spec-login", "pendiente", nombrePrimero],
    ["facturas", "hecha", nombreSegundo],
    ["informes", "pendiente", nombreSegundo],
    ["aprobar-spec-checkout", "pendiente", nombreSegundo],
  ]);
  assert.equal(existsSync(global.planSugerido), false);
});

test("plan <propuesta.md> en otro repo conserva las tareas que --desde-proyecto dejó en la propuesta y lo dice", async () => {
  // crearRepo apunta RASTRO_HOME a su carpeta: el de último es el que manda, y ahí se registran los dos.
  const a = proyecto();
  const c = crearRepo();
  const nombreA = registrar(a.dir).nombre;
  const nombreC = registrar(c.dir).nombre;
  await sugerirDesdeProyecto({ repo: a.dir, config, llm: new FakeLlm(respuesta(tarea("Perfil", "pendiente", d(3, "h")))), ahora });
  const llm = new FakeLlm({ plan: { entregable: "Demo.", tareas: [{ nombre: "Gama", objetivo: "Nueva de c.", duracion: d(1, "h") }] } });

  const res = await armarPlan({ nombre: nombreC, config, llm, propuesta: "# Propuesta", hoy });

  assert.deepEqual(res.conservadas, ["Perfil", "Aprobar spec login"]);
  assert.match(textoDePropuesta(res), /^Se reemplazó la propuesta anterior; se conservaron sus tareas de otros repos: Perfil, Aprobar spec login\.\n/);
  const propuesta = parsearPlan(readFileSync(rutasGlobales().planSugerido, "utf8"), hoy);
  assert.deepEqual(propuesta?.tareas.map((t) => [t.slug, t.repo]), [["perfil", nombreA], ["aprobar-spec-login", nombreA], ["gama", nombreC]]);
});

test("con plan vigente, --desde-proyecto --confirmar acepta los ofrecimientos del repo", async () => {
  const r = proyecto();
  const global = rutasGlobales();
  const lunes = lunesDe(hoy).slice(8) + "/" + lunesDe(hoy).slice(5, 7);
  writeFileSync(global.plan, `## Plan semana ${lunes}\n- **Entregable del viernes:** Demo.\n- [ ] **Existente:** Ya está. · 1h\n`);
  await sugerirDesdeProyecto({ repo: r.dir, config, llm: new FakeLlm(respuesta(tarea("Perfil", "pendiente", d(3, "h")))), ahora });
  assert.match(confirmarDesdeProyecto({ repo: r.dir, config, hoy }), /Se sumaron 2 tareas/);
  assert.deepEqual(parsearPlan(readFileSync(global.plan, "utf8"), hoy)?.tareas.map((t) => t.slug), ["existente", "perfil", "aprobar-spec-login"]);
});

test("--propuesta elige el archivo por sobre los que busca solo", async () => {
  const r = proyecto();
  r.escribir("otra.md", "# Otra propuesta exclusiva\n");
  const llm = new FakeLlm(respuesta(tarea("Login", "pendiente")));
  await sugerirDesdeProyecto({ repo: r.dir, config, llm, ahora, propuesta: join(r.dir, "otra.md") });
  assert.match(llm.prompts[0] ?? "", /Otra propuesta exclusiva/);
  assert.doesNotMatch(llm.prompts[0] ?? "", /Un login y un registro/);
});

test("la CLI, sin propuesta ni intent/, sale con 0 y no corre el LLM; en un repo sin registrar falla con 1", () => {
  const r = crearRepoRegistrado();
  escribirConfig({ ...config, llm: { proveedor: "claude-cli", modelo: "haiku" } });
  r.commit("inicio");
  // Un "claude" de mentira en el PATH: si el comando llegara al LLM, dejaría esta marca.
  const bin = mkdtempSync(join(tmpdir(), "rastro-bin-"));
  const marca = join(bin, "llamado");
  writeFileSync(join(bin, "claude"), `#!/bin/sh\ntouch "${marca}"\nexit 1\n`);
  chmodSync(join(bin, "claude"), 0o755);
  const env = { ...r.env, PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}` };
  const corrida = spawnSync(process.execPath, [BIN, "plan", "--desde-proyecto"], { cwd: r.dir, encoding: "utf8", env });
  assert.equal(corrida.status, 0, corrida.stderr);
  assert.match(corrida.stdout, /No encontré de dónde sacar tareas/);
  assert.equal(existsSync(marca), false);

  const sinRegistrar = crearRepo();
  const home = mkdtempSync(join(tmpdir(), "rastro-home-"));
  mkdirSync(home, { recursive: true });
  const fallo = spawnSync(process.execPath, [BIN, "plan", "--desde-proyecto"], { cwd: sinRegistrar.dir, encoding: "utf8", env: { ...env, RASTRO_HOME: home } });
  assert.equal(fallo.status, 1);
  assert.match(fallo.stderr, /no está observado/);
  assert.equal(existsSync(marca), false);
});

test("una casilla marcada ajena no da por hecha una tarea que solo comparte una palabra, ni un nombre de una letra con un [x] en el asunto", async () => {
  const r = proyecto();
  r.escribir("intent/login/plan.md", "Estado: aceptado\n- [x] Configurar base de datos\n- [x] Perfil: primera versión\n");
  r.commit("arreglo [x] en el formulario");
  const llm = new FakeLlm(respuesta(tarea("Datos", "hecha"), tarea("Base", "hecha"), tarea("x", "hecha"), tarea("Perfil", "hecha")));
  const res = algo(await sugerirDesdeProyecto({ repo: r.dir, config, llm, ahora }));
  assert.deepEqual(res.tareas.map((t) => [t.nombre, t.estado]), [["Datos", "pendiente"], ["Base", "pendiente"], ["x", "pendiente"], ["Perfil", "hecha"]]);
});

test("un propuesta*.md que es un symlink no se lee, y --propuesta con un directorio da un error claro", async () => {
  const secreto = join(mkdtempSync(join(tmpdir(), "rastro-secreto-")), "secreto.md");
  writeFileSync(secreto, "CONTENIDO-AJENO-AL-REPO");
  const solo = crearRepoRegistrado();
  escribirConfig(config);
  const r = proyecto();
  registrar(solo.dir);
  symlinkSync(secreto, join(solo.dir, "propuesta.md"));
  const llm = new FakeLlm(respuesta(tarea("Algo", "pendiente")));
  assert.equal((await sugerirDesdeProyecto({ repo: solo.dir, config, llm, ahora })).tipo, "nada");
  assert.deepEqual(llm.usos, []);
  await assert.rejects(sugerirDesdeProyecto({ repo: r.dir, config, llm, ahora, propuesta: r.dir }), (e: unknown) => e instanceof ErrorUsuario && /no es un archivo/.test(e.message));
});

test("sin propuesta ni intent/ y sin LLM configurado, la CLI avisa y sale con 0", () => {
  const r = crearRepoRegistrado();
  escribirConfig(config);
  r.commit("inicio");
  const corrida = spawnSync(process.execPath, [BIN, "plan", "--desde-proyecto"], { cwd: r.dir, encoding: "utf8", env: r.env });
  assert.equal(corrida.status, 0, corrida.stderr);
  assert.match(corrida.stdout, /No encontré de dónde sacar tareas/);
});

test("features con el mismo slug o una carpeta llamada como la raíz no repiten pasos ni ids", async () => {
  const r = crearRepoRegistrado();
  escribirConfig(config);
  r.escribir("intent/intent.md", "Estado: borrador\n");
  r.escribir("intent/proyecto/intent.md", "Estado: borrador\n");
  r.escribir("intent/Foo/intent.md", "Estado: borrador\n");
  r.escribir("intent/foo/intent.md", "Estado: borrador\n");
  const res = algo(await sugerirDesdeProyecto({ repo: r.dir, config, llm: new FakeLlm(respuesta(tarea("Algo", "pendiente"))), ahora }));
  assert.deepEqual(res.pasos.map((p) => p.nombre), ["Aprobar intent proyecto", "Aprobar intent foo"]);
});

test("el porque y la nota salen en una línea y sin caracteres de control, y las tareas tienen tope", async () => {
  const r = proyecto();
  const muchas = Array.from({ length: 30 }, (_, i) => tarea(`Tarea ${String.fromCharCode(97 + (i % 26))}${i >= 26 ? "z" : ""}`, "pendiente"));
  const sucia = { ...tarea("Sucia", "hecha"), porque: "linea uno\n\u001b[31mroja" };
  const res = algo(await sugerirDesdeProyecto({ repo: r.dir, config, llm: new FakeLlm(respuesta(sucia, ...muchas)), ahora }));
  assert.equal(res.tareas.length, 12);
  assert.equal(res.tareas[0]?.porque, "linea uno [31mroja");
  assert.doesNotMatch(textoDeProyecto(res), /\u001b/);
});

test("la propuesta, los asuntos de commits y las casillas salen redactados hacia el LLM", async () => {
  const r = proyecto();
  r.escribir("Docs/propuesta-x.md", "# P\nAPI_KEY=propuestasecreta123\n");
  r.escribir("intent/login/plan.md", "Estado: aceptado\n- [x] usar GITHUB_TOKEN=casillasecreta456\n");
  r.commit("config DB_PASSWORD=commitsecreto789");
  const llm = new FakeLlm(respuesta(tarea("Login", "pendiente")));
  await sugerirDesdeProyecto({ repo: r.dir, config, llm, ahora });
  const prompt = llm.prompts[0] ?? "";
  for (const secreto of ["propuestasecreta123", "casillasecreta456", "commitsecreto789"]) assert.ok(!prompt.includes(secreto), secreto);
  assert.match(prompt, /\[redactado\]/);
});

test("un repo sin registrar no se lee: ni su propuesta ni su intent/", async () => {
  const r = crearRepo();
  r.escribir("propuesta.md", "# P\n");
  chmodSync(join(r.dir, "propuesta.md"), 0o000);
  await assert.rejects(sugerirDesdeProyecto({ repo: r.dir, config, llm: new FakeLlm(respuesta(tarea("A", "pendiente"))), ahora }), (e: unknown) => e instanceof ErrorUsuario && /no está observado/.test(e.message));
});

test("un ofrecimiento descartado no vuelve a ofrecerse desde el proyecto", async () => {
  const r = proyecto();
  const global = rutasGlobales();
  const lunes = lunesDe(hoy).slice(8) + "/" + lunesDe(hoy).slice(5, 7);
  writeFileSync(global.plan, `## Plan semana ${lunes}\n- **Entregable del viernes:** Demo.\n- [ ] **Existente:** Ya está. · 1h\n`);
  const llm = () => new FakeLlm(respuesta(tarea("Perfil", "pendiente")));
  await sugerirDesdeProyecto({ repo: r.dir, config, llm: llm(), ahora });
  aplicarCambios({ repos: [r.dir], config, cambios: [{ tipo: "ofrecimiento", id: "perfil", accion: "descartar" }], destino: "vigente", confirmar: true, hoy });
  const otra = algo(await sugerirDesdeProyecto({ repo: r.dir, config, llm: llm(), ahora }));
  assert.equal(otra.tipo === "ofrecimientos" ? otra.nuevas : -1, 0);
  assert.deepEqual((JSON.parse(readFileSync(global.ofrecimientos, "utf8")) as { id: string; estado: string }[]).filter((o) => o.id === "perfil").map((o) => o.estado), ["descartado"]);
});

test("un ofrecimiento con repo vacío en ofrecimientos.json es inválido", () => {
  proyecto();
  writeFileSync(rutasGlobales().ofrecimientos, JSON.stringify([{ id: "a", nombre: "A", objetivo: "x", duracion: null, porque: "y", estado: "pendiente", repo: "" }]));
  assert.throws(() => aplicarCambios({ repos: [], config, cambios: [], destino: "vigente", confirmar: false, hoy }), /repo/);
});
