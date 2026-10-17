import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPorDefecto, escribirConfig, rutasGlobales, type Config } from "../src/config.ts";
import { bloquePlan } from "../src/conectores/notion.ts";
import { cmdDaily } from "../src/daily.ts";
import { ddmm, fechaLocal, lunesDe } from "../src/fechas.ts";
import { huellaDelPlan } from "../src/publicado.ts";
import { parsearPlan } from "../src/plan.ts";
import type { Ejecutor } from "../src/llm/claudeCli.ts";
import { cmdSincronizar } from "../src/planCmd.ts";
import { nombresRegistrados, registrar } from "../src/repos.ts";
import { cambiosParaNotion, crearNotionPlan, sincronizarEnLectura, sincronizarPlan, type NotionPlan } from "../src/sincroNotion.ts";
import { FakeLlm } from "./helpers/fakeLlm.ts";
import { crearRepoRegistrado } from "./helpers/repo.ts";

const config: Config = { ...configPorDefecto({ id: "test", nombre: "Test", equipo: "QA" }), llm: { proveedor: "ninguno", modelo: "haiku" } };
const hoy = fechaLocal(new Date(), config.zonaHoraria);
const encabezado = `## Plan semana ${ddmm(lunesDe(hoy))}\n- **Entregable del viernes:** Demo.\n`;
const plan = (...tareas: string[]): string => `${encabezado}${tareas.map((t) => `${t}\n`).join("")}`;
const ALFA = "- [ ] **Alfa:** Hacer A. · 2d · lun–mar";
const BETA = "- [ ] **Beta:** Hacer B. · 1d · mié";
const BETA_SIN_DURACION = "- [ ] **Beta:** Hacer B.";

function entorno(local: string | null, base: string | null): { plan: string; base: string } {
  crearRepoRegistrado();
  escribirConfig(config);
  const r = rutasGlobales();
  if (local !== null) writeFileSync(r.plan, local);
  if (base !== null) writeFileSync(r.notionBase, base);
  return { plan: r.plan, base: r.notionBase };
}

type NotionFalso = NotionPlan & { publicados: string[] };
const notionFalso = (bloque: string | null): NotionFalso => {
  const publicados: string[] = [];
  return {
    publicados,
    leer: async () => bloque,
    publicar: async (s) => {
      publicados.push(bloquePlan(s));
      return "publicado";
    },
  };
};

const sincronizar = (notion: NotionPlan, o: { confirmar?: boolean; usar?: "notion" | "rastro"; llm?: FakeLlm | null } = {}) =>
  sincronizarPlan({ config, hoy, notion, llm: o.llm === undefined ? null : o.llm, confirmar: o.confirmar === true, ...(o.usar === undefined ? {} : { usar: o.usar }) });

async function capturandoStderr<T>(correr: () => Promise<T>): Promise<{ valor: T; stderr: string }> {
  const escrito: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((texto: string) => (escrito.push(texto), true)) as typeof process.stderr.write;
  try {
    return { valor: await correr(), stderr: escrito.join("") };
  } finally {
    process.stderr.write = original;
  }
}

const duracionesDelLlm = (...d: [string, number, "h" | "d"][]) =>
  new FakeLlm({ duraciones: { duraciones: d.map(([slug, valor, unidad]) => ({ slug, duracion: { valor, unidad } })) } });

test("solo cambió Notion: se adopta en plan.md, se actualiza la base y se sugieren las duraciones que faltan", async () => {
  const e = entorno(plan(ALFA), plan(ALFA));
  const llm = duracionesDelLlm(["beta", 2, "d"]);

  const r = await sincronizar(notionFalso(plan(ALFA, BETA_SIN_DURACION)), { llm });

  assert.equal(r.estado, "notion");
  assert.equal(readFileSync(e.plan, "utf8"), plan(ALFA, BETA_SIN_DURACION));
  assert.equal(readFileSync(e.base, "utf8"), plan(ALFA, BETA_SIN_DURACION));
  assert.deepEqual(llm.usos, ["duraciones"]);
  assert.ok(r.lineas.some((l) => l.startsWith("Duraciones sugeridas")));
  assert.ok(r.lineas.some((l) => l.includes("Beta")));
  // Es una vista previa: sin --confirmar la duración no se escribe.
  assert.doesNotMatch(readFileSync(e.plan, "utf8"), /Hacer B\. · 2d/);
});

test("con --confirmar las duraciones sugeridas se aplican igual que plan cambiar", async () => {
  const e = entorno(plan(ALFA), plan(ALFA));

  const r = await sincronizar(notionFalso(plan(ALFA, BETA_SIN_DURACION)), { confirmar: true, llm: duracionesDelLlm(["beta", 2, "d"]) });

  assert.equal(r.planCambio, true);
  assert.match(readFileSync(e.plan, "utf8"), /^- \[ \] \*\*Beta:\*\* Hacer B\. · 2d/m);
});

test("sin LLM se listan las duraciones que faltan", async () => {
  entorno(plan(ALFA), plan(ALFA));

  const r = await sincronizar(notionFalso(plan(ALFA, BETA_SIN_DURACION)));

  assert.ok(r.lineas.some((l) => l.startsWith("Sin duración: Beta")));
});

test("la diferencia de espacios o del orden del sufijo no cuenta como cambio", async () => {
  const e = entorno(plan("- [ ] **Alfa:** Hacer A. · lun–mar · 2d · repo:x".replace("lun–mar · 2d", "2d · lun–mar")), null);
  const notion = notionFalso(`${encabezado}- [ ] **Alfa:**   Hacer A.   · repo:x · 2d · lun–mar\n`);

  const r = await sincronizar(notion);

  assert.equal(r.estado, "iguales");
  assert.ok(existsSync(e.base));
});

test("solo cambió Rastro: sin --confirmar muestra la vista previa y no publica; con --confirmar publica y actualiza la base", async () => {
  const e = entorno(plan(ALFA, BETA), plan(ALFA));
  const notion = notionFalso(plan(ALFA));

  const previa = await sincronizar(notion);
  assert.equal(previa.estado, "rastro");
  assert.ok(previa.lineas.some((l) => l.includes("**Beta:**")));
  assert.deepEqual(notion.publicados, []);
  assert.equal(readFileSync(e.base, "utf8"), plan(ALFA));

  await sincronizar(notion, { confirmar: true });
  assert.equal(notion.publicados.length, 1);
  assert.match(notion.publicados[0] ?? "", /\*\*Beta:\*\* Hacer B\. · 1d · mié/);
  assert.equal(readFileSync(e.base, "utf8"), plan(ALFA, BETA));
});

test("el plan publicado en modo mock vuelve a leerse y los dos lados quedan iguales", async () => {
  entorno(plan(ALFA, BETA), null);
  const notion = crearNotionPlan(config);

  assert.equal((await sincronizar(notion, { confirmar: true })).estado, "rastro");
  assert.equal((await sincronizar(notion)).estado, "iguales");
});

test("cambiaron los dos: muestra las diferencias por tarea y no escribe nada", async () => {
  const DELTA = "- [ ] **Delta:** Local. · 1d";
  const e = entorno(plan(ALFA, DELTA), plan(ALFA, BETA));
  const notion = notionFalso(plan("- [ ] **Alfa:** Hacer A. · 3d · lun–mié", BETA, "- [ ] **Gama:** Nueva. · 1d"));

  const r = await sincronizar(notion);

  assert.equal(r.estado, "ambos");
  const texto = r.lineas.join("\n");
  assert.match(texto, /Alfa: duracion distinto, Rastro 2d, Notion 3d/);
  assert.match(texto, /Gama: solo está en Notion/);
  assert.match(texto, /Delta: solo está en Rastro/);
  assert.match(texto, /--usar notion/);
  assert.equal(readFileSync(e.plan, "utf8"), plan(ALFA, DELTA));
  assert.equal(readFileSync(e.base, "utf8"), plan(ALFA, BETA));
  assert.deepEqual(notion.publicados, []);
});

test("--usar resuelve cuando cambiaron los dos", async () => {
  const e = entorno(plan(ALFA, "- [ ] **Delta:** Local. · 1d"), plan(ALFA, BETA));
  const notion = notionFalso(plan(ALFA, "- [ ] **Gama:** Nueva. · 1d"));

  const previa = await sincronizar(notion, { usar: "rastro" });
  assert.deepEqual(notion.publicados, []);
  assert.ok(previa.lineas[0]?.startsWith("Vista previa"));

  await sincronizar(notion, { usar: "rastro", confirmar: true });
  assert.match(notion.publicados[0] ?? "", /\*\*Delta:\*\*/);
  assert.match(readFileSync(e.base, "utf8"), /\*\*Delta:\*\*/);

  const otro = entorno(plan(ALFA, "- [ ] **Delta:** Local. · 1d"), plan(ALFA, BETA));
  await sincronizar(notionFalso(plan(ALFA, "- [ ] **Gama:** Nueva. · 1d")), { usar: "notion" });
  assert.match(readFileSync(otro.plan, "utf8"), /\*\*Gama:\*\*/);
  assert.doesNotMatch(readFileSync(otro.plan, "utf8"), /\*\*Delta:\*\*/);
  assert.match(readFileSync(otro.base, "utf8"), /\*\*Gama:\*\*/);
});

test("sin base: si solo un lado tiene plan, ese es el que cambió; si los dos tienen planes distintos, cambiaron los dos", async () => {
  const e = entorno(null, null);
  assert.equal((await sincronizar(notionFalso(plan(ALFA)))).estado, "notion");
  assert.equal(readFileSync(e.plan, "utf8"), plan(ALFA));

  entorno(plan(ALFA), null);
  assert.equal((await sincronizar(notionFalso(null))).estado, "rastro");

  const f = entorno(plan(ALFA), null);
  assert.equal((await sincronizar(notionFalso(plan(BETA)))).estado, "ambos");
  assert.equal(readFileSync(f.plan, "utf8"), plan(ALFA));
});

test("adoptar conserva las otras semanas y los comentarios de plan.md", async () => {
  const otraSemana = "## Plan semana 01/01\n- **Entregable del viernes:** Viejo.\n- [x] **Vieja:** Hecha.\n";
  const e = entorno(`${otraSemana}\n${plan(ALFA)}  - nota con fecha\n`, plan(ALFA));

  await sincronizar(notionFalso(plan(ALFA, BETA)));

  const md = readFileSync(e.plan, "utf8");
  assert.ok(md.startsWith(otraSemana));
  assert.match(md, /\*\*Beta:\*\*/);
  assert.match(md, /- nota con fecha/);
});

test("si Notion falla avisa, sale con 0 y el plan local no cambia", async () => {
  const e = entorno(plan(ALFA), plan(ALFA));
  const roto: NotionPlan = { leer: async () => Promise.reject(new SyntaxError("Unexpected token")), publicar: async () => "no" };
  const antes = readFileSync(e.plan, "utf8");

  const { valor, stderr } = await capturandoStderr(() => cmdSincronizar(["--confirmar"], { notion: roto, llm: null }));

  assert.equal(valor, 0);
  assert.match(stderr, /No pude leer el plan de Notion \(Unexpected token\)/);
  assert.equal(readFileSync(e.plan, "utf8"), antes);
  assert.equal(readFileSync(e.base, "utf8"), plan(ALFA));
});

test("un bloque ilegible en Notion también cuenta como falla y no pisa nada", async () => {
  const e = entorno(plan(ALFA), plan(ALFA));

  const r = await sincronizar(notionFalso(`${encabezado}esto no es una tarea\n`));

  assert.equal(r.estado, "sin-notion");
  assert.equal(r.avisos.length, 1);
  assert.equal(readFileSync(e.plan, "utf8"), plan(ALFA));
});

test("sin notion en los conectores lo dice y sale", async () => {
  crearRepoRegistrado();
  escribirConfig({ ...config, conectores: ["central"] });
  let salida = "";
  const original = process.stdout.write;
  process.stdout.write = ((texto: string) => ((salida += texto), true)) as typeof process.stdout.write;
  try {
    assert.equal(await cmdSincronizar([]), 0);
  } finally {
    process.stdout.write = original;
  }
  assert.match(salida, /Notion no está en los conectores/);
});

type LlamadaClaude = { args: readonly string[]; entrada: string; cwd: string | undefined; existiaCwd: boolean };

function conClaude(respuesta: { codigo: number; stdout: string }): { llamadas: LlamadaClaude[]; notion: NotionPlan; home: string } {
  const llamadas: LlamadaClaude[] = [];
  const ejecutar: Ejecutor = async (_bin, args, entrada, _timeout, cwd) => {
    llamadas.push({ args, entrada, cwd, existiaCwd: cwd !== undefined && existsSync(cwd) });
    return { ...respuesta, stderr: "falló" };
  };
  const home = mkdtempSync(join(tmpdir(), "rastro-home-"));
  mkdirSync(join(home, ".claude"));
  writeFileSync(
    join(home, ".claude", "settings.json"),
    JSON.stringify({ permissions: { allow: ["Skill(daily-flock)", "mcp__claude_ai_Notion__notion-fetch", "mcp__claude_ai_Notion__notion-update-page", "Bash(ls)"] } }),
  );
  return { llamadas, home, notion: crearNotionPlan({ ...config, notion: { modo: "claude" } }, { ejecutar, home }) };
}

type TareaExtraida = { nombre: string; objetivo: string; estado: string; duracion: string | null; dias: string | null; repo: string | null };

const tareaExtraida = (nombre: string, campos: Partial<TareaExtraida> = {}): TareaExtraida => ({ nombre, objetivo: `Hacer ${nombre}.`, estado: "pendiente", duracion: "1d", dias: null, repo: null, ...campos });

const extraccion = (tareas: TareaExtraida[], entregable: string | null = "Demo."): string => JSON.stringify({ is_error: false, structured_output: { plan: { entregable, tareas } } });

/** Un repo registrado con ese nombre corto, como el que dejó `rastro init` en una carpeta con ese nombre. */
function registrarRepoLlamado(nombre: string): void {
  const dir = join(mkdtempSync(join(tmpdir(), "rastro-repos-")), nombre);
  mkdirSync(dir);
  registrar(dir);
}

/** claude falso: la lectura (la que lleva --json-schema) contesta `lectura`; la escritura, "listo". Guarda cada llamada. */
function claudeFalso(lectura: string, pagina?: string): { llamadas: { args: readonly string[]; entrada: string }[]; notion: NotionPlan } {
  const llamadas: { args: readonly string[]; entrada: string }[] = [];
  const ejecutar: Ejecutor = async (_bin, args, entrada) => {
    llamadas.push({ args, entrada });
    return { codigo: 0, stdout: args.includes("--json-schema") ? lectura : JSON.stringify({ is_error: false, result: "listo" }), stderr: "" };
  };
  const home = mkdtempSync(join(tmpdir(), "rastro-home-"));
  return { llamadas, notion: crearNotionPlan({ ...config, notion: { modo: "claude", ...(pagina === undefined ? {} : { pagina }) } }, { ejecutar, home }) };
}

test("el claude -p de lectura solo permite leer: ninguna herramienta que escriba", async () => {
  entorno(plan(ALFA), plan(ALFA));
  const respuesta = JSON.stringify({ is_error: false, structured_output: { plan: { entregable: "Demo.", tareas: [tareaExtraida("Alfa", { objetivo: "Hacer A.", duracion: "2d", dias: "lun–mar" })] } } });
  const { llamadas, notion, home } = conClaude({ codigo: 0, stdout: respuesta });

  // El plan sale normalizado con el formato de Rastro, escrito como esté en la página.
  assert.equal(await notion.leer(hoy), plan(ALFA));

  const args = llamadas[0]?.args ?? [];
  const valor = (flag: string): string => args[args.indexOf(flag) + 1] ?? "";
  assert.deepEqual(valor("--allowedTools").split(","), ["Skill(daily-flock)", "mcp__claude_ai_Notion__notion-fetch", "mcp__claude_ai_Notion__notion-search"]);
  assert.doesNotMatch(valor("--allowedTools"), /update|create|Write|Edit|Bash/);
  assert.equal(valor("--permission-mode"), "dontAsk");
  assert.equal(valor("--tools"), "Skill");
  // Lo que el usuario tiene permitido a nivel global y no es de lectura se prohíbe de forma explícita.
  assert.deepEqual(valor("--disallowedTools").split(","), ["mcp__claude_ai_Notion__notion-update-page", "Bash(ls)"]);
  assert.match(llamadas[0]?.entrada ?? "", /solo lectura/i);
  assert.match(llamadas[0]?.entrada ?? "", /cualquier formato/);
  assert.equal(valor("--setting-sources"), "user");
  // Carpeta propia y temporal: no carga los settings ni los hooks del repo, y no queda nada atrás.
  const cwd = llamadas[0]?.cwd ?? "";
  assert.ok(cwd.startsWith(join(tmpdir(), "rastro-notion-")));
  assert.equal(existsSync(join(home, ".cache")), false);
  assert.equal(llamadas[0]?.existiaCwd, true);
  assert.equal(existsSync(cwd), false);
});

test("la lectura devuelve null cuando Notion no tiene plan, y falla si claude falla", async () => {
  const vacio = conClaude({ codigo: 0, stdout: JSON.stringify({ is_error: false, structured_output: { plan: null } }) });
  assert.equal(await vacio.notion.leer(hoy), null);

  entorno(plan(ALFA), plan(ALFA));
  for (const respuesta of [{ codigo: 1, stdout: "" }, { codigo: 0, stdout: "no es json" }, { codigo: 0, stdout: JSON.stringify({ is_error: false, structured_output: { otro: 1 } }) }, { codigo: 0, stdout: JSON.stringify({ is_error: false, structured_output: { bloque: plan(ALFA) } }) }]) {
    const r = await sincronizar(conClaude(respuesta).notion);
    assert.equal(r.estado, "sin-notion");
    assert.equal(readFileSync(rutasGlobales().plan, "utf8"), plan(ALFA));
  }
});

test("publicar con claude le pide al conector de Notion los cambios, no el bloque entero, cuando la página ya tiene el plan", async () => {
  entorno(plan(ALFA, BETA), plan(ALFA));
  const llamadas: string[] = [];
  const ejecutar: Ejecutor = async (_bin, args, entrada) => {
    llamadas.push(`${args.join(" ")}\n${entrada}`);
    // La lectura devuelve el plan viejo; la escritura, el resultado de la skill.
    const lectura = args.includes("--json-schema");
    const vieja = { plan: { entregable: "Demo.", tareas: [tareaExtraida("Alfa", { objetivo: "Hacer A.", duracion: "2d", dias: "lun–mar" })] } };
    return { codigo: 0, stdout: JSON.stringify(lectura ? { is_error: false, structured_output: vieja } : { is_error: false, result: "listo" }), stderr: "" };
  };
  const home = mkdtempSync(join(tmpdir(), "rastro-home-"));
  const notion = crearNotionPlan({ ...config, notion: { modo: "claude" } }, { ejecutar, home });

  await sincronizar(notion, { confirmar: true });

  assert.equal(llamadas.length, 2);
  assert.match(llamadas[1] ?? "", /Agregar la tarea "Beta": objetivo "Hacer B\.", estado pendiente, duración 1d, días mié, repo sin repo/);
  assert.match(readFileSync(rutasGlobales().notionBase, "utf8"), /\*\*Beta:\*\*/);
});

test("daily con el plan de Notion cambiado lo adopta antes de armar el snapshot", async () => {
  const e = entorno(plan(ALFA), plan(ALFA));
  writeFileSync(rutasGlobales().notionPreview, plan(ALFA, BETA));

  await capturandoStderr(() => cmdDaily([]));

  assert.match(readFileSync(e.plan, "utf8"), /\*\*Beta:\*\*/);
  const state = JSON.parse(readFileSync(rutasGlobales().state, "utf8"));
  assert.deepEqual(state.plan.tareas.map((t: { slug: string }) => t.slug), ["alfa", "beta"]);
});

async function capturandoSalida<T>(correr: () => Promise<T>): Promise<{ valor: T; stdout: string; stderr: string }> {
  let stdout = "";
  const original = process.stdout.write;
  process.stdout.write = ((texto: string) => ((stdout += texto), true)) as typeof process.stdout.write;
  try {
    const { valor, stderr } = await capturandoStderr(correr);
    return { valor, stdout, stderr };
  } finally {
    process.stdout.write = original;
  }
}

test("el daily que adopta el plan de Notion lista lo que cambió en su salida", async () => {
  entorno(plan(ALFA), plan(ALFA));
  writeFileSync(rutasGlobales().notionPreview, plan(ALFA, BETA));

  const { stdout, stderr } = await capturandoSalida(() => cmdDaily([]));

  assert.match(stdout, /^Se adoptó el plan de Notion:\n {2}Beta: solo está en Notion[^\n]*\n\nRastro · /);
  assert.doesNotMatch(stderr, /Se adoptó/);
});

test("el daily no adopta un Notion que saca una tarea: avisa las diferencias y deja el plan, la base y Notion como estaban", async () => {
  const e = entorno(plan(ALFA, `${BETA} · repo:b`), plan(ALFA, `${BETA} · repo:b`));
  const preview = plan(ALFA);
  writeFileSync(rutasGlobales().notionPreview, preview);

  const { stdout, stderr } = await capturandoSalida(() => cmdDaily([]));

  assert.match(stderr, /saca tareas o cambia repos[^\n]*Beta: solo está en Rastro[^\n]*plan sincronizar --usar notion/);
  assert.doesNotMatch(stdout, /Se adoptó/);
  assert.equal(readFileSync(e.plan, "utf8"), plan(ALFA, `${BETA} · repo:b`));
  assert.equal(readFileSync(e.base, "utf8"), plan(ALFA, `${BETA} · repo:b`));
  assert.equal(readFileSync(rutasGlobales().notionPreview, "utf8"), preview);
});

test("el daily no adopta un Notion que cambia el repo de una tarea, y sí uno que solo cambia duraciones o suma el repo; un repo que Notion no trae no es un cambio", async () => {
  const conRepo = `${ALFA} · repo:a`;
  const e = entorno(plan(conRepo), plan(conRepo));
  writeFileSync(rutasGlobales().notionPreview, plan(`${ALFA} · repo:b`));

  const otroRepo = await capturandoSalida(() => cmdDaily([]));

  assert.match(otroRepo.stderr, /saca tareas o cambia repos[^\n]*Alfa: repo distinto, Rastro a, Notion b/);
  assert.equal(readFileSync(e.plan, "utf8"), plan(conRepo));

  // Que la página no traiga el repo no dice que la tarea ya no sea de ese repo.
  writeFileSync(rutasGlobales().notionPreview, plan(ALFA));
  const sinRepo = await capturandoSalida(() => cmdDaily([]));
  assert.doesNotMatch(sinRepo.stderr, /saca tareas o cambia repos/);
  assert.equal(readFileSync(e.plan, "utf8"), plan(conRepo));

  writeFileSync(rutasGlobales().notionPreview, plan("- [ ] **Alfa:** Hacer A. · 3d · lun–mié · repo:a"));
  const cambioDuracion = await capturandoSalida(() => cmdDaily([]));
  assert.match(cambioDuracion.stdout, /^Se adoptó el plan de Notion:\n {2}Alfa: duracion distinto, Rastro 2d, Notion 3d/);
  assert.match(readFileSync(e.plan, "utf8"), /Hacer A\. · 3d · lun–mié · repo:a/);
});

test("daily con los dos planes cambiados avisa y no publica ni escribe", async () => {
  const e = entorno(plan(ALFA, "- [ ] **Delta:** Local. · 1d"), plan(ALFA));
  const preview = plan(ALFA, BETA);
  writeFileSync(rutasGlobales().notionPreview, preview);

  const { stderr } = await capturandoStderr(() => cmdDaily([]));

  assert.match(stderr, /cambiaron los dos/);
  assert.equal(readFileSync(e.plan, "utf8"), plan(ALFA, "- [ ] **Delta:** Local. · 1d"));
  assert.equal(readFileSync(rutasGlobales().notionPreview, "utf8"), preview);
  assert.equal(readFileSync(e.base, "utf8"), plan(ALFA));
});

test("daily con solo Rastro cambiado avisa lo que publicaría y no publica", async () => {
  entorno(plan(ALFA, BETA), plan(ALFA));
  const preview = plan(ALFA);
  writeFileSync(rutasGlobales().notionPreview, preview);

  const { stderr } = await capturandoStderr(() => cmdDaily([]));

  assert.match(stderr, /plan sincronizar --confirmar/);
  assert.equal(readFileSync(rutasGlobales().notionPreview, "utf8"), preview);
});

test("Notion vaciado con la base igual al local: Rastro tiene el cambio y se ofrece publicar, sin borrar nada", async () => {
  const e = entorno(plan(ALFA), plan(ALFA));
  const notion = notionFalso(null);

  const r = await sincronizar(notion);

  assert.equal(r.estado, "rastro");
  assert.equal(readFileSync(e.plan, "utf8"), plan(ALFA));
  assert.deepEqual(notion.publicados, []);
});

test("daily que adopta un plan de Notion sin duraciones avisa cuáles faltan", async () => {
  entorno(plan(ALFA), plan(ALFA));
  writeFileSync(rutasGlobales().notionPreview, plan(ALFA, BETA_SIN_DURACION));

  const { stderr } = await capturandoStderr(() => cmdDaily([]));

  assert.match(stderr, /Tareas sin duración: Beta\. `rastro plan sincronizar` las sugiere/);
});

test("con los dos lados iguales, plan sincronizar sugiere las duraciones que faltan y --confirmar las aplica sin publicar", async () => {
  const e = entorno(plan(ALFA, BETA_SIN_DURACION), plan(ALFA, BETA_SIN_DURACION));
  const notion = notionFalso(plan(ALFA, BETA_SIN_DURACION));

  const previa = await sincronizar(notion, { llm: duracionesDelLlm(["beta", 2, "d"]) });
  assert.equal(previa.estado, "iguales");
  assert.ok(previa.lineas.some((l) => l.startsWith("Duraciones sugeridas")));
  assert.doesNotMatch(readFileSync(e.plan, "utf8"), /Hacer B\. · 2d/);

  const r = await sincronizar(notion, { confirmar: true, llm: duracionesDelLlm(["beta", 2, "d"]) });
  assert.match(readFileSync(e.plan, "utf8"), /Hacer B\. · 2d/);
  assert.ok(r.lineas.some((l) => l.includes("cambio local sin publicar")));
  assert.deepEqual(notion.publicados, []);
});

test("adoptar y publicar actualizan publicado.json para que rastro publish no reenvíe el plan", async () => {
  const e = entorno(plan(ALFA), plan(ALFA));
  const huellaDe = (): string | null => huellaDelPlan(parsearPlan(readFileSync(e.plan, "utf8"), hoy));
  const publicado = (): { planHuella: string; modo: string } => JSON.parse(readFileSync(rutasGlobales().publicado, "utf8"));

  await sincronizar(notionFalso(plan(ALFA, BETA)));
  assert.deepEqual(publicado(), { planHuella: huellaDe(), modo: "mock" });

  writeFileSync(e.plan, plan(ALFA, BETA, "- [ ] **Gama:** Nueva. · 1d"));
  await sincronizar(notionFalso(plan(ALFA, BETA)), { confirmar: true });
  assert.deepEqual(publicado(), { planHuella: huellaDe(), modo: "mock" });
});

test("si publicar falla no se escribe nada y el error sube", async () => {
  const e = entorno(plan(ALFA, BETA), plan(ALFA));
  const roto: NotionPlan = { leer: async () => plan(ALFA), publicar: async () => Promise.reject(new Error("Notion rechazó la escritura")) };

  await assert.rejects(() => sincronizar(roto, { confirmar: true }), /Notion rechazó la escritura/);

  assert.equal(readFileSync(e.base, "utf8"), plan(ALFA));
  assert.equal(existsSync(rutasGlobales().publicado), false);
});

test("daily con Notion caído avisa y sigue", async () => {
  const e = entorno(plan(ALFA), plan(ALFA));
  // Un directorio donde va el archivo: leerlo falla con EISDIR.
  mkdirSync(rutasGlobales().notionPreview);

  const { stderr } = await capturandoStderr(() => cmdDaily([]));

  assert.match(stderr, /No pude leer el plan de Notion/);
  assert.equal(readFileSync(e.plan, "utf8"), plan(ALFA));
  assert.ok(existsSync(rutasGlobales().state));
});

test("adoptar avisa los repo: que no están registrados, sin fallar", async () => {
  const e = entorno(plan(ALFA), plan(ALFA));

  const r = await sincronizar(notionFalso(plan(ALFA, `${BETA} · repo:fantasma`)));

  assert.ok(r.lineas.some((l) => l.includes('"fantasma" no es un repo registrado')));
  assert.match(readFileSync(e.plan, "utf8"), /repo:fantasma/);
});

test("un bloque de Notion ilegible avisa sin nombrar plan.md", async () => {
  const e = entorno(plan(ALFA), plan(ALFA));
  const { valor } = await capturandoStderr(() => sincronizar(notionFalso(`${encabezado}esto no es una tarea\n`)));

  assert.equal(valor.estado, "sin-notion");
  assert.match(valor.avisos[0] ?? "", /No pude leer el plan de Notion \(el bloque de Notion línea \d+: /);
  assert.doesNotMatch(valor.avisos[0] ?? "", /plan\.md/);
  assert.equal(readFileSync(e.plan, "utf8"), plan(ALFA));
});

test("una notion-base.md ilegible da un error que nombra ese archivo", async () => {
  const e = entorno(plan(ALFA), `${encabezado}esto no es una tarea\n`);

  await assert.rejects(() => sincronizar(notionFalso(plan(ALFA))), (err: Error) => err.message.includes(e.base) && !err.message.includes("plan.md línea"));
});

const DUP_UNO = "- [ ] **Hunting AI v2:** Armar el tablero. · 1d · lun";
const DUP_DOS = "- [ ] **Hunting AI v2:** Revisar el filtro. · 1d · mar";
const DUP_TRES = "- [ ] **Hunting AI v2:** Medir resultados. · 1d · mié";

const archivosDelRastro = (): Record<string, string> =>
  Object.fromEntries(readdirSync(rutasGlobales().dir).filter((f) => statSync(join(rutasGlobales().dir, f)).isFile()).map((f) => [f, readFileSync(join(rutasGlobales().dir, f), "utf8")]));

test("un plan de Notion con nombres repetidos no se adopta ni se compara: avisa, deja todo como estaba y sigue con el local", async () => {
  entorno(plan(ALFA), plan(ALFA));
  const antes = archivosDelRastro();
  const notion = notionFalso(plan(DUP_UNO, DUP_DOS, DUP_TRES));

  for (const usar of [undefined, "notion" as const]) {
    for (const confirmar of [false, true]) {
      const r = await sincronizar(notion, { confirmar, ...(usar === undefined ? {} : { usar }) });

      assert.equal(r.planCambio, false);
      assert.equal(r.lineas.length, 1);
      assert.match(r.lineas[0] ?? "", /varias tareas con el mismo nombre: Hunting AI v2 \(3 veces\)/);
      assert.match(r.lineas[0] ?? "", /un nombre por tarea/);
      assert.doesNotMatch(r.lineas.join("\n"), /solo está en/);
    }
  }
  assert.deepEqual(archivosDelRastro(), antes);
  assert.deepEqual(notion.publicados, []);
});

test("el daily no adopta un plan de Notion con nombres repetidos: lo avisa y deja plan y base como estaban", async () => {
  const e = entorno(plan(ALFA), plan(ALFA));
  writeFileSync(rutasGlobales().notionPreview, plan(DUP_UNO, DUP_DOS));
  const antes = archivosDelRastro();

  const { stdout, stderr } = await capturandoSalida(() => cmdDaily([]));

  assert.match(stderr, /varias tareas con el mismo nombre: Hunting AI v2 \(2 veces\)/);
  assert.doesNotMatch(stdout, /Se adoptó/);
  assert.equal(readFileSync(e.plan, "utf8"), plan(ALFA));
  assert.equal(readFileSync(e.base, "utf8"), plan(ALFA));
  assert.equal(readFileSync(rutasGlobales().notionPreview, "utf8"), plan(DUP_UNO, DUP_DOS));
  const despues = archivosDelRastro();
  for (const f of Object.keys(antes)) if (f !== "state.json" && !f.startsWith("daily")) assert.equal(despues[f], antes[f], f);
});

const PAGINA = "0123456789abcdef0123456789abcdef";

const HUNTING = [
  tareaExtraida("Armar tablero", { objetivo: "Armar el tablero.", duracion: "1d", dias: "lun", repo: "hunting" }),
  tareaExtraida("Revisar filtro", { objetivo: "Revisar el filtro.", duracion: "4h", dias: "mar", repo: "hunting" }),
  tareaExtraida("Medir resultados", { objetivo: "Medir resultados.", duracion: "1d", dias: "mié", repo: "hunting" }),
];

test("una página con el proyecto como etiqueta da tareas de nombres distintos con el repo de ese proyecto", async () => {
  const e = entorno(null, null);
  registrarRepoLlamado("hunting");
  const { notion, llamadas } = claudeFalso(extraccion(HUNTING));

  const { valor: r, stderr } = await capturandoStderr(() => sincronizar(notion));

  assert.equal(r.estado, "notion");
  const adoptado = parsearPlan(readFileSync(e.plan, "utf8"), hoy);
  assert.deepEqual(adoptado?.tareas.map((t) => [t.nombre, t.repo]), [["Armar tablero", "hunting"], ["Revisar filtro", "hunting"], ["Medir resultados", "hunting"]]);
  assert.equal(stderr, "");
  assert.doesNotMatch(r.lineas.join("\n"), /no es un repo registrado/);
  // Al LLM se le dice qué repos hay y que el nombre es la tarea, no el proyecto.
  const pedido = llamadas[0]?.entrada ?? "";
  assert.match(pedido, /repos registrados \([^)]*hunting[^)]*\)/);
  assert.match(pedido, /nombre: la tarea en sí, no el proyecto, de 1 a 3 palabras y sin ":"/);
  assert.match(pedido, /el proyecto va en repo/);
});

test("el repo que no está registrado queda null y se avisa; si solo cambia la mayúscula se usa el registrado", async () => {
  entorno(null, null);
  registrarRepoLlamado("hunting");
  const { notion } = claudeFalso(extraccion([tareaExtraida("Armar tablero", { repo: "fantasma" }), tareaExtraida("Revisar filtro", { repo: "Hunting" })]));

  const { valor, stderr } = await capturandoStderr(() => notion.leer(hoy, { repos: nombresRegistrados() }));

  const leido = parsearPlan(valor ?? "", hoy);
  assert.deepEqual(leido?.tareas.map((t) => t.repo), [null, "hunting"]);
  assert.match(stderr, /rastro warn notion_repo_no_registrado tarea="Armar tablero" repo="fantasma"/);
  assert.equal(stderr.match(/notion_repo_no_registrado/g)?.length, 1);
});

test("una duración o unos días ilegibles quedan null y las duraciones que faltan se sugieren", async () => {
  const e = entorno(null, null);
  const { notion } = claudeFalso(extraccion([tareaExtraida("Alfa", { duracion: "un rato", dias: "cuando pueda" }), tareaExtraida("Beta", { duracion: "2d", dias: "lun–mar" })]));
  const llm = duracionesDelLlm(["alfa", 3, "d"]);

  const { valor: r, stderr } = await capturandoStderr(() => sincronizar(notion, { confirmar: true, llm }));

  assert.equal(r.estado, "notion");
  const adoptado = parsearPlan(readFileSync(e.plan, "utf8"), hoy);
  assert.deepEqual(adoptado?.tareas.map((t) => [t.nombre, t.duracion?.valor ?? null, t.dias.length]), [["Alfa", 3, 0], ["Beta", 2, 2]]);
  assert.match(stderr, /notion_duracion_ilegible tarea="Alfa"/);
  assert.match(stderr, /notion_dias_ilegibles tarea="Alfa"/);
  // Además del log, llegan a quien corrió el comando.
  assert.deepEqual(r.avisos, ['La duración "un rato" de la tarea "Alfa" no se entiende: queda sin duración.', 'Los días "cuando pueda" de la tarea "Alfa" no se entienden: queda sin días.']);
  assert.deepEqual(llm.usos, ["duraciones"]);
  assert.ok(r.lineas.some((l) => l.startsWith("Duraciones sugeridas") ));
  assert.ok(r.lineas.some((l) => l.includes("Alfa")));
});

test("plan: null cuenta como Notion sin plan: no borra el de Rastro y se ofrece publicarlo", async () => {
  const e = entorno(plan(ALFA), plan(ALFA));
  const { notion, llamadas } = claudeFalso(JSON.stringify({ is_error: false, structured_output: { plan: null } }));

  const r = await sincronizar(notion);

  assert.equal(r.estado, "rastro");
  assert.equal(readFileSync(e.plan, "utf8"), plan(ALFA));
  assert.equal(llamadas.length, 1);
});

test("una respuesta que no cumple el esquema avisa, sale con 0 y no escribe nada", async () => {
  const e = entorno(plan(ALFA), plan(ALFA));
  const antes = archivosDelRastro();
  const invalidas = [
    { plan: { entregable: "Demo.", tareas: [{ ...tareaExtraida("Alfa"), estado: "casi" }] } },
    { plan: { entregable: "Demo.", tareas: [{ nombre: "Alfa" }] } },
    { plan: { entregable: "Demo." } },
    { plan: "texto" },
  ];
  for (const structured_output of invalidas) {
    const { notion, llamadas } = claudeFalso(JSON.stringify({ is_error: false, structured_output }));

    const { valor, stderr } = await capturandoStderr(() => cmdSincronizar(["--confirmar"], { notion, llm: null }));

    assert.equal(valor, 0);
    assert.match(stderr, /No pude leer el plan de Notion \(plan/);
    assert.equal(llamadas.length, 1);
  }
  assert.deepEqual(archivosDelRastro(), antes);
  assert.equal(readFileSync(e.plan, "utf8"), plan(ALFA));
});

test("un cambio de redacción en Notion que no cambia ninguna tarea no cuenta como cambio, y la base guarda el plan normalizado", async () => {
  const e = entorno(plan(ALFA), null);
  const { notion, llamadas } = claudeFalso(extraccion([tareaExtraida("Alfa", { objetivo: " Hacer   **A**. ", duracion: "2D", dias: "Lun-Mar" })]));

  const r = await sincronizar(notion);

  assert.equal(r.estado, "iguales");
  assert.equal(readFileSync(e.base, "utf8"), plan(ALFA));
  assert.equal(llamadas.length, 1);
});

test("publicar con la página que ya tiene el plan manda los cambios y la consigna de conservar el formato, no el bloque", async () => {
  entorno(plan("- [ ] **Alfa:** Hacer A. · 3d · lun–mié", BETA), plan(ALFA));
  for (const pagina of [undefined, PAGINA]) {
    const vieja = extraccion([tareaExtraida("Alfa", { objetivo: "Hacer A.", duracion: "2d", dias: "lun–mar" }), tareaExtraida("Gama", { objetivo: "Sobra.", duracion: "1d" })]);
    const { notion, llamadas } = claudeFalso(vieja, pagina);

    await sincronizar(notion, { confirmar: true, usar: "rastro" });

    const entrada = llamadas[1]?.entrada ?? "";
    assert.match(entrada, /Cambios del plan de la semana:/);
    assert.match(entrada, /- Tarea "Alfa": cambiar la duración de 2d a 3d/);
    assert.match(entrada, /- Tarea "Alfa": cambiar los días de lun–mar a lun–mié/);
    assert.match(entrada, /- Agregar la tarea "Beta": /);
    assert.match(entrada, /- Sacar la tarea "Gama" del plan de la semana/);
    assert.match(entrada, /Conservá el formato que ya tiene la página: las etiquetas de proyecto, el orden y el estilo de cada línea\./);
    assert.match(entrada, /solo los cambios de la lista de más abajo/);
    assert.doesNotMatch(entrada, /^## Plan semana/m);
    assert.doesNotMatch(entrada, /dejá el plan|dejar el plan/);
    const args = llamadas[1]?.args ?? [];
    assert.equal(args[args.indexOf("--allowedTools") + 1], "Skill(daily-flock),mcp__claude_ai_Notion__notion-fetch,mcp__claude_ai_Notion__notion-update-page");
    assert.match(entrada, pagina === undefined ? /^Usá la skill daily-flock \(Flujo B/ : new RegExp(`^Usá notion-fetch para leer la página ${PAGINA}`));
  }
});

test("publicar en una página sin plan de esta semana agrega el bloque completo en el formato de la página", async () => {
  entorno(plan(ALFA, BETA), null);
  const { notion, llamadas } = claudeFalso(JSON.stringify({ is_error: false, structured_output: { plan: null } }));

  await sincronizar(notion, { confirmar: true });

  const entrada = llamadas[1]?.entrada ?? "";
  assert.match(entrada, /^## Plan semana \d{2}\/\d{2}$/m);
  assert.match(entrada, /\*\*Beta:\*\* Hacer B\. · 1d · mié/);
  assert.match(entrada, /agregá el bloque completo al final, en el formato que usen las semanas anteriores de la página, o en el de este bloque si no hay ninguna/);
  assert.doesNotMatch(entrada, /Cambios del plan de la semana/);
});

test("la vista previa de publicar lista los cambios que se aplican en la página", async () => {
  entorno(plan(ALFA, BETA), plan(ALFA));
  const { notion, llamadas } = claudeFalso(extraccion([tareaExtraida("Alfa", { objetivo: "Hacer A.", duracion: "2d", dias: "lun–mar" })]));

  const r = await sincronizar(notion);

  assert.ok(r.lineas.some((l) => l.includes("**Beta:**")));
  assert.ok(r.lineas.some((l) => l.startsWith("En la página de Notion se aplican estos cambios")));
  assert.ok(r.lineas.some((l) => l.includes('Agregar la tarea "Beta"')));
  assert.equal(llamadas.length, 1);
});

test("cambiosParaNotion lista el entregable, las agregadas, las sacadas y los campos cambiados contra el plan de Notion", () => {
  const deNotion = parsearPlan(`${encabezado}- [ ] **Alfa:** Hacer A. · 2d · lun–mar\n- [ ] **Gama:** Sobra. · 1d\n`, hoy);
  const local = parsearPlan(`## Plan semana ${ddmm(lunesDe(hoy))}\n- **Entregable del viernes:** Otra demo.\n- [x] **Alfa:** Hacer A. · 2d · lun–mar · repo:a\n- [ ] **Beta:** Hacer B. · 1d · mié\n`, hoy);
  assert.ok(deNotion !== null && local !== null);

  assert.deepEqual(cambiosParaNotion(deNotion, local), [
    'Cambiar el entregable del viernes de "Demo." a "Otra demo."',
    'Tarea "Alfa": cambiar el estado de pendiente a hecha',
    'Tarea "Alfa": cambiar el repo de sin repo a a',
    'Agregar la tarea "Beta": objetivo "Hacer B.", estado pendiente, duración 1d, días mié, repo sin repo',
    'Sacar la tarea "Gama" del plan de la semana',
  ]);
  assert.deepEqual(cambiosParaNotion(local, local), []);
});

test("el aviso de un repo no registrado llega al resultado de sincronizar y al del daily en lectura", async () => {
  entorno(plan(ALFA), plan(ALFA));
  const lectura = extraccion([tareaExtraida("Alfa", { objetivo: "Hacer A.", duracion: "2d", dias: "lun–mar", repo: "fantasma" })]);

  const { valor: r } = await capturandoStderr(() => sincronizar(claudeFalso(lectura).notion));
  assert.deepEqual(r.avisos, ['El repo "fantasma" de la tarea "Alfa" no está registrado: la tarea queda sin repo.']);

  const { valor: l } = await capturandoStderr(() => sincronizarEnLectura({ hoy, notion: claudeFalso(lectura).notion, modo: "claude" }));
  assert.ok(l.avisos.includes('El repo "fantasma" de la tarea "Alfa" no está registrado: la tarea queda sin repo.'));
});

test("la lectura le pasa a la extracción el plan que Rastro ya conoce, el de la base o, sin base, el local, para que no cambie de una lectura a otra", async () => {
  const vacia = JSON.stringify({ is_error: false, structured_output: { plan: null } });

  entorno(plan(ALFA, BETA), plan("- [ ] **Armar JD:** Hacer. · 1d · lun · repo:hunting", "- [ ] **Correr búsqueda:** Hacer. · 4h"));
  const conBase = claudeFalso(vacia);
  await sincronizar(conBase.notion);
  const pedido = conBase.llamadas[0]?.entrada ?? "";
  assert.match(pedido, /Rastro ya conoce este plan de la semana: \{"entregable":"Demo\.","tareas":\[\{"nombre":"Armar JD","estado":"pendiente","duracion":"1d","dias":"lun","repo":"hunting"\},\{"nombre":"Correr búsqueda","estado":"pendiente","duracion":"4h","dias":null,"repo":null\}\]\}\./);
  assert.match(pedido, /usá exactamente ese nombre/);
  assert.match(pedido, /devolvé el valor que Rastro ya tiene, sin reformularlo/);
  assert.match(pedido, /solo con lo que el plan de esa semana dice de forma explícita\. No los deduzcas de las entradas de la bitácora, de otras semanas/);
  assert.doesNotMatch(pedido, /"Alfa"/);

  entorno(plan(ALFA, BETA), null);
  const sinBase = claudeFalso(vacia);
  await sincronizar(sinBase.notion);
  assert.match(sinBase.llamadas[0]?.entrada ?? "", /"tareas":\[\{"nombre":"Alfa","estado":"pendiente","duracion":"2d","dias":"lun–mar","repo":null\},\{"nombre":"Beta"/);

  entorno(null, null);
  const sinNada = claudeFalso(vacia);
  await sincronizar(sinNada.notion);
  assert.doesNotMatch(sinNada.llamadas[0]?.entrada ?? "", /ya conoce este plan/);
  assert.match(sinNada.llamadas[0]?.entrada ?? "", /solo con lo que el plan de esa semana dice de forma explícita/);
});

test("--usar notion sugiere las duraciones que faltan igual que cuando solo cambió Notion: vista previa y, con --confirmar, las aplica", async () => {
  const deNotion = plan(ALFA, "- [ ] **Gama:** Hacer G.", BETA_SIN_DURACION);
  for (const [local, base] of [[plan(ALFA), plan(ALFA)], [plan("- [ ] **Delta:** Local. · 1d"), plan(ALFA)], [null, null]] as const) {
    const e = entorno(local, base);

    const previa = await sincronizar(notionFalso(deNotion), { usar: "notion", llm: duracionesDelLlm(["gama", 2, "d"], ["beta", 3, "d"]) });
    assert.equal(previa.planCambio, true);
    assert.ok(previa.lineas.some((l) => l.startsWith("Duraciones sugeridas (no se escribió nada")), previa.lineas.join("\n"));
    assert.ok(previa.lineas.some((l) => l.includes("Gama")) && previa.lineas.some((l) => l.includes("Beta")));
    assert.doesNotMatch(readFileSync(e.plan, "utf8"), /Hacer G\. · 2d/);

    const aplicada = await sincronizar(notionFalso(deNotion), { usar: "notion", confirmar: true, llm: duracionesDelLlm(["gama", 2, "d"], ["beta", 3, "d"]) });
    assert.ok(aplicada.lineas.some((l) => l.startsWith("Duraciones sugeridas, aplicadas")));
    assert.match(readFileSync(e.plan, "utf8"), /Hacer G\. · 2d/);
    assert.match(readFileSync(e.plan, "utf8"), /Hacer B\. · 3d/);
  }
});

test("plan sincronizar --usar notion sin LLM lista por stdout las tareas sin duración", async () => {
  entorno(plan(ALFA), plan(ALFA));
  const { stdout } = await capturandoSalida(() => cmdSincronizar(["--usar", "notion"], { notion: notionFalso(plan(ALFA, "- [ ] **Gama:** Hacer G.", BETA_SIN_DURACION)), llm: null }));

  assert.match(stdout, /Se adoptó el plan de Notion/);
  assert.match(stdout, /Sin duración: Gama, Beta/);
});

test("los días de una tarea sin duración sobreviven a la lectura de Notion", async () => {
  const e = entorno(null, null);
  const { notion } = claudeFalso(extraccion([tareaExtraida("Alfa", { duracion: null, dias: "lun–mar" })]));

  await sincronizar(notion);

  const adoptado = parsearPlan(readFileSync(e.plan, "utf8"), hoy);
  assert.deepEqual(adoptado?.tareas.map((t) => [t.duracion, t.dias.length]), [[null, 2]]);
});

const REFORMULADAS = [
  tareaExtraida("Alfa", { objetivo: "Otra redacción de A", duracion: null, dias: null }),
  tareaExtraida("Beta", { objetivo: "Otra redacción de B", duracion: null, dias: null }),
];

test("la misma página leída con otra redacción del objetivo y sin duración ni días es 'iguales': no se escribe nada y el daily no avisa", async () => {
  entorno(plan(ALFA, BETA), plan(ALFA, BETA));
  const antes = archivosDelRastro();

  const r = await sincronizar(claudeFalso(extraccion(REFORMULADAS)).notion, { confirmar: true });
  const l = await sincronizarEnLectura({ hoy, notion: claudeFalso(extraccion(REFORMULADAS)).notion, modo: "claude" });

  assert.equal(r.estado, "iguales");
  assert.equal(r.planCambio, false);
  assert.deepEqual(l, { avisos: [], informes: [] });
  assert.deepEqual(archivosDelRastro(), antes);
});

test("un repo que la página no trae tampoco es un cambio, pero uno distinto sí", async () => {
  entorno(plan(`${ALFA} · repo:hunting`), plan(`${ALFA} · repo:hunting`));
  registrarRepoLlamado("hunting");
  registrarRepoLlamado("otro");
  const alfa = { objetivo: "Hacer A.", duracion: "2d", dias: "lun–mar" };

  assert.equal((await sincronizar(claudeFalso(extraccion([tareaExtraida("Alfa", { ...alfa, repo: null })])).notion)).estado, "iguales");
  assert.equal((await sincronizar(claudeFalso(extraccion([tareaExtraida("Alfa", { ...alfa, repo: "otro" })])).notion)).estado, "notion");
});

test("un cambio real de estado en Notion se adopta y la tarea conserva su objetivo, su duración y sus días locales", async () => {
  const e = entorno(plan(ALFA, BETA), plan(ALFA, BETA));
  const lectura = extraccion([tareaExtraida("Alfa", { objetivo: "Otra redacción de A", estado: "hecha", duracion: null, dias: null }), REFORMULADAS[1] as TareaExtraida]);

  const r = await sincronizar(claudeFalso(lectura).notion);

  assert.equal(r.estado, "notion");
  assert.match(readFileSync(e.plan, "utf8"), /^- \[x\] \*\*Alfa:\*\* Hacer A\. · 2d · lun–mar$/m);
  assert.match(readFileSync(e.plan, "utf8"), /^- \[ \] \*\*Beta:\*\* Hacer B\. · 1d · mié$/m);
  assert.ok(r.lineas.some((l) => l.includes("Alfa")));
});

test("una duración de Notion distinta de la local sí es una diferencia; los días que Notion no trae se conservan; una tarea nueva entra como se extrajo", async () => {
  const e = entorno(plan(ALFA), plan(ALFA));
  const lectura = extraccion([
    tareaExtraida("Alfa", { objetivo: "Otra redacción de A", duracion: "3d", dias: null }),
    tareaExtraida("Gama", { objetivo: "Tarea nueva.", duracion: "1d", dias: "vie" }),
  ]);

  const l = await sincronizarEnLectura({ hoy, notion: claudeFalso(lectura).notion, modo: "claude" });

  assert.ok(l.informes.some((i) => i.includes("Alfa: duracion distinto, Rastro 2d, Notion 3d")));
  assert.ok(l.informes.some((i) => i.includes("Gama: solo está en Notion")));
  assert.doesNotMatch(l.informes.join("\n"), /objetivo|dias distinto/);
  const md = readFileSync(e.plan, "utf8");
  assert.match(md, /^- \[ \] \*\*Alfa:\*\* Hacer A\. · 3d · lun–mar$/m);
  assert.match(md, /^- \[ \] \*\*Gama:\*\* Tarea nueva\. · 1d · vie$/m);
});

test("lo que Notion no trae se completa con la base: un cambio solo local sigue siendo de Rastro y no de Notion", async () => {
  entorno(plan("- [ ] **Alfa:** Hacer A. · 3d · lun–mar"), plan(ALFA));

  assert.equal((await sincronizar(claudeFalso(extraccion(REFORMULADAS.slice(0, 1))).notion)).estado, "iguales");

  entorno(plan("- [ ] **Alfa:** Hacer A. · 3d · lun–mar"), plan(ALFA));
  // Con la duración vieja de la base, Notion no cambió: lo que cambió es Rastro.
  const igualALaBase = extraccion([tareaExtraida("Alfa", { objetivo: "Otra redacción", duracion: "2d", dias: "lun–mar" })]);
  assert.equal((await sincronizar(claudeFalso(igualALaBase).notion)).estado, "rastro");
});

test("al publicar, el objetivo reformulado de Notion no se pide como cambio", async () => {
  entorno(plan(ALFA, BETA), plan(ALFA));
  const alfa = tareaExtraida("Alfa", { objetivo: "Otra redacción de A", duracion: "2d", dias: "lun–mar" });
  const { notion, llamadas } = claudeFalso(extraccion([alfa]));

  await sincronizar(notion, { confirmar: true });

  const entrada = llamadas[1]?.entrada ?? "";
  assert.match(entrada, /Agregar la tarea "Beta"/);
  assert.doesNotMatch(entrada, /Tarea "Alfa"/);
});

test("el daily no pisa las duraciones ni los días locales con un Notion que no los trae", async () => {
  const e = entorno(plan(ALFA, BETA), plan(ALFA, BETA));
  writeFileSync(rutasGlobales().notionPreview, plan("- [ ] **Alfa:** Hacer A.", "- [ ] **Beta:** Hacer B."));

  const { stdout, stderr } = await capturandoSalida(() => cmdDaily([]));

  assert.doesNotMatch(stdout, /Se adoptó/);
  assert.doesNotMatch(stderr, /plan de Notion/);
  assert.equal(readFileSync(e.plan, "utf8"), plan(ALFA, BETA));
  assert.equal(readFileSync(e.base, "utf8"), plan(ALFA, BETA));
});

test("lo que viene de la página y va al prompt de escritura se redacta, se aplana y se acota", () => {
  const largo = "x".repeat(300);
  const deNotion = parsearPlan(`## Plan semana ${ddmm(lunesDe(hoy))}\n- **Entregable del viernes:** Demo API_KEY=abc123secreto ${largo}\n- [ ] **Gama ${largo}:** Sobra. · 1d\n`, hoy);
  const local = parsearPlan(plan(ALFA), hoy);
  assert.ok(deNotion !== null && local !== null);

  const [entregable, sacar] = cambiosParaNotion(deNotion, local);

  assert.ok(entregable?.startsWith('Cambiar el entregable del viernes de "Demo API_KEY=[redactado]'));
  assert.doesNotMatch(`${entregable}${sacar}`, /abc123secreto/);
  assert.ok((entregable?.length ?? 999) < 200 && (sacar?.length ?? 999) < 150, `${entregable} | ${sacar}`);
});

test("los nombres de los repos van redactados en el pedido de lectura", async () => {
  entorno(null, null);
  registrarRepoLlamado("sk-abcdefghijklmnop");
  const { notion, llamadas } = claudeFalso(JSON.stringify({ is_error: false, structured_output: { plan: null } }));

  await sincronizar(notion);

  assert.match(llamadas[0]?.entrada ?? "", /repos registrados \([^)]*\[redactado\]/);
  assert.doesNotMatch(llamadas[0]?.entrada ?? "", /sk-abcdefghijklmnop/);
});

test("un repos.json ilegible se informa como tal y no como una falla de Notion", async () => {
  entorno(plan(ALFA), plan(ALFA));
  writeFileSync(rutasGlobales().repos, "{no es json");
  const { notion, llamadas } = claudeFalso(JSON.stringify({ is_error: false, structured_output: { plan: null } }));

  await assert.rejects(() => sincronizar(notion), /repos\.json no es válido/);

  assert.equal(llamadas.length, 0);
});
