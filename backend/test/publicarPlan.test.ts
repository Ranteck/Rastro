import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { configPorDefecto, escribirConfig } from "../src/config.ts";
import { registrar } from "../src/repos.ts";
import { cmdPublish } from "../src/publish.ts";
import { crearRepo } from "./helpers/repo.ts";

const config = { ...configPorDefecto({ id: "denis", nombre: "Denis", equipo: "AI Day" }), conectores: ["notion" as const] };
const ejemplo = readFileSync(new URL("../../frontend/ejemplos/persona-denis.json", import.meta.url), "utf8");

function publicarEn(dir: string): Promise<number> {
  const original = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.chdir(dir);
  return cmdPublish(["--yes"]).finally(() => {
    process.stdout.write = original;
  });
}

test("el plan va a la vista previa de Notion solo cuando cambió desde la última publicación", async () => {
  const r = crearRepo();
  escribirConfig(config);
  registrar(r.dir);
  r.escribir(".rastro/state.json", ejemplo);
  const preview = join(r.dir, ".rastro/notion-preview.md");

  assert.equal(await publicarEn(r.dir), 0);
  assert.match(readFileSync(preview, "utf8"), /^## Plan semana \d{2}\/\d{2}$/m);

  rmSync(preview);
  await publicarEn(r.dir);
  assert.doesNotMatch(readFileSync(preview, "utf8"), /## Plan semana/);

  const cambiado = JSON.parse(ejemplo) as { plan: { entregable: string } };
  cambiado.plan.entregable = "Otro entregable.";
  r.escribir(".rastro/state.json", JSON.stringify(cambiado));
  await publicarEn(r.dir);
  assert.match(readFileSync(preview, "utf8"), /Otro entregable\./);
  assert.ok(existsSync(join(r.dir, ".rastro/publicado.json")));
});

function salidaDePublicar(dir: string): Promise<string> {
  const original = process.stdout.write;
  const trozos: string[] = [];
  process.stdout.write = ((t: string) => (trozos.push(t), true)) as typeof process.stdout.write;
  process.chdir(dir);
  return cmdPublish(["--yes"]).then(() => trozos.join("")).finally(() => {
    process.stdout.write = original;
  });
}

test("la vista previa lista las líneas del plan que van a salir", async () => {
  const r = crearRepo();
  escribirConfig(config);
  registrar(r.dir);
  r.escribir(".rastro/state.json", ejemplo);
  const salida = await salidaDePublicar(r.dir);
  assert.match(salida, /^ {4}## Plan semana \d{2}\/\d{2}$/m);
  assert.match(salida, /^ {4}- \[[ x]\] /m);
});

test("lo publicado en otro modo no cuenta: el plan vuelve a salir aunque no haya cambiado", async () => {
  const r = crearRepo();
  escribirConfig(config);
  registrar(r.dir);
  r.escribir(".rastro/state.json", ejemplo);
  const preview = join(r.dir, ".rastro/notion-preview.md");
  await publicarEn(r.dir);
  const huella = (JSON.parse(readFileSync(join(r.dir, ".rastro/publicado.json"), "utf8")) as { planHuella: string }).planHuella;
  r.escribir(".rastro/publicado.json", JSON.stringify({ planHuella: huella, modo: "claude" }));
  rmSync(preview);
  await publicarEn(r.dir);
  assert.match(readFileSync(preview, "utf8"), /^## Plan semana/m);
});

test("un segundo publish sin cambios conserva el plan en la vista previa de Notion y publicar el plan actualiza la base", async () => {
  const r = crearRepo();
  escribirConfig(config);
  registrar(r.dir);
  r.escribir(".rastro/state.json", ejemplo);
  const preview = join(r.dir, ".rastro/notion-preview.md");
  const base = join(r.dir, ".rastro/notion-base.md");

  await publicarEn(r.dir);
  const plan = /^## Plan semana[\s\S]*$/m.exec(readFileSync(preview, "utf8"))?.[0];
  assert.ok(plan !== undefined);
  assert.equal(readFileSync(base, "utf8"), plan);

  await publicarEn(r.dir);
  assert.equal(/^## Plan semana[\s\S]*$/m.exec(readFileSync(preview, "utf8"))?.[0], plan);
});
