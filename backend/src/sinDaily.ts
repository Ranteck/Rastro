import { existsSync, readFileSync } from "node:fs";
import { rutasGlobales, type Config } from "./config.ts";
import { validarSnapshot, type Snapshot } from "./contract/snapshot.ts";
import { lunesQueViene, type Fecha } from "./fechas.ts";
import { log } from "./log.ts";
import { parsearPlan } from "./plan.ts";
import { redactarSnapshot } from "./publish.ts";
import { nombresRegistrados } from "./repos.ts";

/**
 * Lo que se puede mostrar antes del primer `rastro daily`: el plan de plan.md y nada más, sin git ni LLM.
 * Es un snapshot válido y vacío para que las vistas no necesiten otro tipo de dato; la marca "sin daily" viaja aparte.
 */
export function snapshotSinDaily(o: { config: Config; hoy: Fecha; ahora: Date }): Snapshot {
  const archivo = rutasGlobales().plan;
  const plan = existsSync(archivo) ? parsearPlan(readFileSync(archivo, "utf8"), o.hoy) : null;
  return redactarSnapshot(validarSnapshot({
    schemaVersion: 3,
    generadoEn: o.ahora.toISOString(),
    persona: o.config.persona,
    repo: { nombre: nombresRegistrados().join(", ") },
    periodo: { desde: o.hoy, hasta: o.hoy },
    plan,
    bitacora: [],
    pendientes: [],
    desvios: { fueraDelPlanPct: 0, alerta: false, tareasSinActividad: [], tareasAtrasadas: [] },
    resumen: null,
    sugerencias: [],
    foco: null,
    ofrecimientos: [],
    gantt: { mock: false, barras: [] },
    costo: { llamadas: 0, usd: 0, tokens: 0 },
  }));
}

/**
 * Si esta semana no tiene plan y la que viene sí, qué semana y cuántas tareas: el dashboard lo dice en vez de ofrecer armar un plan.
 * Solo cuentas: el texto de las tareas no sale de ~/.rastro/ por este camino.
 */
export function planQueViene(hoy: Fecha): { semana: Fecha; tareas: number } | null {
  const archivo = rutasGlobales().plan;
  const plan = existsSync(archivo) ? parsearPlan(readFileSync(archivo, "utf8"), lunesQueViene(hoy)) : null;
  return plan === null ? null : { semana: plan.semana, tareas: plan.tareas.length };
}

/** La hora del daily automático es solo una pista: si no se puede leer, el dashboard y `rastro start` siguen sin ella. */
export async function horaOpcional(leer: () => Promise<string | null>): Promise<string | null> {
  try {
    return await leer();
  } catch (e) {
    log("warn", "hora_daily_ilegible", { tipo: e instanceof Error ? e.name : "desconocido" });
    return null;
  }
}
