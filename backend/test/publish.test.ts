import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Almacen } from "../src/central/almacen.ts";
import { snapshotsDemo } from "../src/central/demo.ts";
import { crearCentral } from "../src/central/servidor.ts";
import { configPorDefecto } from "../src/config.ts";
import { ConectorCentral } from "../src/conectores/central.ts";
import type { Conector } from "../src/conectores/conector.ts";
import { ConectorNotionMock } from "../src/conectores/notion.ts";
import { validarSnapshot, type Snapshot } from "../src/contract/snapshot.ts";
import { paraCompartir, publicar, publicarConConfirmacion, vistaPrevia } from "../src/publish.ts";

const snapshot = (): Snapshot =>
  validarSnapshot(JSON.parse(readFileSync(new URL("../../frontend/ejemplos/persona-denis.json", import.meta.url), "utf8")));
const config = configPorDefecto({ id: "denis", nombre: "Denis", equipo: "AI Day" });

class ConectorFalso implements Conector {
  readonly nombre: string;
  readonly recibidos: Snapshot[] = [];
  readonly #falla: boolean;

  constructor(nombre: string, falla = false) {
    this.nombre = nombre;
    this.#falla = falla;
  }

  async publicar(s: Snapshot): Promise<string> {
    if (this.#falla) throw new Error("caído");
    this.recibidos.push(s);
    return "ok";
  }
}

const sinSalida = (): void => {
  // La vista previa no interesa en este test.
};

test("si la respuesta no es sí, no se envía nada", async () => {
  const c = new ConectorFalso("central");
  const r = await publicarConConfirmacion({ snapshot: snapshot(), config, conectores: [c], yes: false, preguntar: async () => "n", mostrar: sinSalida });
  assert.equal(r, null);
  assert.equal(c.recibidos.length, 0);
});

test("con --yes publica sin preguntar y la vista previa dice adónde va", async () => {
  const c = new ConectorFalso("central");
  let mostrado = "";
  await publicarConConfirmacion({
    snapshot: snapshot(),
    config,
    conectores: [c],
    yes: true,
    preguntar: async () => {
      throw new Error("no debería preguntar");
    },
    mostrar: (t) => {
      mostrado += t;
    },
  });
  assert.equal(c.recibidos.length, 1);
  assert.match(mostrado, /Se va a publicar en: central/);
});

test("las sugerencias no se comparten salvo que la config lo habilite", () => {
  const s = snapshot();
  assert.deepEqual(paraCompartir(s, config).sugerencias, []);
  assert.equal(s.sugerencias.length, 2);
  assert.equal(paraCompartir(s, { ...config, compartir: { sugerencias: true } }).sugerencias.length, 2);
});

test("un conector caído no frena a los demás y se informa", async () => {
  const bien = new ConectorFalso("central");
  const r = await publicar(snapshot(), [new ConectorFalso("notion", true), bien]);
  assert.deepEqual(r.map((x) => [x.conector, x.ok]), [["notion", false], ["central", true]]);
  assert.equal(bien.recibidos.length, 1);
});

test("el conector central publica de verdad, con los compañeros demo, y avisa si el central no responde", async (t) => {
  const servidor = crearCentral({ almacen: new Almacen(mkdtempSync(join(tmpdir(), "rastro-central-"))), estaticos: join(tmpdir(), "rastro-sin-dist") });
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => servidor.close(() => resolve())));
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  await new ConectorCentral(url).publicar(snapshot());
  for (const s of snapshotsDemo("2026-10-09", new Date("2026-10-09T21:00:00Z"))) await new ConectorCentral(url).publicar(s);
  const equipo = (await (await fetch(`${url}/api/equipo`)).json()) as { equipo: unknown[] };
  assert.equal(equipo.equipo.length, 4);
  await assert.rejects(new ConectorCentral("http://127.0.0.1:9").publicar(snapshot()), /no se pudo conectar/);
});

test("los datos demo cumplen el contrato y son tres personas distintas", () => {
  const demo = snapshotsDemo("2026-10-09", new Date("2026-10-09T21:00:00Z"));
  assert.equal(new Set(demo.map((s) => s.persona.id)).size, 3);
});

test("el conector de Notion en modo mock deja la vista previa con el formato de daily-flock", async () => {
  const archivo = join(mkdtempSync(join(tmpdir(), "rastro-notion-")), "preview.md");
  await new ConectorNotionMock(archivo).publicar(snapshot());
  const md = readFileSync(archivo, "utf8");
  assert.match(md, /^### 09\/10$/m);
  assert.match(md, /^- 17\.52hs \*\*Pendientes:\*\* Se incorporó la detección/m);
  assert.match(md, /^- 14\.35hs \*\*main:\*\* Se ajustó/m);
  assert.ok(md.indexOf("11.20hs") < md.indexOf("17.52hs"));
});

test("la vista previa lista las líneas que van a salir, no solo cantidades", () => {
  const s = snapshot();
  const texto = vistaPrevia(paraCompartir(s, config), ["central"]);
  const e = s.bitacora[0];
  const p = s.pendientes[0];
  assert.ok(e !== undefined && p !== undefined);
  assert.ok(texto.includes(e.hora) && texto.includes(e.texto));
  assert.ok(texto.includes(p.tipo) && texto.includes(p.texto));
  assert.ok(!texto.includes(s.sugerencias[0]?.patron ?? "\0"), "sugerencias no compartidas no se listan");
  const conSugerencias = vistaPrevia(paraCompartir(s, { ...config, compartir: { sugerencias: true } }), ["central"]);
  assert.ok(conSugerencias.includes(s.sugerencias[0]?.patron ?? "\0"));
});

test("un secreto en la bitácora no sale por ningún conector", async (t) => {
  const s = snapshot();
  const primera = s.bitacora[0];
  assert.ok(primera !== undefined);
  const conSecreto = validarSnapshot({ ...s, bitacora: [{ ...primera, texto: "Se exportó GITHUB_TOKEN=ghp_abc123 en el deploy." }, ...s.bitacora.slice(1)] });
  const compartido = paraCompartir(conSecreto, config);
  validarSnapshot(compartido);
  assert.ok(!JSON.stringify(compartido).includes("ghp_abc123"));
  assert.ok(JSON.stringify(conSecreto).includes("ghp_abc123"));

  const servidor = crearCentral({ almacen: new Almacen(mkdtempSync(join(tmpdir(), "rastro-central-"))), estaticos: join(tmpdir(), "rastro-sin-dist") });
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => servidor.close(() => resolve())));
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  const archivo = join(mkdtempSync(join(tmpdir(), "rastro-notion-")), "notion-preview.md");
  const r = await publicarConConfirmacion({ snapshot: conSecreto, config, conectores: [new ConectorCentral(url), new ConectorNotionMock(archivo)], yes: true, preguntar: async () => "s", mostrar: sinSalida });
  assert.ok(r !== null);
  assert.deepEqual(r.map((x) => x.ok), [true, true]);
  assert.ok(!readFileSync(archivo, "utf8").includes("ghp_abc123"));
  const recibido = await (await fetch(`${url}/api/persona/denis`)).text();
  assert.ok(!recibido.includes("ghp_abc123"));
});
