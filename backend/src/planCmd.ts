import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { exigirRegistrado } from "./repos.ts";
import { parseArgs } from "node:util";
import { cambioDeArgumentos, fijadosDeLaSemana, fijarDias, guardarBase, guardarOfrecimientos, leerBase, leerOfrecimientos, validarCambios } from "./cambios.ts";
import type { Cambio } from "./contract/cambios.ts";
import { leerConfig, rutasGlobales, type Config } from "./config.ts";
import { aplicarYRecalcular, recalcularSiHayDaily, reposObservados, tareasDelRepo } from "./daily.ts";
import { vincularPorNombre } from "./detectores/vinculo.ts";
import { ErrorUsuario } from "./errores.ts";
import type { Tarea } from "./contract/snapshot.ts";
import { ddmm, desdeDdmm, fechaLocal, lunesDe, lunesQueViene, sumarDias, type Fecha } from "./fechas.ts";
import { raizDelRepo, recolectarGit } from "./git.ts";
import { crearLlm } from "./llm/crear.ts";
import { ErrorLlm, type Llm, type PedidoLlm } from "./llm/llm.ts";
import { log } from "./log.ts";
import { pedidoPlan, pedidoSugerirPlan } from "./llm/usos.ts";
import { fusionarSeccion, parsearPlan, renderizarPlan, textoDias, textoDuracion, type TareaARenderizar } from "./plan.ts";
import { conReparto, conservarEmpezadas } from "./reparto.ts";
import { crearNotionPlan, sincronizarPlan, type NotionPlan } from "./sincroNotion.ts";
import { slugDe } from "./texto.ts";

export async function conLlm<T>(llm: Llm, pedido: PedidoLlm<T>, que: string): Promise<T> {
  try {
    return await llm.completar(pedido);
  } catch (e) {
    if (e instanceof ErrorLlm) throw new ErrorUsuario(`No se pudo ${que}: el LLM no está disponible (${e.message}).`, { cause: e });
    throw e;
  }
}

type TareaNueva = { nombre: string; objetivo: string; duracion: Tarea["duracion"] };

/** Descarta nombres sin letras y slugs repetidos; el saneado del texto lo hace renderizarPlan. */
export function tareasValidas<T extends TareaNueva>(tareas: readonly T[]): T[] {
  const vistos = new Set<string>();
  const res: T[] = [];
  for (const t of tareas) {
    const slug = slugDe(t.nombre);
    if (slug === "" || vistos.has(slug)) continue;
    vistos.add(slug);
    res.push({ ...t, objetivo: t.objetivo.trim() });
  }
  return res;
}

export function tabla(tareas: readonly TareaARenderizar[]): string {
  const ancho = Math.max(...tareas.map((t) => t.nombre.length));
  return tareas
    .map((t) => {
      const duracion = t.duracion === null || t.duracion === undefined ? "sin duración" : textoDuracion(t.duracion);
      const dias = t.noEntra === true ? "no entra" : t.dias === undefined || t.dias.length === 0 ? "-" : textoDias(t.dias);
      return `  ${t.nombre.padEnd(ancho)}  ${duracion.padEnd(12)}  ${dias}`;
    })
    .join("\n");
}

/**
 * La propuesta es de todos los repos: armarla en uno solo reemplaza las tareas de ese repo y conserva, con su estado y sus días,
 * las que la propuesta de la misma semana ya tenía de otros repos (o de ninguno), salvo las que la nueva vuelve a nombrar.
 */
export function conservarDeOtrosRepos(semana: Fecha, repo: string, slugsNuevos: ReadonlySet<string>): { tareas: TareaARenderizar[]; fijadas: Map<string, readonly Fecha[]> } {
  const r = rutasGlobales();
  const previa = existsSync(r.planSugerido) ? parsearPlan(readFileSync(r.planSugerido, "utf8"), semana) : null;
  const conservadas = (previa?.tareas ?? []).filter((t) => t.repo !== repo && !slugsNuevos.has(t.slug));
  return {
    tareas: conservadas.map((t) => ({ nombre: t.nombre, objetivo: t.objetivo, duracion: t.duracion, estado: t.estado, dias: t.dias, noEntra: t.noEntra, repo: t.repo })),
    fijadas: new Map(conservadas.filter((t) => t.estado === "pendiente" && t.dias.length > 0).map((t) => [t.slug, t.dias] as const)),
  };
}

export type PropuestaDescartada = { semana: Fecha; tareas: string[] };

/**
 * La propuesta es un solo archivo y no se fusiona entre semanas: armar la de `semana` descarta la pendiente de otra.
 * Devuelve cuál era y qué traía, para decirlo; null si no había o era de la misma semana (esa se conserva por repo).
 */
export function propuestaDeOtraSemana(semana: Fecha): PropuestaDescartada | null {
  const r = rutasGlobales();
  if (!existsSync(r.planSugerido)) return null;
  const texto = readFileSync(r.planSugerido, "utf8");
  const encabezado = /^## Plan semana (\d{2}\/\d{2})\s*$/m.exec(texto)?.[1];
  if (encabezado === undefined) return null;
  const previa = desdeDdmm(encabezado, semana);
  if (previa === semana) return null;
  try {
    return { semana: previa, tareas: parsearPlan(texto, previa)?.tareas.map((t) => t.nombre) ?? [] };
  } catch (e) {
    // Una propuesta ilegible igual se descarta: se nombra la semana, sin la lista de tareas.
    if (!(e instanceof ErrorUsuario)) throw e;
    return { semana: previa, tareas: [] };
  }
}

/** Lo que se le dice a quien armó una propuesta que descartó la pendiente de otra semana. */
export function textoDeDescartada(d: PropuestaDescartada): string {
  const tareas = d.tareas.length === 0 ? "" : ` y sus tareas: ${d.tareas.join(", ")}`;
  return `Se descartó la propuesta sin confirmar de la semana del ${ddmm(d.semana)}${tareas}; si la querías, armala de nuevo.\n`;
}

/** `nombre` es el nombre corto del repo donde corre: las tareas nacen vinculadas a él, como las de `--desde-proyecto`. */
export async function armarPlan(o: { nombre: string; config: Config; llm: Llm; propuesta: string; hoy: Fecha }): Promise<{ archivo: string; tareas: TareaARenderizar[]; reemplazo: boolean; conservadas: string[]; descartada?: PropuestaDescartada }> {
  const r = rutasGlobales();
  const semana = lunesDe(o.hoy);
  const res = await conLlm(o.llm, pedidoPlan(o.propuesta, semana), "armar el plan");
  const nuevas = tareasValidas(res.tareas).map((t) => ({ ...t, repo: o.nombre }));
  if (nuevas.length === 0) throw new ErrorUsuario("El LLM no devolvió tareas válidas: probá de nuevo o armá el plan a mano.");
  const otras = conservarDeOtrosRepos(semana, o.nombre, new Set(nuevas.map((t) => slugDe(t.nombre))));
  const descartada = propuestaDeOtraSemana(semana);
  const tareas = conReparto({ desde: semana, semana, config: o.config, tareas: [...otras.tareas, ...nuevas], fijadas: otras.fijadas });
  mkdirSync(r.dir, { recursive: true });
  const reemplazo = existsSync(r.planSugerido);
  const md = renderizarPlan(semana, res.entregable, tareas);
  writeFileSync(r.planSugerido, md);
  // La base sale de releer lo escrito, para que sus slugs sean los mismos que va a ver --confirmar.
  guardarBase(semana, parsearPlan(md, semana)?.tareas ?? []);
  return { archivo: r.planSugerido, tareas, reemplazo, conservadas: otras.tareas.map((t) => t.nombre), ...(descartada === null ? {} : { descartada }) };
}

/** Guarda lo que el LLM sugiere como ofrecimientos: el plan solo cambia cuando se aceptan con `plan cambiar ofrecimiento`. */
export async function sugerirTareas(o: { repo: string; nombre: string; config: Config; llm: Llm; ahora: Date }): Promise<{ archivo: string; nuevas: number }> {
  const r = rutasGlobales();
  const hoy = fechaLocal(o.ahora, o.config.zonaHoraria);
  const plan = existsSync(r.plan) ? parsearPlan(readFileSync(r.plan, "utf8"), hoy) : null;
  if (plan === null) throw new ErrorUsuario("No hay plan para esta semana: armalo primero con `rastro plan <propuesta.md>`.");
  const fuera = recolectarGit(o.repo, sumarDias(plan.semana, -1))
    .commits.filter((c) => c.padres.length < 2 && vincularPorNombre(c, tareasDelRepo(plan.tareas, o.nombre)) === null)
    .map((c) => c.asunto);
  if (fuera.length === 0) return { archivo: r.ofrecimientos, nuevas: 0 };
  const res = await conLlm(
    o.llm,
    pedidoSugerirPlan({ plan: plan.tareas.map((t) => ({ nombre: t.nombre, objetivo: t.objetivo })), trabajoFueraDelPlan: fuera.slice(0, 50) }),
    "sugerir tareas",
  );
  const guardados = leerOfrecimientos();
  // Los descartados cuentan: un ofrecimiento descartado no vuelve a proponerse con el mismo slug.
  const conocidos = new Set([...plan.tareas.map((t) => t.slug), ...guardados.map((g) => g.id)]);
  const nuevos = tareasValidas(res.tareas)
    .filter((t) => !conocidos.has(slugDe(t.nombre)))
    .map((t) => ({ id: slugDe(t.nombre), nombre: t.nombre, objetivo: t.objetivo, duracion: t.duracion, porque: t.porque.trim(), estado: "pendiente" as const, repo: o.nombre }));
  if (nuevos.length > 0) guardarOfrecimientos([...guardados, ...nuevos]);
  return { archivo: r.ofrecimientos, nuevas: nuevos.length };
}

const mismaDuracion = (a: Tarea["duracion"], b: Tarea["duracion"]): boolean => (a === null || b === null ? a === b : a.valor === b.valor && a.unidad === b.unidad);
const mismosDias = (a: readonly Fecha[], b: readonly Fecha[]): boolean => a.length === b.length && a.every((d, i) => d === b[i]);

/**
 * Vuelve vigente la propuesta y repite el reparto de lo que no está fijado, sin asignar días que ya pasaron.
 * Una tarea queda fijada con los días de la propuesta solo si se cambiaron a mano respecto del reparto con que se generó
 * (~/.rastro/plan.base.json); si no hay base, valen los días escritos. Cualquier otra tarea se reparte con su duración actual.
 * También quedan fijos los días de ~/.rastro/fijados.json.
 * El plan es de todos los repos: solo se reemplazan las tareas vigentes de los repos que la propuesta trae (cada tarea lleva el suyo),
 * sea cual sea la carpeta donde se confirma. Las de otros repos y las sin repo siguen con su estado y sus días, salvo que la propuesta
 * traiga una con el mismo nombre. Lo que se quita de los repos de la propuesta se informa.
 */
export function confirmarPlan(o: { config: Config; hoy: Fecha; deLaQueViene?: boolean }): { archivo: string; semana: Fecha; tareas: TareaARenderizar[]; quitadas: string[]; aviso?: string } {
  const r = rutasGlobales();
  const marca = o.deLaQueViene === true ? " --semana-que-viene" : "";
  if (!existsSync(r.planSugerido)) throw new ErrorUsuario(`No hay una propuesta para confirmar: armala con \`rastro plan <propuesta.md>${marca}\`.`);
  const texto = readFileSync(r.planSugerido, "utf8");
  const propuesta = parsearPlan(texto, o.hoy);
  if (propuesta === null) {
    // La propuesta es una sola: si es la de la otra semana, se dice cómo confirmarla en vez de pedir que se arme de nuevo.
    const deLaQueViene = o.deLaQueViene !== true && parsearPlan(texto, lunesQueViene(o.hoy)) !== null;
    throw new ErrorUsuario(
      deLaQueViene
        ? "La propuesta es del plan de la semana que viene: confirmala con `rastro plan --confirmar --semana-que-viene`."
        : `La propuesta no es del plan de ${o.deLaQueViene === true ? "la semana que viene" : "esta semana"}: armala de nuevo con \`rastro plan <propuesta.md>${marca}\`.`,
    );
  }
  const desde = o.hoy > propuesta.semana ? o.hoy : propuesta.semana;
  const leida = leerBase();
  const base = leida !== null && leida.semana === propuesta.semana ? leida : null;
  const aMano = new Map<string, readonly Fecha[]>(
    propuesta.tareas
      .filter((t) => {
        // Días que ya pasaron son del reparto anterior, no una decisión: se repiten.
        if (t.estado !== "pendiente" || t.dias.length === 0 || !t.dias.every((d) => d >= desde)) return false;
        if (base === null) return true;
        const original = base.tareas[t.slug];
        return original !== undefined && !mismosDias(original.dias, t.dias);
      })
      .map((t) => [t.slug, t.dias]),
  );
  const fijadosAntes = fijadosDeLaSemana(propuesta.semana);
  const fijadas = new Map<string, readonly Fecha[]>([...aMano, ...fijadosAntes]);
  // Una pendiente que ya empezó no se mueve (así sigue atrasada), salvo que se haya cambiado su duración respecto de la base.
  const reestimadas = new Set(
    propuesta.tareas.filter((t) => base !== null && base.tareas[t.slug] !== undefined && !mismaDuracion(base.tareas[t.slug]?.duracion ?? null, t.duracion)).map((t) => t.slug),
  );
  // Solo se conserva lo que ya corría en el plan vigente con esos mismos días: una propuesta armada el lunes y confirmada el miércoles se reparte desde hoy y no nace con tareas atrasadas.
  const vigente = existsSync(r.plan) ? parsearPlan(readFileSync(r.plan, "utf8"), o.hoy) : null;
  const yaVigentes = propuesta.tareas.filter((t) => {
    const enVigente = vigente?.tareas.find((v) => v.slug === t.slug);
    return enVigente !== undefined && mismosDias(enVigente.dias, t.dias);
  });
  const conservadas = conservarEmpezadas({ tareas: yaVigentes, desde, fijadas, reestimadas });
  const enPropuesta = new Set(propuesta.tareas.map((t) => t.slug));
  const deVigente = (vigente?.tareas ?? []).filter((t) => !enPropuesta.has(t.slug));
  const reposDeLaPropuesta = new Set(propuesta.tareas.flatMap((t) => (t.repo === null ? [] : [t.repo])));
  const delRepoDeLaPropuesta = (t: { repo: string | null }): boolean => t.repo !== null && reposDeLaPropuesta.has(t.repo);
  const ajenas = deVigente.filter((t) => !delRepoDeLaPropuesta(t));
  const quitadas = deVigente.filter(delRepoDeLaPropuesta).map((t) => t.nombre);
  // Las ajenas no se mueven: sus días valen como fijos y consumen primero su horario.
  const fijasConAjenas = new Map(conservadas.fijadas);
  for (const t of ajenas) if (t.estado === "pendiente" && t.dias.length > 0) fijasConAjenas.set(t.slug, t.dias);
  const tareas = conReparto({ desde, semana: propuesta.semana, config: o.config, tareas: [...ajenas, ...propuesta.tareas], fijadas: fijasConAjenas, inicios: conservadas.inicios });
  for (const t of tareas) {
    if (t.estado === "pendiente" && (t.duracion === null || t.duracion === undefined)) log("warn", "tarea_sin_duracion", { tarea: slugDe(t.nombre) });
  }
  const seccion = renderizarPlan(propuesta.semana, propuesta.entregable, tareas);
  writeFileSync(r.plan, fusionarSeccion(existsSync(r.plan) ? readFileSync(r.plan, "utf8") : "", o.hoy, seccion));
  // Lo corregido a mano queda fijado también después: un cambio posterior del plan no lo mueve.
  fijarDias(propuesta.semana, new Map([...aMano].filter(([slug]) => !fijadosAntes.has(slug))));
  rmSync(r.planSugerido);
  rmSync(r.planBase, { force: true });
  // El resumen del daily es de esta semana: un plan para la que viene no lo cambia.
  const aviso = o.deLaQueViene === true ? undefined : recalcularSiHayDaily(o);
  const semana = propuesta.semana;
  return aviso === undefined ? { archivo: r.plan, semana, tareas, quitadas } : { archivo: r.plan, semana, tareas, quitadas, aviso };
}

/** Lo que `plan --confirmar` imprime: el plan que quedó y, si se quitó algo de este repo, qué. */
export function textoDeConfirmacion(r: { archivo: string; tareas: readonly TareaARenderizar[]; quitadas: readonly string[]; aviso?: string; semana?: Fecha }, deLaQueViene = false): string {
  // El lunes pasa a ser el plan vigente; hasta entonces Notion no lo tiene (`plan sincronizar` solo publica el de esta semana).
  const local = deLaQueViene ? "Queda solo en Rastro: el lunes pasa a ser el plan vigente y ese día `rastro plan sincronizar --confirmar` (o decile a Claude «sincronizá el plan») lo lleva a Notion.\n" : "";
  const quitadas = r.quitadas.length === 0 ? "" : `Se quitaron del plan, porque la propuesta no las trae: ${r.quitadas.join(", ")}.\n`;
  const titulo = deLaQueViene && r.semana !== undefined ? `Plan de la semana del ${ddmm(r.semana)} (la que viene) confirmado` : "Plan de la semana confirmado";
  return `${titulo} en ${r.archivo}:\n${tabla(r.tareas)}\n${quitadas}${r.aviso === undefined ? "" : `${r.aviso}\n`}${local}`;
}

const USO = "Uso: rastro plan <propuesta.md> [--semana-que-viene] | rastro plan --sugerir | rastro plan --desde-proyecto [--semana-que-viene] | rastro plan --confirmar [--semana-que-viene] | rastro plan cambiar <tipo> <tarea|sha|id> <valor> [--propuesta [--semana-que-viene]] [--confirmar] | rastro plan sincronizar [--confirmar] [--usar notion|rastro]";

function cambiar(o: { repos: readonly string[]; config: Config; hoy: Fecha; args: string[]; destino: "vigente" | "propuesta"; confirmar: boolean; json: boolean }): number {
  let cambios: Cambio[];
  if (o.json) {
    if (o.args.length > 0) throw new ErrorUsuario(USO);
    let crudo: unknown;
    try {
      crudo = JSON.parse(readFileSync(0, "utf8"));
    } catch (e) {
      if (e instanceof SyntaxError) throw new ErrorUsuario("Lo que llegó por stdin no es un JSON válido.", { cause: e });
      throw e;
    }
    cambios = validarCambios(crudo);
  } else {
    const [tipo, objetivo, valor, ...sobran] = o.args;
    if (tipo === undefined || objetivo === undefined || valor === undefined || sobran.length > 0) throw new ErrorUsuario(USO);
    cambios = [cambioDeArgumentos(tipo, objetivo, valor, o.hoy)];
  }
  const r = aplicarYRecalcular({ repos: o.repos, config: o.config, cambios, destino: o.destino, confirmar: o.confirmar, hoy: o.hoy });
  const encabezado = r.aplicado ? "Cambios aplicados:" : o.confirmar ? "No hubo nada para cambiar:" : "Vista previa (no se escribió nada; repetí con --confirmar para aplicar):";
  process.stdout.write(`${encabezado}\n${r.vistaPrevia.map((l) => `  ${l}`).join("\n")}\n${r.aviso === undefined ? "" : `${r.aviso}\n`}`);
  return 0;
}

export function textoDePropuesta(r: { archivo: string; tareas: readonly TareaARenderizar[]; reemplazo: boolean; conservadas?: readonly string[]; descartada?: PropuestaDescartada }, semanaQueViene?: Fecha): string {
  const conservadas = r.conservadas === undefined || r.conservadas.length === 0 ? "" : `; se conservaron sus tareas de otros repos: ${r.conservadas.join(", ")}`;
  return `${r.descartada !== undefined ? textoDeDescartada(r.descartada) : r.reemplazo ? `Se reemplazó la propuesta anterior${conservadas}.\n` : ""}Propuesta de plan${semanaQueViene === undefined ? "" : ` de la semana que viene (${ddmm(semanaQueViene)})`} en ${r.archivo} (plan.md no se tocó):\n${tabla(r.tareas)}\nCorregí las duraciones o los días editando ese archivo (si cambiás una duración, los días se vuelven a repartir; si cambiás los días, esos quedan fijos) y confirmá con \`rastro plan --confirmar${semanaQueViene === undefined ? "" : " --semana-que-viene"}\`.\n`;
}

/** Los repos donde buscar un SHA: todos los observados, con el de la carpeta actual primero si lo es. Funciona desde cualquier carpeta, como el dashboard. */
function reposParaCambiar(): string[] {
  const rutas = reposObservados().map((r) => r.ruta);
  let actual: string | null = null;
  try {
    actual = raizDelRepo(process.cwd());
  } catch (e) {
    // Fuera de un repo no hay uno "actual": se busca solo entre los observados.
    if (!(e instanceof ErrorUsuario)) throw e;
  }
  return actual !== null && rutas.includes(actual) ? [actual, ...rutas.filter((r) => r !== actual)] : rutas;
}

const USO_SINCRONIZAR = "Uso: rastro plan sincronizar [--confirmar] [--usar notion|rastro]";

/** Mantiene iguales el plan de Notion y el de Rastro; funciona desde cualquier carpeta, como `plan cambiar`. */
export async function cmdSincronizar(args: string[], deps: { notion?: NotionPlan; llm?: Llm | null } = {}): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { confirmar: { type: "boolean", default: false }, usar: { type: "string" } } });
  const usar = values.usar;
  if (positionals.length > 0 || (usar !== undefined && usar !== "notion" && usar !== "rastro")) throw new ErrorUsuario(USO_SINCRONIZAR);
  reposObservados();
  const config = leerConfig();
  if (!config.conectores.includes("notion")) {
    process.stdout.write("Notion no está en los conectores de la configuración: no hay nada para sincronizar.\n");
    return 0;
  }
  const hoy = fechaLocal(new Date(), config.zonaHoraria);
  const r = await sincronizarPlan({
    config,
    hoy,
    notion: deps.notion ?? crearNotionPlan(config),
    llm: deps.llm === undefined ? crearLlm(config) : deps.llm,
    confirmar: values.confirmar,
    ...(usar === undefined ? {} : { usar }),
  });
  for (const aviso of r.avisos) log("warn", "notion_aviso", { detalle: aviso });
  const aviso = r.planCambio ? recalcularSiHayDaily({ config, hoy }) : undefined;
  process.stdout.write(`${[...r.lineas, ...(aviso === undefined ? [] : [aviso])].map((l) => `${l}\n`).join("")}`);
  return 0;
}

export async function cmdPlan(args: string[], deps: { llm?: Llm | null } = {}): Promise<number> {
  if (args[0] === "sincronizar") return cmdSincronizar(args.slice(1));
  // --propuesta lleva un archivo acá y es un interruptor en `cambiar`: cada forma lee sus propios argumentos.
  // El import es dinámico porque sugerirProyecto.ts importa conLlm y tareasValidas de este módulo: uno estático haría un ciclo.
  if (args.includes("--desde-proyecto")) return (await import("./sugerirProyecto.ts")).cmdDesdeProyecto(args, deps);
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      sugerir: { type: "boolean", default: false },
      confirmar: { type: "boolean", default: false },
      propuesta: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "semana-que-viene": { type: "boolean", default: false },
    },
  });
  const queViene = values["semana-que-viene"];
  if (positionals[0] === "cambiar") {
    // Para la semana que viene solo se corrige la propuesta: el plan vigente es el de esta semana.
    if (values.sugerir || (queViene && !values.propuesta)) throw new ErrorUsuario(USO);
    const repos = reposParaCambiar();
    const config = leerConfig();
    const hoy = fechaLocal(new Date(), config.zonaHoraria);
    return cambiar({ repos, config, hoy: queViene ? lunesQueViene(hoy) : hoy, args: positionals.slice(1), destino: values.propuesta ? "propuesta" : "vigente", confirmar: values.confirmar, json: values.json });
  }
  const repo = raizDelRepo(process.cwd());
  const nombre = exigirRegistrado(repo);
  const config = leerConfig();
  const hoyReal = fechaLocal(new Date(), config.zonaHoraria);
  // El plan de la semana que viene se arma y se confirma con el mismo código: todo se calcula desde su lunes.
  const hoy = queViene ? lunesQueViene(hoyReal) : hoyReal;
  if (values.propuesta || values.json) throw new ErrorUsuario(USO);
  if (values.confirmar) {
    if (values.sugerir || positionals.length > 0) throw new ErrorUsuario(USO);
    process.stdout.write(textoDeConfirmacion(confirmarPlan({ config, hoy, deLaQueViene: queViene }), queViene));
    return 0;
  }
  if (values.sugerir && queViene) throw new ErrorUsuario(USO);
  const llm = deps.llm === undefined ? crearLlm(config) : deps.llm;
  if (llm === null) throw new ErrorUsuario(`El plan necesita un LLM: configurá llm.proveedor en ${rutasGlobales().config}.`);
  if (values.sugerir) {
    const r = await sugerirTareas({ repo, nombre, config, llm, ahora: new Date() });
    process.stdout.write(
      r.nuevas === 0
        ? "No hay tareas nuevas para sugerir.\n"
        : `Se guardaron ${r.nuevas} ofrecimientos en ${r.archivo}; el plan no cambió. Aceptalos o descartalos con \`rastro plan cambiar ofrecimiento <id> aceptar|descartar\`.\n`,
    );
    return 0;
  }
  const propuesta = positionals[0];
  if (propuesta === undefined) throw new ErrorUsuario(USO);
  if (!existsSync(propuesta)) throw new ErrorUsuario(`No existe ${propuesta}.`);
  const r = await armarPlan({ nombre, config, llm, propuesta: readFileSync(propuesta, "utf8"), hoy });
  process.stdout.write(textoDePropuesta(r, queViene ? hoy : undefined));
  return 0;
}
