import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { leerConfig, rutas } from "./config.ts";
import { objAbierto, str } from "./contract/validar.ts";
import { calcularDesvios } from "./detectores/desvios.ts";
import { vincularPorNombre, type Vinculo } from "./detectores/vinculo.ts";
import { agregarEvento } from "./eventos.ts";
import { fechaLocal, sumarDias } from "./fechas.ts";
import { commitsDe, git, raizDelRepo } from "./git.ts";
import type { Tarea } from "./contract/snapshot.ts";
import { parsearPlan } from "./plan.ts";

export function hookCommit(repo: string, ahora: Date): string | null {
  const sha = git(repo, ["rev-parse", "HEAD"]).trim();
  const rama = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  agregarEvento(rutas(repo).eventos, { tipo: "commit", sha, rama, en: ahora.toISOString() });
  return avisoDeDesvio(repo, rama, ahora);
}

/** `commits` va del más nuevo al más viejo. Los anteriores no traen su rama: se vinculan solo por mensaje, para no atribuirles la rama de HEAD. */
export function vincularCommitsDeHoy(
  commits: readonly { asunto: string; cuerpo: string }[],
  rama: string,
  tareas: readonly Tarea[],
): { vinculo: Vinculo }[] {
  return commits.map((c, i) => {
    const tarea = vincularPorNombre({ rama: i === 0 ? rama : "", asunto: c.asunto, cuerpo: c.cuerpo }, tareas);
    return { vinculo: tarea === null ? { tarea: null, tipo: "sin-tarea" } : { tarea, tipo: "nombre" } };
  });
}

/** REQ-8: una línea de aviso si el commit recién hecho no tiene tarea y el día ya supera el umbral. */
export function avisoDeDesvio(repo: string, rama: string, ahora: Date): string | null {
  const r = rutas(repo);
  if (!existsSync(r.config) || !existsSync(r.plan)) return null;
  const config = leerConfig(repo);
  const hoy = fechaLocal(ahora, config.zonaHoraria);
  const plan = parsearPlan(readFileSync(r.plan, "utf8"), hoy);
  if (plan === null) return null;
  const deHoy = commitsDe(repo, "HEAD", sumarDias(hoy, -1)).filter(
    (c) => c.padres.length < 2 && fechaLocal(c.fecha, config.zonaHoraria) === hoy,
  );
  const ultimo = deHoy[0];
  if (ultimo === undefined) return null;
  const vinculados = vincularCommitsDeHoy(deHoy, rama, plan.tareas);
  const [vinculoUltimo] = vinculados;
  if (vinculoUltimo?.vinculo.tipo !== "sin-tarea") return null;
  const { fueraDelPlanPct } = calcularDesvios({ plan, commitsPeriodo: vinculados, commitsSemana: vinculados, umbralPct: config.umbrales.fueraDelPlanPct });
  if (fueraDelPlanPct <= config.umbrales.fueraDelPlanPct) return null;
  const fuera = vinculados.filter((c) => c.vinculo.tipo === "sin-tarea").length;
  return `rastro: ${fuera} de ${deHoy.length} commits de hoy están fuera del plan (${fueraDelPlanPct}%). Si es parte de una tarea, nombrala con [Tarea] en el mensaje.`;
}

const checkPayloadSesion = objAbierto({ session_id: str, transcript_path: str, cwd: str });

export function hookSesion(entrada: string, ahora: Date): void {
  const payload = checkPayloadSesion(JSON.parse(entrada), "SessionEnd");
  const repo = raizDelRepo(payload.cwd);
  let rama: string | null;
  try {
    rama = git(repo, ["symbolic-ref", "--short", "HEAD"]).trim();
  } catch {
    rama = null; // HEAD separado: la sesión queda sin rama.
  }
  agregarEvento(rutas(repo).eventos, { tipo: "sesion", id: payload.session_id, transcript: payload.transcript_path, rama, en: ahora.toISOString() });
}

function anotarError(error: unknown): void {
  const linea = `${new Date().toISOString()} ${error instanceof Error ? error.message : String(error)}\n`;
  try {
    appendFileSync(rutas(raizDelRepo(process.cwd())).errores, linea);
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
