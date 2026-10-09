import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { leerConfig, rutas, type Config } from "./config.ts";
import type { Conector } from "./conectores/conector.ts";
import { crearConectores } from "./conectores/crear.ts";
import { validarSnapshot, type Snapshot } from "./contract/snapshot.ts";
import { ErrorValidacion } from "./contract/validar.ts";
import { ErrorUsuario } from "./errores.ts";
import { raizDelRepo } from "./git.ts";
import { redactar } from "./redactar.ts";

/** F6/REQ-13: los secretos no salen por ningún conector; el state.json local queda como está. */
function redactarStrings(valor: unknown): unknown {
  if (typeof valor === "string") return redactar(valor);
  if (Array.isArray(valor)) return valor.map(redactarStrings);
  if (valor !== null && typeof valor === "object") return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, redactarStrings(v)]));
  return valor;
}

/** REQ-12: las sugerencias salen de la terminal de cada persona; por defecto no se comparten. */
export function paraCompartir(s: Snapshot, config: Config): Snapshot {
  const saliente = config.compartir.sugerencias ? s : { ...s, sugerencias: [] };
  return validarSnapshot(redactarStrings(saliente));
}

/** Spec "muestra el contenido": lista las líneas que van a salir, no solo cantidades. */
export function vistaPrevia(s: Snapshot, destinos: readonly string[]): string {
  const bitacora = s.bitacora.map((e) => `    ${e.hora} [${e.tarea ?? "sin tarea"}] ${e.texto}`);
  const pendientes = s.pendientes.map((p) => `    ${p.tipo}: ${p.texto}`);
  const sugerencias = s.sugerencias.map((g) => `    ${g.fuente}: ${g.patron} -> ${g.propuesta.tipo}: ${g.propuesta.contenido}`);
  return [
    `Se va a publicar en: ${destinos.join(", ")}`,
    `- Persona: ${s.persona.nombre} (${s.persona.equipo}) · repo ${s.repo.nombre}`,
    `- Plan: ${s.plan === null ? "sin plan" : `${s.plan.tareas.length} tareas`} · Resumen: ${s.resumen === null ? "no" : "sí"}`,
    `- Bitácora (${s.bitacora.length}):`,
    ...bitacora,
    `- Pendientes (${s.pendientes.length}):`,
    ...pendientes,
    `- Sugerencias (${s.sugerencias.length}):`,
    ...sugerencias,
    "",
  ].join("\n");
}

export type ResultadoConector = { conector: string; ok: boolean; detalle: string };

export async function publicar(s: Snapshot, conectores: readonly Conector[]): Promise<ResultadoConector[]> {
  const resultados: ResultadoConector[] = [];
  for (const c of conectores) {
    try {
      resultados.push({ conector: c.nombre, ok: true, detalle: await c.publicar(s) });
    } catch (e) {
      // Cada conector es independiente: la falla se informa en su resultado y se sigue con el próximo.
      resultados.push({ conector: c.nombre, ok: false, detalle: e instanceof Error ? e.message : String(e) });
    }
  }
  return resultados;
}

export async function publicarConConfirmacion(o: {
  snapshot: Snapshot;
  config: Config;
  conectores: readonly Conector[];
  yes: boolean;
  preguntar: (texto: string) => Promise<string>;
  mostrar: (texto: string) => void;
}): Promise<ResultadoConector[] | null> {
  const s = paraCompartir(o.snapshot, o.config);
  o.mostrar(vistaPrevia(s, o.conectores.map((c) => c.nombre)));
  if (!o.yes) {
    const respuesta = (await o.preguntar("¿Publicar? [s/N] ")).trim().toLowerCase();
    if (!["s", "si", "sí", "y", "yes"].includes(respuesta)) return null;
  }
  return publicar(s, o.conectores);
}

function preguntarEnTerminal(texto: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.once("close", () => resolve("")); // stdin cerrado sin respuesta cuenta como "no"
    rl.question(texto, (respuesta) => {
      resolve(respuesta);
      rl.close();
    });
  });
}

export async function cmdPublish(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { yes: { type: "boolean", default: false } } });
  const repo = raizDelRepo(process.cwd());
  const config = leerConfig(repo);
  const archivo = rutas(repo).state;
  if (!existsSync(archivo)) throw new ErrorUsuario("No hay .rastro/state.json: corré `rastro daily` primero.");
  let snapshot: Snapshot;
  try {
    snapshot = validarSnapshot(JSON.parse(readFileSync(archivo, "utf8")));
  } catch (e) {
    if (e instanceof ErrorValidacion || e instanceof SyntaxError) {
      throw new ErrorUsuario(`.rastro/state.json no cumple el contrato (${e.message}): volvé a correr \`rastro daily\`.`, { cause: e });
    }
    throw e;
  }
  const resultados = await publicarConConfirmacion({
    snapshot,
    config,
    conectores: crearConectores(config, repo),
    yes: values.yes,
    preguntar: preguntarEnTerminal,
    mostrar: (t) => process.stdout.write(t),
  });
  if (resultados === null) {
    process.stdout.write("No se publicó nada.\n");
    return 0;
  }
  for (const r of resultados) process.stdout.write(`${r.ok ? "✓" : "✗"} ${r.conector}: ${r.detalle}\n`);
  return resultados.every((r) => r.ok) ? 0 : 1;
}
