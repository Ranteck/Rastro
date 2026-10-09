import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leerEventos } from "../src/eventos.ts";
import { ddmm, fechaLocal, lunesDe } from "../src/fechas.ts";
import { avisoDeDesvio, hookSesion } from "../src/hooks.ts";
import { BIN_RASTRO, inicializar } from "../src/init.ts";
import { crearRepo, ENV_GIT } from "./helpers/repo.ts";

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
  r.commit("inicio");
  const payload = { session_id: "abc12345-x", transcript_path: "/tmp/t.jsonl", cwd: r.dir, hook_event_name: "SessionEnd", reason: "exit", campo_nuevo: 1 };
  hookSesion(JSON.stringify(payload), new Date("2026-10-09T15:00:00Z"));
  assert.deepEqual(eventosDe(r.dir), [
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
  const res = spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "fix d"], { cwd: r.dir, env: ENV_GIT, encoding: "utf8" });
  assert.equal(res.status, 0);
  assert.match(res.stderr, /4 de 5 commits de hoy están fuera del plan \(80%\)/);
});

test("los commits de otra rama no se atribuyen a la rama de HEAD", () => {
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
