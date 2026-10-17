import { DIAS_SEMANA } from "./config.ts";
import type { Plan, Tarea } from "./contract/snapshot.ts";
import { ErrorUsuario } from "./errores.ts";
import { ddmm, desdeDdmm, indiceDiaSemana, lunesDe, sumarDias, type Fecha } from "./fechas.ts";
import { log } from "./log.ts";
import { normalizar, slugDe } from "./texto.ts";

const RE_ENCABEZADO = /^## Plan semana (\d{2}\/\d{2})\s*$/;
const RE_ENTREGABLE = /^- (~~)?\*\*Entregable del viernes:\*\*\s*(.*?)(~~)?\s*$/;
const RE_TAREA = /^- \[([ xX])\] (~~)?\*\*(.+?):\*\*\s*(.*?)(~~)?\s*$/;

const NOMBRES_DIA = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;
// "· 2d · lun–mié", "· 4h · jue" o "· 3d · no entra" al final del objetivo; sin él la tarea no tiene duración.
// La forma "· <n>(h|d) · <algo>" es siempre un sufijo: si el <algo> no se lee, se corta en vez de dejarlo como parte del objetivo.
// Y un "· repo:<nombre>" opcional, solo o antes o después de la duración y los días: "· 2d · lun–mar · repo:hunting".
const RE_SUFIJO = /(?:^|\s)·\s(\d+(?:[.,]\d+)?[hd])(?:\s·\s([^·]+?))?$/i;

// Días sin duración ("· jue", "· lun–mar, jue", "· no entra"): solo con nombres de día, para no confundir con texto del objetivo.
const DIA = "(?:lun|mar|mi[eé]|jue|vie|s[aá]b|dom)";
const TRAMO_DIAS = `${DIA}(?:\\s*[–-]\\s*${DIA})?`;
const RE_DIAS_SOLOS = new RegExp(`(?:^|\\s)·\\s(${TRAMO_DIAS}(?:\\s*,\\s*${TRAMO_DIAS})*|no entra)$`, "i");

const RE_REPO_FINAL = /(?:^|\s)·\srepo:([^\s·]+)\s*$/;

export type Duracion = NonNullable<Tarea["duracion"]>;

const LIMITES_DURACION = { h: { min: 0.25, max: 80 }, d: { min: 0.25, max: 10 } } as const;

export function duracionEnRango(d: Duracion): boolean {
  const { min, max } = LIMITES_DURACION[d.unidad];
  return d.valor >= min && d.valor <= max;
}

/** Único lector de duraciones ("4h", "1,5d", "2D"): lo usan plan.md y la CLI. Null si no tiene esa forma. */
export function parsearDuracion(texto: string): Duracion | null {
  const m = /^(\d+(?:[.,]\d+)?)([hd])$/i.exec(texto.trim());
  if (m === null) return null;
  return { valor: Number((m[1] ?? "").replace(",", ".")), unidad: m[2]?.toLowerCase() === "h" ? "h" : "d" };
}

/**
 * Único lector de días ("lun–mar, jue"): lo usan plan.md y la CLI. Acepta guion ASCII, con o sin acentos y mayúsculas.
 * Null si un tramo no se lee o va al revés.
 */
export function parsearDias(texto: string, semana: Fecha): Fecha[] | null {
  const dias: Fecha[] = [];
  for (const tramo of texto.split(",")) {
    const indices = tramo.split(/[–-]/).map((n) => DIAS_SEMANA.indexOf(normalizar(n.trim()) as (typeof DIAS_SEMANA)[number]));
    const [desde, hasta = desde] = indices;
    if (indices.length > 2 || desde === undefined || hasta === undefined || desde < 0 || hasta < desde) return null;
    for (let i = desde; i <= hasta; i++) dias.push(sumarDias(semana, i));
  }
  return dias;
}

/** Los días de un sufijo ("lun–mar, jue" o "no entra"); lanza si un tramo no se lee o los días van desordenados. */
function leerDiasDelSufijo(texto: string, semana: Fecha, linea: number): Pick<Tarea, "dias" | "noEntra"> {
  if (normalizar(texto) === "no entra") return { dias: [], noEntra: true };
  const dias = texto === "" ? [] : parsearDias(texto, semana);
  if (dias === null) throw new ErrorUsuario(`plan.md línea ${linea}: no pude leer los días "${texto}" de la tarea: usá, por ejemplo, lun–mar, jue o no entra`);
  if (dias.some((f, i) => i > 0 && f <= (dias[i - 1] ?? ""))) {
    throw new ErrorUsuario(`plan.md línea ${linea}: los días de la tarea deben ir en orden y sin repetir`);
  }
  return { dias, noEntra: false };
}

/** Null si la duración está fuera de rango: ese final no es un sufijo, es texto del objetivo. */
function parsearSufijo(sufijo: RegExpExecArray, semana: Fecha, linea: number): Pick<Tarea, "duracion" | "dias" | "noEntra"> | null {
  const duracion = parsearDuracion(sufijo[1] ?? "");
  if (duracion === null || !duracionEnRango(duracion)) {
    log("warn", "duracion_fuera_de_rango", { linea });
    return null;
  }
  return { duracion, ...leerDiasDelSufijo((sufijo[2] ?? "").trim(), semana, linea) };
}

/** Separa del objetivo el repo (antes o después de la duración) y la duración con sus días. El nombre del repo es texto del usuario: no se valida contra los registrados. */
function leerSufijos(texto: string, semana: Fecha, linea: number): { objetivo: string; repo: string | null; sufijo: ReturnType<typeof parsearSufijo> } {
  let resto = texto;
  let repo: string | null = null;
  const quitarRepo = (): void => {
    const m = RE_REPO_FINAL.exec(resto);
    if (m === null) return;
    repo = m[1] ?? null;
    resto = resto.slice(0, m.index);
  };
  quitarRepo();
  const crudo = RE_SUFIJO.exec(resto);
  let sufijo = crudo === null ? null : parsearSufijo(crudo, semana, linea);
  if (crudo !== null && sufijo !== null) {
    resto = resto.slice(0, crudo.index);
    if (repo === null) quitarRepo();
  }
  // Una tarea con días y sin duración: la duración fuera de rango (crudo) sigue siendo texto del objetivo, no se busca más.
  const soloDias = crudo === null ? RE_DIAS_SOLOS.exec(resto) : null;
  if (soloDias !== null) {
    sufijo = { duracion: null, ...leerDiasDelSufijo((soloDias[1] ?? "").trim(), semana, linea) };
    resto = resto.slice(0, soloDias.index);
    if (repo === null) quitarRepo();
  }
  return { objetivo: resto, repo, sufijo };
}

function encabezadoDeLaSemana(lineas: readonly string[], lunes: Fecha, hoy: Fecha): number {
  return lineas.findIndex((l) => {
    const m = RE_ENCABEZADO.exec(l);
    return m !== null && m[1] !== undefined && desdeDdmm(m[1], hoy) === lunes;
  });
}

/** Devuelve el plan de la semana de `hoy` o null si el archivo no tiene uno. */
export function parsearPlan(md: string, hoy: Fecha): Plan | null {
  const lineas = md.split(/\r?\n/);
  const lunes = lunesDe(hoy);
  const inicio = encabezadoDeLaSemana(lineas, lunes, hoy);
  if (inicio === -1) return null;

  let entregable = "";
  const tareas: Tarea[] = [];
  for (let i = inicio + 1; i < lineas.length; i++) {
    const linea = lineas[i] ?? "";
    if (/^#{1,6} /.test(linea)) break;
    // Vacías y sub-bullets con fecha: son comentarios del plan, no tareas.
    if (linea.trim() === "" || /^\s/.test(linea) || linea.startsWith("- **Cierre")) continue;
    const e = RE_ENTREGABLE.exec(linea);
    if (e !== null) {
      if (e[1] === undefined) entregable = e[2] ?? "";
      continue;
    }
    const t = RE_TAREA.exec(linea);
    if (t === null || t[3] === undefined) {
      throw new ErrorUsuario(`plan.md línea ${i + 1}: no es una tarea válida (se espera "- [ ] **Nombre:** objetivo")`);
    }
    const { objetivo, repo, sufijo } = leerSufijos(t[4] ?? "", lunes, i + 1);
    tareas.push({
      slug: slugDe(t[3]),
      nombre: t[3],
      objetivo,
      estado: t[2] === "~~" ? "sacada" : t[1] === " " ? "pendiente" : "hecha",
      repo,
      ...(sufijo ?? { duracion: null, dias: [], noEntra: false }),
    });
  }
  return { semana: lunes, entregable, tareas };
}

export type TareaARenderizar = { nombre: string; objetivo: string; estado?: Tarea["estado"] } & Partial<Pick<Tarea, "duracion" | "dias" | "noEntra" | "repo">>;

// El texto puede venir de un LLM: se aplana y se quitan los marcadores para que plan.md siga legible y se relea igual.
function limpiar(texto: string): string {
  let previo: string;
  let actual = texto;
  do {
    previo = actual;
    actual = actual.replace(/\*\*|~~/g, "");
  } while (actual !== previo);
  return actual.replace(/\s+/g, " ").trim();
}

export function textoDias(dias: readonly Fecha[]): string {
  const tramos: number[][] = [];
  for (const indice of dias.map(indiceDiaSemana)) {
    const ultimo = tramos.at(-1);
    if (ultimo !== undefined && ultimo.at(-1) === indice - 1) ultimo.push(indice);
    else tramos.push([indice]);
  }
  return tramos.map((t) => (t.length === 1 ? NOMBRES_DIA[t[0] ?? 0] : `${NOMBRES_DIA[t[0] ?? 0]}–${NOMBRES_DIA[t.at(-1) ?? 0]}`)).join(", ");
}

export function textoDuracion(d: Duracion): string {
  return `${String(d.valor).replace(".", ",")}${d.unidad}`;
}

function sufijoDeDuracion(t: TareaARenderizar): string {
  const base = t.duracion === undefined || t.duracion === null ? "" : ` · ${textoDuracion(t.duracion)}`;
  if (t.noEntra === true) return `${base} · no entra`;
  return t.dias === undefined || t.dias.length === 0 ? base : `${base} · ${textoDias(t.dias)}`;
}

const sufijoDe = (t: TareaARenderizar): string => sufijoDeDuracion(t) + (t.repo === undefined || t.repo === null ? "" : ` · repo:${t.repo}`);

function lineaDeTarea(t: TareaARenderizar): string {
  const nombre = limpiar(t.nombre).replaceAll(":", "").trim();
  if (slugDe(nombre) === "") throw new ErrorUsuario(`El nombre de tarea "${nombre}" no tiene letras ni números`);
  // Un objetivo que ya termina con forma de sufijo se leería como duración: se cambia su último " · " para que el plan haga ida y vuelta.
  const objetivo = limpiar(t.objetivo).replace(RE_REPO_FINAL, (m) => m.replace("·", "-")).replace(RE_SUFIJO, (m) => m.replace("·", "-")).replace(RE_DIAS_SOLOS, (m) => m.replace("·", "/")) + sufijoDe(t);
  return t.estado === "sacada" ? `- [ ] ~~**${nombre}:** ${objetivo}~~` : `- [${t.estado === "hecha" ? "x" : " "}] **${nombre}:** ${objetivo}`;
}

export function renderizarPlan(semana: Fecha, entregable: string, tareas: readonly TareaARenderizar[]): string {
  return [`## Plan semana ${ddmm(semana)}`, `- **Entregable del viernes:** ${limpiar(entregable)}`, ...tareas.map(lineaDeTarea), ""].join("\n");
}

/**
 * Reescribe solo las líneas de tarea de la semana de `hoy`: el entregable, los comentarios y las demás semanas quedan como están.
 * Las tareas que la sección no tenía (un ofrecimiento aceptado) se agregan después de la última tarea y sus notas.
 */
export function actualizarTareas(md: string, hoy: Fecha, tareas: readonly TareaARenderizar[]): string {
  const lineas = md.split(/\r?\n/);
  const inicio = encabezadoDeLaSemana(lineas, lunesDe(hoy), hoy);
  if (inicio === -1) return md;
  const porSlug = new Map(tareas.map((t) => [slugDe(t.nombre), t]));
  const vistas = new Set<string>();
  let ultima = inicio;
  for (let i = inicio + 1; i < lineas.length; i++) {
    const linea = lineas[i] ?? "";
    if (/^#{1,6} /.test(linea)) break;
    const m = RE_TAREA.exec(linea);
    if (m?.[3] !== undefined) {
      ultima = i;
      const slug = slugDe(m[3]);
      vistas.add(slug);
      const tarea = porSlug.get(slug);
      if (tarea !== undefined) lineas[i] = lineaDeTarea(tarea);
    } else if (/^\s+\S/.test(linea)) {
      ultima = i;
    }
  }
  const nuevas = tareas.filter((t) => !vistas.has(slugDe(t.nombre))).map(lineaDeTarea);
  lineas.splice(ultima + 1, 0, ...nuevas);
  return lineas.join("\n");
}

/** Lo que la sección vieja tiene además de las tareas: los sub-bullets (colgados de su tarea) y las líneas de Cierre. */
function notasDeLaSeccion(lineas: readonly string[], inicio: number): { porTarea: Map<string, string[]>; cierres: string[] } {
  const porTarea = new Map<string, string[]>();
  const cierres: string[] = [];
  let ultima = "";
  for (let i = inicio + 1; i < lineas.length; i++) {
    const linea = lineas[i] ?? "";
    if (/^#{1,6} /.test(linea)) break;
    const m = RE_TAREA.exec(linea);
    if (m?.[3] !== undefined) ultima = slugDe(m[3]);
    else if (linea.startsWith("- **Cierre")) cierres.push(linea);
    else if (/^\s+\S/.test(linea)) porTarea.set(ultima, [...(porTarea.get(ultima) ?? []), linea]);
  }
  return { porTarea, cierres };
}

/**
 * Reemplaza la sección de la semana de `hoy` por `seccion` o la agrega al final; las demás semanas quedan como están.
 * Los sub-bullets y el Cierre de la sección vieja se conservan: son del usuario, no de la propuesta.
 */
export function fusionarSeccion(md: string, hoy: Fecha, seccion: string): string {
  const lineas = md.split(/\r?\n/);
  const lunes = lunesDe(hoy);
  const inicio = encabezadoDeLaSemana(lineas, lunes, hoy);
  if (inicio === -1) return md.trim() === "" ? seccion : `${md.replace(/\s*$/, "")}\n\n${seccion}`;
  const siguiente = lineas.findIndex((l, i) => i > inicio && /^#{1,6} /.test(l));
  const despues = siguiente === -1 ? [] : ["", ...lineas.slice(siguiente)];
  const { porTarea, cierres } = notasDeLaSeccion(lineas, inicio);
  const nuevas = seccion.replace(/\n$/, "").split("\n").flatMap((linea) => {
    const m = RE_TAREA.exec(linea);
    const slug = m?.[3] === undefined ? undefined : slugDe(m[3]);
    const notas = slug === undefined ? undefined : porTarea.get(slug);
    if (slug !== undefined) porTarea.delete(slug);
    return [linea, ...(notas ?? [])];
  });
  const huerfanas = [...porTarea.values()].flat();
  return [...lineas.slice(0, inicio), ...nuevas, ...huerfanas, ...cierres, ...despues].join("\n").replace(/\s*$/, "\n");
}
