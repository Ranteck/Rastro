import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { textoSiguiente } from "../src/aviso.ts";
import { configPorDefecto, escribirConfig, rutasGlobales, type Config } from "../src/config.ts";
import { Almacen } from "../src/central/almacen.ts";
import { crearCentral } from "../src/central/servidor.ts";
import { validarSnapshot } from "../src/contract/snapshot.ts";
import { cmdDaily } from "../src/daily.ts";
import { ErrorUsuario } from "../src/errores.ts";
import { ddmm, fechaLocal, lunesDe, lunesQueViene, sumarDias } from "../src/fechas.ts";
import type { Ejecutor } from "../src/llm/claudeCli.ts";
import { parsearPlan } from "../src/plan.ts";
import { guardarPublicado, huellaDelPlan, leerPublicado, yaPublicado } from "../src/publicado.ts";
import { armarPlan, cmdPlan, textoDePropuesta } from "../src/planCmd.ts";
import { crearNotionPlan, sincronizarEnLectura, sincronizarPlan, type NotionPlan } from "../src/sincroNotion.ts";
import { FakeLlm } from "./helpers/fakeLlm.ts";
import { crearRepoRegistrado, type RepoTemporal } from "./helpers/repo.ts";

const config: Config = { ...configPorDefecto({ id: "test", nombre: "Test", equipo: "QA" }), llm: { proveedor: "ninguno", modelo: "haiku" } };
const hoy = fechaLocal(new Date(), config.zonaHoraria);
const lunes = lunesDe(hoy);
const proximo = lunesQueViene(hoy);
const seccion = (semana: string, ...tareas: string[]): string => `## Plan semana ${ddmm(semana)}\n- **Entregable del viernes:** Demo.\n${tareas.map((t) => `${t}\n`).join("")}`;
const ALFA = "- [ ] **Alfa:** Hacer A. · 2d · lun–mar";
const BETA = "- [ ] **Beta:** Hacer B. · 1d · mié";
const GAMA = "- [ ] **Gama:** Hacer G. · 1d · jue";
const DELTA = "- [ ] **Delta:** Hacer D. · 1d · vie";
const estaSemana = (...t: string[]): string => seccion(lunes, ...t);
const laQueViene = (...t: string[]): string => seccion(proximo, ...t);

function entorno(): { repo: RepoTemporal; plan: string; base: string } {
  const repo = crearRepoRegistrado();
  escribirConfig(config);
  const r = rutasGlobales();
  return { repo, plan: r.plan, base: r.notionBase };
}

const notionFalso = (texto: string | null): NotionPlan => ({
  leer: async () => texto,
  publicar: async () => "publicado",
});

const sincronizar = (notion: NotionPlan, o: { usar?: "notion" | "rastro"; hoyDe?: string } = {}) =>
  sincronizarPlan({ config, hoy: o.hoyDe ?? hoy, notion, llm: null, confirmar: false, ...(o.usar === undefined ? {} : { usar: o.usar }) });

async function capturandoSalida<T>(correr: () => Promise<T>): Promise<{ valor: T; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const out = process.stdout.write;
  const err = process.stderr.write;
  process.stdout.write = ((t: string) => ((stdout += t), true)) as typeof process.stdout.write;
  process.stderr.write = ((t: string) => ((stderr += t), true)) as typeof process.stderr.write;
  try {
    return { valor: await correr(), stdout, stderr };
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
}

/** `cmdPlan` corre desde la carpeta de un repo registrado. */
async function enElRepo<T>(repo: RepoTemporal, correr: () => Promise<T>): Promise<{ valor: T; stdout: string }> {
  const previo = process.cwd();
  process.chdir(repo.dir);
  try {
    const { valor, stdout } = await capturandoSalida(correr);
    return { valor, stdout };
  } finally {
    process.chdir(previo);
  }
}

test("Notion con esta semana y la que viene: se adoptan las dos, cada una en su sección, y el lunes la que viene es la vigente", async () => {
  const e = entorno();
  const r = await sincronizar(notionFalso(`${estaSemana(ALFA)}\n${laQueViene(BETA, GAMA)}`));

  assert.equal(r.estado, "notion");
  const md = readFileSync(e.plan, "utf8");
  assert.equal(md, `${estaSemana(ALFA)}\n${laQueViene(BETA, GAMA)}`);
  assert.deepEqual(parsearPlan(md, hoy)?.tareas.map((t) => t.slug), ["alfa"]);
  assert.deepEqual(parsearPlan(md, proximo)?.tareas.map((t) => t.slug), ["beta", "gama"]);
  assert.ok(r.lineas.some((l) => l.includes(`semana del ${ddmm(proximo)} (2 tareas)`)));
  // Con `hoy` simulado en el lunes que viene, esa sección es la vigente y la de la semana anterior ya no.
  assert.match(textoSiguiente(new Date(`${proximo}T15:00:00Z`)), new RegExp(`^Plan de la semana del ${ddmm(proximo)}\\.`));
});

test("las bases de las dos semanas son independientes: cada semana se compara con la suya", async () => {
  const e = entorno();
  await sincronizar(notionFalso(`${estaSemana(ALFA)}\n${laQueViene(BETA)}`));
  assert.equal(readFileSync(e.base, "utf8"), `${estaSemana(ALFA)}\n${laQueViene(BETA)}`);

  // Rastro cambió esta semana y Notion cambió la que viene: cada lado se resuelve a su manera, sin mezclarse.
  writeFileSync(e.plan, `${estaSemana(ALFA, GAMA)}\n${laQueViene(BETA)}`);
  const r = await sincronizar(notionFalso(`${estaSemana(ALFA)}\n${laQueViene(BETA, DELTA)}`));

  assert.equal(r.estado, "rastro");
  assert.match(r.lineas.join("\n"), /Vista previa de lo que se publica/);
  const md = readFileSync(e.plan, "utf8");
  assert.deepEqual(parsearPlan(md, hoy)?.tareas.map((t) => t.slug), ["alfa", "gama"]);
  assert.deepEqual(parsearPlan(md, proximo)?.tareas.map((t) => t.slug), ["beta", "delta"]);
  // La base de esta semana no se movió (Rastro todavía no publicó) y la de la que viene sí.
  const base = readFileSync(e.base, "utf8");
  assert.deepEqual(parsearPlan(base, hoy)?.tareas.map((t) => t.slug), ["alfa"]);
  assert.deepEqual(parsearPlan(base, proximo)?.tareas.map((t) => t.slug), ["beta", "delta"]);
});

test("un nombre repetido en la semana que viene no frena la de esta semana", async () => {
  const e = entorno();
  const r = await sincronizar(notionFalso(`${estaSemana(ALFA)}\n${laQueViene(BETA, BETA)}`));

  assert.equal(r.estado, "notion");
  assert.ok(r.lineas.some((l) => /de la semana que viene tiene varias tareas con el mismo nombre: Beta \(2 veces\)/.test(l)));
  assert.equal(parsearPlan(readFileSync(e.plan, "utf8"), proximo), null);
  assert.deepEqual(parsearPlan(readFileSync(e.plan, "utf8"), hoy)?.tareas.map((t) => t.slug), ["alfa"]);
});

test("un plan de la semana que viene que Rastro armó y Notion no tiene no se toca ni se avisa como desvío", async () => {
  const e = entorno();
  writeFileSync(e.plan, `${estaSemana(ALFA)}\n${laQueViene(BETA)}`);
  const lectura = await sincronizarEnLectura({ hoy, notion: notionFalso(estaSemana(ALFA)), modo: "mock" });

  assert.deepEqual(lectura.avisos.filter((a) => a.includes(ddmm(proximo))), []);
  assert.equal(readFileSync(e.plan, "utf8"), `${estaSemana(ALFA)}\n${laQueViene(BETA)}`);
});

test("el daily lee solo con la semana que viene en Notion: la adopta, lo dice y `siguiente` también", async () => {
  const e = entorno();
  writeFileSync(rutasGlobales().notionPreview, laQueViene(ALFA, BETA));

  const { stdout } = await capturandoSalida(() => cmdDaily([]));

  assert.match(stdout, new RegExp(`^Ya está el plan de la semana del ${ddmm(proximo)} \\(2 tareas\\)\\.\\n`));
  const md = readFileSync(e.plan, "utf8");
  assert.equal(parsearPlan(md, hoy), null);
  assert.deepEqual(parsearPlan(md, proximo)?.tareas.map((t) => t.slug), ["alfa", "beta"]);
  const siguiente = textoSiguiente(new Date(`${hoy}T15:00:00Z`));
  assert.match(siguiente, new RegExp(`^No hay plan para esta semana, pero sí para la que viene \\(${ddmm(proximo)}, 2 tareas\\)`));
});

test("`siguiente` suma la línea de la semana que viene desde el viernes, y no antes", () => {
  const e = entorno();
  writeFileSync(e.plan, `${estaSemana(ALFA)}\n${laQueViene(BETA)}`);

  const miercoles = new Date(`${sumarDias(lunes, 2)}T15:00:00Z`);
  const viernes = new Date(`${sumarDias(lunes, 4)}T15:00:00Z`);
  assert.doesNotMatch(textoSiguiente(miercoles), /semana que viene/);
  assert.match(textoSiguiente(viernes), new RegExp(`\\nYa está el plan de la semana que viene \\(${ddmm(proximo)}, 1 tarea\\)\\.\\n$`));
});

test("`siguiente` sin plan en ninguna semana ofrece la frase para Claude", () => {
  entorno();
  assert.match(textoSiguiente(new Date()), /rastro plan <propuesta\.md>`.*\(O decile a Claude «armá el plan»/);
});

type Llamada = { args: readonly string[]; entrada: string };

function claudeFalso(respuesta: unknown): { llamadas: Llamada[]; notion: NotionPlan } {
  const llamadas: Llamada[] = [];
  const ejecutar: Ejecutor = async (_bin, args, entrada) => {
    llamadas.push({ args, entrada });
    return { codigo: 0, stdout: JSON.stringify({ is_error: false, structured_output: respuesta }), stderr: "" };
  };
  return { llamadas, notion: crearNotionPlan({ ...config, notion: { modo: "claude" } }, { ejecutar, home: rutasGlobales().dir }) };
}

const planExtraido = (semana: string | null, nombre: string) => ({ semana, entregable: "Demo.", tareas: [{ nombre, objetivo: `Hacer ${nombre}.`, estado: "pendiente", duracion: "1d", dias: null, repo: null }] });

test("la extracción con claude pide las dos semanas y devuelve un bloque por cada una", async () => {
  entorno();
  const { llamadas, notion } = claudeFalso({ plan: planExtraido(ddmm(lunes), "Alfa"), planProxima: planExtraido(ddmm(proximo), "Beta") });

  const bloques = await notion.leer(hoy);

  assert.equal(parsearPlan(bloques ?? "", hoy)?.tareas[0]?.slug, "alfa");
  assert.equal(parsearPlan(bloques ?? "", proximo)?.tareas[0]?.slug, "beta");
  const entrada = llamadas[0]?.entrada ?? "";
  assert.ok(entrada.includes(`el lunes ${ddmm(lunes)}`));
  assert.ok(entrada.includes(`el lunes ${ddmm(proximo)}`));
  assert.match(entrada, /"planProxima"/);
  const esquema = JSON.parse(llamadas[0]?.args[(llamadas[0]?.args.indexOf("--json-schema") ?? 0) + 1] ?? "{}") as { required: string[] };
  assert.deepEqual(esquema.required, ["plan", "planProxima"]);
});

test("un plan que el LLM rotula con otra semana que la pedida no se adopta y se avisa", async () => {
  entorno();
  const avisos: string[] = [];
  const { notion } = claudeFalso({ plan: planExtraido(ddmm(proximo), "Alfa"), planProxima: planExtraido(null, "Beta") });

  const bloques = await notion.leer(hoy, { repos: [], avisar: (a) => avisos.push(a) });

  assert.equal(parsearPlan(bloques ?? "", hoy), null);
  // Sin rótulo no se puede saber, y se acepta como la semana pedida.
  assert.equal(parsearPlan(bloques ?? "", proximo)?.tareas[0]?.slug, "beta");
  assert.match(avisos.join("\n"), new RegExp(`dice ser de la del ${ddmm(proximo)}: no lo adopto`));
});

test("una respuesta que solo trae `plan` (sin planProxima) sigue siendo válida", async () => {
  entorno();
  const { notion } = claudeFalso({ plan: planExtraido(ddmm(lunes), "Alfa") });
  assert.equal(parsearPlan((await notion.leer(hoy)) ?? "", hoy)?.tareas[0]?.slug, "alfa");
});

const respuestaPlan = { plan: { entregable: "Demo.", tareas: [{ nombre: "Bitácora", objetivo: "Registrar.", duracion: { valor: 2, unidad: "d" } }, { nombre: "Central", objetivo: "Recibir.", duracion: { valor: 4, unidad: "h" } }] } };

test("plan <propuesta> --semana-que-viene arma la propuesta del lunes que viene y --confirmar no toca la semana actual", async () => {
  const e = entorno();
  writeFileSync(e.plan, estaSemana(ALFA));
  e.repo.escribir("propuesta.md", "# Propuesta\n");
  const llm = new FakeLlm(respuestaPlan);

  const armado = await enElRepo(e.repo, () => cmdPlan([`${e.repo.dir}/propuesta.md`, "--semana-que-viene"], { llm }));

  assert.equal(armado.valor, 0);
  assert.ok(llm.prompts[0]?.includes(proximo), "el LLM recibe el lunes que viene");
  assert.match(armado.stdout, new RegExp(`Propuesta de plan de la semana que viene \\(${ddmm(proximo)}\\)`));
  assert.match(armado.stdout, /rastro plan --confirmar --semana-que-viene/);
  const propuesta = parsearPlan(readFileSync(rutasGlobales().planSugerido, "utf8"), proximo);
  assert.deepEqual(propuesta?.tareas.map((t) => t.dias[0]), [proximo, sumarDias(proximo, 2)]);
  assert.equal(readFileSync(e.plan, "utf8"), estaSemana(ALFA));

  // Sin la bandera, la propuesta de la semana que viene no se confirma como la de esta: se dice cómo.
  await assert.rejects(
    enElRepo(e.repo, () => cmdPlan(["--confirmar"])),
    (err: unknown) => err instanceof ErrorUsuario && /plan --confirmar --semana-que-viene/.test(err.message),
  );

  const confirmado = await enElRepo(e.repo, () => cmdPlan(["--confirmar", "--semana-que-viene"]));
  assert.match(confirmado.stdout, new RegExp(`^Plan de la semana del ${ddmm(proximo)} \\(la que viene\\) confirmado`));
  const md = readFileSync(e.plan, "utf8");
  assert.ok(md.startsWith(estaSemana(ALFA).trimEnd()), "la sección de esta semana queda igual");
  assert.deepEqual(parsearPlan(md, hoy)?.tareas.map((t) => t.slug), ["alfa"]);
  const nueva = parsearPlan(md, proximo);
  assert.deepEqual(nueva?.tareas.map((t) => [t.slug, t.dias[0]]), [["bitacora", proximo], ["central", sumarDias(proximo, 2)]]);
  assert.equal(existsSync(rutasGlobales().planSugerido), false);
});

test("plan cambiar --propuesta --semana-que-viene corrige la propuesta del lunes que viene, y sin --propuesta se rechaza", async () => {
  const e = entorno();
  e.repo.escribir("propuesta.md", "# Propuesta\n");
  await enElRepo(e.repo, () => cmdPlan([`${e.repo.dir}/propuesta.md`, "--semana-que-viene"], { llm: new FakeLlm(respuestaPlan) }));

  await enElRepo(e.repo, () => cmdPlan(["cambiar", "duracion", "central", "1d", "--propuesta", "--semana-que-viene", "--confirmar"]));

  assert.deepEqual(parsearPlan(readFileSync(rutasGlobales().planSugerido, "utf8"), proximo)?.tareas.find((t) => t.slug === "central")?.duracion, { valor: 1, unidad: "d" });
  await assert.rejects(enElRepo(e.repo, () => cmdPlan(["cambiar", "duracion", "central", "1d", "--semana-que-viene"])), /Uso: rastro plan/);
});

test("plan --desde-proyecto --semana-que-viene arma una propuesta aunque ya haya plan esta semana, y --confirmar la deja para el lunes", async () => {
  const e = entorno();
  e.repo.escribir(".gitignore", ".rastro/\n");
  e.repo.escribir("Docs/propuesta-x.md", "# Propuesta\nUn login.\n");
  e.repo.commit("inicio");
  writeFileSync(e.plan, estaSemana(ALFA));
  const llm = new FakeLlm({ "desde-proyecto": { entregable: "Demo.", tareas: [{ nombre: "Login", objetivo: "Hacer el login.", duracion: { valor: 1, unidad: "d" }, estado: "pendiente", porque: "Es lo que viene." }] } });

  const armado = await enElRepo(e.repo, () => cmdPlan(["--desde-proyecto", "--semana-que-viene"], { llm }));

  assert.match(armado.stdout, new RegExp(`Propuesta de plan de la semana que viene \\(${ddmm(proximo)}\\)[^\\n]*confirmá con \`rastro plan --desde-proyecto --confirmar --semana-que-viene\``));
  assert.equal(parsearPlan(readFileSync(rutasGlobales().planSugerido, "utf8"), proximo)?.tareas[0]?.dias[0], proximo);
  assert.equal(existsSync(rutasGlobales().ofrecimientos), false);

  await enElRepo(e.repo, () => cmdPlan(["--desde-proyecto", "--confirmar", "--semana-que-viene"]));

  const md = readFileSync(e.plan, "utf8");
  assert.deepEqual(parsearPlan(md, hoy)?.tareas.map((t) => t.slug), ["alfa"]);
  assert.deepEqual(parsearPlan(md, proximo)?.tareas.map((t) => t.slug), ["login"]);
});

test("--semana-que-viene sin propuesta ni nada que confirmar dice qué falta", async () => {
  const e = entorno();
  await assert.rejects(enElRepo(e.repo, () => cmdPlan(["--confirmar", "--semana-que-viene"])), /No hay una propuesta para confirmar: armala con `rastro plan <propuesta\.md> --semana-que-viene`/);
  await assert.rejects(enElRepo(e.repo, () => cmdPlan(["--desde-proyecto", "--confirmar", "--semana-que-viene"])), /No hay una propuesta para la semana que viene/);
  await assert.rejects(enElRepo(e.repo, () => cmdPlan(["--sugerir", "--semana-que-viene"], { llm: new FakeLlm("falla") })), /Uso: rastro plan/);
});

test("armar la propuesta de la otra semana nombra la semana descartada y lo que traía, y la de la misma semana sigue como antes", async () => {
  entorno();
  const nombre = "test";
  await armarPlan({ nombre, config, llm: new FakeLlm(respuestaPlan), propuesta: "# P", hoy });

  const queViene = await armarPlan({ nombre, config, llm: new FakeLlm(respuestaPlan), propuesta: "# P", hoy: proximo });
  assert.deepEqual(queViene.descartada, { semana: lunes, tareas: ["Bitácora", "Central"] });
  assert.match(textoDePropuesta(queViene, proximo), new RegExp(`^Se descartó la propuesta sin confirmar de la semana del ${ddmm(lunes)} y sus tareas: Bitácora, Central;`));

  // Al revés también, y una propuesta de la misma semana se reemplaza (y conserva) como siempre.
  const deEstaSemana = await armarPlan({ nombre, config, llm: new FakeLlm(respuestaPlan), propuesta: "# P", hoy });
  assert.deepEqual(deEstaSemana.descartada, { semana: proximo, tareas: ["Bitácora", "Central"] });
  const misma = await armarPlan({ nombre, config, llm: new FakeLlm(respuestaPlan), propuesta: "# P", hoy });
  assert.equal(misma.descartada, undefined);
  assert.match(textoDePropuesta(misma), /^Se reemplazó la propuesta anterior/);
});

test("el --desde-proyecto de la otra semana también dice qué propuesta descartó", async () => {
  const e = entorno();
  e.repo.escribir(".gitignore", ".rastro/\n");
  e.repo.escribir("Docs/propuesta-x.md", "# Propuesta\n");
  e.repo.commit("inicio");
  const llm = new FakeLlm({ "desde-proyecto": { entregable: "Demo.", tareas: [{ nombre: "Login", objetivo: "Hacer.", duracion: { valor: 1, unidad: "d" }, estado: "pendiente", porque: "Sí." }] } });
  await enElRepo(e.repo, () => cmdPlan(["--desde-proyecto"], { llm }));

  const r = await enElRepo(e.repo, () => cmdPlan(["--desde-proyecto", "--semana-que-viene"], { llm }));

  assert.match(r.stdout, new RegExp(`\\nSe descartó la propuesta sin confirmar de la semana del ${ddmm(lunes)} y sus tareas: Login`));
});

test("confirmar la semana que viene dice que queda solo en Rastro y cómo llega a Notion, y confirmar esta semana no lo dice", async () => {
  const e = entorno();
  e.repo.escribir("propuesta.md", "# P\n");
  await enElRepo(e.repo, () => cmdPlan([`${e.repo.dir}/propuesta.md`, "--semana-que-viene"], { llm: new FakeLlm(respuestaPlan) }));
  const queViene = await enElRepo(e.repo, () => cmdPlan(["--confirmar", "--semana-que-viene"]));
  assert.match(queViene.stdout, /Queda solo en Rastro: el lunes pasa a ser el plan vigente y ese día `rastro plan sincronizar --confirmar` \(o decile a Claude «sincronizá el plan»\) lo lleva a Notion\./);

  await enElRepo(e.repo, () => cmdPlan([`${e.repo.dir}/propuesta.md`], { llm: new FakeLlm(respuestaPlan) }));
  const esta = await enElRepo(e.repo, () => cmdPlan(["--confirmar"]));
  assert.doesNotMatch(esta.stdout, /Queda solo en Rastro/);
});

test("confirmar la semana que viene no rehace el resumen del daily: state.json queda igual y no hay aviso", async () => {
  const e = entorno();
  const estado = readFileSync(new URL("../../frontend/ejemplos/persona-denis.json", import.meta.url), "utf8");
  writeFileSync(rutasGlobales().state, estado);
  e.repo.escribir("propuesta.md", "# P\n");
  await enElRepo(e.repo, () => cmdPlan([`${e.repo.dir}/propuesta.md`, "--semana-que-viene"], { llm: new FakeLlm(respuestaPlan) }));

  const r = await enElRepo(e.repo, () => cmdPlan(["--confirmar", "--semana-que-viene"]));

  assert.equal(readFileSync(rutasGlobales().state, "utf8"), estado);
  assert.doesNotMatch(r.stdout, /resumen local|rastro daily/);
});

test("adoptar la semana que viene anota su huella: el lunes, publish no la vuelve a ofrecer, y la de esta semana se conserva", async () => {
  const e = entorno();
  await sincronizar(notionFalso(`${estaSemana(ALFA)}\n${laQueViene(BETA)}`));

  const publicado = leerPublicado();
  assert.equal(publicado?.queViene?.semana, proximo);
  // Es el plan que `publish` ve el lunes, cuando esa sección es la vigente.
  const delLunes = parsearPlan(readFileSync(e.plan, "utf8"), proximo);
  assert.ok(delLunes !== null);
  const huella = huellaDelPlan(delLunes);
  assert.ok(huella !== null);
  assert.equal(yaPublicado(delLunes, huella, config.notion.modo, publicado), true);
  assert.equal(yaPublicado(delLunes, huella, config.notion.modo === "mock" ? "claude" : "mock", publicado), false);
  assert.equal(yaPublicado(delLunes, `${huella}x`, config.notion.modo, publicado), false);
  // Anotar la huella de esta semana no pisa la de la que viene.
  guardarPublicado("otra", "mock");
  assert.equal(leerPublicado()?.queViene?.semana, proximo);
});

test("`conocidoProxima` de la extracción es el plan de la semana que viene y no el de esta", async () => {
  const e = entorno();
  writeFileSync(e.plan, `${estaSemana(ALFA)}\n${laQueViene(BETA)}`);
  writeFileSync(e.base, `${estaSemana(ALFA)}\n${laQueViene(BETA)}`);
  const { llamadas, notion } = claudeFalso({ plan: planExtraido(ddmm(lunes), "Alfa"), planProxima: planExtraido(ddmm(proximo), "Beta") });

  await sincronizar(notion);

  const entrada = llamadas[0]?.entrada ?? "";
  const deEstaSemana = entrada.split("\n").find((l) => l.startsWith("Rastro ya conoce este plan de la semana")) ?? "";
  const deLaQueViene = entrada.split("\n").find((l) => l.startsWith(`Rastro ya conoce el plan de la semana que empieza el lunes ${ddmm(proximo)}`)) ?? "";
  assert.match(deEstaSemana, /"nombre":"Alfa"/);
  assert.doesNotMatch(deEstaSemana, /Beta/);
  assert.match(deLaQueViene, /"nombre":"Beta"/);
  assert.doesNotMatch(deLaQueViene, /Alfa/);
});

test("sincronizar con `hoy` en el lunes que viene: la sección adoptada de antemano ya es la vigente y cuenta como igual; un cambio de Notion ese lunes se adopta solo", async () => {
  const e = entorno();
  await sincronizar(notionFalso(`${estaSemana(ALFA)}\n${laQueViene(BETA)}`));

  // El lunes, Notion solo trae el plan de esa semana (y todavía no el de la siguiente).
  const igual = await sincronizar(notionFalso(laQueViene(BETA)), { hoyDe: proximo });
  assert.equal(igual.estado, "iguales");
  assert.ok(igual.lineas.some((l) => l.includes("ya son iguales")));
  const lectura = await sincronizarEnLectura({ hoy: proximo, notion: notionFalso(laQueViene(BETA)), modo: "mock" });
  assert.deepEqual([lectura.avisos, lectura.informes], [[], []]);

  const conCambio = await sincronizar(notionFalso(laQueViene(BETA, GAMA)), { hoyDe: proximo });
  assert.equal(conCambio.estado, "notion");
  const md = readFileSync(e.plan, "utf8");
  assert.deepEqual(parsearPlan(md, proximo)?.tareas.map((t) => t.slug), ["beta", "gama"]);
  assert.deepEqual(parsearPlan(md, hoy)?.tareas.map((t) => t.slug), ["alfa"]);
});

test("/api/persona: con plan solo para la semana que viene viaja `queViene` con la semana y la cantidad, sin el texto de las tareas", async (t) => {
  const e = entorno();
  writeFileSync(e.plan, laQueViene(ALFA, BETA));
  const servidor = crearCentral({ almacen: new Almacen(mkdtempSync(join(tmpdir(), "rastro-central-"))), estaticos: join(tmpdir(), "rastro-sin-dist"), personal: { ahora: () => new Date(`${hoy}T15:00:00Z`) } });
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => servidor.close(() => resolve())));
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

  const sinDaily = (await (await fetch(`${url}/api/persona/test`)).json()) as { queViene: unknown; snapshot: unknown };
  assert.deepEqual(sinDaily.queViene, { semana: proximo, tareas: 2 });
  assert.equal(validarSnapshot(sinDaily.snapshot).plan, null);

  // Con un daily de esta semana sin plan, el snapshot sale envuelto solo para sumar lo de la que viene.
  const estado = JSON.parse(readFileSync(new URL("../../frontend/ejemplos/persona-denis.json", import.meta.url), "utf8")) as Record<string, unknown>;
  writeFileSync(rutasGlobales().state, JSON.stringify({ ...estado, persona: { id: "test", nombre: "Test", equipo: "QA" }, plan: null }));
  const conDaily = (await (await fetch(`${url}/api/persona/test`)).json()) as { queViene: unknown; snapshot: { plan: unknown } };
  assert.deepEqual(conDaily.queViene, { semana: proximo, tareas: 2 });
  assert.equal(conDaily.snapshot.plan, null);

  // Con plan esta semana la respuesta es el snapshot de siempre, sin envoltorio.
  writeFileSync(e.plan, `${estaSemana(ALFA)}\n${laQueViene(BETA)}`);
  writeFileSync(rutasGlobales().state, JSON.stringify({ ...estado, persona: { id: "test", nombre: "Test", equipo: "QA" } }));
  const normal = (await (await fetch(`${url}/api/persona/test`)).json()) as Record<string, unknown>;
  assert.equal("queViene" in normal, false);
  assert.equal("snapshot" in normal, false);
});
