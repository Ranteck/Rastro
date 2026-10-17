import { existsSync, readFileSync } from "node:fs";
import { listar, type RepoObservado } from "./repos.ts";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { expandirHome, leerConfig, rutasGlobales, rutasRepo, type Config } from "./config.ts";
import {
  validarSnapshot,
  type EntradaBitacora,
  type Evidencia,
  type Pendiente,
  type Plan,
  type Resumen,
  type Snapshot,
  type Sugerencia,
  type Tarea,
} from "./contract/snapshot.ts";
import { aplicarCambios, leerCorrecciones, leerOfrecimientos, type ResultadoCambios } from "./cambios.ts";
import { calcularDesvios } from "./detectores/desvios.ts";
import { patronesDeComandos, patronesDePrompts, type Patron } from "./detectores/repeticiones.ts";
import { detectarPendientes, type CommitVinculado } from "./detectores/pendientes.ts";
import { vincularPorNombre, vinculoCorregido, type Vinculo } from "./detectores/vinculo.ts";
import { ErrorUsuario } from "./errores.ts";
import { leerEventos, type Evento } from "./eventos.ts";
import { fechaLocal, horaLocal, lunesDe, sumarDias, type Fecha } from "./fechas.ts";
import { dirDeProyecto, leerTranscript, promptsDeTranscript, transcriptsRecientes, type PromptUsuario } from "./fuentes/claudeCode.ts";
import { parsearHistorialZsh, type Comando } from "./fuentes/zsh.ts";
import { textoParaPegar } from "./contract/textos.ts";
import { calcularFoco, sesionesVinculadas, type Sesion } from "./foco.ts";
import { calcularGantt } from "./gantt.ts";
import { diffResumido, lineasAgregadas, recolectarGit, type Commit } from "./git.ts";
import { idsDeChat } from "./chat.ts";
import { crearLlm } from "./llm/crear.ts";
import { ErrorLlm, type Llm } from "./llm/llm.ts";
import { pedidoBitacora, pedidoSugerencias, pedidoVinculos } from "./llm/usos.ts";
import { log } from "./log.ts";
import { parsearPlan } from "./plan.ts";
import { redactar } from "./redactar.ts";
import { guardarState, leerState } from "./state.ts";
import { crearNotionPlan, sincronizarEnLectura } from "./sincroNotion.ts";
import { slugDe } from "./texto.ts";

/** Los repos registrados que siguen en el disco; hay al menos uno. */
export type Observados = readonly [RepoObservado, ...RepoObservado[]];

export type ContextoDaily = {
  repos: Observados;
  config: Config;
  llm: Llm | null;
  ahora: Date;
  desde?: Fecha;
  fuentes?: { comandos: readonly Comando[]; prompts: readonly PromptUsuario[] };
};
export type ResultadoDaily = { snapshot: Snapshot; avisos: string[] };

type ItemBitacora = { entrada: EntradaBitacora; sha: string | null; ruta: string | null };

const MAX_DIFF_POR_COMMIT = 4_000;
const MAX_DIFF_TOTAL = 40_000;

/** El LLM es opcional: si falla, se avisa y la corrida sigue sin él (REQ-10). */
async function intentarLlm<T>(avisos: string[], sinEso: string, pedir: () => Promise<T>): Promise<T | null> {
  try {
    return await pedir();
  } catch (e) {
    if (!(e instanceof ErrorLlm)) throw e;
    avisos.push(`${sinEso}: el LLM no está disponible (${e.message}).`);
    return null;
  }
}

export function reposObservados(): Observados {
  const [primero, ...resto] = listar().filter((r) => {
    // Una carpeta que sigue en el disco pero ya no es un repo git se saltea igual que una borrada: no frena el daily de los demás.
    if (existsSync(join(r.ruta, ".git"))) return true;
    log("warn", "repo-inexistente", { ruta: r.ruta, nombre: r.nombre });
    return false;
  });
  if (primero === undefined) throw new ErrorUsuario("No hay repos observados: sumá uno corriendo `rastro init` adentro del repo.");
  return [primero, ...resto];
}

/** Las tareas con las que puede vincularse un commit o una sesión de ese repo: las suyas y las que no son de ningún repo. */
export const tareasDelRepo = (tareas: readonly Tarea[], nombre: string): Tarea[] => tareas.filter((t) => t.repo === null || t.repo === nombre);

export const planDelRepo = (plan: Plan | null, nombre: string): Plan | null => (plan === null ? null : { ...plan, tareas: tareasDelRepo(plan.tareas, nombre) });

function vincularCommit(c: Commit, ramaPorSha: ReadonlyMap<string, string>, correcciones: ReadonlyMap<string, string | null>, tareas: readonly Tarea[]): CommitVinculado {
  const rama = ramaPorSha.get(c.sha) ?? c.rama;
  const corregido = vinculoCorregido(correcciones, c.sha, tareas);
  if (corregido !== null) return { ...c, rama, vinculo: corregido };
  const tarea = vincularPorNombre({ rama, asunto: c.asunto, cuerpo: c.cuerpo }, tareas);
  return { ...c, rama, vinculo: tarea === null ? { tarea: null, tipo: "sin-tarea" } : { tarea, tipo: "nombre" } };
}

export type Inferidos = ReadonlyMap<string, { tarea: string; razon?: string }>;

/** Lo que el LLM infirió en un daily no se puede rehacer sin él: se conserva de la bitácora, por ref de 7 caracteres, mientras la tarea siga en el plan. */
export function inferidosDeBitacora(bitacora: Snapshot["bitacora"], tareas: readonly Tarea[]): Inferidos {
  return new Map(
    bitacora.flatMap((e) =>
      e.vinculo === "inferido" && e.tarea !== null && tareas.some((t) => t.slug === e.tarea)
        ? [[e.evidencia[0]?.ref ?? "", { tarea: e.tarea, ...(e.razon === undefined ? {} : { razon: e.razon }) }] as const]
        : [],
    ),
  );
}

/** Los commits de la semana (sin merges, desde `desde` hasta `hoy` y hasta `corte`) con su vínculo: corregido, por nombre o, si no hay otro, el inferido. */
export function commitsVinculadosDeLaSemana(o: { repo: string; nombre: string; desde: Fecha; hoy: Fecha; corte: Date; zona: string; tareas: readonly Tarea[]; inferidos: Inferidos }): CommitVinculado[] {
  const tareas = tareasDelRepo(o.tareas, o.nombre);
  const ramaPorSha = new Map<string, string>();
  for (const e of leerEventos(rutasRepo(o.repo).eventos).eventos) if (e.tipo === "commit") ramaPorSha.set(e.sha, e.rama);
  const correcciones = leerCorrecciones();
  return recolectarGit(o.repo, sumarDias(o.desde, -1))
    .commits.filter((c) => {
      const f = fechaLocal(c.fecha, o.zona);
      return c.padres.length < 2 && c.fecha <= o.corte && f >= o.desde && f <= o.hoy;
    })
    .map((c): CommitVinculado => {
      const v = { ...vincularCommit(c, ramaPorSha, correcciones, tareas), repo: o.nombre };
      const inferido = v.vinculo.tipo === "sin-tarea" ? o.inferidos.get(c.sha.slice(0, 7)) : undefined;
      // Una inferencia guardada de una tarea que no es de este repo no vale: un commit nunca se vincula con la tarea de otro repo.
      return inferido === undefined || !tareas.some((t) => t.slug === inferido.tarea)
        ? v
        : { ...v, vinculo: { tarea: inferido.tarea, tipo: "inferido", ...(inferido.razon === undefined ? {} : { razon: inferido.razon }) } };
    });
}

/** Las sesiones de Claude Code vinculadas al plan que cayeron entre `desde` y `hoy`, hasta `corte`: evidencia de toda la semana, aunque el período del daily sea solo hoy. */
export function sesionesDeLaSemana(o: { eventos: readonly Evento[]; plan: Plan | null; zona: string; desde: Fecha; hoy: Fecha; corte: Date }): Sesion[] {
  const hasta = o.eventos.filter((e) => e.tipo !== "sesion" || new Date(e.en) <= o.corte);
  // Las líneas ilegibles de los transcripts ya las avisa el daily; acá no hay donde mostrarlas.
  return sesionesVinculadas(entradasDeSesiones(hasta, o.plan?.tareas ?? [], null, o.zona, o.desde, o.hoy, []), o.plan);
}

/** Lo mismo que `sesionesDeLaSemana`, leyendo los eventos del repo y sin las conversaciones del chat de Rastro. */
export function sesionesDeLaSemanaEnDisco(o: { repo: string; plan: Plan | null; zona: string; desde: Fecha; hoy: Fecha; corte: Date }): Sesion[] {
  const deChat = idsDeChat();
  const eventos = leerEventos(rutasRepo(o.repo).eventos).eventos.filter((e) => e.tipo !== "sesion" || !deChat.has(e.id));
  return sesionesDeLaSemana({ ...o, eventos });
}

const RE_DOC = /^(?:docs\/|(?:.*\/)?README)/i;

export async function generarSnapshot(ctx: ContextoDaily): Promise<ResultadoDaily> {
  const { repos, config } = ctx;
  const zona = config.zonaHoraria;
  const hoy = fechaLocal(ctx.ahora, zona);
  const desde = ctx.desde ?? hoy;
  const inicio = desde < lunesDe(hoy) ? desde : lunesDe(hoy);
  const r = rutasGlobales();
  const avisos: string[] = [];
  // Si el LLM falla una vez, no se vuelve a intentar en esta corrida.
  let llm = ctx.llm;

  const plan = existsSync(r.plan) ? parsearPlan(readFileSync(r.plan, "utf8"), hoy) : null;
  const tareas = plan?.tareas ?? [];
  const [cualquiera] = repos;
  // Las sesiones del chat de Rastro no son trabajo: aunque un SessionEnd viejo las haya registrado, no entran a la bitácora.
  const sesionesDeChat = idsDeChat(avisos);
  const correcciones = leerCorrecciones();

  const enRango = (c: Commit, d: Fecha): boolean => {
    const f = fechaLocal(c.fecha, zona);
    return f >= d && f <= hoy;
  };
  const lecturas = repos.map((repo) => {
    const datos = recolectarGit(repo.ruta, sumarDias(inicio, -1));
    const leidos = leerEventos(rutasRepo(repo.ruta).eventos);
    if (leidos.descartados > 0) avisos.push(`Se descartaron ${leidos.descartados} eventos ilegibles de .rastro/events.jsonl de ${repo.nombre}.`);
    const eventos = leidos.eventos.filter((e) => e.tipo !== "sesion" || !sesionesDeChat.has(e.id));
    const ramaPorSha = new Map<string, string>();
    for (const e of eventos) if (e.tipo === "commit") ramaPorSha.set(e.sha, e.rama);
    const tareasDelRepoActual = tareasDelRepo(tareas, repo.nombre);
    const deLaSemana = datos.commits.filter((c) => enRango(c, inicio));
    const evidenciaCommit = (sha: string): Evidencia =>
      datos.urlBase === null ? { tipo: "commit", ref: sha.slice(0, 7) } : { tipo: "commit", ref: sha.slice(0, 7), url: `${datos.urlBase}/commit/${sha}` };
    return {
      ...repo,
      datos,
      eventos,
      tareas: tareasDelRepoActual,
      plan: planDelRepo(plan, repo.nombre),
      evidenciaCommit,
      merges: deLaSemana.filter((c) => c.padres.length > 1),
      semana: deLaSemana.filter((c) => c.padres.length < 2).map((c) => ({ ...vincularCommit(c, ramaPorSha, correcciones, tareasDelRepoActual), repo: repo.nombre })),
    };
  });
  let semana = lecturas.flatMap((l) => l.semana);

  if (llm !== null && tareas.length > 0) {
    const sinTarea = semana.filter((c) => enRango(c, desde) && c.vinculo.tipo === "sin-tarea");
    const inferidos = await inferirVinculos(llm, sinTarea, tareas, avisos);
    if (inferidos === null) llm = null;
    else {
      semana = semana.map((c) => {
        // Solo se pisan los que se le mandaron al LLM: lo que respondió de más no toca los corregidos ni los vinculados por nombre.
        const v = c.vinculo.tipo === "sin-tarea" ? inferidos.get(c.sha) : undefined;
        // El LLM ve todas las tareas, pero un commit nunca se vincula con la de otro repo.
        return v === undefined || !tareasDelRepo(tareas, c.repo).some((t) => t.slug === v.tarea) ? c : { ...c, vinculo: v };
      });
    }
  }
  const periodo = semana.filter((c) => enRango(c, desde));

  const hayVarios = repos.length > 1;
  const vistos = new Set<string>();
  const pendientes = lecturas.flatMap((l): Pendiente[] => {
    const deEsteRepo = (c: CommitVinculado): boolean => c.repo === l.nombre;
    return detectarPendientes({
      plan: l.plan,
      commitsSemana: semana.filter(deEsteRepo),
      commitsPeriodo: periodo.filter(deEsteRepo),
      merges: l.merges,
      ramas: l.datos.ramas,
      ramaPrincipal: l.datos.ramaPrincipal,
      lineasAgregadas: (sha) => lineasAgregadas(l.ruta, sha),
      evidenciaCommit: l.evidenciaCommit,
      ahora: ctx.ahora,
      ramaQuietaDias: config.umbrales.ramaQuietaDias,
    }).flatMap((p): Pendiente[] => {
      const deLaTarea = tareas.find((t) => t.slug === p.tarea);
      // Una tarea cerrada sin evidencia es del plan, no de un repo: cuenta la evidencia de todos y se avisa una sola vez.
      if (p.tipo === "cerrado-sin-evidencia" && deLaTarea?.repo === null) {
        if (semana.some((c) => c.vinculo.tarea === p.tarea) || vistos.has(p.tarea ?? "")) return [];
        vistos.add(p.tarea ?? "");
        return [p];
      }
      return [hayVarios ? { ...p, texto: `[${l.nombre}] ${p.texto}` } : p];
    });
  });
  const desvios = calcularDesvios({ plan, commitsPeriodo: periodo, commitsSemana: semana, umbralPct: config.umbrales.fueraDelPlanPct, hoy, umbralAtrasadas: config.umbrales.atrasadas });

  const items: ItemBitacora[] = [
    ...lecturas.flatMap((l) =>
      periodo.filter((c) => c.repo === l.nombre).map((c): ItemBitacora => ({ entrada: entradaDeCommit(c, l.nombre, zona, l.evidenciaCommit), sha: c.sha, ruta: l.ruta })),
    ),
    ...lecturas.flatMap((l) => entradasDeSesiones(l.eventos, l.tareas, l.nombre, zona, desde, hoy, avisos).map((entrada): ItemBitacora => ({ entrada, sha: null, ruta: null }))),
  ].sort((a, b) => `${b.entrada.fecha} ${b.entrada.hora}`.localeCompare(`${a.entrada.fecha} ${a.entrada.hora}`));

  const nombreDe = (slug: string): string => tareas.find((t) => t.slug === slug)?.nombre ?? slug;
  const sigue = [
    ...pendientes.map((p) => p.proximoPaso),
    ...desvios.tareasSinActividad.map((s) => `${nombreDe(s)} no tuvo actividad esta semana.`),
  ];
  let bitacora = items.map((i) => i.entrada);
  let resumen: Resumen | null = null;
  if (llm !== null) {
    const res = await resumirConLlm(llm, plan, items, pendientes, desvios.tareasSinActividad.map(nombreDe), avisos);
    if (res === null) {
      llm = null;
    } else {
      bitacora = bitacora.map((e, i) => ({ ...e, texto: res.textos.get(i) ?? e.texto }));
      resumen = { ...res.resumen, sigue: [...new Set([...sigue, ...res.resumen.sigue])] };
    }
  }

  const sesiones = lecturas.flatMap((l) => sesionesDeLaSemana({ eventos: l.eventos, plan: l.plan, zona, desde: inicio, hoy, corte: ctx.ahora }));
  let sugerencias: Sugerencia[] = [];
  if (llm !== null && ctx.fuentes !== undefined) {
    const u = config.umbrales.repeticiones;
    const patrones = [...patronesDeComandos(ctx.fuentes.comandos, u, zona), ...patronesDePrompts(ctx.fuentes.prompts, u, zona)];
    sugerencias = await sugerirAutomatizaciones(llm, patrones, avisos);
  }

  const [unico] = lecturas;
  const urlUnica = repos.length === 1 ? unico?.datos.urlBase ?? null : null;
  const snapshot = validarSnapshot({
    schemaVersion: 3,
    generadoEn: ctx.ahora.toISOString(),
    persona: config.persona,
    repo: urlUnica === null ? { nombre: repos.map((x) => x.nombre).join(", ") } : { nombre: cualquiera.nombre, url: urlUnica },
    periodo: { desde, hasta: hoy },
    plan,
    bitacora,
    pendientes,
    desvios,
    resumen,
    sugerencias,
    foco: calcularFoco(plan, semana, sesiones, hoy, zona),
    ofrecimientos: ofrecimientosPendientes(plan),
    gantt: calcularGantt(plan, semana, sesiones, zona, desvios.tareasAtrasadas),
    costo: ctx.llm?.costo() ?? { llamadas: 0, usd: 0, tokens: 0 },
  });
  return { snapshot, avisos };
}

/**
 * Rehace sin LLM lo que depende del plan vigente y de los vínculos de los commits (plan, bitácora, desvíos, foco, Gantt y ofrecimientos).
 * Lee git y los eventos, nunca el LLM: los textos de la bitácora, el resumen y las sugerencias quedan como los dejó el último daily.
 * Solo cuenta los commits hasta el instante del último daily, para que el snapshot siga coherente con su bitácora.
 * Los pendientes tampoco se recalculan: dependen de ramas y diffs, y se actualizan con el próximo `rastro daily`.
 */
export function recalcularConPlan(snapshot: Snapshot, o: { config: Config; hoy: Fecha }): Snapshot {
  const { config } = o;
  const repos = reposObservados();
  // El snapshot tiene una sola fecha, la del último daily: si hoy cae en otra semana, el plan, los commits y la bitácora serían de semanas distintas.
  if (lunesDe(o.hoy) !== lunesDe(snapshot.periodo.hasta)) throw new ErrorUsuario("El último daily es de otra semana: corré `rastro daily` (o decile a Claude «cerrá el día»).");
  const hoy = snapshot.periodo.hasta;
  const corte = new Date(snapshot.generadoEn);
  const zona = config.zonaHoraria;
  const r = rutasGlobales();
  const plan = existsSync(r.plan) ? parsearPlan(readFileSync(r.plan, "utf8"), o.hoy) : null;
  const tareas = plan?.tareas ?? [];
  const desde = snapshot.periodo.desde;
  const inicio = desde < lunesDe(hoy) ? desde : lunesDe(hoy);
  const inferidos = inferidosDeBitacora(snapshot.bitacora, tareas);
  const enRango = (c: Commit, d: Fecha): boolean => {
    const f = fechaLocal(c.fecha, zona);
    return f >= d && f <= hoy;
  };
  const semana = repos.flatMap((r) => commitsVinculadosDeLaSemana({ repo: r.ruta, nombre: r.nombre, desde: inicio, hoy, corte, zona, tareas, inferidos }));
  const periodo = semana.filter((c) => enRango(c, desde));
  const claveDe = (repo: string | null | undefined, ref: string): string => `${repo ?? ""}\0${ref}`;
  const vinculoPorRef = new Map(periodo.map((c) => [claveDe(c.repo, c.sha.slice(0, 7)), c.vinculo]));
  const desvios = calcularDesvios({ plan, commitsPeriodo: periodo, commitsSemana: semana, umbralPct: config.umbrales.fueraDelPlanPct, hoy, umbralAtrasadas: config.umbrales.atrasadas });
  const bitacora = snapshot.bitacora.map((e) => {
    const ref = e.evidencia[0]?.tipo === "commit" ? e.evidencia[0].ref : null;
    const v = ref === null ? undefined : vinculoPorRef.get(claveDe(e.repo, ref));
    if (v === undefined) return e;
    const { razon: _razon, ...resto } = e;
    return { ...resto, tarea: v.tarea, vinculo: v.tipo, ...(v.razon === undefined ? {} : { razon: v.razon }) };
  });
  const sesiones = repos.flatMap((r) => sesionesDeLaSemanaEnDisco({ repo: r.ruta, plan: planDelRepo(plan, r.nombre), zona, desde: inicio, hoy, corte }));
  return validarSnapshot({
    ...snapshot,
    plan,
    bitacora,
    desvios,
    foco: calcularFoco(plan, semana, sesiones, hoy, zona),
    ofrecimientos: ofrecimientosPendientes(plan),
    gantt: calcularGantt(plan, semana, sesiones, zona, desvios.tareasAtrasadas),
  });
}

/**
 * Después de cambiar plan.md: si hay un último daily, lo rehace con el plan nuevo para que el dashboard, el chat y `publish` no usen el viejo.
 * Devuelve un aviso si no pudo; el plan ya está escrito y el aviso no es un error (quien llama reintentaría un cambio aplicado).
 */
export function recalcularSiHayDaily(o: { config: Config; hoy: Fecha }): string | undefined {
  if (!existsSync(rutasGlobales().state)) return undefined;
  try {
    guardarState(recalcularConPlan(leerState(), o));
    return undefined;
  } catch (e) {
    log("warn", "recalculo_fallo", { tipo: e instanceof Error ? e.name : "desconocido" });
    return "El plan se actualizó, pero no pude actualizar el resumen local: corré `rastro daily` (o decile a Claude «cerrá el día»).";
  }
}

/** Único camino para aplicar cambios al plan vigente (CLI, dashboard y chat): aplica y, si se escribió, rehace el resumen local. */
export function aplicarYRecalcular(o: Parameters<typeof aplicarCambios>[0]): ResultadoCambios & { aviso?: string } {
  const r = aplicarCambios(o);
  const aviso = r.aplicado && o.destino === "vigente" ? recalcularSiHayDaily({ config: o.config, hoy: o.hoy }) : undefined;
  return aviso === undefined ? r : { ...r, aviso };
}

// Uno cuya tarea ya está en el plan (agregada a mano o de otra semana) no se puede aceptar: no viaja en el snapshot.
const ofrecimientosPendientes = (plan: Plan | null): Snapshot["ofrecimientos"] =>
  leerOfrecimientos().filter((x) => x.estado === "pendiente" && !(plan?.tareas ?? []).some((t) => t.slug === x.id)).map((x) => ({
      id: x.id,
      nombre: x.nombre,
      objetivo: x.objetivo,
      duracion: x.duracion,
      porque: x.porque,
      ...(x.repo === undefined ? {} : { repo: x.repo }),
      ...(x.estadoSugerido === undefined ? {} : { estadoSugerido: x.estadoSugerido }),
    }));

async function sugerirAutomatizaciones(llm: Llm, patrones: readonly Patron[], avisos: string[]): Promise<Sugerencia[]> {
  if (patrones.length === 0) return [];
  try {
    const r = await llm.completar(pedidoSugerencias({ patrones: patrones.map((p, i) => ({ id: String(i), ...p })) }));
    return r.propuestas.flatMap((x): Sugerencia[] => {
      const p = patrones[Number(x.id)];
      // El patrón queda en el snapshot: se redacta igual que lo que va al LLM.
      return p === undefined ? [] : [{ ...p, patron: redactar(p.patron), propuesta: { tipo: x.tipo, contenido: x.contenido, porque: x.porque } }];
    });
  } catch (e) {
    if (!(e instanceof ErrorLlm)) throw e;
    avisos.push(`Sin sugerencias: el LLM no está disponible (${e.message}).`);
    return [];
  }
}

const DIAS_DE_HISTORIA = 14;

export function leerFuentes(config: Config, repo: string, ahora: Date, avisos: string[]): { comandos: Comando[]; prompts: PromptUsuario[] } {
  const desde = new Date(ahora.getTime() - DIAS_DE_HISTORIA * 86_400_000);
  const zsh = expandirHome(config.fuentes.zshHistory);
  let comandos: Comando[] = [];
  let contenidoZsh: Buffer | null = null;
  try {
    contenidoZsh = readFileSync(zsh);
  } catch (e) {
    // Sin historial no hay nada que leer; un directorio o falta de permisos se avisa y se sigue.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") avisos.push("No se pudo leer el historial de zsh.");
  }
  if (contenidoZsh !== null) {
    const r = parsearHistorialZsh(contenidoZsh);
    comandos = r.comandos.filter((c) => c.en >= desde);
    if (r.descartadas > 0) avisos.push(`${r.descartadas} líneas del historial de zsh no tienen fecha: con \`setopt EXTENDED_HISTORY\` empiezan a contar.`);
  }
  const prompts: PromptUsuario[] = [];
  let ilegibles = 0;
  // Solo los repos observados: leer las sesiones de proyectos que la persona no registró sería vigilancia, no bitácora.
  const dirProyecto = join(expandirHome(config.fuentes.claudeProjects), dirDeProyecto(repo));
  const recientes = transcriptsRecientes(dirProyecto, desde);
  ilegibles += recientes.ilegibles;
  // El chat de Rastro corre en la carpeta global y deja sus transcripts allá, fuera de los proyectos observados; solo una sesión retomada desde un repo cae acá, y no es trabajo ni prompts repetidos de la persona.
  const sesionesDeChat = idsDeChat(avisos);
  for (const t of recientes.rutas.filter((ruta) => !sesionesDeChat.has(basename(ruta, ".jsonl")))) {
    let contenido: string;
    try {
      contenido = readFileSync(t, "utf8");
    } catch {
      ilegibles++; // Un transcript que no se puede abrir no frena el resto.
      continue;
    }
    const r = promptsDeTranscript(contenido);
    prompts.push(...r.prompts.filter((p) => p.en >= desde));
    ilegibles += r.descartadas;
  }
  if (ilegibles > 0) avisos.push(`${ilegibles} líneas ilegibles en los transcripts de Claude Code de ${basename(repo)}.`);
  return { comandos, prompts };
}

/** El historial de zsh es uno solo; los prompts salen de las sesiones de cada repo observado. */
function leerFuentesDeRepos(config: Config, repos: Observados, ahora: Date, avisos: string[]): { comandos: Comando[]; prompts: PromptUsuario[] } {
  const [primero, ...resto] = repos;
  const base = leerFuentes(config, primero.ruta, ahora, avisos);
  return { comandos: base.comandos, prompts: [...base.prompts, ...resto.flatMap((r) => leerFuentes(config, r.ruta, ahora, avisos).prompts)] };
}

async function inferirVinculos(
  llm: Llm,
  commits: readonly CommitVinculado[],
  tareas: readonly Tarea[],
  avisos: string[],
): Promise<Map<string, Vinculo> | null> {
  const res = new Map<string, Vinculo>();
  if (commits.length === 0) return res;
  const r = await intentarLlm(avisos, "Sin vínculos inferidos", () =>
    llm.completar(
      pedidoVinculos({
        commits: commits.map((c) => ({ sha: c.sha, asunto: c.asunto, archivos: c.archivos.slice(0, 20) })),
        tareas: tareas.map((t) => ({ slug: t.slug, nombre: t.nombre, objetivo: t.objetivo })),
      }),
    ),
  );
  if (r === null) return null;
  const slugs = new Set(tareas.map((t) => t.slug));
  // Un slug inventado por el LLM se descarta: el commit queda sin tarea.
  for (const v of r.vinculos) if (v.tarea !== null && slugs.has(v.tarea)) res.set(v.sha, { tarea: v.tarea, tipo: "inferido", razon: v.razon });
  return res;
}

async function resumirConLlm(
  llm: Llm,
  plan: Plan | null,
  items: readonly ItemBitacora[],
  pendientes: readonly Pendiente[],
  sinActividad: string[],
  avisos: string[],
): Promise<{ textos: Map<number, string>; resumen: Resumen } | null> {
  let presupuesto = MAX_DIFF_TOTAL;
  const entradas = items.map((item, i) => {
    let diff = "";
    if (item.sha !== null && item.ruta !== null && presupuesto > 0) {
      diff = diffResumido(item.ruta, item.sha, Math.min(MAX_DIFF_POR_COMMIT, presupuesto));
      presupuesto -= diff.length;
    }
    return { id: String(i), tarea: item.entrada.tarea, rama: item.entrada.rama, asunto: item.entrada.texto, diff };
  });
  const res = await intentarLlm(avisos, "Sin resumen", () =>
    llm.completar(
      pedidoBitacora({
        entregable: plan?.entregable ?? null,
        entradas,
        pendientes: pendientes.map((p) => ({ texto: p.texto, proximoPaso: p.proximoPaso })),
        sinActividad,
      }),
    ),
  );
  if (res === null) return null;
  return { textos: new Map(res.entradas.map((e): [number, string] => [Number(e.id), e.texto])), resumen: res.resumen };
}

function entradaDeCommit(c: CommitVinculado, repo: string, zona: string, evidenciaCommit: (sha: string) => Evidencia): EntradaBitacora {
  return {
    fecha: fechaLocal(c.fecha, zona),
    hora: horaLocal(c.fecha, zona),
    tarea: c.vinculo.tarea,
    repo,
    rama: c.rama,
    texto: c.asunto,
    vinculo: c.vinculo.tipo,
    ...(c.vinculo.razon === undefined ? {} : { razon: c.vinculo.razon }),
    evidencia: [
      evidenciaCommit(c.sha),
      { tipo: "rama", ref: c.rama },
      ...c.archivos.filter((a) => RE_DOC.test(a)).map((a): Evidencia => ({ tipo: "doc", ref: a })),
    ],
  };
}

function entradasDeSesiones(
  eventos: readonly Evento[],
  tareas: readonly Tarea[],
  repo: string | null,
  zona: string,
  desde: Fecha,
  hoy: Fecha,
  avisos: string[],
): EntradaBitacora[] {
  const res: EntradaBitacora[] = [];
  let ilegibles = 0;
  for (const e of eventos) {
    if (e.tipo !== "sesion") continue;
    const en = new Date(e.en);
    const fecha = fechaLocal(en, zona);
    if (fecha < desde || fecha > hoy) continue;
    const leido = leerTranscript(e.transcript);
    ilegibles += leido.ilegibles;
    const titulo = leido.titulo;
    const tarea = vincularPorNombre({ rama: e.rama ?? "", asunto: titulo ?? "", cuerpo: "" }, tareas);
    res.push({
      fecha,
      hora: horaLocal(en, zona),
      tarea,
      repo,
      rama: e.rama ?? "(sin rama)",
      texto: titulo === null ? "Sesión de Claude Code." : `Sesión de Claude Code: ${titulo}.`,
      vinculo: tarea === null ? "sin-tarea" : "nombre",
      evidencia: [{ tipo: "sesion", ref: e.id.slice(0, 8) }],
    });
  }
  if (ilegibles > 0) avisos.push(`Se saltearon ${ilegibles} líneas ilegibles de transcripts de Claude Code${repo === null ? "" : ` de ${repo}`}.`);
  return res;
}

export function textoDelDia(s: Snapshot): string {
  const l: string[] = [
    `Rastro · ${s.persona.nombre} · ${s.periodo.desde === s.periodo.hasta ? s.periodo.hasta : `${s.periodo.desde} a ${s.periodo.hasta}`}`,
    `Bitácora: ${s.bitacora.length} entradas · Pendientes: ${s.pendientes.length} · Fuera del plan: ${s.desvios.fueraDelPlanPct}%${s.desvios.alerta ? " (alerta)" : ""}`,
  ];
  if (s.pendientes.length > 0) {
    l.push("", "Pendientes:");
    for (const p of s.pendientes) l.push(`  - [${p.tipo}] ${p.texto} → ${p.proximoPaso}`);
  }
  if (s.desvios.tareasSinActividad.length > 0) {
    const nombres = s.desvios.tareasSinActividad.map((slug) => s.plan?.tareas.find((t) => t.slug === slug)?.nombre ?? slug);
    l.push("", `Sin actividad: ${nombres.join(", ")}`);
  }
  if (s.resumen === null) {
    l.push("", "Sin resumen (LLM no disponible).");
  } else {
    const bloques = [["Hice", s.resumen.hice], ["Avancé", s.resumen.avance], ["Sigue", s.resumen.sigue], ["Bloqueos", s.resumen.bloqueos]] as const;
    for (const [titulo, items] of bloques) {
      if (items.length === 0) continue;
      l.push("", `${titulo}:`);
      for (const i of items) l.push(`  - ${i}`);
    }
  }
  if (s.sugerencias.length > 0) {
    l.push("", "Sugerencias de automatización:");
    for (const g of s.sugerencias) l.push(`  - ${g.patron} (${g.ocurrencias} veces en ${g.dias} días) → ${g.propuesta.tipo}`);
  }
  l.push(
    "",
    `Costo LLM: ${s.costo.llamadas} llamadas · US$${s.costo.usd.toFixed(4)} · ${s.costo.tokens} tokens`,
    `Guardado en ${rutasGlobales().state}. Revisalo y publicalo con \`rastro publish\`.`,
    "",
  );
  return l.join("\n");
}

/** Un bloque por tarea con actividad (o solo la pedida), con las entradas como bullets listos para pegar en la Daily. */
function bloquesParaPegar(s: Snapshot, tarea: string | undefined): string {
  const slugs = tarea === undefined ? (s.plan?.tareas ?? []).map((t) => t.slug) : [slugDe(tarea)];
  const bloques = slugs.flatMap((slug) => {
    const texto = textoParaPegar(s, slug);
    return texto === null ? [] : [`**${s.plan?.tareas.find((t) => t.slug === slug)?.nombre ?? slug}**\n${redactar(texto)}`];
  });
  if (bloques.length === 0) {
    throw new ErrorUsuario(tarea === undefined ? "No hay entradas en la bitácora para pegar." : `La tarea "${tarea}" no tiene entradas en la bitácora para pegar.`);
  }
  return `${bloques.join("\n\n")}\n`;
}

export async function cmdDaily(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { desde: { type: "string" }, "para-pegar": { type: "boolean", default: false } },
  });
  if (values.desde !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(values.desde)) throw new ErrorUsuario("--desde tiene que ser una fecha AAAA-MM-DD.");
  if (positionals.length > (values["para-pegar"] ? 1 : 0)) throw new ErrorUsuario("Uso: rastro daily [--desde AAAA-MM-DD] [--para-pegar [tarea]]");
  const repos = reposObservados();
  if (values["para-pegar"]) {
    // Usa el último daily: regenerarlo cambiaría la bitácora y gastaría LLM solo para copiar texto.
    process.stdout.write(bloquesParaPegar(leerState(), positionals[0]));
    return 0;
  }
  const config = leerConfig();
  const ahora = new Date();
  const avisosFuentes: string[] = [];
  const informes: string[] = [];
  // Antes del snapshot, para que lea el plan que acaba de adoptar de Notion; en lectura: nunca publica.
  if (config.conectores.includes("notion")) {
    const lectura = await sincronizarEnLectura({ hoy: fechaLocal(ahora, config.zonaHoraria), notion: crearNotionPlan(config), modo: config.notion.modo });
    avisosFuentes.push(...lectura.avisos);
    informes.push(...lectura.informes);
  }
  const fuentes = leerFuentesDeRepos(config, repos, ahora, avisosFuentes);
  const { snapshot, avisos } = await generarSnapshot({
    repos,
    config,
    llm: crearLlm(config),
    ahora,
    fuentes,
    ...(values.desde === undefined ? {} : { desde: values.desde }),
  });
  guardarState(snapshot);
  for (const aviso of new Set([...avisosFuentes, ...avisos])) log("warn", "daily_degradado", { detalle: aviso });
  process.stdout.write(`${informes.map((l) => `${l}\n`).join("")}${informes.length === 0 ? "" : "\n"}${textoDelDia(snapshot)}`);
  return 0;
}
