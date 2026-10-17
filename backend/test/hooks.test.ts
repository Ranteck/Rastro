import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { leerEventos } from "../src/eventos.ts";
import { ddmm, fechaLocal, lunesDe } from "../src/fechas.ts";
import { avisoDeDesvio, hookSesion, vincularCommitsDeHoy } from "../src/hooks.ts";
import { BIN_RASTRO, inicializar } from "../src/init.ts";
import { crearRepo } from "./helpers/repo.ts";

const eventosDe = (dir: string) => leerEventos(join(dir, ".rastro", "events.jsonl")).eventos;

test("init encadena un post-commit existente y el commit registra el evento", () => {
  const r = crearRepo();
  r.escribir(".git/hooks/post-commit", "#!/bin/sh\necho original > .git/original.txt\nexit 0\n");
  chmodSync(join(r.dir, ".git/hooks/post-commit"), 0o755);
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  const sha = r.commit("primero");
  assert.ok(existsSync(join(r.dir, ".git/original.txt")));
  assert.deepEqual(eventosDe(r.dir).map((e) => (e.tipo === "commit" ? e.sha : null)), [sha]);
  assert.match(readFileSync(join(r.dir, ".git/info/exclude"), "utf8"), /^\.rastro\/$/m);
});

test("init dos veces no duplica y respeta los settings existentes", () => {
  const r = crearRepo();
  r.escribir(".claude/settings.local.json", JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }));
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  const ajustes = JSON.parse(readFileSync(join(r.dir, ".claude/settings.local.json"), "utf8")) as {
    permissions: unknown;
    hooks: { SessionEnd: unknown[] };
  };
  assert.deepEqual(ajustes.permissions, { allow: ["Bash(ls)"] });
  assert.equal(ajustes.hooks.SessionEnd.length, 1);
  assert.equal(readFileSync(join(r.dir, ".git/hooks/post-commit"), "utf8").split("# rastro").length - 1, 1);
});

test("init no toca un post-commit que no es de shell y lo avisa", () => {
  const r = crearRepo();
  const python = "#!/usr/bin/env python3\nprint('hola')\n";
  r.escribir(".git/hooks/post-commit", python);
  const hechos = inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  assert.equal(readFileSync(join(r.dir, ".git/hooks/post-commit"), "utf8"), python);
  assert.ok(hechos.some((h) => h.includes("agregá a mano")));
});

test("el commit se crea aunque events.jsonl no se pueda escribir", (t) => {
  if (process.getuid?.() === 0) {
    t.skip("como root los permisos de archivo no aplican");
    return;
  }
  const r = crearRepo();
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  writeFileSync(join(r.dir, ".rastro/events.jsonl"), "");
  chmodSync(join(r.dir, ".rastro/events.jsonl"), 0o000);
  assert.match(r.commit("igual se crea"), /^[0-9a-f]{40}$/);
  assert.match(readFileSync(join(r.dir, ".rastro/errors.log"), "utf8"), /EACCES/);
});

test("session-end registra la sesión e ignora campos nuevos del payload", () => {
  const r = crearRepo();
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  r.commit("inicio");
  const payload = { session_id: "abc12345-x", transcript_path: "/tmp/t.jsonl", cwd: r.dir, hook_event_name: "SessionEnd", reason: "exit", campo_nuevo: 1 };
  hookSesion(JSON.stringify(payload), new Date("2026-10-09T15:00:00Z"));
  assert.deepEqual(eventosDe(r.dir).filter((e) => e.tipo === "sesion"), [
    { tipo: "sesion", id: "abc12345-x", transcript: "/tmp/t.jsonl", rama: "main", en: "2026-10-09T15:00:00.000Z" },
  ]);
});

test("el post-commit avisa cuando el día ya se fue del plan", () => {
  const r = crearRepo();
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  const hoy = fechaLocal(new Date(), "America/Argentina/Buenos_Aires");
  r.escribir(".rastro/plan.md", `## Plan semana ${ddmm(lunesDe(hoy))}\n- **Entregable del viernes:** Demo.\n- [ ] **Pendientes:** Detectar.\n`);
  r.commit("[Pendientes] uno");
  r.commit("fix a");
  r.commit("fix b");
  r.commit("fix c");
  const res = spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "fix d"], { cwd: r.dir, env: r.env, encoding: "utf8" });
  assert.equal(res.status, 0);
  assert.match(res.stderr, /4 de 5 commits de hoy están fuera del plan \(80%\)\./);
  assert.doesNotMatch(res.stderr, /nombrala/);
});

test("el aviso depende de la rama del último commit, no de los anteriores", () => {
  const r = crearRepo();
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  const hoy = fechaLocal(new Date(), "America/Argentina/Buenos_Aires");
  r.escribir(".rastro/plan.md", `## Plan semana ${ddmm(lunesDe(hoy))}\n- **Entregable del viernes:** Demo.\n- [ ] **Pendientes:** Detectar.\n`);
  r.commit("fix a");
  r.commit("fix b");
  r.git("checkout", "-q", "-b", "feat/pendientes");
  r.commit("fix c");
  const ahora = new Date();
  // Con la rama de la tarea, el último commit está en el plan: no hay aviso aunque los anteriores no lo estén.
  assert.equal(avisoDeDesvio(r.dir, "feat/pendientes", ahora), null);
  // Con otra rama, el último queda fuera y los dos de main siguen contando como fuera del plan.
  assert.match(avisoDeDesvio(r.dir, "feat/otra", ahora) ?? "", /3 de 3 commits de hoy están fuera del plan \(100%\)/);
});

test("solo el commit más nuevo se vincula por la rama de HEAD", () => {
  const tareas = [{ slug: "pendientes", nombre: "Pendientes", objetivo: "Detectar", estado: "pendiente" as const, duracion: null, dias: [], noEntra: false, repo: null }];
  const nuevoYViejo = [
    { sha: "a".repeat(40), asunto: "fix nuevo", cuerpo: "" },
    { sha: "b".repeat(40), asunto: "fix viejo, hecho en otra rama", cuerpo: "" },
  ];
  const vinculos = vincularCommitsDeHoy(nuevoYViejo, "feat/pendientes", tareas, new Map()).map((c) => c.vinculo);
  assert.deepEqual(vinculos, [{ tarea: "pendientes", tipo: "nombre" }, { tarea: null, tipo: "sin-tarea" }]);
});

function repoConAtraso(): ReturnType<typeof crearRepo> {
  const r = crearRepo();
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  r.escribir(".rastro/plan.md", "## Plan semana 05/10\n- **Entregable del viernes:** Demo.\n- [ ] **Bitácora:** Registrar. · 2d · lun–mar\n- [ ] **Central:** Recibir. · 1d · jue\n");
  r.commit("[Central] inicio", "2026-10-05T15:00:00Z");
  return r;
}

test("el aviso de commit suma el atraso, una línea por tarea, sin invocar al LLM", (t) => {
  const r = repoConAtraso();
  // Un "claude" en el PATH que deja una marca si alguien lo ejecuta.
  const bin = join(r.dir, "bin");
  r.escribir("bin/claude", `#!/bin/sh\ntouch "${join(r.dir, "llm-invocado")}"\n`);
  chmodSync(join(bin, "claude"), 0o755);
  const pathOriginal = process.env.PATH;
  process.env.PATH = `${bin}:${pathOriginal ?? ""}`;
  t.after(() => {
    process.env.PATH = pathOriginal;
  });
  assert.equal(avisoDeDesvio(r.dir, "main", new Date("2026-10-07T15:00:00Z")), "rastro: vas atrasado en Bitácora (terminaba el mar).");
  assert.equal(existsSync(join(r.dir, "llm-invocado")), false);
});

test("el martes la tarea todavía no está atrasada y no hay aviso", () => {
  assert.equal(avisoDeDesvio(repoConAtraso().dir, "main", new Date("2026-10-06T15:00:00Z")), null);
});

test("avisa de toda tarea atrasada aunque no llegue a umbrales.atrasadas: el umbral es solo de la alerta", () => {
  const r = repoConAtraso();
  const config = JSON.parse(readFileSync(join(r.dir, ".rastro/config.json"), "utf8")) as { umbrales: Record<string, number> };
  config.umbrales["atrasadas"] = 2;
  writeFileSync(join(r.dir, ".rastro/config.json"), JSON.stringify(config));
  assert.equal(avisoDeDesvio(r.dir, "main", new Date("2026-10-07T15:00:00Z")), "rastro: vas atrasado en Bitácora (terminaba el mar).");
});

test("el día se cuenta en la zona de la config: a las 23:30 del martes en Buenos Aires todavía no hay atraso", () => {
  assert.equal(avisoDeDesvio(repoConAtraso().dir, "main", new Date("2026-10-07T02:30:00Z")), null);
  assert.match(avisoDeDesvio(repoConAtraso().dir, "main", new Date("2026-10-08T02:30:00Z")) ?? "", /atrasado en Bitácora/);
});

test("un commit corregido a sin tarea cuenta como fuera del plan en el aviso", () => {
  const r = repoConAtraso();
  const sha = r.commit("[Central] avance", "2026-10-07T15:00:00Z");
  const ahora = new Date("2026-10-07T16:00:00Z");
  assert.doesNotMatch(avisoDeDesvio(r.dir, "main", ahora) ?? "", /fuera del plan/);
  r.escribir(".rastro/correcciones.json", JSON.stringify({ [sha]: null }));
  assert.match(avisoDeDesvio(r.dir, "main", ahora) ?? "", /1 de 1 commits de hoy están fuera del plan/);
});

test("session-end en un repo sin rastro init no crea .rastro/", () => {
  const r = crearRepo();
  r.commit("inicio");
  hookSesion(JSON.stringify({ session_id: "s-1", transcript_path: "/tmp/t.jsonl", cwd: r.dir }), new Date("2026-10-09T15:00:00Z"));
  assert.equal(existsSync(join(r.dir, ".rastro")), false);
});

test("session-end con un cwd fuera de un repo git vuelve sin crear ~/.rastro/ ni anotar un error", () => {
  const casa = join(mkdtempSync(join(tmpdir(), "rastro-casa-")), "rastro-inexistente");
  const fuera = mkdtempSync(join(tmpdir(), "rastro-fuera-"));
  const payload = JSON.stringify({ session_id: "s-1", transcript_path: "/tmp/t.jsonl", cwd: fuera });
  const corrida = spawnSync(process.execPath, [BIN_RASTRO, "hook", "session-end"], { input: payload, encoding: "utf8", env: { ...process.env, RASTRO_HOME: casa } });
  assert.equal(corrida.status, 0, corrida.stderr);
  assert.equal(corrida.stderr, "");
  assert.equal(existsSync(casa), false);
});

test("un events.jsonl con la misma sesión dos veces se lee como una", () => {
  const r = crearRepo();
  const linea = (id: string) => JSON.stringify({ tipo: "sesion", id, transcript: "/tmp/t.jsonl", rama: "main", en: "2026-10-09T15:00:00.000Z" });
  r.escribir(".rastro/events.jsonl", `${linea("s-1")}\n${linea("s-1")}\n${linea("s-2")}\n`);
  assert.deepEqual(eventosDe(r.dir).map((e) => (e.tipo === "sesion" ? e.id : null)), ["s-1", "s-2"]);
});

test("dos hooks session-end a la vez con el mismo id dejan una sola sesión para el daily", async () => {
  const r = crearRepo();
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  r.commit("inicio");
  const entrada = JSON.stringify({ session_id: "s-paralela", transcript_path: "/tmp/t.jsonl", cwd: r.dir });
  const lanzar = () =>
    new Promise<number | null>((resolver) => {
      const p = spawn(process.execPath, [BIN_RASTRO, "hook", "session-end"], { cwd: r.dir, stdio: ["pipe", "ignore", "ignore"] });
      p.on("close", resolver);
      p.stdin.end(entrada);
    });
  assert.deepEqual(await Promise.all([lanzar(), lanzar()]), [0, 0]);
  assert.deepEqual(eventosDe(r.dir).filter((e) => e.tipo === "sesion").map((e) => (e.tipo === "sesion" ? e.id : null)), ["s-paralela"]);
});

test("REQ-14: el post-commit real avisa el atraso sin invocar al LLM y en menos de 1 s", () => {
  const hoy = fechaLocal(new Date(), "America/Argentina/Buenos_Aires");
  const r = crearRepo();
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  r.escribir(".rastro/plan.md", `## Plan semana ${ddmm(lunesDe(hoy))}\n- **Entregable del viernes:** Demo.\n- [ ] **Bitácora:** Registrar. · 1d · lun\n`);
  r.commit("[Bitácora] inicio");
  const marca = join(r.dir, "llm-invocado");
  r.escribir("bin/claude", `#!/bin/sh\ntouch "${marca}"\n`);
  chmodSync(join(r.dir, "bin/claude"), 0o755);
  const env = { ...r.env, PATH: `${join(r.dir, "bin")}:${process.env.PATH ?? ""}` };
  const t0 = performance.now();
  const res = spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "otro"], { cwd: r.dir, env, encoding: "utf8" });
  const ms = performance.now() - t0;
  assert.equal(res.status, 0);
  // El hook usa el reloj real y el lunes ningún día del plan ya pasó: ese día no hay atraso que avisar, pero lo demás se verifica igual.
  if (hoy !== lunesDe(hoy)) assert.match(res.stderr, /rastro: vas atrasado en Bitácora \(terminaba el lun\)\./);
  assert.equal(existsSync(marca), false);
  assert.ok(ms < 1000, `el commit con hook tardó ${Math.round(ms)} ms`);
});
