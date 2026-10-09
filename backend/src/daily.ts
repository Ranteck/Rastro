import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { expandirHome, leerConfig, rutas, type Config } from "./config.ts";
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
import { calcularDesvios } from "./detectores/desvios.ts";
import { patronesDeComandos, patronesDePrompts, type Patron } from "./detectores/repeticiones.ts";
import { detectarPendientes, type CommitVinculado } from "./detectores/pendientes.ts";
import { vincularPorNombre, type Vinculo } from "./detectores/vinculo.ts";
import { ErrorUsuario } from "./errores.ts";
import { leerEventos, type Evento } from "./eventos.ts";
import { fechaLocal, horaLocal, lunesDe, sumarDias, type Fecha } from "./fechas.ts";
import { dirDeProyecto, leerTranscript, promptsDeTranscript, transcriptsRecientes, type PromptUsuario } from "./fuentes/claudeCode.ts";
import { parsearHistorialZsh, type Comando } from "./fuentes/zsh.ts";
import { ganttMock } from "./gantt.ts";
import { diffResumido, lineasAgregadas, raizDelRepo, recolectarGit, type Commit } from "./git.ts";
import { crearLlm } from "./llm/crear.ts";
import { ErrorLlm, type Llm } from "./llm/llm.ts";
import { pedidoBitacora, pedidoSugerencias, pedidoVinculos } from "./llm/usos.ts";
import { log } from "./log.ts";
import { parsearPlan } from "./plan.ts";
import { redactar } from "./redactar.ts";

export type ContextoDaily = {
  repo: string;
  config: Config;
  llm: Llm | null;
  ahora: Date;
  desde?: Fecha;
  fuentes?: { comandos: readonly Comando[]; prompts: readonly PromptUsuario[] };
};
export type ResultadoDaily = { snapshot: Snapshot; avisos: string[] };

type ItemBitacora = { entrada: EntradaBitacora; sha: string | null };

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

const RE_DOC = /^(?:docs\/|(?:.*\/)?README)/i;

export async function generarSnapshot(ctx: ContextoDaily): Promise<ResultadoDaily> {
  const { repo, config } = ctx;
  const zona = config.zonaHoraria;
  const hoy = fechaLocal(ctx.ahora, zona);
  const desde = ctx.desde ?? hoy;
  const inicio = desde < lunesDe(hoy) ? desde : lunesDe(hoy);
  const r = rutas(repo);
  const avisos: string[] = [];
  // Si el LLM falla una vez, no se vuelve a intentar en esta corrida.
  let llm = ctx.llm;

  const plan = existsSync(r.plan) ? parsearPlan(readFileSync(r.plan, "utf8"), hoy) : null;
  const tareas = plan?.tareas ?? [];
  const datos = recolectarGit(repo, sumarDias(inicio, -1));
  const { eventos, descartados } = leerEventos(r.eventos);
  if (descartados > 0) avisos.push(`Se descartaron ${descartados} eventos ilegibles de .rastro/events.jsonl.`);
  const ramaPorSha = new Map<string, string>();
  for (const e of eventos) if (e.tipo === "commit") ramaPorSha.set(e.sha, e.rama);

  const enRango = (c: Commit, d: Fecha): boolean => {
    const f = fechaLocal(c.fecha, zona);
    return f >= d && f <= hoy;
  };
  const vincular = (c: Commit): CommitVinculado => {
    const rama = ramaPorSha.get(c.sha) ?? c.rama;
    const tarea = vincularPorNombre({ rama, asunto: c.asunto, cuerpo: c.cuerpo }, tareas);
    return { ...c, rama, vinculo: tarea === null ? { tarea: null, tipo: "sin-tarea" } : { tarea, tipo: "nombre" } };
  };
  const deLaSemana = datos.commits.filter((c) => enRango(c, inicio));
  const merges = deLaSemana.filter((c) => c.padres.length > 1);
  let semana = deLaSemana.filter((c) => c.padres.length < 2).map(vincular);

  if (llm !== null && tareas.length > 0) {
    const sinTarea = semana.filter((c) => enRango(c, desde) && c.vinculo.tipo === "sin-tarea");
    const inferidos = await inferirVinculos(llm, sinTarea, tareas, avisos);
    if (inferidos === null) llm = null;
    else {
      semana = semana.map((c) => {
        const v = inferidos.get(c.sha);
        return v === undefined ? c : { ...c, vinculo: v };
      });
    }
  }
  const periodo = semana.filter((c) => enRango(c, desde));

  const evidenciaCommit = (sha: string): Evidencia =>
    datos.urlBase === null
      ? { tipo: "commit", ref: sha.slice(0, 7) }
      : { tipo: "commit", ref: sha.slice(0, 7), url: `${datos.urlBase}/commit/${sha}` };
  const pendientes = detectarPendientes({
    plan,
    commitsSemana: semana,
    commitsPeriodo: periodo,
    merges,
    ramas: datos.ramas,
    ramaPrincipal: datos.ramaPrincipal,
    lineasAgregadas: (sha) => lineasAgregadas(repo, sha),
    evidenciaCommit,
    ahora: ctx.ahora,
    ramaQuietaDias: config.umbrales.ramaQuietaDias,
  });
  const desvios = calcularDesvios({ plan, commitsPeriodo: periodo, commitsSemana: semana, umbralPct: config.umbrales.fueraDelPlanPct });

  const items: ItemBitacora[] = [
    ...periodo.map((c): ItemBitacora => ({ entrada: entradaDeCommit(c, zona, evidenciaCommit), sha: c.sha })),
    ...entradasDeSesiones(eventos, tareas, zona, desde, hoy, avisos).map((entrada): ItemBitacora => ({ entrada, sha: null })),
  ].sort((a, b) => `${b.entrada.fecha} ${b.entrada.hora}`.localeCompare(`${a.entrada.fecha} ${a.entrada.hora}`));

  const nombreDe = (slug: string): string => tareas.find((t) => t.slug === slug)?.nombre ?? slug;
  const sigue = [
    ...pendientes.map((p) => p.proximoPaso),
    ...desvios.tareasSinActividad.map((s) => `${nombreDe(s)} no tuvo actividad esta semana.`),
  ];
  let bitacora = items.map((i) => i.entrada);
  let resumen: Resumen | null = null;
  if (llm !== null) {
    const res = await resumirConLlm(llm, repo, plan, items, pendientes, desvios.tareasSinActividad.map(nombreDe), avisos);
    if (res === null) {
      llm = null;
    } else {
      bitacora = bitacora.map((e, i) => ({ ...e, texto: res.textos.get(i) ?? e.texto }));
      resumen = { ...res.resumen, sigue: [...new Set([...sigue, ...res.resumen.sigue])] };
    }
  }

  let sugerencias: Sugerencia[] = [];
  if (llm !== null && ctx.fuentes !== undefined) {
    const u = config.umbrales.repeticiones;
    const patrones = [...patronesDeComandos(ctx.fuentes.comandos, u, zona), ...patronesDePrompts(ctx.fuentes.prompts, u, zona)];
    sugerencias = await sugerirAutomatizaciones(llm, patrones, avisos);
  }

  const snapshot = validarSnapshot({
    schemaVersion: 1,
    generadoEn: ctx.ahora.toISOString(),
    persona: config.persona,
    repo: datos.urlBase === null ? { nombre: basename(repo) } : { nombre: basename(repo), url: datos.urlBase },
    periodo: { desde, hasta: hoy },
    plan,
    bitacora,
    pendientes,
    desvios,
    resumen,
    sugerencias,
    gantt: ganttMock(plan, semana, zona),
    costo: ctx.llm?.costo() ?? { llamadas: 0, usd: 0, tokens: 0 },
  });
  return { snapshot, avisos };
}

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
  // Solo el proyecto actual: leer las sesiones de otros proyectos sería vigilancia, no bitácora.
  const dirProyecto = join(expandirHome(config.fuentes.claudeProjects), dirDeProyecto(repo));
  const recientes = transcriptsRecientes(dirProyecto, desde);
  ilegibles += recientes.ilegibles;
  for (const t of recientes.rutas) {
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
  if (ilegibles > 0) avisos.push(`${ilegibles} líneas ilegibles en los transcripts de Claude Code.`);
  return { comandos, prompts };
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
  repo: string,
  plan: Plan | null,
  items: readonly ItemBitacora[],
  pendientes: readonly Pendiente[],
  sinActividad: string[],
  avisos: string[],
): Promise<{ textos: Map<number, string>; resumen: Resumen } | null> {
  let presupuesto = MAX_DIFF_TOTAL;
  const entradas = items.map((item, i) => {
    let diff = "";
    if (item.sha !== null && presupuesto > 0) {
      diff = diffResumido(repo, item.sha, Math.min(MAX_DIFF_POR_COMMIT, presupuesto));
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

function entradaDeCommit(c: CommitVinculado, zona: string, evidenciaCommit: (sha: string) => Evidencia): EntradaBitacora {
  return {
    fecha: fechaLocal(c.fecha, zona),
    hora: horaLocal(c.fecha, zona),
    tarea: c.vinculo.tarea,
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
      rama: e.rama ?? "(sin rama)",
      texto: titulo === null ? "Sesión de Claude Code." : `Sesión de Claude Code: ${titulo}.`,
      vinculo: tarea === null ? "sin-tarea" : "nombre",
      evidencia: [{ tipo: "sesion", ref: e.id.slice(0, 8) }],
    });
  }
  if (ilegibles > 0) avisos.push(`Se saltearon ${ilegibles} líneas ilegibles de transcripts de Claude Code.`);
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
    "Guardado en .rastro/state.json. Revisalo y publicalo con `rastro publish`.",
    "",
  );
  return l.join("\n");
}

export async function cmdDaily(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { desde: { type: "string" } } });
  if (values.desde !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(values.desde)) throw new ErrorUsuario("--desde tiene que ser una fecha AAAA-MM-DD.");
  const repo = raizDelRepo(process.cwd());
  const config = leerConfig(repo);
  const ahora = new Date();
  const avisosFuentes: string[] = [];
  const fuentes = leerFuentes(config, repo, ahora, avisosFuentes);
  const { snapshot, avisos } = await generarSnapshot({
    repo,
    config,
    llm: crearLlm(config),
    ahora,
    fuentes,
    ...(values.desde === undefined ? {} : { desde: values.desde }),
  });
  writeFileSync(rutas(repo).state, `${JSON.stringify(snapshot, null, 2)}\n`);
  for (const aviso of [...avisosFuentes, ...avisos]) log("warn", "daily_degradado", { detalle: aviso });
  process.stdout.write(textoDelDia(snapshot));
  return 0;
}
