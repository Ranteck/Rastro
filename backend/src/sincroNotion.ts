import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { aplicarCambios } from "./cambios.ts";
import { rutasGlobales, type Config } from "./config.ts";
import { bloquePlan, ConectorNotionClaude, ConectorNotionMock, permisosAProhibir } from "./conectores/notion.ts";
import type { Cambio } from "./contract/cambios.ts";
import { validarSnapshot, type Plan, type Snapshot, type Tarea } from "./contract/snapshot.ts";
import { bool, desconocido, ErrorValidacion, objAbierto, str } from "./contract/validar.ts";
import { ErrorUsuario } from "./errores.ts";
import { ddmm, lunesQueViene, type Fecha } from "./fechas.ts";
import { bloquesDeExtraccion, checkExtraccion, ESQUEMA_EXTRACCION, instruccionDeExtraccion } from "./extraerPlanNotion.ts";
import { ejecutarProceso, type Ejecutor } from "./llm/claudeCli.ts";
import { ErrorLlm, type Llm } from "./llm/llm.ts";
import { pedidoDuraciones } from "./llm/usos.ts";
import { guardarPublicado, guardarPublicadoDeLaQueViene, huellaDelPlan } from "./publicado.ts";
import { fusionarSeccion, parsearPlan, renderizarPlan, textoDias, textoDuracion } from "./plan.ts";
import { redactar } from "./redactar.ts";
import { nombreRegistrado, nombresRegistrados } from "./repos.ts";
import { cantidad } from "./texto.ts";

export type OpcionesLectura = {
  /** El plan que Rastro ya conoce de esta semana: la extracción devuelve los mismos nombres y valores cuando la página no dice otra cosa. */
  conocido?: Plan | null;
  /** Lo mismo para la semana que viene. */
  conocidoProxima?: Plan | null;
  /** Los nombres de los repos registrados: se leen antes y afuera, para que un registro ilegible no se atribuya a Notion. */
  repos?: readonly string[];
  /** Recibe lo que no se pudo leer de la página y quedó sin valor. */
  avisar?: (aviso: string) => void;
};

/** Lo único que Rastro le pide a Notion para el plan: leer el plan de la semana y publicar los cambios. */
export type NotionPlan = {
  /**
   * El plan de la semana de `hoy` y el de la que viene, normalizados como bloques `## Plan semana DD/MM` (uno por semana que la página tenga),
   * sea cual sea el formato de la página, o null si no hay ninguno. Lanza si no puede leer.
   */
  leer(hoy: Fecha, o?: OpcionesLectura): Promise<string | null>;
  publicar(s: Snapshot, o?: { cambiosPlan?: readonly string[] }): Promise<string>;
};

// Solo lectura: la misma skill y el mismo fetch que al publicar, más la búsqueda, y ninguna herramienta que escriba.
const PERMITIDAS_LECTURA = ["Skill(daily-flock)", "mcp__claude_ai_Notion__notion-fetch", "mcp__claude_ai_Notion__notion-search"];
const TIMEOUT_LECTURA_MS = 180_000;

const checkSalidaLectura = objAbierto({ is_error: bool }, { result: str, structured_output: desconocido });

function instruccionDeLectura(hoy: Fecha, pagina: string | undefined, repos: readonly string[], conocido: Plan | null, conocidoProxima: Plan | null): string {
  const donde =
    pagina === undefined
      ? "Usá la skill daily-flock (Flujo B: ver el plan de la semana) para leer la página Daily de Notion."
      : `Usá notion-fetch para leer la página ${pagina} de Notion. No uses la skill daily-flock.`;
  return instruccionDeExtraccion({ donde, hoy, repos, conocido, conocidoProxima });
}

async function leerConClaude(o: { modelo: string; ejecutar: Ejecutor; home: string; pagina: string | undefined; hoy: Fecha } & OpcionesLectura): Promise<string | null> {
  // Mismas protecciones que ConectorNotionClaude: sin --strict-mcp-config (necesita el conector de Notion de claude.ai),
  // con --permission-mode dontAsk y los permisos globales del usuario prohibidos, porque --allowedTools solo preaprueba.
  const prohibidas = permisosAProhibir(o.home, PERMITIDAS_LECTURA);
  const args = [
    "-p", "--output-format", "json", "--model", o.modelo, "--no-session-persistence",
    "--tools", "Skill", "--permission-mode", "dontAsk", "--setting-sources", "user",
    "--json-schema", JSON.stringify(ESQUEMA_EXTRACCION), "--allowedTools", PERMITIDAS_LECTURA.join(","),
    ...(prohibidas.length > 0 ? ["--disallowedTools", prohibidas.join(",")] : []),
  ];
  // En el directorio temporal del sistema: no es de ningún repo (no carga sus settings ni su hook) ni deja nada en ~/.cache.
  const cwd = mkdtempSync(join(tmpdir(), "rastro-notion-"));
  try {
    const repos = o.repos ?? [];
    const r = await o.ejecutar("claude", args, instruccionDeLectura(o.hoy, o.pagina, repos, o.conocido ?? null, o.conocidoProxima ?? null), TIMEOUT_LECTURA_MS, cwd);
    if (r.codigo !== 0) throw new ErrorLlm(`claude salió con ${String(r.codigo)}: ${r.stderr.slice(0, 200)}`);
    const salida = checkSalidaLectura(JSON.parse(r.stdout), "claude");
    if (salida.is_error) throw new ErrorLlm(`claude no pudo leer Notion: ${(salida.result ?? "").slice(0, 200)}`);
    if (salida.structured_output === undefined) throw new ErrorLlm("claude respondió sin salida estructurada");
    // Lo que contesta el LLM es dato no confiable: se valida y se normaliza antes de comparar nada.
    return bloquesDeExtraccion(checkExtraccion(salida.structured_output, "plan"), { hoy: o.hoy, repos, avisar: o.avisar ?? (() => undefined) });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

/** En modo mock el "Notion" es el archivo de vista previa que escribe el conector mock al publicar: así se prueba sin red. */
export function crearNotionPlan(config: Config, o: { ejecutar?: Ejecutor; home?: string } = {}): NotionPlan {
  const { pagina } = config.notion;
  if (config.notion.modo === "mock") {
    const archivo = rutasGlobales().notionPreview;
    const mock = new ConectorNotionMock(archivo);
    // El mock lee y escribe el bloque en el formato de Rastro, sin LLM: la extracción es solo del modo claude.
    return { leer: async () => (existsSync(archivo) ? readFileSync(archivo, "utf8") : null), publicar: (s) => mock.publicar(s, { conPlan: true }) };
  }
  const ejecutar = o.ejecutar ?? ejecutarProceso;
  const home = o.home ?? homedir();
  const conector = new ConectorNotionClaude({ modelo: config.llm.modelo, ejecutar, home, ...(pagina === undefined ? {} : { pagina }) });
  return {
    leer: (hoy, opciones = {}) => leerConClaude({ modelo: config.llm.modelo, ejecutar, home, pagina, hoy, ...opciones }),
    publicar: (s, o) => conector.publicar(s, { conPlan: true, ...(o?.cambiosPlan === undefined ? {} : { cambiosPlan: o.cambiosPlan }) }),
  };
}

const normalizado = (plan: Plan | null): string => (plan === null || plan.tareas.length === 0 ? "" : renderizarPlan(plan.semana, plan.entregable, plan.tareas));

function leerLocal(hoy: Fecha): Plan | null {
  const archivo = rutasGlobales().plan;
  return existsSync(archivo) ? parsearPlan(readFileSync(archivo, "utf8"), hoy) : null;
}

function leerBase(hoy: Fecha): Plan | null {
  const archivo = rutasGlobales().notionBase;
  if (!existsSync(archivo)) return null;
  try {
    return parsearPlan(readFileSync(archivo, "utf8"), hoy);
  } catch (e) {
    // parsearPlan habla de "plan.md": acá el archivo que falla es la base.
    if (e instanceof ErrorUsuario) throw new ErrorUsuario(`${archivo} no se puede leer (${motivoDe(e).replace(/^plan\.md /, "")}): borralo y la próxima sincronización lo rehace.`, { cause: e });
    throw e;
  }
}

/** Una sección por semana, como plan.md: la base de la semana que viene no pisa la de esta ni al revés. */
export function guardarBaseNotion(plan: Plan): void {
  const r = rutasGlobales();
  mkdirSync(r.dir, { recursive: true });
  const actual = existsSync(r.notionBase) ? readFileSync(r.notionBase, "utf8") : "";
  writeFileSync(r.notionBase, fusionarSeccion(actual, plan.semana, normalizado(plan)));
}

/** Los fallos esperables de leer Notion se avisan y se sigue con la copia local; un error de programación sigue subiendo. */
function esFalloDeNotion(e: unknown): e is Error {
  return e instanceof ErrorUsuario || e instanceof ErrorLlm || e instanceof ErrorValidacion || e instanceof SyntaxError || (e instanceof Error && typeof (e as NodeJS.ErrnoException).code === "string");
}

const motivoDe = (e: Error): string => redactar(e.message).replace(/\s+/g, " ").slice(0, 200);

export type EstadoSync = "iguales" | "notion" | "rastro" | "ambos";

/** `notion` es el plan de Notion completado con el local (lo que se compara y se adopta); `publicable`, el que sale de la página (lo que se publica). `hoy` es un día de la semana evaluada. */
type Evaluacion = { estado: EstadoSync; notion: Plan | null; publicable: Plan | null; local: Plan | null; hoy: Fecha };

/** Cada semana se evalúa por separado: su plan local, su base y su plan de Notion no dependen de los de la otra. */
type Semana = Evaluacion | { repetidas: string };

/** Los nombres que se repiten en el plan, con cuántas veces: dos tareas con el mismo slug no se pueden comparar ni adoptar. */
function nombresRepetidos(plan: Plan): string[] {
  const porSlug = new Map<string, { nombre: string; veces: number }>();
  for (const t of plan.tareas) {
    const previa = porSlug.get(t.slug);
    porSlug.set(t.slug, { nombre: previa?.nombre ?? t.nombre, veces: (previa?.veces ?? 0) + 1 });
  }
  return [...porSlug.values()].filter((x) => x.veces > 1).map((x) => `${x.nombre} (${String(x.veces)} veces)`);
}

/**
 * Lo que la lectura de Notion no dice no es un cambio: el objetivo (el LLM lo reformula en cada lectura) no se compara, y una duración,
 * unos días o un repo que la página no trae valen lo que tiene `referencia`. Solo un valor de Notion que difiere cuenta.
 * Las tareas que `referencia` no tiene entran como las extrajo el LLM.
 */
function completarCon(notion: Plan, referencia: Plan | null): Plan {
  if (referencia === null) return notion;
  const tareas = notion.tareas.map((t): Tarea => {
    const propia = referencia.tareas.find((x) => x.slug === t.slug);
    if (propia === undefined) return t;
    const sinDias = t.dias.length === 0 && !t.noEntra;
    return {
      ...t,
      objetivo: propia.objetivo,
      duracion: t.duracion ?? propia.duracion,
      dias: sinDias ? propia.dias : t.dias,
      noEntra: sinDias ? propia.noEntra : t.noEntra,
      repo: t.repo ?? propia.repo,
    };
  });
  return { ...notion, entregable: notion.entregable === "" ? referencia.entregable : notion.entregable, tareas };
}

/** Lo que se le pide a Notion al publicar se calcula contra lo que la página dice, pero sin tomar por cambio el objetivo reformulado. */
function conObjetivosDe(notion: Plan, local: Plan): Plan {
  return { ...notion, tareas: notion.tareas.map((t) => ({ ...t, objetivo: local.tareas.find((x) => x.slug === t.slug)?.objetivo ?? t.objetivo })) };
}

/** Compara el plan de Notion de una semana con el local y con la base de esa misma semana. */
function evaluarSemana(o: { delNotion: Plan | null; hoy: Fecha; local: Plan | null; base: Plan | null; deLaQueViene: boolean }): Semana {
  const { delNotion, local, base } = o;
  const repetidas = delNotion === null ? [] : nombresRepetidos(delNotion);
  if (repetidas.length > 0) {
    return { repetidas: `El plan de Notion${o.deLaQueViene ? " de la semana que viene" : ""} tiene varias tareas con el mismo nombre: ${repetidas.join(", ")}. Rastro necesita un nombre por tarea; no lo adopto ni lo comparo y sigo con el plan local, sin escribir nada.` };
  }
  // Contra el local, para adoptar y para ver si los dos lados son iguales; contra la base, para saber si Notion cambió desde la última sincronización.
  const alLado = delNotion === null ? null : completarCon(delNotion, local);
  const n = normalizado(alLado);
  const l = normalizado(local);
  const b = normalizado(base);
  const publicable = delNotion === null || local === null ? delNotion : conObjetivosDe(delNotion, local);
  const evaluacion = (estado: EstadoSync): Evaluacion => ({ estado, notion: alLado, publicable, local, hoy: o.hoy });
  if (n === l) {
    // Los dos lados quedaron iguales: es la última versión sincronizada.
    if (local !== null && l !== b && l !== "") guardarBaseNotion(local);
    return evaluacion("iguales");
  }
  // Un lado sin plan nunca es "borrado": el otro lado lo completa.
  if (n === "") return evaluacion("rastro");
  if (l === "") return evaluacion("notion");
  const cambioNotion = normalizado(delNotion === null ? null : completarCon(delNotion, base)) !== b;
  const cambioLocal = l !== b;
  return evaluacion(cambioNotion && cambioLocal ? "ambos" : cambioNotion ? "notion" : "rastro");
}

/** Esta semana y la que viene, o el aviso de por qué no se pudo leer Notion. */
async function evaluar(notion: NotionPlan, hoy: Fecha, avisosDeLectura: string[]): Promise<{ actual: Semana; proxima: Semana } | { aviso: string }> {
  const hoyProxima = lunesQueViene(hoy);
  // Fuera del try: una base o un plan local ilegibles son un problema de Rastro, no de Notion.
  const local = leerLocal(hoy);
  const base = leerBase(hoy);
  const localProxima = leerLocal(hoyProxima);
  const baseProxima = leerBase(hoyProxima);
  const repos = nombresRegistrados();
  let delActual: Plan | null;
  let delProxima: Plan | null;
  try {
    // La extracción recibe lo último que Rastro y Notion compartieron (o, sin eso, el plan local), para devolver los mismos nombres y valores.
    const bloques = await notion.leer(hoy, { conocido: base ?? local, conocidoProxima: baseProxima ?? localProxima, repos, avisar: (a) => avisosDeLectura.push(a) });
    delActual = bloques === null ? null : parsearPlan(bloques, hoy);
    delProxima = bloques === null ? null : parsearPlan(bloques, hoyProxima);
  } catch (e) {
    if (!esFalloDeNotion(e)) throw e;
    // parsearPlan habla de "plan.md": acá el texto que falla es el bloque de Notion.
    return { aviso: `No pude leer el plan de Notion (${motivoDe(e).replace(/^plan\.md /, "el bloque de Notion ")}): sigo con el plan local y no cambio nada.` };
  }
  return {
    actual: evaluarSemana({ delNotion: delActual, hoy, local, base, deLaQueViene: false }),
    proxima: evaluarSemana({ delNotion: delProxima, hoy: hoyProxima, local: localProxima, base: baseProxima, deLaQueViene: true }),
  };
}

type Diferencia = { nombre: string; texto: string };

const textoCampo: { [C in "objetivo" | "estado" | "duracion" | "dias" | "noEntra" | "repo"]: (t: Tarea) => string } = {
  objetivo: (t) => `"${t.objetivo}"`,
  estado: (t) => t.estado,
  duracion: (t) => (t.duracion === null ? "sin duración" : textoDuracion(t.duracion)),
  dias: (t) => (t.dias.length === 0 ? "sin días" : textoDias(t.dias)),
  noEntra: (t) => (t.noEntra ? "no entra" : "entra"),
  repo: (t) => (t.repo === null ? "sin repo" : t.repo),
};

/** Las diferencias por tarea entre Notion y Rastro: la agregada de un lado, la sacada del otro y el campo que cambió en cada una. */
export function diferencias(notion: Plan, local: Plan): Diferencia[] {
  const res: Diferencia[] = [];
  if (notion.entregable !== local.entregable) res.push({ nombre: "Entregable", texto: `Entregable: Rastro "${local.entregable}", Notion "${notion.entregable}"` });
  for (const t of notion.tareas) {
    const propia = local.tareas.find((x) => x.slug === t.slug);
    if (propia === undefined) {
      res.push({ nombre: t.nombre, texto: `${t.nombre}: solo está en Notion (agregada allá o sacada de Rastro)` });
      continue;
    }
    for (const campo of Object.keys(textoCampo) as (keyof typeof textoCampo)[]) {
      const deRastro = textoCampo[campo](propia);
      const deNotion = textoCampo[campo](t);
      if (deRastro !== deNotion) res.push({ nombre: t.nombre, texto: `${t.nombre}: ${campo} distinto, Rastro ${deRastro}, Notion ${deNotion}` });
    }
  }
  for (const t of local.tareas) {
    if (!notion.tareas.some((x) => x.slug === t.slug)) res.push({ nombre: t.nombre, texto: `${t.nombre}: solo está en Rastro (agregada acá o sacada de Notion)` });
  }
  return res;
}

const etiquetaCampo: { [C in keyof typeof textoCampo]: string } = {
  objetivo: "el objetivo",
  estado: "el estado",
  duracion: "la duración",
  dias: "los días",
  noEntra: "si entra en la semana",
  repo: "el repo",
};

/** Texto que vino de la página: va a un prompt con permiso de escritura, así que se redacta, se aplana y se acota como cualquier texto de la página. */
const deLaPagina = (texto: string): string => redactar(texto).replace(/\s+/g, " ").trim().slice(0, 80);

/**
 * Los cambios que hay que aplicar en la página de Notion para que su plan quede como el de Rastro, escritos como instrucciones.
 * Se calculan contra el plan que Notion tiene ahora, que es lo que la página va a dejar de tener.
 */
export function cambiosParaNotion(notion: Plan, local: Plan): string[] {
  const res: string[] = [];
  if (notion.entregable !== local.entregable) res.push(`Cambiar el entregable del viernes de "${deLaPagina(notion.entregable)}" a "${local.entregable}"`);
  for (const t of local.tareas) {
    const enNotion = notion.tareas.find((x) => x.slug === t.slug);
    if (enNotion === undefined) {
      const datos = [`objetivo ${textoCampo.objetivo(t)}`, `estado ${t.estado}`, `duración ${textoCampo.duracion(t)}`, `días ${textoCampo.dias(t)}`, ...(t.noEntra ? ["no entra en la semana"] : []), `repo ${textoCampo.repo(t)}`];
      res.push(`Agregar la tarea "${t.nombre}": ${datos.join(", ")}`);
      continue;
    }
    for (const campo of Object.keys(textoCampo) as (keyof typeof textoCampo)[]) {
      const antes = textoCampo[campo](enNotion);
      const despues = textoCampo[campo](t);
      if (antes !== despues) res.push(`Tarea "${t.nombre}": cambiar ${etiquetaCampo[campo]} de ${antes} a ${despues}`);
    }
  }
  for (const t of notion.tareas) {
    if (!local.tareas.some((x) => x.slug === t.slug)) res.push(`Sacar la tarea "${deLaPagina(t.nombre)}" del plan de la semana`);
  }
  return res;
}

/**
 * Deja plan.md como el de Notion y avisa los `repo:` que no están registrados, igual que `plan cambiar repo`.
 * Con `deLaQueViene` la huella queda anotada aparte: lo que `rastro publish` envía hoy es el plan de esta semana, y ese no cambió.
 */
function adoptar(notion: Plan, hoy: Fecha, modo: "mock" | "claude", deLaQueViene = false): string[] {
  const r = rutasGlobales();
  mkdirSync(r.dir, { recursive: true });
  const actual = existsSync(r.plan) ? readFileSync(r.plan, "utf8") : "";
  writeFileSync(r.plan, fusionarSeccion(actual, hoy, normalizado(notion)));
  guardarBaseNotion(notion);
  // Notion ya tiene este plan: `rastro publish` no tiene que reenviarlo.
  const huella = huellaDelPlan(leerLocal(hoy));
  if (huella !== null) {
    if (deLaQueViene) guardarPublicadoDeLaQueViene(notion.semana, huella, modo);
    else guardarPublicado(huella, modo);
  }
  const desconocidos = [...new Set(notion.tareas.flatMap((t) => (t.repo !== null && !nombreRegistrado(t.repo) ? [t.repo] : [])))];
  return desconocidos.map((repo) => `Aviso: "${repo}" no es un repo registrado; las tareas quedan con ese nombre igual.`);
}

const sinDuracion = (plan: Plan): Tarea[] => plan.tareas.filter((t) => t.estado === "pendiente" && t.duracion === null);

function snapshotDelPlan(config: Config, plan: Plan): Snapshot {
  return validarSnapshot({
    schemaVersion: 3,
    generadoEn: new Date().toISOString(),
    persona: config.persona,
    repo: { nombre: "plan" },
    periodo: { desde: plan.semana, hasta: plan.semana },
    pendientes: [],
    resumen: null,
    sugerencias: [],
    costo: { llamadas: 0, usd: 0, tokens: 0 },
    bitacora: [],
    plan,
    desvios: { fueraDelPlanPct: 0, alerta: false, tareasSinActividad: [], tareasAtrasadas: [] },
    foco: null,
    ofrecimientos: [],
    gantt: { mock: false, barras: [] },
  });
}

async function sugerirDuraciones(o: { llm: Llm | null; config: Config; hoy: Fecha; plan: Plan; confirmar: boolean }): Promise<{ lineas: string[]; planCambio: boolean }> {
  const sin = sinDuracion(o.plan);
  if (sin.length === 0) return { lineas: [], planCambio: false };
  const faltan = (motivo: string): string => `Sin duración: ${sin.map((t) => t.nombre).join(", ")} (${motivo}). Ponelas con \`rastro plan cambiar duracion <tarea> <valor>\`.`;
  if (o.llm === null) return { lineas: [faltan("sin LLM no las puedo sugerir")], planCambio: false };
  let cambios: Cambio[];
  try {
    const res = await o.llm.completar(pedidoDuraciones(sin.map((t) => ({ slug: t.slug, nombre: t.nombre, objetivo: t.objetivo }))));
    cambios = sin.flatMap((t): Cambio[] => {
      const duracion = res.duraciones.find((d) => d.slug === t.slug)?.duracion ?? null;
      return duracion === null ? [] : [{ tipo: "duracion", tarea: t.slug, duracion }];
    });
  } catch (e) {
    if (!(e instanceof ErrorLlm)) throw e;
    return { lineas: [faltan(`el LLM no está disponible: ${motivoDe(e)}`)], planCambio: false };
  }
  if (cambios.length === 0) return { lineas: [faltan("el LLM no pudo estimarlas")], planCambio: false };
  // Mismo camino que `plan cambiar`: vista previa y, con --confirmar, aplica todo o nada.
  const r = aplicarCambios({ repos: [], config: o.config, cambios, destino: "vigente", confirmar: o.confirmar, hoy: o.hoy });
  const encabezado = r.aplicado ? "Duraciones sugeridas, aplicadas:" : "Duraciones sugeridas (no se escribió nada; con --confirmar se aplican, o una por una con `rastro plan cambiar duracion <tarea> <valor> --confirmar`):";
  const sinPublicar = r.aplicado ? ["Esas duraciones son un cambio local sin publicar: el próximo `rastro plan sincronizar` te ofrece publicarlas en Notion."] : [];
  return { lineas: [encabezado, ...r.vistaPrevia.map((l) => `  ${l}`), ...sinPublicar], planCambio: r.aplicado };
}

export type ResultadoSync = {
  estado: EstadoSync | "sin-notion";
  /** Lo que se le muestra a quien lo corrió, por stdout. */
  lineas: string[];
  /** Avisos para stderr (Notion no respondió). */
  avisos: string[];
  /** plan.md cambió: quien lo corre tiene que rehacer el resumen local. */
  planCambio: boolean;
};

type OpcionesSync = {
  config: Config;
  hoy: Fecha;
  notion: NotionPlan;
  llm: Llm | null;
  confirmar: boolean;
  usar?: "notion" | "rastro";
};

export async function sincronizarPlan(o: OpcionesSync): Promise<ResultadoSync> {
  const avisosDeLectura: string[] = [];
  const r = await sincronizar(o, avisosDeLectura);
  return { ...r, avisos: [...avisosDeLectura, ...r.avisos] };
}

async function sincronizar(o: OpcionesSync, avisosDeLectura: string[]): Promise<ResultadoSync> {
  const ev = await evaluar(o.notion, o.hoy, avisosDeLectura);
  if ("aviso" in ev) return { estado: "sin-notion", lineas: [], avisos: [ev.aviso], planCambio: false };
  const hayProxima = !("repetidas" in ev.proxima) && ev.proxima.notion !== null;
  const actual = await sincronizarActual(o, ev.actual, hayProxima);
  return { ...actual, lineas: [...actual.lineas, ...sincronizarProxima(o, ev.proxima)] };
}

async function sincronizarActual(o: OpcionesSync, ev: Semana, hayProxima: boolean): Promise<ResultadoSync> {
  if ("repetidas" in ev) return { estado: "sin-notion", lineas: [ev.repetidas], avisos: [], planCambio: false };
  const { notion, local } = ev;
  if (ev.estado === "iguales") {
    if (local === null) return { estado: "iguales", lineas: ["No hay plan de esta semana ni en Notion ni en Rastro."], avisos: [], planCambio: false };
    // Un plan adoptado por el daily ya quedó igual a Notion: las duraciones que faltan se sugieren igual.
    const sugerencias = await sugerirDuraciones({ llm: o.llm, config: o.config, hoy: o.hoy, plan: local, confirmar: o.confirmar });
    return { estado: "iguales", lineas: ["El plan de Notion y el de Rastro ya son iguales.", ...sugerencias.lineas], avisos: [], planCambio: sugerencias.planCambio };
  }
  // Con --usar se resuelve a favor de un lado aunque no sea el que cambió.
  const accion = o.usar ?? (ev.estado === "ambos" ? null : ev.estado);
  if (accion === null && notion !== null && local !== null) {
    const lineas = [
      "El plan de Notion y el de Rastro cambiaron los dos y son distintos; no escribí nada:",
      ...diferencias(notion, local).map((d) => `  ${d.texto}`),
      "Resolvelo con `rastro plan sincronizar --usar notion` (adopta el de Notion) o `rastro plan sincronizar --usar rastro --confirmar` (publica el de Rastro).",
    ];
    return { estado: "ambos", lineas, avisos: [], planCambio: false };
  }
  if (accion === "notion") {
    if (notion === null) {
      // Con la semana que viene en Notion hay qué adoptar igual: la de esta semana solo falta.
      if (hayProxima) return { estado: ev.estado, lineas: ["Notion no tiene un plan para esta semana."], avisos: [], planCambio: false };
      throw new ErrorUsuario("Notion no tiene un plan para esta semana: no hay nada para adoptar.");
    }
    const avisosRepo = adoptar(notion, o.hoy, o.config.notion.modo);
    const adoptado = [`Se adoptó el plan de Notion en ${rutasGlobales().plan}:`, ...notion.tareas.map((t) => `  ${t.nombre}`), ...avisosRepo];
    const sugerencias = await sugerirDuraciones({ llm: o.llm, config: o.config, hoy: o.hoy, plan: notion, confirmar: o.confirmar });
    return { estado: ev.estado, lineas: [...adoptado, ...sugerencias.lineas], avisos: [], planCambio: true };
  }
  if (local === null) throw new ErrorUsuario("No hay plan de esta semana en Rastro: no hay nada para publicar. Armalo con `rastro plan <propuesta.md>` (o decile a Claude «armá el plan»).");
  const snapshot = snapshotDelPlan(o.config, local);
  // Si la página ya tiene el plan de esta semana se le piden solo los cambios, para que respete su formato; si no, el bloque entero.
  const cambios = ev.publicable === null ? [] : cambiosParaNotion(ev.publicable, local);
  if (!o.confirmar) {
    const bloque = bloquePlan(snapshot).split("\n").filter((l) => l.trim() !== "").map((l) => `  ${l}`);
    return {
      estado: ev.estado,
      lineas: [
        "Vista previa de lo que se publica en Notion (no se escribió nada; repetí con --confirmar para publicar):",
        ...bloque,
        ...(cambios.length === 0 ? [] : ["En la página de Notion se aplican estos cambios, conservando su formato:", ...cambios.map((c) => `  ${c}`)]),
      ],
      avisos: [],
      planCambio: false,
    };
  }
  const detalle = await o.notion.publicar(snapshot, cambios.length === 0 ? {} : { cambiosPlan: cambios });
  guardarBaseNotion(local);
  const huella = huellaDelPlan(local);
  if (huella !== null) guardarPublicado(huella, o.config.notion.modo);
  return { estado: ev.estado, lineas: [`Plan publicado en Notion: ${detalle}`], avisos: [], planCambio: false };
}

/**
 * La semana que viene se trae de Notion cuando Notion ya tiene su plan: se adopta si cambió solo Notion (o con `--usar notion`).
 * No se publica: `plan sincronizar` publica el plan de la semana en curso, y un plan que Rastro armó para el lunes se queda en Rastro.
 */
function sincronizarProxima(o: OpcionesSync, ev: Semana): string[] {
  if ("repetidas" in ev) return [ev.repetidas];
  const { notion, local } = ev;
  if (notion === null) return [];
  const semana = ddmm(notion.semana);
  if (ev.estado === "iguales") return [`El plan de la semana del ${semana} ya es igual en Notion y en Rastro.`];
  if (o.usar === "rastro") return [];
  if (o.usar === "notion" || ev.estado === "notion") {
    const avisosRepo = adoptar(notion, ev.hoy, o.config.notion.modo, true);
    return [`Se adoptó el plan de Notion de la semana del ${semana} (${cantidad(notion.tareas.length, "tarea", "tareas")}) en ${rutasGlobales().plan}:`, ...notion.tareas.map((t) => `  ${t.nombre}`), ...avisosRepo];
  }
  const diferenciasDeLaSemana = local === null ? [] : diferencias(notion, local).map((d) => `  ${d.texto}`);
  const encabezado =
    ev.estado === "ambos"
      ? `El plan de la semana del ${semana} cambió en Notion y en Rastro y son distintos; no escribí nada (\`rastro plan sincronizar --usar notion\` adopta el de Notion):`
      : `El plan de la semana del ${semana} cambió en Rastro y Notion no lo tiene al día; no lo publico, porque \`plan sincronizar\` solo publica el plan de esta semana:`;
  return [encabezado, ...diferenciasDeLaSemana];
}

/** Adoptar sacaría tareas del plan local o les sacaría o cambiaría el repo: eso lo decide la persona, no el daily. */
function adopcionQuitaOCambiaRepos(notion: Plan, local: Plan): boolean {
  const enNotion = new Map(notion.tareas.map((t) => [t.slug, t]));
  return local.tareas.some((t) => {
    const nueva = enNotion.get(t.slug);
    return nueva === undefined || (t.repo !== null && nueva.repo !== t.repo);
  });
}

export type ResultadoLectura = {
  /** Cosas a revisar: van a stderr como degradación. */
  avisos: string[];
  /** Lo que el daily hizo con el plan (adoptar el de Notion): va a su salida. */
  informes: string[];
};

/**
 * El daily sincroniza solo en lectura: adopta el plan de Notion si es lo único que cambió y no saca tareas ni repos,
 * e informa qué cambió; en cualquier otro caso avisa qué haría `rastro plan sincronizar`. Nunca publica ni pide LLM.
 * Un bloque que un LLM transcribió con ruido (sin el `· repo:` de una tarea, por ejemplo) no pisa el plan sin que nadie lo vea.
 * Lo mismo vale para el plan de la semana que viene, si Notion ya lo tiene.
 */
export async function sincronizarEnLectura(o: { hoy: Fecha; notion: NotionPlan; modo: "mock" | "claude" }): Promise<ResultadoLectura> {
  const avisosDeLectura: string[] = [];
  const r = await leerYComparar(o, avisosDeLectura);
  return { ...r, avisos: [...avisosDeLectura, ...r.avisos] };
}

async function leerYComparar(o: { hoy: Fecha; notion: NotionPlan; modo: "mock" | "claude" }, avisosDeLectura: string[]): Promise<ResultadoLectura> {
  const ev = await evaluar(o.notion, o.hoy, avisosDeLectura);
  if ("aviso" in ev) return { avisos: [ev.aviso], informes: [] };
  const actual = leerSemanaActual(o, ev.actual);
  const proxima = leerSemanaQueViene(o, ev.proxima);
  return { avisos: [...actual.avisos, ...proxima.avisos], informes: [...actual.informes, ...proxima.informes] };
}

// Las duraciones que faltan nunca se pierden: el daily las recuerda hasta que se pongan.
const avisoDeDuraciones = (plan: Plan): string[] => {
  const sin = sinDuracion(plan);
  return sin.length === 0 ? [] : [`Tareas sin duración: ${sin.map((t) => t.nombre).join(", ")}. \`rastro plan sincronizar\` las sugiere (con --confirmar las aplica; o decile a Claude «sincronizá el plan»).`];
};

function leerSemanaActual(o: { hoy: Fecha; modo: "mock" | "claude" }, ev: Semana): ResultadoLectura {
  if ("repetidas" in ev) return { avisos: [ev.repetidas], informes: [] };
  const { notion, local } = ev;
  if (ev.estado === "iguales") return { avisos: local === null ? [] : avisoDeDuraciones(local), informes: [] };
  if (notion === null) return { avisos: ["El plan de Rastro no está en Notion: `rastro plan sincronizar --confirmar` lo publicaría (o decile a Claude «sincronizá el plan»)."], informes: [] };
  if (ev.estado === "notion") {
    const cambios = local === null ? notion.tareas.map((t) => `${t.nombre}: agregada`) : diferencias(notion, local).map((d) => d.texto);
    if (local !== null && adopcionQuitaOCambiaRepos(notion, local)) {
      return {
        avisos: [`El plan de Notion saca tareas o cambia repos del de Rastro y no lo adopté (${cambios.join("; ")}): \`rastro plan sincronizar --usar notion\` lo adopta; \`rastro plan sincronizar\` lo compara (o decile a Claude «sincronizá el plan»).`],
        informes: [],
      };
    }
    const avisosRepo = adoptar(notion, o.hoy, o.modo);
    return { avisos: [...avisosRepo, ...avisoDeDuraciones(notion)], informes: ["Se adoptó el plan de Notion:", ...cambios.map((c) => `  ${c}`)] };
  }
  const nombres = local === null ? [] : [...new Set(diferencias(notion, local).map((d) => d.nombre))];
  const detalle = nombres.length === 0 ? "" : ` (${nombres.join(", ")})`;
  return {
    avisos:
      ev.estado === "rastro"
        ? [`El plan de Rastro cambió y Notion todavía no lo tiene${detalle}: \`rastro plan sincronizar --confirmar\` lo publicaría (o decile a Claude «sincronizá el plan»).`]
        : [`El plan de Notion y el de Rastro cambiaron los dos y son distintos${detalle}: no escribí nada; resolvelo con \`rastro plan sincronizar\` (o decile a Claude «sincronizá el plan»).`],
    informes: [],
  };
}

/** Misma regla que esta semana, pero solo cuando Notion ya tiene el plan: un plan que Rastro armó para el lunes y Notion no tiene no es un desvío. */
function leerSemanaQueViene(o: { modo: "mock" | "claude" }, ev: Semana): ResultadoLectura {
  if ("repetidas" in ev) return { avisos: [ev.repetidas], informes: [] };
  const { notion, local } = ev;
  if (notion === null || ev.estado === "iguales") return { avisos: [], informes: [] };
  const semana = ddmm(notion.semana);
  if (ev.estado === "notion") {
    if (local !== null && adopcionQuitaOCambiaRepos(notion, local)) {
      const cambios = diferencias(notion, local).map((d) => d.texto);
      return { avisos: [`El plan de Notion de la semana del ${semana} saca tareas o cambia repos del de Rastro y no lo adopté (${cambios.join("; ")}): \`rastro plan sincronizar --usar notion\` lo adopta (o decile a Claude «sincronizá el plan»).`], informes: [] };
    }
    const avisosRepo = adoptar(notion, ev.hoy, o.modo, true);
    const informe = local === null ? [`Ya está el plan de la semana del ${semana} (${cantidad(notion.tareas.length, "tarea", "tareas")}).`] : [`Se adoptó el plan de Notion de la semana del ${semana}:`, ...diferencias(notion, local).map((d) => `  ${d.texto}`)];
    return { avisos: avisosRepo, informes: informe };
  }
  return {
    avisos: [
      ev.estado === "rastro"
        ? `El plan de la semana del ${semana} cambió en Rastro y Notion no lo tiene al día: no lo publico, porque se publica el de la semana en curso.`
        : `El plan de la semana del ${semana} cambió en Notion y en Rastro y son distintos: no escribí nada; resolvelo con \`rastro plan sincronizar\` (o decile a Claude «sincronizá el plan»).`,
    ],
    informes: [],
  };
}
