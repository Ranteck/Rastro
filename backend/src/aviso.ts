import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { leerConfig, rutasGlobales } from "./config.ts";
import type { Plan, Tarea } from "./contract/snapshot.ts";
import { commitsVinculadosDeLaSemana, inferidosDeBitacora, planDelRepo, reposObservados, sesionesDeLaSemanaEnDisco, type Inferidos } from "./daily.ts";
import { tareasAtrasadas } from "./detectores/desvios.ts";
import { ErrorUsuario } from "./errores.ts";
import { ddmm, fechaLocal, indiceDiaSemana, lunesDe, lunesQueViene } from "./fechas.ts";
import { calcularFoco } from "./foco.ts";
import { ramaActual, raizDelRepo } from "./git.ts";
import { avisoDeDesvio } from "./hooks.ts";
import { parsearPlan, textoDias, textoDuracion } from "./plan.ts";
import { log } from "./log.ts";
import { estaRegistrado } from "./repos.ts";
import { cantidad } from "./texto.ts";
import { leerState } from "./state.ts";

export function textoAviso(repo: string, ahora: Date): string {
  const aviso = avisoDeDesvio(repo, ramaActual(repo), ahora);
  return aviso === null ? "" : `${aviso}\n`;
}

/** Las líneas de desvío de ahora, sin LLM ni red. Sale siempre con 0: lo llama un hook que no puede romper la sesión. */
export async function cmdAviso(_args: string[]): Promise<number> {
  try {
    const repo = raizDelRepo(process.cwd());
    // Un repo sin `rastro init` no se lee: el plugin llama a `aviso` después de cualquier commit, en cualquier repo.
    if (estaRegistrado(repo)) process.stdout.write(textoAviso(repo, new Date()));
  } catch (e) {
    // Un aviso que falla no debe frenar a quien lo llama: el motivo queda en stderr, que el hook descarta.
    process.stderr.write(`rastro aviso: ${e instanceof Error ? e.message : String(e)}\n`);
  }
  return 0;
}

const descripcion = (t: Tarea): string => {
  const partes = [t.duracion === null ? null : textoDuracion(t.duracion), t.dias.length === 0 ? null : textoDias(t.dias)].filter((p) => p !== null);
  return partes.length === 0 ? t.nombre : `${t.nombre} (${partes.join(", ")})`;
};

/** Lo que sale del último daily, si existe: los vínculos que solo infiere el LLM. Sin él, la tarea actual sale de los vínculos por nombre y corregidos. */
function delUltimoDaily(plan: Plan): Inferidos {
  if (!existsSync(rutasGlobales().state)) return new Map();
  try {
    const { bitacora } = leerState();
    return inferidosDeBitacora(bitacora, plan.tareas);
  } catch (e) {
    if (!(e instanceof ErrorUsuario)) throw e;
    // El mensaje puede citar contenido del archivo: al log no va.
    log("warn", "state_ignorado", {});
    return new Map();
  }
}

/** Calcula en fresco con el plan, git de todos los repos observados y la fecha de hoy: no depende de que `state.json` esté al día y da lo mismo desde cualquier carpeta. */
export function textoSiguiente(ahora: Date): string {
  const repos = reposObservados();
  const r = rutasGlobales();
  const config = leerConfig();
  const hoy = fechaLocal(ahora, config.zonaHoraria);
  const texto = existsSync(r.plan) ? readFileSync(r.plan, "utf8") : "";
  const plan = parsearPlan(texto, hoy);
  const queViene = parsearPlan(texto, lunesQueViene(hoy));
  const deLaQueViene = queViene === null ? "" : `${ddmm(queViene.semana)}, ${cantidad(queViene.tareas.length, "tarea", "tareas")}`;
  if (plan === null) {
    if (queViene !== null) return `No hay plan para esta semana, pero sí para la que viene (${deLaQueViene}): arranca el lunes ${ddmm(queViene.semana)}.\n`;
    // El plan puede llevarse en Notion: `siguiente` no lo lee, así que se nombra el comando que lo trae.
    const notion = config.conectores.includes("notion");
    const deNotion = notion ? " o, si lo llevás en Notion, traelo con `rastro plan sincronizar`" : "";
    return `No hay un plan vigente para esta semana. Armalo con \`rastro plan <propuesta.md>\`${deNotion}. (O decile a Claude «armá el plan»${notion ? " o «traé el plan de Notion»" : ""}.)\n`;
  }
  const inferidos = delUltimoDaily(plan);
  const desde = lunesDe(hoy);
  const zona = config.zonaHoraria;
  const commits = repos.flatMap((x) => commitsVinculadosDeLaSemana({ repo: x.ruta, nombre: x.nombre, desde, hoy, corte: ahora, zona, tareas: plan.tareas, inferidos }));
  const sesiones = repos.flatMap((x) => sesionesDeLaSemanaEnDisco({ repo: x.ruta, plan: planDelRepo(plan, x.nombre), zona, desde, hoy, corte: ahora }));
  const foco = calcularFoco(plan, commits, sesiones, hoy, zona);
  const porSlug = (slug: string | null | undefined): Tarea | undefined => plan.tareas.find((t) => t.slug === slug);
  const actual = porSlug(foco?.actual);
  const siguiente = porSlug(foco?.siguiente);
  const atrasadas = tareasAtrasadas(plan, hoy);
  const noEntran = plan.tareas.filter((t) => t.estado === "pendiente" && t.noEntra);
  const lineas = [
    `Plan de la semana del ${ddmm(plan.semana)}.`,
    `Ahora: ${actual === undefined ? "sin tarea en curso" : actual.nombre}.`,
    `Sigue: ${siguiente === undefined ? "no queda nada pendiente" : `${descripcion(siguiente)}${siguiente.repo === null ? "" : ` · ${siguiente.repo}`}`}.`,
  ];
  if (atrasadas.length > 0) lineas.push(`Atrasadas: ${atrasadas.map((t) => `${t.nombre} (terminaba el ${textoDias(t.dias.slice(-1))})`).join("; ")}.`);
  if (noEntran.length > 0) lineas.push(`No entran esta semana: ${noEntran.map(descripcion).join("; ")}.`);
  // Del viernes en adelante ya se está cerrando la semana: se avisa si la que viene tiene su plan.
  if (indiceDiaSemana(hoy) >= 4 && queViene !== null) lineas.push(`Ya está el plan de la semana que viene (${deLaQueViene}).`);
  return `${lineas.join("\n")}\n`;
}

/** `--si-registrado` es para el hook de sesión: fuera de un repo observado no escribe nada ni falla. */
export async function cmdSiguiente(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { "si-registrado": { type: "boolean", default: false } } });
  if (values["si-registrado"] && !enRepoRegistrado(process.cwd())) return 0;
  process.stdout.write(textoSiguiente(new Date()));
  return 0;
}

function enRepoRegistrado(dir: string): boolean {
  let raiz: string;
  try {
    raiz = raizDelRepo(dir);
  } catch (e) {
    if (e instanceof ErrorUsuario) return false; // Fuera de un repo git: no hay nada que mostrar.
    throw e;
  }
  // Un registro ilegible no se traga: se propaga para que lo cuente quien llama.
  return estaRegistrado(raiz);
}
