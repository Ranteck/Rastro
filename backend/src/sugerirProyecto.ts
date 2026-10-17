import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { aplicarYRecalcular } from "./daily.ts";
import { guardarBase, guardarOfrecimientos, leerOfrecimientos } from "./cambios.ts";
import { leerConfig, rutasGlobales, type Config } from "./config.ts";
import type { Tarea } from "./contract/snapshot.ts";
import { vincularPorNombre } from "./detectores/vinculo.ts";
import { ErrorUsuario } from "./errores.ts";
import { ddmm, fechaLocal, lunesDe, lunesQueViene, type Fecha } from "./fechas.ts";
import { git, raizDelRepo, tieneCommits } from "./git.ts";
import { crearLlm } from "./llm/crear.ts";
import type { Llm } from "./llm/llm.ts";
import { pedidoDesdeProyecto } from "./llm/usos.ts";
import { confirmarPlan, conLlm, conservarDeOtrosRepos, propuestaDeOtraSemana, tareasValidas, textoDeConfirmacion, textoDeDescartada, type PropuestaDescartada } from "./planCmd.ts";
import { parsearPlan, renderizarPlan, textoDuracion, type TareaARenderizar } from "./plan.ts";
import { conReparto } from "./reparto.ts";
import { exigirRegistrado, nombreRegistrado } from "./repos.ts";
import { slugDe } from "./texto.ts";

const USO = "Uso: rastro plan --desde-proyecto [--propuesta <archivo>] [--semana-que-viene] | rastro plan --desde-proyecto --confirmar [--semana-que-viene]";
const MAX_COMMITS = 50;
const MAX_CASILLAS = 100;
const MAX_TAREAS = 12;
// Por debajo de esto el nombre es tan genérico que cualquier texto lo "nombra".
const MIN_SLUG_EVIDENCIA = 3;
const RAIZ = "proyecto";

type EstadoDoc = "borrador" | "aceptado" | "sin-estado";
type Documentos = { intent: EstadoDoc | null; spec: EstadoDoc | null; plan: EstadoDoc | null };
type Feature = Documentos & { slug: string; etiqueta: string };
type Casilla = { texto: string; marcada: boolean };
type Paso = { nombre: string; objetivo: string };

export type TareaDeProyecto = {
  nombre: string;
  objetivo: string;
  duracion: Tarea["duracion"];
  estado: "hecha" | "pendiente";
  enCurso: boolean;
  porque: string;
  /** Por qué una tarea que el LLM dio por hecha quedó pendiente. */
  nota?: string;
};

export type ResultadoProyecto =
  | { tipo: "nada" }
  | { tipo: "propuesta"; tareas: TareaDeProyecto[]; pasos: TareaDeProyecto[]; archivo: string; reemplazo: boolean; conservadas: string[]; descartada?: PropuestaDescartada }
  | { tipo: "ofrecimientos"; tareas: TareaDeProyecto[]; pasos: TareaDeProyecto[]; archivo: string; nuevas: number; repetidas: number };

/** lstat y no stat: un symlink dentro del repo podría apuntar a un archivo de afuera, y su contenido iría al LLM. */
const esArchivo = (ruta: string): boolean => existsSync(ruta) && lstatSync(ruta).isFile();
const esCarpeta = (ruta: string): boolean => existsSync(ruta) && lstatSync(ruta).isDirectory();

/** Texto de un LLM o de un archivo que se imprime: una línea, sin caracteres de control. */
const plano = (texto: string): string => texto.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();

function estadoDe(archivo: string): EstadoDoc | null {
  if (!esArchivo(archivo)) return null;
  const m = /(?:^|·\s*)Estado:\s*(borrador|aceptado)\b/im.exec(readFileSync(archivo, "utf8"));
  return m?.[1] === undefined ? "sin-estado" : (m[1].toLowerCase() as EstadoDoc);
}

function documentosDe(dir: string): Documentos {
  return { intent: estadoDe(join(dir, "intent.md")), spec: estadoDe(join(dir, "spec.md")), plan: estadoDe(join(dir, "plan.md")) };
}

const hayAlgo = (d: Documentos): boolean => d.intent !== null || d.spec !== null || d.plan !== null;

/** La raíz cuenta como una feature más. */
function leerFeatures(repo: string): { features: Feature[]; casillas: Casilla[] } {
  const base = join(repo, "intent");
  if (!esCarpeta(base)) return { features: [], casillas: [] };
  const lugares = [{ dir: base, slug: RAIZ, etiqueta: RAIZ }];
  // Un slug repetido (Foo y foo, o una carpeta llamada como la raíz) se queda con el primero: dos features darían pasos con el mismo nombre.
  const vistos = new Set([RAIZ]);
  for (const nombre of readdirSync(base).sort()) {
    const slug = slugDe(nombre);
    if (slug === "" || vistos.has(slug) || !esCarpeta(join(base, nombre))) continue;
    vistos.add(slug);
    lugares.push({ dir: join(base, nombre), slug, etiqueta: nombre });
  }
  const features: Feature[] = [];
  const casillas: Casilla[] = [];
  for (const l of lugares) {
    const docs = documentosDe(l.dir);
    if (!hayAlgo(docs)) continue;
    features.push({ ...docs, slug: l.slug, etiqueta: l.etiqueta });
    const plan = join(l.dir, "plan.md");
    if (esArchivo(plan)) {
      for (const linea of readFileSync(plan, "utf8").split(/\r?\n/)) {
        const m = /^\s*- \[([ xX])\]\s+(.+?)\s*$/.exec(linea);
        if (m?.[2] !== undefined) casillas.push({ texto: m[2], marcada: m[1] !== " " });
      }
    }
  }
  return { features, casillas };
}

/** El primer archivo que exista: el pedido, `propuesta*.md` en la raíz, o el de docs/ y Docs/. */
function leerPropuesta(repo: string, pedida: string | undefined): string | null {
  if (pedida !== undefined) {
    if (!existsSync(pedida)) throw new ErrorUsuario(`No existe ${pedida}.`);
    // Lo pedido a mano puede ser cualquier ruta (también un symlink), pero tiene que ser un archivo.
    if (!statSync(pedida).isFile()) throw new ErrorUsuario(`${pedida} no es un archivo.`);
    return readFileSync(pedida, "utf8");
  }
  for (const carpeta of [".", "docs", "Docs"]) {
    const dir = join(repo, carpeta);
    if (!esCarpeta(dir)) continue;
    const archivo = readdirSync(dir).sort().find((n) => /^propuesta.*\.md$/i.test(n) && esArchivo(join(dir, n)));
    if (archivo !== undefined) return readFileSync(join(dir, archivo), "utf8");
  }
  return null;
}

function asuntosRecientes(repo: string): string[] {
  // Un repo sin commits todavía no tiene asuntos; no es un error. Cualquier otro fallo de git sube.
  if (!tieneCommits(repo)) return [];
  return git(repo, ["log", `-${MAX_COMMITS}`, "--no-merges", "--format=%s"]).split("\n").map((l) => l.trim()).filter((l) => l !== "");
}

/** Lo que falta de la cadena intent -> spec -> plan de cada feature, sin LLM. */
function pasosDelProceso(features: readonly Feature[]): Paso[] {
  const pasos: Paso[] = [];
  for (const f of features) {
    const paso = (verbo: string, doc: string): void => {
      pasos.push({ nombre: `${verbo} ${doc} ${f.slug}`, objetivo: `${verbo} el ${doc} de ${f.etiqueta}` });
    };
    if (f.intent === "borrador") paso("Aprobar", "intent");
    if (f.intent === "aceptado" && f.spec === null) paso("Escribir", "spec");
    if (f.spec === "borrador") paso("Aprobar", "spec");
    if (f.spec === "aceptado" && f.plan === null) paso("Armar", "plan");
    if (f.plan === "borrador") paso("Aprobar", "plan");
  }
  return pasos;
}

/** Hecha solo con evidencia determinística: un commit que la nombra (la misma regla que el vínculo) o una casilla marcada. */
function hayEvidencia(nombre: string, asuntos: readonly string[], casillas: readonly Casilla[]): boolean {
  const slug = slugDe(nombre);
  if (slug.length < MIN_SLUG_EVIDENCIA) return false;
  const tarea: Tarea = { slug, nombre, objetivo: "", estado: "pendiente", duracion: null, dias: [], noEntra: false, repo: null };
  if (asuntos.some((asunto) => vincularPorNombre({ rama: "", asunto, cuerpo: "" }, [tarea]) !== null)) return true;
  // La casilla tiene que ser la tarea (o "Nombre: detalle"), no mencionarla: "Configurar base de datos" no prueba que "Datos" esté hecha.
  return casillas.some((c) => c.marcada && [c.texto, c.texto.split(/[:—]/)[0] ?? ""].some((t) => slugDe(t.replaceAll("*", "")) === slug));
}

type DeLlm = { nombre: string; objetivo: string; duracion: Tarea["duracion"]; estado: "hecha" | "en-curso" | "pendiente"; porque: string };

function conEvidencia(t: DeLlm, asuntos: readonly string[], casillas: readonly Casilla[]): TareaDeProyecto {
  const base = { nombre: plano(t.nombre), objetivo: plano(t.objetivo), duracion: t.duracion, porque: plano(t.porque) };
  if (t.estado === "hecha") {
    return hayEvidencia(t.nombre, asuntos, casillas)
      ? { ...base, estado: "hecha", enCurso: false }
      : { ...base, estado: "pendiente", enCurso: false, nota: "el LLM la dio por hecha, pero ningún commit ni casilla marcada la nombra: queda pendiente" };
  }
  return { ...base, estado: "pendiente", enCurso: t.estado === "en-curso" };
}

export async function sugerirDesdeProyecto(o: { repo: string; config: Config; llm: Llm | null; ahora: Date; propuesta?: string; semanaQueViene?: boolean }): Promise<ResultadoProyecto> {
  const nombreRepo = exigirRegistrado(o.repo);
  const propuesta = leerPropuesta(o.repo, o.propuesta);
  const { features, casillas } = leerFeatures(o.repo);
  if (propuesta === null && features.length === 0) return { tipo: "nada" };
  if (o.llm === null) throw new ErrorUsuario(`El plan necesita un LLM: configurá llm.proveedor en ${rutasGlobales().config}.`);
  const asuntos = asuntosRecientes(o.repo);
  const procesos = pasosDelProceso(features);
  const res = await conLlm(
    o.llm,
    pedidoDesdeProyecto({
      propuesta,
      sdlc: features.map((f) => ({ feature: f.etiqueta, intent: f.intent, spec: f.spec, plan: f.plan })),
      casillas: casillas.slice(0, MAX_CASILLAS),
      commits: asuntos,
      pasosDelProceso: procesos,
    }),
    "sugerir tareas desde el proyecto",
  );
  const propuestas = tareasValidas(res.tareas);
  const slugsDePasos = new Set(procesos.map((p) => slugDe(p.nombre)));
  const tareas = propuestas.filter((t) => !slugsDePasos.has(slugDe(t.nombre))).slice(0, MAX_TAREAS).map((t) => conEvidencia(t, asuntos, casillas));
  if (tareas.length === 0 && procesos.length === 0) throw new ErrorUsuario("El LLM no devolvió tareas válidas: probá de nuevo o armá el plan a mano.");
  // Un paso del proceso no depende del LLM: si no lo estimó, entra igual, sin duración.
  const pasos: TareaDeProyecto[] = procesos.map((p) => {
    const estimado = propuestas.find((t) => slugDe(t.nombre) === slugDe(p.nombre));
    return { nombre: p.nombre, objetivo: p.objetivo, duracion: estimado?.duracion ?? null, estado: "pendiente", enCurso: false, porque: "Falta en la cadena intent, spec y plan." };
  });
  const todas = [...tareas, ...pasos];
  const r = rutasGlobales();
  const hoyReal = fechaLocal(o.ahora, o.config.zonaHoraria);
  const hoy = o.semanaQueViene === true ? lunesQueViene(hoyReal) : hoyReal;
  // Los ofrecimientos se aceptan sobre el plan de esta semana: para la que viene siempre se arma una propuesta, que `--confirmar` fusiona con lo que ya haya.
  const vigente = o.semanaQueViene === true || !existsSync(r.plan) ? null : parsearPlan(readFileSync(r.plan, "utf8"), hoy);
  return vigente === null
    ? armarPropuesta({ repo: nombreRepo, config: o.config, hoy, entregable: res.entregable, tareas, pasos })
    : guardarComoOfrecimientos({ repo: nombreRepo, enPlan: new Set(vigente.tareas.map((t) => t.slug)), tareas, pasos, todas });
}

/** Solo se reemplazan las tareas de `o.repo` en la propuesta de la semana: las de otros repos se conservan (ver `conservarDeOtrosRepos`). */
function armarPropuesta(o: { repo: string; config: Config; hoy: Fecha; entregable: string; tareas: TareaDeProyecto[]; pasos: TareaDeProyecto[] }): ResultadoProyecto {
  const r = rutasGlobales();
  const semana = lunesDe(o.hoy);
  const nuevas: TareaARenderizar[] = [...o.tareas, ...o.pasos].map((t) => ({ nombre: t.nombre, objetivo: t.objetivo, duracion: t.duracion, estado: t.estado, repo: o.repo }));
  const otras = conservarDeOtrosRepos(semana, o.repo, new Set(nuevas.map((t) => slugDe(t.nombre))));
  const descartada = propuestaDeOtraSemana(semana);
  const repartidas = conReparto({ desde: semana, semana, config: o.config, tareas: [...otras.tareas, ...nuevas], fijadas: otras.fijadas });
  mkdirSync(r.dir, { recursive: true });
  const reemplazo = existsSync(r.planSugerido);
  const md = renderizarPlan(semana, o.entregable, repartidas);
  writeFileSync(r.planSugerido, md);
  // La base sale de releer lo escrito, como en armarPlan, para que --confirmar vea los mismos slugs.
  guardarBase(semana, parsearPlan(md, semana)?.tareas ?? []);
  return { tipo: "propuesta", tareas: o.tareas, pasos: o.pasos, archivo: r.planSugerido, reemplazo, conservadas: otras.tareas.map((t) => t.nombre), ...(descartada === null ? {} : { descartada }) };
}

function guardarComoOfrecimientos(o: { repo: string; enPlan: ReadonlySet<string>; tareas: TareaDeProyecto[]; pasos: TareaDeProyecto[]; todas: TareaDeProyecto[] }): ResultadoProyecto {
  const r = rutasGlobales();
  const guardados = leerOfrecimientos();
  // Los descartados cuentan: un ofrecimiento descartado no vuelve a proponerse con el mismo slug.
  const conocidos = new Set([...o.enPlan, ...guardados.map((g) => g.id)]);
  const nuevos = o.todas
    .filter((t) => {
      const id = slugDe(t.nombre);
      if (conocidos.has(id)) return false;
      conocidos.add(id);
      return true;
    })
    .map((t) => ({ id: slugDe(t.nombre), nombre: t.nombre, objetivo: t.objetivo.trim(), duracion: t.duracion, porque: t.porque, estado: "pendiente" as const, repo: o.repo, estadoSugerido: t.estado }));
  if (nuevos.length > 0) guardarOfrecimientos([...guardados, ...nuevos]);
  return { tipo: "ofrecimientos", tareas: o.tareas, pasos: o.pasos, archivo: r.ofrecimientos, nuevas: nuevos.length, repetidas: o.todas.length - nuevos.length };
}

const conDuracion = (t: TareaDeProyecto): string => (t.duracion === null ? "sin duración" : textoDuracion(t.duracion));

function seccion(titulo: string, tareas: readonly TareaDeProyecto[], detalle: (t: TareaDeProyecto) => string): string[] {
  if (tareas.length === 0) return [];
  const ancho = Math.max(...tareas.map((t) => t.nombre.length));
  return [`${titulo}:`, ...tareas.map((t) => `  ${t.nombre.padEnd(ancho)}  ${detalle(t)}`)];
}

export function textoDeProyecto(r: Exclude<ResultadoProyecto, { tipo: "nada" }>, semanaQueViene?: Fecha): string {
  const hechas = r.tareas.filter((t) => t.estado === "hecha");
  const enCurso = r.tareas.filter((t) => t.enCurso);
  const vienen = r.tareas.filter((t) => t.estado === "pendiente" && !t.enCurso);
  const tabla = [
    ...seccion("Hecho", hechas, (t) => t.porque),
    ...seccion("En curso", enCurso, (t) => `${conDuracion(t)} · en curso`),
    ...seccion("Lo que viene", vienen, (t) => `${conDuracion(t)}${t.nota === undefined ? "" : ` (${t.nota})`}`),
    ...seccion("Falta del proceso", r.pasos, conDuracion),
  ].join("\n");
  const cierre =
    r.tipo === "propuesta"
      ? `${r.descartada !== undefined ? textoDeDescartada(r.descartada) : r.reemplazo ? `Se reemplazó la propuesta anterior${r.conservadas.length === 0 ? "" : `; se conservaron sus tareas de otros repos: ${r.conservadas.join(", ")}`}.\n` : ""}Propuesta de plan${semanaQueViene === undefined ? "" : ` de la semana que viene (${ddmm(semanaQueViene)})`} en ${r.archivo} (plan.md no se tocó). Revisala y confirmá con \`rastro plan --desde-proyecto --confirmar${semanaQueViene === undefined ? "" : " --semana-que-viene"}\`.`
      : r.nuevas === 0
        ? "No hay tareas nuevas: todas están ya en el plan o ya se ofrecieron."
        : `Se guardaron ${r.nuevas} ofrecimientos en ${r.archivo}${r.repetidas > 0 ? ` (${r.repetidas} ya estaban en el plan o se habían ofrecido)` : ""}; el plan no cambió. Aceptalos todos con \`rastro plan --desde-proyecto --confirmar\` o de a uno con \`rastro plan cambiar ofrecimiento <id> aceptar --confirmar\`.`;
  return `${tabla}\n${cierre}\n`;
}

/** Acepta los ofrecimientos pendientes de este repo; los demás repos y los ya presentes en el plan no se tocan. */
export function aceptarOfrecimientosDelRepo(o: { repo: string; config: Config; hoy: Fecha }): string {
  const nombre = exigirRegistrado(o.repo);
  const r = rutasGlobales();
  const vigente = existsSync(r.plan) ? parsearPlan(readFileSync(r.plan, "utf8"), o.hoy) : null;
  const pendientes = leerOfrecimientos().filter((x) => x.estado === "pendiente" && x.repo === nombre && !(vigente?.tareas ?? []).some((t) => t.slug === x.id));
  if (pendientes.length === 0) return `No hay ofrecimientos pendientes de ${nombre}.\n`;
  if (vigente === null) throw new ErrorUsuario("No hay plan vigente esta semana: confirmá antes la propuesta con `rastro plan --confirmar`.");
  const res = aplicarYRecalcular({
    repos: [o.repo],
    config: o.config,
    cambios: pendientes.map((x) => ({ tipo: "ofrecimiento" as const, id: x.id, accion: "aceptar" as const })),
    destino: "vigente",
    confirmar: true,
    hoy: o.hoy,
  });
  return `Se sumaron ${pendientes.length} tareas de ${nombre} al plan:\n${res.vistaPrevia.map((l) => `  ${l}`).join("\n")}\n${res.aviso === undefined ? "" : `${res.aviso}\n`}`;
}

/**
 * Confirma lo que quedó pendiente: sin plan vigente, la propuesta de la semana (de `--desde-proyecto` o de `plan <propuesta.md>`),
 * solo si todas sus tareas son de repos registrados, este u otros; una con tareas sin repo (escrita a mano) o de un repo que ya no está registrado
 * se confirma con `rastro plan --confirmar`. Con plan vigente, los ofrecimientos pendientes de este repo.
 */
export function confirmarDesdeProyecto(o: { repo: string; config: Config; hoy: Fecha; semanaQueViene?: boolean }): string {
  const nombre = exigirRegistrado(o.repo);
  const r = rutasGlobales();
  const queViene = o.semanaQueViene === true;
  // Para la semana que viene siempre manda la propuesta, aunque ya haya un plan: confirmarPlan lo fusiona. Los ofrecimientos son del plan de esta semana.
  const hayVigente = !queViene && existsSync(r.plan) && parsearPlan(readFileSync(r.plan, "utf8"), o.hoy) !== null;
  if (queViene && !existsSync(r.planSugerido)) {
    throw new ErrorUsuario("No hay una propuesta para la semana que viene: armala con `rastro plan --desde-proyecto --semana-que-viene`.");
  }
  if (!hayVigente && existsSync(r.planSugerido)) {
    const propuesta = parsearPlan(readFileSync(r.planSugerido, "utf8"), o.hoy);
    if (propuesta !== null && propuesta.tareas.length > 0 && propuesta.tareas.every((t) => t.repo !== null && nombreRegistrado(t.repo))) {
      return textoDeConfirmacion(confirmarPlan({ config: o.config, hoy: o.hoy, deLaQueViene: queViene }), queViene);
    }
    // Una propuesta con tareas sin repo o de un repo no registrado no se confirma desde acá; sin ofrecimientos propios, avisar que existe y cómo confirmarla.
    if (propuesta !== null && (queViene || !leerOfrecimientos().some((x) => x.estado === "pendiente" && x.repo === nombre))) {
      return `${queViene ? "" : `No hay ofrecimientos pendientes de ${nombre}.\n`}Hay una propuesta de plan sin confirmar en ${r.planSugerido}: se confirma con \`rastro plan --confirmar${queViene ? " --semana-que-viene" : ""}\`.\n`;
    }
  }
  if (queViene) throw new ErrorUsuario("La propuesta guardada no es de la semana que viene: armala con `rastro plan --desde-proyecto --semana-que-viene`.");
  return aceptarOfrecimientosDelRepo(o);
}

export async function cmdDesdeProyecto(args: string[], deps: { llm?: Llm | null } = {}): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { "desde-proyecto": { type: "boolean", default: false }, confirmar: { type: "boolean", default: false }, propuesta: { type: "string" }, "semana-que-viene": { type: "boolean", default: false } },
  });
  if (positionals.length > 0) throw new ErrorUsuario(USO);
  const repo = raizDelRepo(process.cwd());
  exigirRegistrado(repo);
  const config = leerConfig();
  const queViene = values["semana-que-viene"];
  if (values.confirmar) {
    if (values.propuesta !== undefined) throw new ErrorUsuario(USO);
    const hoy = fechaLocal(new Date(), config.zonaHoraria);
    process.stdout.write(confirmarDesdeProyecto({ repo, config, hoy: queViene ? lunesQueViene(hoy) : hoy, semanaQueViene: queViene }));
    return 0;
  }
  // El LLM se exige recién cuando hay algo que consultarle: sin propuesta ni intent/ no hace falta.
  const ahora = new Date();
  const r = await sugerirDesdeProyecto({ repo, config, llm: deps.llm === undefined ? crearLlm(config) : deps.llm, ahora, semanaQueViene: queViene, ...(values.propuesta === undefined ? {} : { propuesta: values.propuesta }) });
  const semana = queViene ? lunesQueViene(fechaLocal(ahora, config.zonaHoraria)) : undefined;
  process.stdout.write(r.tipo === "nada" ? "No encontré de dónde sacar tareas: ni una propuesta (propuesta*.md, docs/ o Docs/) ni la carpeta intent/.\n" : textoDeProyecto(r, semana));
  return 0;
}
