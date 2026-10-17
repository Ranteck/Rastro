import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { leerCorrecciones } from "./cambios.ts";
import { idsDeChat } from "./chat.ts";
import { leerConfig, rutasGlobales, rutasRepo, type Config } from "./config.ts";
import { estaRegistrado, nombreDeRepo } from "./repos.ts";
import { objAbierto, str } from "./contract/validar.ts";
import { porcentajeFueraDelPlan, tareasAtrasadas } from "./detectores/desvios.ts";
import { vincularPorNombre, vinculoCorregido, type Vinculo } from "./detectores/vinculo.ts";
import { reposObservados, tareasDelRepo } from "./daily.ts";
import { agregarEvento, leerEventos } from "./eventos.ts";
import { fechaLocal, sumarDias, type Fecha } from "./fechas.ts";
import { ErrorUsuario } from "./errores.ts";
import { commitsDe, git, ramaActual, raizDelRepo, tieneCommits } from "./git.ts";
import type { Plan, Tarea } from "./contract/snapshot.ts";
import { parsearPlan, textoDias } from "./plan.ts";

export function hookCommit(repo: string, ahora: Date): string | null {
  // Un repo sin `rastro init` no se lee ni se escribe (REQ-5).
  if (!estaRegistrado(repo)) return null;
  const sha = git(repo, ["rev-parse", "HEAD"]).trim();
  const rama = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  agregarEvento(rutasRepo(repo).eventos, { tipo: "commit", sha, rama, en: ahora.toISOString() });
  return avisoDeDesvio(repo, rama, ahora);
}

/** `commits` va del más nuevo al más viejo. Los anteriores no traen su rama: se vinculan solo por mensaje, para no atribuirles la rama de HEAD. */
export function vincularCommitsDeHoy(
  commits: readonly { sha: string; asunto: string; cuerpo: string }[],
  rama: string,
  tareas: readonly Tarea[],
  correcciones: ReadonlyMap<string, string | null>,
): { vinculo: Vinculo }[] {
  return commits.map((c, i) => {
    const corregido = vinculoCorregido(correcciones, c.sha, tareas);
    if (corregido !== null) return { vinculo: corregido };
    const tarea = vincularPorNombre({ rama: i === 0 ? rama : "", asunto: c.asunto, cuerpo: c.cuerpo }, tareas);
    return { vinculo: tarea === null ? { tarea: null, tipo: "sin-tarea" } : { tarea, tipo: "nombre" } };
  });
}

/**
 * Avisos del commit recién hecho, uno por línea y sin LLM ni red (REQ-6, REQ-14):
 * toda tarea atrasada (el umbral `atrasadas` gobierna solo la alerta del snapshot) y que el día ya supera el umbral de trabajo fuera del plan.
 * Lo del día es de todos los repos observados, así que da lo mismo desde cualquiera (REQ-7); cada commit se vincula con las tareas de su repo.
 * Un repo sin registrar no tiene aviso. `rama` es la del commit recién hecho en `repo`.
 */
export function avisoDeDesvio(repo: string, rama: string, ahora: Date): string | null {
  if (nombreDeRepo(repo) === null) return null;
  const r = rutasGlobales();
  if (!existsSync(r.config) || !existsSync(r.plan)) return null;
  const config = leerConfig();
  const hoy = fechaLocal(ahora, config.zonaHoraria);
  const plan = parsearPlan(readFileSync(r.plan, "utf8"), hoy);
  if (plan === null) return null;
  const avisos: string[] = [];
  for (const t of tareasAtrasadas(plan, hoy)) avisos.push(`rastro: vas atrasado en ${t.nombre} (terminaba el ${textoDias(t.dias.slice(-1))}).`);
  const fuera = avisoFueraDelPlan(repo, rama, hoy, plan, config);
  if (fuera !== null) avisos.push(fuera);
  return avisos.length === 0 ? null : avisos.join("\n");
}

function avisoFueraDelPlan(repo: string, rama: string, hoy: Fecha, plan: Plan, config: Config): string | null {
  const nombre = nombreDeRepo(repo);
  const correcciones = leerCorrecciones();
  const vinculados = reposObservados()
    .filter((o) => tieneCommits(o.ruta))
    .flatMap((o) => {
      const deHoy = commitsDe(o.ruta, "HEAD", sumarDias(hoy, -1)).filter((c) => c.padres.length < 2 && fechaLocal(c.fecha, config.zonaHoraria) === hoy);
      const vinculos = vincularCommitsDeHoy(deHoy, o.nombre === nombre ? rama : ramaActual(o.ruta), tareasDelRepo(plan.tareas, o.nombre), correcciones);
      return deHoy.map((c, i) => ({ fecha: c.fecha, vinculo: vinculos[i]?.vinculo ?? { tarea: null, tipo: "sin-tarea" as const } }));
    })
    .sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
  const [ultimo] = vinculados;
  if (ultimo === undefined || ultimo.vinculo.tarea !== null) return null;
  const fueraDelPlanPct = porcentajeFueraDelPlan(vinculados);
  if (fueraDelPlanPct <= config.umbrales.fueraDelPlanPct) return null;
  const fuera = vinculados.filter((c) => c.vinculo.tarea === null).length;
  return `rastro: ${fuera} de ${vinculados.length} commits de hoy están fuera del plan (${fueraDelPlanPct}%).`;
}

const checkPayloadSesion = objAbierto({ session_id: str, transcript_path: str, cwd: str });

export function hookSesion(entrada: string, ahora: Date): void {
  const payload = checkPayloadSesion(JSON.parse(entrada), "SessionEnd");
  let repo: string;
  try {
    repo = raizDelRepo(payload.cwd);
  } catch (e) {
    // El plugin dispara este hook en toda sesión, también fuera de un repo y en las de `claude -p`: no hay nada que registrar ni que anotar como error.
    if (e instanceof ErrorUsuario) return;
    throw e;
  }
  // El plugin dispara este hook en cualquier repo: solo los que hicieron `rastro init` participan.
  if (!estaRegistrado(repo)) return;
  // Retomar en la terminal una sesión del chat de Rastro también termina con un SessionEnd: no es una sesión de trabajo.
  if (idsDeChat().has(payload.session_id)) return;
  // El plugin y `rastro init` pueden registrar el mismo SessionEnd: un id ya registrado no suma otro evento.
  if (leerEventos(rutasRepo(repo).eventos).eventos.some((e) => e.tipo === "sesion" && e.id === payload.session_id)) return;
  let rama: string | null;
  try {
    rama = git(repo, ["symbolic-ref", "--short", "HEAD"]).trim();
  } catch {
    rama = null; // HEAD separado: la sesión queda sin rama.
  }
  agregarEvento(rutasRepo(repo).eventos, { tipo: "sesion", id: payload.session_id, transcript: payload.transcript_path, rama, en: ahora.toISOString() });
}

function anotarError(error: unknown): void {
  const linea = `${new Date().toISOString()} ${error instanceof Error ? error.message : String(error)}\n`;
  try {
    mkdirSync(rutasGlobales().dir, { recursive: true });
    appendFileSync(rutasGlobales().errores, linea);
  } catch {
    process.stderr.write(`rastro (hook): ${linea}`); // Ni el log se pudo escribir: queda al menos en stderr.
  }
}

async function leerStdin(): Promise<string> {
  const partes: Buffer[] = [];
  for await (const parte of process.stdin) partes.push(parte as Buffer);
  return Buffer.concat(partes).toString("utf8");
}

export async function cmdHook(args: string[]): Promise<number> {
  try {
    if (args[0] === "commit") {
      const aviso = hookCommit(raizDelRepo(process.cwd()), new Date());
      if (aviso !== null) process.stderr.write(`${aviso}\n`);
    } else if (args[0] === "session-end") {
      hookSesion(await leerStdin(), new Date());
    } else {
      throw new Error(`hook desconocido: ${args[0] ?? "(ninguno)"}`);
    }
  } catch (e) {
    // Un hook nunca bloquea el commit ni la sesión (REQ-2): el error queda anotado y se sale con 0.
    anotarError(e);
  }
  return 0;
}
