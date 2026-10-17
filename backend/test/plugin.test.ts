import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, mkdirSync, mkdtempSync, symlinkSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { configPorDefecto, escribirConfig, rutasGlobales } from "../src/config.ts";
import { ddmm, fechaLocal, lunesDe } from "../src/fechas.ts";
import { leerEventos } from "../src/eventos.ts";
import { hookSesion } from "../src/hooks.ts";
import { BIN_RASTRO, inicializar } from "../src/init.ts";
import { registrar } from "../src/repos.ts";
import { crearRepo } from "./helpers/repo.ts";

const BIN = fileURLToPath(new URL("../bin/rastro.js", import.meta.url));
const PLUGIN = fileURLToPath(new URL("../../plugin/", import.meta.url));
const leer = (ruta: string): string => readFileSync(join(PLUGIN, ruta), "utf8");

test("plugin.json es JSON válido con nombre, descripción y versión", () => {
  const m = JSON.parse(leer(".claude-plugin/plugin.json")) as Record<string, unknown>;
  assert.equal(m["name"], "rastro");
  assert.equal(typeof m["description"], "string");
  assert.match(String(m["version"]), /^\d+\.\d+\.\d+$/);
});

test("hooks.json registra SessionEnd y PostToolUse con matcher Bash", () => {
  const h = JSON.parse(leer("hooks/hooks.json")) as { hooks: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]> };
  assert.match(h.hooks["SessionEnd"]?.[0]?.hooks[0]?.command ?? "", /rastro\.sh" hook session-end/);
  assert.equal(h.hooks["PostToolUse"]?.[0]?.matcher, "Bash");
  assert.match(h.hooks["PostToolUse"]?.[0]?.hooks[0]?.command ?? "", /aviso-commit\.sh/);
});

test("los comandos y la skill tienen frontmatter con description, y plan.md exige el OK explícito", () => {
  for (const ruta of ["commands/plan.md", "commands/siguiente.md", "skills/rastro/SKILL.md"]) {
    assert.match(leer(ruta), /^---\n(?:.*\n)*?description: .+\n(?:.*\n)*?---\n/, ruta);
  }
  for (const ruta of ["commands/plan.md", "skills/rastro/SKILL.md"]) {
    assert.match(leer(ruta), /solo cuando el usuario lo apruebe de forma explícita|Nunca confirmes el plan sin el OK explícito/, ruta);
  }
});

test("los scripts son ejecutables", () => {
  for (const f of readdirSync(join(PLUGIN, "scripts"))) accessSync(join(PLUGIN, "scripts", f), constants.X_OK);
});

const AVISO = 'rastro: vas atrasado en "Bitácora"\nrastro: otra línea con \\ y comillas "x".';

function entorno(): { env: NodeJS.ProcessEnv; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "rastro-plugin-"));
  const stub = join(dir, "rastro-stub");
  writeFileSync(join(dir, "aviso.txt"), `${AVISO}\n`);
  writeFileSync(stub, `#!/bin/sh\n[ "$1" = aviso ] && cat "${join(dir, "aviso.txt")}"\nexit 0\n`);
  chmodSync(stub, 0o755);
  return { dir, env: { ...process.env, RASTRO_BIN: stub } };
}

function correr(entrada: string, env: NodeJS.ProcessEnv): { status: number | null; stdout: string } {
  const r = spawnSync(join(PLUGIN, "scripts/aviso-commit.sh"), { input: entrada, encoding: "utf8", env });
  return { status: r.status, stdout: r.stdout };
}

const payload = (comando: string, cwd: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash", cwd, tool_input: { command: comando }, tool_response: { stdout: "", stderr: "" }, ...extra });

test("aviso-commit.sh devuelve el aviso como contexto adicional tras un git commit", () => {
  const { dir, env } = entorno();
  for (const comando of ["git commit -m x", `git -C ${dir} commit -m x`, "git add . && git commit -m x", "FOO=1 git -c user.name=a commit -m x", "rtk git commit -m x", "command git commit -m x", "env GIT_X=1 git commit -m x", `git -C "${dir}" commit -m x`]) {
    const r = correr(payload(comando, dir), env);
    assert.equal(r.status, 0, comando);
    assert.deepEqual(JSON.parse(r.stdout), { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: AVISO } }, comando);
  }
});

test("aviso-commit.sh sigue `git -C` a un directorio con espacios, entrecomillado o con la barra", () => {
  const { dir, env } = entorno();
  const conEspacio = join(dir, "mi dir");
  mkdirSync(conEspacio);
  for (const comando of [`git -C "${conEspacio}" commit -m x`, `git -C '${conEspacio}' commit -m x`, `git -C ${conEspacio.replace(/ /g, "\\ ")} commit -m x`, `git -C ${dir}/mi\\ dir commit -m x`]) {
    const r = correr(payload(comando, dir), env);
    assert.equal(r.status, 0, comando);
    assert.deepEqual(JSON.parse(r.stdout), { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: AVISO } }, comando);
  }
});

test("aviso-commit.sh no imprime nada si no fue un git commit", () => {
  const { dir, env } = entorno();
  for (const comando of ["ls", "git commit-tree abc", "git commit-graph write", "rtk git status", 'echo "git commit"', "git status", "git log --grep commit"]) {
    assert.deepEqual(correr(payload(comando, dir), env), { status: 0, stdout: "" }, comando);
  }
});

test("aviso-commit.sh no repite el aviso que el hook de git ya imprimió en la salida del commit", () => {
  const { dir, env } = entorno();
  const yaAvisado = payload("git commit -m x", dir, { tool_response: { stdout: "[main abc] x", stderr: AVISO } });
  assert.deepEqual(correr(yaAvisado, env), { status: 0, stdout: "" });
});

test("aviso-commit.sh sale con 0 y sin salida ante un stdin inválido o un RASTRO_BIN inexistente", () => {
  const { dir, env } = entorno();
  assert.deepEqual(correr("no es json", env), { status: 0, stdout: "" });
  assert.deepEqual(correr("", env), { status: 0, stdout: "" });
  assert.deepEqual(correr(payload("git commit -m x", dir), { ...env, RASTRO_BIN: join(dir, "no-existe") }), { status: 0, stdout: "" });
});

test("registrar dos veces la misma sesión deja un solo evento", () => {
  const r = crearRepo();
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  r.commit("inicio");
  const entrada = JSON.stringify({ session_id: "s-1", transcript_path: "/tmp/t.jsonl", cwd: r.dir });
  hookSesion(entrada, new Date("2026-10-09T15:00:00Z"));
  hookSesion(entrada, new Date("2026-10-09T15:00:01Z"));
  hookSesion(JSON.stringify({ session_id: "s-2", transcript_path: "/tmp/t2.jsonl", cwd: r.dir }), new Date("2026-10-09T15:00:02Z"));
  const ids = leerEventos(join(r.dir, ".rastro", "events.jsonl")).eventos.flatMap((e) => (e.tipo === "sesion" ? [e.id] : []));
  assert.deepEqual(ids, ["s-1", "s-2"]);
});

test("rastro.sh sin CLI avisa por stderr y sale con 127; los hooks siguen en silencio y con 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "rastro-sin-cli-"));
  // Sin RASTRO_BIN, sin rastro en el PATH y con la raíz del plugin apuntando a un lugar sin backend/.
  const bin = join(dir, "bin");
  mkdirSync(bin);
  for (const [nombre, destino] of [["node", process.execPath], ["sh", "/bin/sh"], ["cat", "/bin/cat"], ["dirname", "/usr/bin/dirname"]] as const) symlinkSync(destino, join(bin, nombre));
  const env = { PATH: bin, CLAUDE_PLUGIN_ROOT: dir };
  const directo = spawnSync(join(PLUGIN, "scripts/rastro.sh"), ["aviso"], { encoding: "utf8", env });
  assert.equal(directo.status, 127);
  assert.match(directo.stderr, /no encuentro la CLI/);
  assert.deepEqual(correr(payload("git commit -m x", dir), env), { status: 0, stdout: "" });
  const hooks = JSON.parse(leer("hooks/hooks.json")) as { hooks: { SessionEnd: { hooks: { command: string }[] }[] } };
  const comando = (hooks.hooks.SessionEnd[0]?.hooks[0]?.command ?? "").replaceAll("${CLAUDE_PLUGIN_ROOT}", PLUGIN.replace(/\/$/, ""));
  const sesionEnd = spawnSync("/bin/sh", ["-c", comando], { input: "{}", encoding: "utf8", env: { ...env, CLAUDE_PLUGIN_ROOT: dir } });
  assert.deepEqual({ status: sesionEnd.status, stdout: sesionEnd.stdout, stderr: sesionEnd.stderr }, { status: 0, stdout: "", stderr: "" });
});

test("los comandos y la skill llaman a la CLI por scripts/rastro.sh del plugin, nunca por rastro pelado", () => {
  for (const ruta of ["commands/plan.md", "commands/siguiente.md", "skills/rastro/SKILL.md"]) {
    const t = leer(ruta);
    assert.doesNotMatch(t, /`rastro (plan|siguiente|aviso)/, ruta);
    assert.match(t, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/rastro\.sh/, ruta);
  }
});

test("allowed-tools preaprueba lo mínimo: plan cambiar en /rastro:plan, y siguiente y aviso en /rastro:siguiente", () => {
  const permisos = (ruta: string): string[] => (/^allowed-tools: (.+)$/m.exec(leer(ruta))?.[1] ?? "").split(", ");
  const raiz = "Bash(${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh";
  assert.deepEqual(permisos("commands/plan.md"), [`${raiz} plan cambiar *)`]);
  assert.deepEqual(permisos("commands/siguiente.md"), [`${raiz} siguiente)`, `${raiz} aviso)`]);
});

test("/rastro:init tiene description y preaprueba solo sus comandos", () => {
  const t = leer("commands/init.md");
  assert.match(t, /^---\n(?:.*\n)*?description: .+\n(?:.*\n)*?---\n/);
  const raiz = "Bash(${CLAUDE_PLUGIN_ROOT}/scripts/";
  assert.deepEqual((/^allowed-tools: (.+)$/m.exec(t)?.[1] ?? "").split(", "), [
    "Bash(command -v rastro)", "Bash(cd *)", "Bash(npm install)", "Bash(npm link)", "Bash(npm run build)",
    `${raiz}raiz-rastro.sh)`, `${raiz}dashboard-al-dia.sh)`, `${raiz}rastro.sh init)`, `${raiz}rastro.sh siguiente --si-registrado)`, `${raiz}rastro.sh cron)`, `${raiz}rastro.sh cron instalar)`, `${raiz}rastro.sh cron instalar --hora *)`, `${raiz}rastro.sh plan --desde-proyecto)`,
  ]);
});

test("/rastro:init no confirma el plan: sin --confirmar ni cron quitar, y el cierre dice que el plan no cambió", () => {
  const t = leer("commands/init.md");
  const permisos = /^allowed-tools: (.+)$/m.exec(t)?.[1] ?? "";
  assert.doesNotMatch(permisos, /--confirmar|quitar/);
  assert.match(t, /si ya está, no lo toques/);
  assert.match(t, /Tu plan todavía no cambió/);
  assert.match(t, /plan --desde-proyecto --confirmar/);
  assert.match(t, /se corre siempre/);
  assert.match(t, /\.git\/info\/exclude/);
});

test("la skill rastro trae los disparadores de sincronizar, repo y plan del proyecto, y confirma con --desde-proyecto --confirmar", () => {
  const skill = leer("skills/rastro/SKILL.md");
  const descripcion = /^description: (.+)$/m.exec(skill)?.[1] ?? "";
  for (const disparador of ["sincronizá el plan", "traé el plan de Notion", "sugerime el plan de este proyecto", "este repo es de X"]) assert.ok(descripcion.includes(disparador), disparador);
  assert.match(skill, /plan sincronizar/);
  assert.match(skill, /plan cambiar repo/);
  assert.match(skill, /plan --desde-proyecto` \(vista previa\)/);
  assert.match(skill, /plan --desde-proyecto --confirmar/);
});

test("la skill rastro trae los disparadores de la semana que viene, cada uno con su comando y la confirmación de siempre", () => {
  const skill = leer("skills/rastro/SKILL.md");
  const descripcion = /^description: (.+)$/m.exec(skill)?.[1] ?? "";
  for (const disparador of ["planeá la semana que viene", "andá armando el plan del lunes", "traé el plan de la semana que viene"]) assert.ok(descripcion.includes(disparador), disparador);
  assert.match(skill, /plan <propuesta\.md> --semana-que-viene/);
  assert.match(skill, /plan --desde-proyecto --semana-que-viene/);
  assert.match(skill, /plan --confirmar --semana-que-viene` solo con el OK explícito del usuario/);
  assert.match(skill, /plan cambiar <tipo> <tarea> <valor> --propuesta --semana-que-viene/);
  // Los comandos con --semana-que-viene no se preaprueban: piden permiso como el resto de plan.
  assert.doesNotMatch(/^allowed-tools: (.+)$/m.exec(skill)?.[1] ?? "", /semana-que-viene/);
});

test("las versiones de backend, frontend, plugin y skill van alineadas", () => {
  const version = (ruta: string): unknown => (JSON.parse(readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), "utf8")) as { version: unknown }).version;
  const deSkill = /^version: (.+)$/m.exec(leer("skills/rastro/SKILL.md"))?.[1];
  const versiones = [version("../package.json"), version("../../frontend/package.json"), version("../../plugin/.claude-plugin/plugin.json"), deSkill];
  assert.equal(new Set(versiones).size, 1, versiones.join(", "));
});

test("/rastro:init no vuelve a preguntar: la invocación es el OK y los ajustes van como argumento", () => {
  const t = leer("commands/init.md");
  assert.match(t, /es su OK/);
  assert.match(t, /\$ARGUMENTS/);
  assert.doesNotMatch(t, /¿Lo hago\?/);
  assert.match(t, /command -v rastro/);
  assert.match(t, /npm install && npm link/);
  assert.match(t, /rastro\.sh" init/);
  assert.match(t, /cron instalar/);
  assert.match(t, /18:30/);
  assert.match(t, /npm run build/);
  assert.match(t, /sin volver a preguntar/);
  assert.match(t, /`rastro start`/);
  assert.doesNotMatch(t, /serve --repo/);
});

const CONTEXTO = "Ahora: Bitácora.\nSigue: Central (1d, jue).\nUna línea con \\ y comillas \"x\".";

function entornoContexto(): { env: NodeJS.ProcessEnv; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "rastro-contexto-"));
  const stub = join(dir, "rastro-stub");
  writeFileSync(join(dir, "siguiente.txt"), `${CONTEXTO}\n`);
  writeFileSync(stub, `#!/bin/sh\n[ "$1" = siguiente ] && cat "${join(dir, "siguiente.txt")}"\nexit 0\n`);
  chmodSync(stub, 0o755);
  return { dir, env: { ...process.env, RASTRO_BIN: stub } };
}

const correrContexto = (entrada: string, env: NodeJS.ProcessEnv): { status: number | null; stdout: string } => {
  const r = spawnSync(join(PLUGIN, "scripts/contexto-sesion.sh"), { input: entrada, encoding: "utf8", env });
  return { status: r.status, stdout: r.stdout };
};

const sesion = (cwd: string): string => JSON.stringify({ hook_event_name: "SessionStart", source: "startup", cwd });

test("hooks.json registra SessionStart con contexto-sesion.sh", () => {
  const h = JSON.parse(leer("hooks/hooks.json")) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
  assert.match(h.hooks["SessionStart"]?.[0]?.hooks[0]?.command ?? "", /contexto-sesion\.sh/);
});

test("contexto-sesion.sh da el plan en un repo registrado y nada en uno sin registrar, con la CLI real y sin LLM", () => {
  const registrado = crearRepo();
  const sinRegistrar = crearRepo();
  const home = mkdtempSync(join(tmpdir(), "rastro-home-"));
  process.env["RASTRO_HOME"] = home;
  escribirConfig(configPorDefecto({ id: "t", nombre: "T", equipo: "QA" }));
  registrar(registrado.dir);
  writeFileSync(rutasGlobales().plan, `## Plan semana ${ddmm(lunesDe(fechaLocal(new Date(), configPorDefecto({ id: "t", nombre: "T", equipo: "QA" }).zonaHoraria)))}\n- **Entregable del viernes:** Demo.\n- [ ] **Bitácora:** Registrar. · 2d · lun–mar\n`);
  // El script llama a rastro.sh: RASTRO_BIN lo apunta al build de los tests en vez de al `rastro` instalado.
  const bin = join(home, "rastro-test");
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`);
  chmodSync(bin, 0o755);
  const env = { ...process.env, RASTRO_BIN: bin, RASTRO_HOME: home, GIT_CONFIG_GLOBAL: "/dev/null" };

  const conPlan = correrContexto(sesion(registrado.dir), env);
  assert.equal(conPlan.status, 0);
  const salida = JSON.parse(conPlan.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  assert.equal(salida.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(salida.hookSpecificOutput.additionalContext, /^Plan de Rastro para esta semana:\nPlan de la semana del \d\d\/\d\d\./);
  assert.deepEqual(correrContexto(sesion(sinRegistrar.dir), env), { status: 0, stdout: "" });
});

test("contexto-sesion.sh sale con 0 y sin salida ante un stdin inválido o la CLI ausente", () => {
  const { dir, env } = entornoContexto();
  assert.deepEqual(correrContexto("no es json", env), { status: 0, stdout: "" });
  assert.deepEqual(correrContexto("", env), { status: 0, stdout: "" });
  assert.deepEqual(correrContexto(sesion(dir), { ...env, RASTRO_BIN: join(dir, "no-existe") }), { status: 0, stdout: "" });
});

test("la skill rastro trae los disparadores de cerrar el día y preaprueba solo siguiente, aviso, daily --para-pegar y start", () => {
  const skill = leer("skills/rastro/SKILL.md");
  const descripcion = /^description: (.+)$/m.exec(skill)?.[1] ?? "";
  for (const disparador of ["terminé X", "cerrá el día", "el update de hoy", "qué hice hoy", "armá la daily"]) assert.ok(descripcion.includes(disparador), disparador);
  const raiz = "Bash(${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh";
  assert.deepEqual((/^allowed-tools: (.+)$/m.exec(skill)?.[1] ?? "").split(", "), [`${raiz} siguiente)`, `${raiz} aviso)`, `${raiz} daily --para-pegar)`, `${raiz} start)`]);
  assert.match(skill, /nunca con `--yes`/);
});

test("/rastro:dashboard tiene description, preaprueba solo rastro.sh start y pide segundo plano", () => {
  const t = leer("commands/dashboard.md");
  assert.match(t, /^---\n(?:.*\n)*?description: .+\n(?:.*\n)*?---\n/);
  assert.deepEqual((/^allowed-tools: (.+)$/m.exec(t)?.[1] ?? "").split(", "), ["Bash(${CLAUDE_PLUGIN_ROOT}/scripts/rastro.sh start)"]);
  assert.match(t, /rastro\.sh" start` \*\*en segundo plano\*\*/);
  assert.match(t, /\/rastro:init/);
});

test("la skill rastro trae los disparadores del dashboard, pide segundo plano y cierra el día ofreciéndolo", () => {
  const skill = leer("skills/rastro/SKILL.md");
  const descripcion = /^description: (.+)$/m.exec(skill)?.[1] ?? "";
  for (const disparador of ["mostrame el dashboard", "abrí el dashboard", "quiero ver el Gantt", "cómo vengo esta semana, en el dashboard", "mostrame el tablero"]) assert.ok(descripcion.includes(disparador), disparador);
  assert.match(skill, /rastro\.sh" start` \*\*en segundo plano\*\*/);
  assert.match(skill, /alcanza con la respuesta en el chat/);
  assert.match(skill, /¿te abro el dashboard\?/);
});

function marketplaceFalso(dirNombre = "rastro", nombre = "rastro"): { config: string; raiz: string } {
  const config = mkdtempSync(join(tmpdir(), "rastro-config-"));
  const raiz = join(config, "plugins", "marketplaces", dirNombre);
  mkdirSync(join(raiz, ".claude-plugin"), { recursive: true });
  mkdirSync(join(raiz, "backend", "bin"), { recursive: true });
  writeFileSync(join(raiz, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: nombre, plugins: [{ name: "rastro", source: "./plugin" }] }));
  return { config, raiz };
}

function entornoLimpio(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base = { ...process.env };
  delete base["RASTRO_BIN"];
  return { ...base, ...extra };
}

test("raiz-rastro.sh encuentra CLAUDE_PLUGIN_ROOT/..", () => {
  const repo = mkdtempSync(join(tmpdir(), "rastro-repo-"));
  mkdirSync(join(repo, "plugin"));
  mkdirSync(join(repo, "backend", "bin"), { recursive: true });
  writeFileSync(join(repo, "backend", "bin", "rastro.js"), "");
  const config = mkdtempSync(join(tmpdir(), "rastro-config-"));
  const r = spawnSync(join(PLUGIN, "scripts/raiz-rastro.sh"), { encoding: "utf8", env: entornoLimpio({ CLAUDE_PLUGIN_ROOT: join(repo, "plugin"), CLAUDE_CONFIG_DIR: config }) });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), repo);
});

test("raiz-rastro.sh encuentra el marketplace clonado cuando el plugin está en la caché", () => {
  const { config, raiz } = marketplaceFalso();
  writeFileSync(join(raiz, "backend", "bin", "rastro.js"), "");
  const cache = join(config, "plugins", "cache", "rastro", "rastro", "0.1.1");
  mkdirSync(cache, { recursive: true });
  const r = spawnSync(join(PLUGIN, "scripts/raiz-rastro.sh"), { encoding: "utf8", env: entornoLimpio({ CLAUDE_PLUGIN_ROOT: cache, CLAUDE_CONFIG_DIR: config }) });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), raiz);
});

test("raiz-rastro.sh sin repo sale con código distinto de cero y sin salida", () => {
  const config = mkdtempSync(join(tmpdir(), "rastro-config-"));
  const cache = join(config, "plugins", "cache", "rastro", "rastro", "0.1.1");
  mkdirSync(cache, { recursive: true });
  const r = spawnSync(join(PLUGIN, "scripts/raiz-rastro.sh"), { encoding: "utf8", env: entornoLimpio({ CLAUDE_PLUGIN_ROOT: cache, CLAUDE_CONFIG_DIR: config }) });
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, "");
});

function dashboardAlDia(dist: { version?: string } | null): { status: number | null; stdout: string } {
  const repo = mkdtempSync(join(tmpdir(), "rastro-repo-"));
  mkdirSync(join(repo, "plugin"));
  mkdirSync(join(repo, "backend", "bin"), { recursive: true });
  writeFileSync(join(repo, "backend", "bin", "rastro.js"), "");
  mkdirSync(join(repo, "frontend"));
  writeFileSync(join(repo, "frontend", "package.json"), JSON.stringify({ name: "x", version: "1.2.3" }));
  if (dist !== null) {
    mkdirSync(join(repo, "frontend", "dist"));
    if (dist.version !== undefined) writeFileSync(join(repo, "frontend", "dist", "version.txt"), `${dist.version}\n`);
  }
  const config = mkdtempSync(join(tmpdir(), "rastro-config-"));
  const r = spawnSync(join(PLUGIN, "scripts/dashboard-al-dia.sh"), { encoding: "utf8", env: entornoLimpio({ CLAUDE_PLUGIN_ROOT: join(repo, "plugin"), CLAUDE_CONFIG_DIR: config }) });
  return { status: r.status, stdout: r.stdout.trim() };
}

test("dashboard-al-dia.sh distingue un dist al día, uno de otra versión, uno de 0.1.x sin version.txt y la falta de dist", () => {
  assert.deepEqual(dashboardAlDia({ version: "1.2.3" }), { status: 0, stdout: "al-dia" });
  assert.deepEqual(dashboardAlDia({ version: "1.2.2" }), { status: 1, stdout: "desactualizado" });
  assert.deepEqual(dashboardAlDia({}), { status: 1, stdout: "desactualizado" });
  assert.deepEqual(dashboardAlDia(null), { status: 1, stdout: "falta" });
});

test("dashboard-al-dia.sh sin raíz de Rastro dice sin-raiz", () => {
  const config = mkdtempSync(join(tmpdir(), "rastro-config-"));
  const cache = join(config, "plugins", "cache", "rastro", "rastro", "0.2.0");
  mkdirSync(cache, { recursive: true });
  const r = spawnSync(join(PLUGIN, "scripts/dashboard-al-dia.sh"), { encoding: "utf8", env: entornoLimpio({ CLAUDE_PLUGIN_ROOT: cache, CLAUDE_CONFIG_DIR: config }) });
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim(), "sin-raiz");
});

test("/rastro:init reconstruye el dashboard cuando falta o está desactualizado, no solo cuando falta", () => {
  const t = leer("commands/init.md");
  assert.match(t, /dashboard-al-dia\.sh/);
  assert.match(t, /`falta` o `desactualizado`/);
  assert.doesNotMatch(t, /test -d/);
});

function raizDesdeCache(config: string): { status: number | null; stdout: string } {
  const cache = join(config, "plugins", "cache", "rastro", "rastro", "0.1.1");
  mkdirSync(cache, { recursive: true });
  return spawnSync(join(PLUGIN, "scripts/raiz-rastro.sh"), { encoding: "utf8", env: entornoLimpio({ CLAUDE_PLUGIN_ROOT: cache, CLAUDE_CONFIG_DIR: config }) });
}

test("raiz-rastro.sh no elige otro marketplace que declare un plugin rastro", () => {
  const { config, raiz } = marketplaceFalso("otro", "otro");
  writeFileSync(join(raiz, "backend", "bin", "rastro.js"), "");
  const r = raizDesdeCache(config);
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, "");
});

test("raiz-rastro.sh no elige marketplaces/rastro si su marketplace.json tiene otro name", () => {
  const { config, raiz } = marketplaceFalso("rastro", "otro");
  writeFileSync(join(raiz, "backend", "bin", "rastro.js"), "");
  const r = raizDesdeCache(config);
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, "");
});

test("rastro.sh sin PATH ni RASTRO_BIN ejecuta el backend/bin/rastro.js del marketplace", () => {
  const { config, raiz } = marketplaceFalso();
  writeFileSync(join(raiz, "backend", "bin", "rastro.js"), 'console.log("stub-marketplace " + process.argv.slice(2).join(" "));\n');
  const cache = join(config, "plugins", "cache", "rastro", "rastro", "0.1.1");
  mkdirSync(cache, { recursive: true });
  const nodeDir = join(config, "bin-node");
  mkdirSync(nodeDir);
  symlinkSync(process.execPath, join(nodeDir, "node"));
  const r = spawnSync(join(PLUGIN, "scripts/rastro.sh"), ["siguiente"], { encoding: "utf8", env: entornoLimpio({ CLAUDE_PLUGIN_ROOT: cache, CLAUDE_CONFIG_DIR: config, PATH: `${nodeDir}:/usr/bin:/bin` }) });
  assert.equal(r.stdout.trim(), "stub-marketplace siguiente");
});

test("/rastro:init con sin cron igual informa las líneas viejas por repo, sin quitarlas", () => {
  const t = leer("commands/init.md");
  assert.match(t, /Con `sin cron` no lo instales, pero corré igual/);
  assert.match(t, /líneas viejas por repo/);
  assert.match(t, /reinstalalo con la misma hora que informó/);
  assert.doesNotMatch(/^allowed-tools: (.+)$/m.exec(t)?.[1] ?? "", /quitar/);
});
