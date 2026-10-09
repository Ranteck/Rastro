import { test } from "node:test";
import assert from "node:assert/strict";
import { configPorDefecto, escribirConfig } from "../src/config.ts";
import { generarSnapshot, leerFuentes } from "../src/daily.ts";
import { normalizarComando, patronesDeComandos, patronesDePrompts } from "../src/detectores/repeticiones.ts";
import { dirDeProyecto, promptsDeTranscript, transcriptsRecientes } from "../src/fuentes/claudeCode.ts";
import { parsearHistorialZsh } from "../src/fuentes/zsh.ts";
import { FakeLlm } from "./helpers/fakeLlm.ts";
import { crearRepo } from "./helpers/repo.ts";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ZONA = "America/Argentina/Buenos_Aires";
const u = { veces: 3, dias: 2, ventanaMin: 10 };
const config = configPorDefecto({ id: "test", nombre: "Test", equipo: "QA" });

test("normaliza rutas, hashes y números, y descarta comandos triviales", () => {
  assert.equal(normalizarComando("git rebase origin/main"), "git rebase <ruta>");
  assert.equal(normalizarComando("git show 3f9c2ab7"), "git show <hash>");
  assert.equal(normalizarComando("kill 4312"), "kill <n>");
  assert.equal(normalizarComando("ls -la"), null);
  assert.equal(normalizarComando("git status -s"), null);
});

test("la misma secuencia 3 veces en 2 días es un patrón, y sus partes no se repiten", () => {
  const secuencia = (dia: string, hora: string) => [
    { en: new Date(`${dia}T${hora}:00-03:00`), texto: "git fetch origin" },
    { en: new Date(`${dia}T${hora}:30-03:00`), texto: "git rebase origin/main" },
    { en: new Date(`${dia}T${hora}:59-03:00`), texto: "npm test" },
  ];
  const comandos = [...secuencia("2026-10-07", "10:00"), ...secuencia("2026-10-08", "15:00"), ...secuencia("2026-10-08", "18:00")];
  assert.deepEqual(patronesDeComandos(comandos, u, ZONA), [
    { fuente: "zsh", patron: "git fetch origin → git rebase <ruta> → npm test", ocurrencias: 3, dias: 2 },
  ]);
});

test("comandos separados por más de la ventana no forman una secuencia", () => {
  const comandos = ["2026-10-07", "2026-10-08", "2026-10-09"].flatMap((d) => [
    { en: new Date(`${d}T10:00:00-03:00`), texto: "docker compose up -d" },
    { en: new Date(`${d}T10:30:00-03:00`), texto: "npm run seed" },
  ]);
  const patrones = patronesDeComandos(comandos, u, ZONA);
  assert.ok(!patrones.some((p) => p.patron.includes("→")));
  assert.ok(patrones.some((p) => p.patron === "docker compose up -d"));
});

test("prompts parecidos de Claude Code se agrupan; las confirmaciones cortas no cuentan", () => {
  const p = (iso: string, texto: string) => ({ en: new Date(iso), texto, sesion: "s" });
  const prompts = [
    p("2026-10-06T10:00:00-03:00", "armá el update de la daily con lo que hice hoy"),
    p("2026-10-07T10:00:00-03:00", "Armá el update de la daily con lo que hice hoy!"),
    p("2026-10-08T10:00:00-03:00", "armá el update de la daily con lo que hice hoy por favor"),
    ...["dale", "dale", "dale", "sí, acepto"].map((t, i) => p(`2026-10-0${6 + i}T11:00:00-03:00`, t)),
  ];
  const patrones = patronesDePrompts(prompts, u, ZONA);
  assert.equal(patrones.length, 1);
  assert.equal(patrones[0]?.ocurrencias, 3);
  assert.equal(patrones[0]?.dias, 3);
});

test("historial de zsh: timestamps, comandos multilínea, bytes metaficados y líneas sin fecha", () => {
  const contenido = Buffer.concat([
    Buffer.from(": 1760000000:0;git status\n: 1760000060:0;echo uno \\\ndos\nsin fecha vieja\n: 1760000120:0;echo m"),
    Buffer.from([0xc3, 0x83, 0x81]), // "á" metaficada por zsh: 0x83 seguido de 0xA1 ^ 0x20
    Buffer.from("s\n"),
  ]);
  const { comandos, descartadas } = parsearHistorialZsh(contenido);
  assert.deepEqual(comandos.map((c) => c.texto), ["git status", "echo uno \ndos", "echo más"]);
  assert.equal(comandos[0]?.en.getTime(), 1760000000 * 1000);
  assert.equal(descartadas, 1);
});

test("del transcript solo cuentan los prompts del usuario; lo ilegible se cuenta", () => {
  const lineas = [
    JSON.stringify({ type: "user", message: { role: "user", content: "armá el plan de la semana" }, timestamp: "2026-10-09T13:00:00.000Z", sessionId: "s1", isSidechain: false }),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "x" }] }, timestamp: "2026-10-09T13:01:00.000Z", sessionId: "s1" }),
    JSON.stringify({ type: "user", message: { role: "user", content: "<command-name>/effort</command-name>" }, timestamp: "2026-10-09T13:02:00.000Z", sessionId: "s1" }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: "hola" }, timestamp: "2026-10-09T13:03:00.000Z", sessionId: "s1" }),
    '{"type":"user", cortado',
  ];
  const { prompts, descartadas } = promptsDeTranscript(lineas.join("\n"));
  assert.deepEqual(prompts.map((p) => p.texto), ["armá el plan de la semana"]);
  assert.equal(descartadas, 1);
});

test("daily suma las sugerencias con su propuesta y nunca deja pasar un secreto", async () => {
  const r = crearRepo();
  escribirConfig(r.dir, config);
  r.escribir(".gitignore", ".rastro/\n");
  r.commit("inicio");
  const token = `ghp_${"c".repeat(36)}`;
  const comandos = ["2026-10-07", "2026-10-08", "2026-10-08"].map((d, i) => ({
    en: new Date(`${d}T1${i}:00:00-03:00`),
    texto: `deploy --token=${token} --env staging`,
  }));
  const llm = new FakeLlm({
    bitacora: { entradas: [], resumen: { hice: [], avance: [], sigue: [], bloqueos: [] } },
    sugerencias: { propuestas: [{ id: "0", tipo: "alias", contenido: "alias deploy-staging='deploy --env staging'", porque: "Se repitió 3 veces en 2 días." }] },
  });
  const { snapshot } = await generarSnapshot({ repo: r.dir, config, llm, ahora: new Date(), fuentes: { comandos, prompts: [] } });
  assert.equal(snapshot.sugerencias.length, 1);
  assert.equal(snapshot.sugerencias[0]?.propuesta.tipo, "alias");
  assert.ok(!snapshot.sugerencias[0]?.patron.includes(token));
  assert.ok(llm.prompts.every((p) => !p.includes(token)));
});

test("solo se leen los transcripts del proyecto actual y las líneas rotas se avisan", () => {
  const repo = "/home/x/Proyectos/Mi.App";
  assert.equal(dirDeProyecto(repo), "-home-x-Proyectos-Mi-App");
  const base = mkdtempSync(join(tmpdir(), "rastro-fuentes-"));
  const ahora = new Date("2026-10-09T15:00:00Z");
  const linea = (texto: string) => JSON.stringify({ type: "user", message: { role: "user", content: texto }, timestamp: "2026-10-08T13:00:00.000Z", sessionId: "s1" });
  const proyectos = join(base, "projects");
  mkdirSync(join(proyectos, dirDeProyecto(repo)), { recursive: true });
  mkdirSync(join(proyectos, "-home-x-Proyectos-Otro"), { recursive: true });
  writeFileSync(join(proyectos, dirDeProyecto(repo), "a.jsonl"), `${linea("pedido de este proyecto")}\n{cortado\n`);
  writeFileSync(join(proyectos, "-home-x-Proyectos-Otro", "b.jsonl"), `${linea("pedido de otro proyecto")}\n`);
  const zsh = join(base, "zsh_history");
  writeFileSync(zsh, ": 1791475200:0;git status\nsin fecha\n");
  const cfg = { ...config, fuentes: { zshHistory: zsh, claudeProjects: proyectos } };
  const avisos: string[] = [];
  const { comandos, prompts } = leerFuentes(cfg, repo, ahora, avisos);
  assert.deepEqual(prompts.map((p) => p.texto), ["pedido de este proyecto"]);
  assert.equal(comandos.length, 1);
  assert.equal(avisos.length, 2);
  assert.deepEqual(transcriptsRecientes(join(proyectos, "no-existe"), ahora), { rutas: [], ilegibles: 0 });
});

test("un token que cruza el carácter 120 no se filtra al patrón ni al LLM", async () => {
  const token = `ghp_${"d".repeat(36)}`;
  const texto = `${"armá el reporte semanal de avance ".repeat(2)}con el token de deploy ${token} para el deploy`;
  // Con 25+ caracteres del token antes del corte, cortar antes de redactar dejaría un `ghp_...` que sí es reconocible.
  assert.ok(texto.indexOf(token) + 4 + 25 <= 120 && texto.indexOf(token) + token.length > 120);
  const prompts = ["2026-10-06", "2026-10-07", "2026-10-08"].map((d) => ({ en: new Date(`${d}T10:00:00-03:00`), texto, sesion: "s" }));
  const patrones = patronesDePrompts(prompts, u, ZONA);
  assert.equal(patrones.length, 1);
  assert.ok(patrones[0]?.patron.includes("[redactado]"));
  assert.ok(!patrones[0]?.patron.includes("ghp_"));
  const r = crearRepo();
  escribirConfig(r.dir, config);
  r.escribir(".gitignore", ".rastro/\n");
  r.commit("inicio");
  const llm = new FakeLlm({
    bitacora: { entradas: [], resumen: { hice: [], avance: [], sigue: [], bloqueos: [] } },
    sugerencias: { propuestas: [{ id: "0", tipo: "skill", contenido: "skill", porque: "Se repitió 3 veces." }] },
  });
  const { snapshot } = await generarSnapshot({ repo: r.dir, config, llm, ahora: new Date(), fuentes: { comandos: [], prompts } });
  assert.equal(snapshot.sugerencias.length, 1);
  assert.ok(!JSON.stringify(snapshot).includes("ghp_"));
  assert.ok(llm.prompts.every((p) => !p.includes("ghp_")));
});

test("fuentes ilegibles (historial que es un directorio, transcript que es un directorio) no abortan", async () => {
  const base = mkdtempSync(join(tmpdir(), "rastro-ilegibles-"));
  const repo = "/home/x/Proyectos/App";
  const proyectos = join(base, "projects");
  mkdirSync(join(proyectos, dirDeProyecto(repo), "roto.jsonl"), { recursive: true });
  const zsh = join(base, "zsh_dir");
  mkdirSync(zsh);
  const cfg = { ...config, fuentes: { zshHistory: zsh, claudeProjects: proyectos } };
  const avisos: string[] = [];
  const fuentes = leerFuentes(cfg, repo, new Date(), avisos);
  assert.deepEqual(fuentes, { comandos: [], prompts: [] });
  assert.equal(avisos.length, 2);
  const r = crearRepo();
  escribirConfig(r.dir, config);
  r.commit("inicio");
  const { snapshot } = await generarSnapshot({ repo: r.dir, config, llm: null, ahora: new Date(), fuentes });
  assert.equal(snapshot.sugerencias.length, 0);
});
