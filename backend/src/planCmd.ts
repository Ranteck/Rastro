import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { leerConfig, rutas, type Config } from "./config.ts";
import { vincularPorNombre } from "./detectores/vinculo.ts";
import { ErrorUsuario } from "./errores.ts";
import { fechaLocal, lunesDe, sumarDias, type Fecha } from "./fechas.ts";
import { raizDelRepo, recolectarGit } from "./git.ts";
import { crearLlm } from "./llm/crear.ts";
import { ErrorLlm, type Llm, type PedidoLlm } from "./llm/llm.ts";
import { pedidoPlan, pedidoSugerirPlan } from "./llm/usos.ts";
import { parsearPlan, renderizarPlan, type TareaARenderizar } from "./plan.ts";
import { slugDe } from "./texto.ts";

async function conLlm<T>(llm: Llm, pedido: PedidoLlm<T>, que: string): Promise<T> {
  try {
    return await llm.completar(pedido);
  } catch (e) {
    if (e instanceof ErrorLlm) throw new ErrorUsuario(`No se pudo ${que}: el LLM no está disponible (${e.message}).`, { cause: e });
    throw e;
  }
}

/** Descarta nombres sin letras y slugs repetidos; el saneado del texto lo hace renderizarPlan. */
function tareasValidas(tareas: readonly { nombre: string; objetivo: string }[]): TareaARenderizar[] {
  const vistos = new Set<string>();
  const res: TareaARenderizar[] = [];
  for (const t of tareas) {
    const slug = slugDe(t.nombre);
    if (slug === "" || vistos.has(slug)) continue;
    vistos.add(slug);
    res.push({ nombre: t.nombre, objetivo: t.objetivo.trim() });
  }
  return res;
}

export async function armarPlan(o: { repo: string; llm: Llm; propuesta: string; hoy: Fecha }): Promise<{ archivo: string; sugerido: boolean; tareas: number }> {
  const r = rutas(o.repo);
  const semana = lunesDe(o.hoy);
  const res = await conLlm(o.llm, pedidoPlan(o.propuesta, semana), "armar el plan");
  const tareas = tareasValidas(res.tareas);
  if (tareas.length === 0) throw new ErrorUsuario("El LLM no devolvió tareas válidas: probá de nuevo o armá el plan a mano.");
  const sugerido = existsSync(r.plan);
  const archivo = sugerido ? r.planSugerido : r.plan;
  mkdirSync(r.dir, { recursive: true });
  writeFileSync(archivo, renderizarPlan(semana, res.entregable, tareas));
  return { archivo, sugerido, tareas: tareas.length };
}

export async function sugerirTareas(o: { repo: string; config: Config; llm: Llm; ahora: Date }): Promise<{ archivo: string; nuevas: number }> {
  const r = rutas(o.repo);
  const hoy = fechaLocal(o.ahora, o.config.zonaHoraria);
  const plan = existsSync(r.plan) ? parsearPlan(readFileSync(r.plan, "utf8"), hoy) : null;
  if (plan === null) throw new ErrorUsuario("No hay plan para esta semana: armalo primero con `rastro plan <propuesta.md>`.");
  const fuera = recolectarGit(o.repo, sumarDias(plan.semana, -1))
    .commits.filter((c) => c.padres.length < 2 && vincularPorNombre(c, plan.tareas) === null)
    .map((c) => c.asunto);
  if (fuera.length === 0) return { archivo: r.planSugerido, nuevas: 0 };
  const res = await conLlm(
    o.llm,
    pedidoSugerirPlan({ plan: plan.tareas.map((t) => ({ nombre: t.nombre, objetivo: t.objetivo })), trabajoFueraDelPlan: fuera.slice(0, 50) }),
    "sugerir tareas",
  );
  const existentes = new Set(plan.tareas.map((t) => t.slug));
  const nuevas = tareasValidas(res.tareas).filter((t) => !existentes.has(slugDe(t.nombre)));
  writeFileSync(r.planSugerido, renderizarPlan(plan.semana, plan.entregable, [...plan.tareas, ...nuevas]));
  return { archivo: r.planSugerido, nuevas: nuevas.length };
}

export async function cmdPlan(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { sugerir: { type: "boolean", default: false } } });
  const repo = raizDelRepo(process.cwd());
  const config = leerConfig(repo);
  const llm = crearLlm(config);
  if (llm === null) throw new ErrorUsuario("El plan necesita un LLM: configurá llm.proveedor en .rastro/config.json.");
  if (values.sugerir) {
    const r = await sugerirTareas({ repo, config, llm, ahora: new Date() });
    process.stdout.write(
      r.nuevas === 0 ? "No hay tareas nuevas para sugerir.\n" : `Se sugirieron ${r.nuevas} tareas en ${r.archivo}. Pasá a plan.md las que quieras.\n`,
    );
    return 0;
  }
  const propuesta = positionals[0];
  if (propuesta === undefined) throw new ErrorUsuario("Uso: rastro plan <propuesta.md> | rastro plan --sugerir");
  if (!existsSync(propuesta)) throw new ErrorUsuario(`No existe ${propuesta}.`);
  const r = await armarPlan({ repo, llm, propuesta: readFileSync(propuesta, "utf8"), hoy: fechaLocal(new Date(), config.zonaHoraria) });
  process.stdout.write(
    r.sugerido ? `Ya había un plan y no lo toqué: la propuesta quedó en ${r.archivo}.\n` : `Plan con ${r.tareas} tareas en ${r.archivo}.\n`,
  );
  return 0;
}
