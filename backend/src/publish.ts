import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { leerConfig, rutasGlobales, type Config } from "./config.ts";
import type { Conector, OpcionesPublicacion } from "./conectores/conector.ts";
import { reposObservados } from "./daily.ts";
import { crearConectores } from "./conectores/crear.ts";
import { bloquePlan } from "./conectores/notion.ts";
import { validarSnapshot, type Snapshot } from "./contract/snapshot.ts";
import { guardarPublicado, huellaDelPlan, leerPublicado, yaPublicado } from "./publicado.ts";
import { redactar } from "./redactar.ts";
import { guardarBaseNotion } from "./sincroNotion.ts";
import { leerState } from "./state.ts";

/** F6/REQ-13: los secretos no salen por ningún conector; el state.json local queda como está. */
function redactarStrings(valor: unknown): unknown {
  if (typeof valor === "string") return redactar(valor);
  if (Array.isArray(valor)) return valor.map(redactarStrings);
  if (valor !== null && typeof valor === "object") return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, redactarStrings(v)]));
  return valor;
}

/** REQ-12: las sugerencias salen de la terminal de cada persona; por defecto no se comparten. */
export function paraCompartir(s: Snapshot, config: Config): Snapshot {
  return redactarSnapshot(config.compartir.sugerencias ? s : { ...s, sugerencias: [] });
}

/** Lo que sale de la máquina, también hacia el navegador del modo personal, pasa por acá. */
export function redactarSnapshot(s: Snapshot): Snapshot {
  return validarSnapshot(redactarStrings(s));
}

/** Spec "muestra el contenido": lista las líneas que van a salir, no solo cantidades. */
export function vistaPrevia(s: Snapshot, destinos: readonly string[], conPlan = false): string {
  const bloque = conPlan ? bloquePlan(s).split("\n").filter((l) => l.trim() !== "").map((l) => `    ${l}`) : [];
  const bitacora = s.bitacora.map((e) => `    ${e.hora} [${e.tarea ?? "sin tarea"}] ${e.texto}`);
  const resumen = s.resumen === null ? [] : [...s.resumen.hice, ...s.resumen.avance, ...s.resumen.sigue, ...s.resumen.bloqueos].map((l) => `    ${l}`);
  const pendientes = s.pendientes.map((p) => `    ${p.tipo}: ${p.texto}`);
  const sugerencias = s.sugerencias.map((g) => `    ${g.fuente}: ${g.patron} -> ${g.propuesta.tipo}: ${g.propuesta.contenido}`);
  return [
    `Se va a publicar en: ${destinos.join(", ")}`,
    `- Persona: ${s.persona.nombre} (${s.persona.equipo}) · repo ${s.repo.nombre}`,
    `- Plan: ${s.plan === null ? "sin plan" : `${s.plan.tareas.length} tareas${conPlan ? " (cambió: se publica con duraciones y días)" : ""}`} · Resumen: ${s.resumen === null ? "no" : "sí"}`,
    ...bloque,
    `- Bitácora (${s.bitacora.length}):`,
    ...bitacora,
    ...(resumen.length === 0 ? [] : ["- Resumen (hice, avance, sigue, bloqueos):", ...resumen]),
    `- Pendientes (${s.pendientes.length}):`,
    ...pendientes,
    `- Sugerencias (${s.sugerencias.length}):`,
    ...sugerencias,
    "",
  ].join("\n");
}

export type ResultadoConector = { conector: string; ok: boolean; detalle: string };

export async function publicar(s: Snapshot, conectores: readonly Conector[], opciones: OpcionesPublicacion = {}): Promise<ResultadoConector[]> {
  const resultados: ResultadoConector[] = [];
  for (const c of conectores) {
    try {
      resultados.push({ conector: c.nombre, ok: true, detalle: await c.publicar(s, opciones) });
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
  conPlan?: boolean;
  preguntar: (texto: string) => Promise<string>;
  mostrar: (texto: string) => void;
}): Promise<ResultadoConector[] | null> {
  const s = paraCompartir(o.snapshot, o.config);
  const conPlan = o.conPlan === true;
  o.mostrar(vistaPrevia(s, o.conectores.map((c) => c.nombre), conPlan));
  if (!o.yes) {
    const respuesta = (await o.preguntar("¿Publicar? [s/N] ")).trim().toLowerCase();
    if (!["s", "si", "sí", "y", "yes"].includes(respuesta)) return null;
  }
  return publicar(s, o.conectores, { conPlan });
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
  reposObservados();
  const config = leerConfig();
  const snapshot = leerState();
  const huella = huellaDelPlan(snapshot.plan);
  const publicado = leerPublicado();
  const conPlan = huella !== null && config.conectores.includes("notion") && !(snapshot.plan !== null && yaPublicado(snapshot.plan, huella, config.notion.modo, publicado));
  const resultados = await publicarConConfirmacion({
    snapshot,
    config,
    conectores: crearConectores(config),
    yes: values.yes,
    conPlan,
    preguntar: preguntarEnTerminal,
    mostrar: (t) => process.stdout.write(t),
  });
  if (resultados === null) {
    process.stdout.write("No se publicó nada.\n");
    return 0;
  }
  if (conPlan && snapshot.plan !== null && resultados.some((r) => r.conector === "notion" && r.ok)) {
    guardarPublicado(huella, config.notion.modo);
    // Igual que `plan sincronizar`: la base es lo último que Notion y Rastro compartieron, para no confundir un cambio solo local con uno de los dos lados.
    guardarBaseNotion(snapshot.plan);
  }
  for (const r of resultados) process.stdout.write(`${r.ok ? "✓" : "✗"} ${r.conector}: ${r.detalle}\n`);
  return resultados.every((r) => r.ok) ? 0 : 1;
}
