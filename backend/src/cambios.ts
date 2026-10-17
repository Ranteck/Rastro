import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { rutasGlobales, type Config } from "./config.ts";
import { checkCambios, type Cambio } from "./contract/cambios.ts";
import {
  arr,
  duracion,
  ErrorValidacion,
  fecha,
  fechasOrdenadas,
  lit,
  nullable,
  obj,
  patron,
  registro,
  slug,
  str,
  type Check,
  type Infer,
} from "./contract/validar.ts";
import type { Tarea } from "./contract/snapshot.ts";
import { ErrorUsuario } from "./errores.ts";
import { ddmm, lunesDe, sumarDias, type Fecha } from "./fechas.ts";
import { git } from "./git.ts";
import { nombreRegistrado } from "./repos.ts";
import { actualizarTareas, duracionEnRango, parsearDias, parsearDuracion, parsearPlan, textoDias, textoDuracion } from "./plan.ts";
import { conReparto, conservarEmpezadas } from "./reparto.ts";

export type { Cambio };

/** Único punto de entrada de los cambios: la CLI, el central y el chat pasan por acá antes de tocar nada. */
export function validarCambios(crudos: unknown): Cambio[] {
  try {
    return checkCambios(crudos, "cambios");
  } catch (e) {
    if (e instanceof ErrorValidacion) throw new ErrorUsuario(`Los cambios no son válidos: ${e.message}`, { cause: e });
    throw e;
  }
}

function leerJson<T>(archivo: string, check: Check<T>, vacio: T): T {
  if (!existsSync(archivo)) return vacio;
  try {
    return check(JSON.parse(readFileSync(archivo, "utf8")), "archivo");
  } catch (e) {
    if (e instanceof ErrorValidacion || e instanceof SyntaxError) {
      throw new ErrorUsuario(`${archivo} no es válido: ${e.message}`, { cause: e });
    }
    throw e;
  }
}

const textoJson = (datos: unknown): string => `${JSON.stringify(datos, null, 2)}\n`;

/**
 * Escribe todos los archivos con un temporal y `rename`: si falla cualquier escritura no se reemplaza ninguno,
 * y los JSON van antes que el markdown para que un plan nunca quede sin sus fijadas o sus correcciones.
 */
function escribirAtomico(dir: string, archivos: readonly { archivo: string; contenido: string }[]): void {
  mkdirSync(dir, { recursive: true });
  const temporales = archivos.map((a) => `${a.archivo}.tmp`);
  try {
    archivos.forEach((a, i) => writeFileSync(temporales[i] ?? "", a.contenido));
  } catch (e) {
    for (const t of temporales) rmSync(t, { force: true });
    throw e;
  }
  temporales.forEach((t, i) => renameSync(t, archivos[i]?.archivo ?? ""));
}

function escribirJson(dir: string, archivo: string, datos: unknown): void {
  escribirAtomico(dir, [{ archivo, contenido: textoJson(datos) }]);
}

// semana (lunes) -> slug de la tarea -> días fijados.
const checkFijados = registro(registro(fechasOrdenadas));
// SHA completo -> slug de la tarea, o null si el commit no es de ninguna tarea.
const checkCorrecciones = registro(nullable(slug));

// repo y estadoSugerido solo los trae lo sugerido desde un proyecto; sin ellos, la tarea entra pendiente y sin repo.
const checkOfrecimientos = arr(
  obj(
    { id: slug, nombre: str, objetivo: str, duracion, porque: str, estado: lit("pendiente", "descartado") },
    { repo: nullable(patron(/\S/, "un nombre de repo no vacío")), estadoSugerido: lit("pendiente", "hecha") },
  ),
);
type OfrecimientoGuardado = Infer<typeof checkOfrecimientos>[number];

// Lo que el reparto le dio a cada tarea de la propuesta: sirve para distinguir un día corregido a mano de uno que salió del reparto.
const checkBase = obj({ semana: fecha, tareas: registro(obj({ duracion, dias: fechasOrdenadas })) });
type BaseDePropuesta = Infer<typeof checkBase>;

export function leerOfrecimientos(): OfrecimientoGuardado[] {
  return leerJson(rutasGlobales().ofrecimientos, checkOfrecimientos, []);
}

export function guardarOfrecimientos(ofrecimientos: readonly OfrecimientoGuardado[]): void {
  escribirJson(rutasGlobales().dir, rutasGlobales().ofrecimientos, ofrecimientos);
}

export function leerBase(): BaseDePropuesta | null {
  return leerJson<BaseDePropuesta | null>(rutasGlobales().planBase, checkBase, null);
}

const baseDe = (semana: Fecha, tareas: readonly Pick<Tarea, "slug" | "duracion" | "dias">[]): BaseDePropuesta => ({
  semana,
  tareas: Object.fromEntries(tareas.map((t) => [t.slug, { duracion: t.duracion, dias: [...t.dias] }])),
});

export function guardarBase(semana: Fecha, tareas: readonly Pick<Tarea, "slug" | "duracion" | "dias">[]): void {
  escribirJson(rutasGlobales().dir, rutasGlobales().planBase, baseDe(semana, tareas));
}

/** Deja fijados esos días para la semana: el reparto no los mueve. */
export function fijarDias(semana: Fecha, dias: ReadonlyMap<string, readonly Fecha[]>): void {
  if (dias.size === 0) return;
  const porSemana = leerFijados();
  escribirJson(rutasGlobales().dir, rutasGlobales().fijados, { ...porSemana, [semana]: { ...porSemana[semana], ...Object.fromEntries(dias) } });
}

function leerFijados(): Record<string, Record<string, Fecha[]>> {
  return leerJson(rutasGlobales().fijados, checkFijados, {});
}

/** Los días que el usuario fijó para las tareas de esa semana: el reparto no los mueve. */
export function fijadosDeLaSemana(semana: Fecha): Map<string, Fecha[]> {
  return new Map(Object.entries(leerFijados()[semana] ?? {}));
}

export function leerCorrecciones(): ReadonlyMap<string, string | null> {
  return new Map(Object.entries(leerJson(rutasGlobales().correcciones, checkCorrecciones, {})));
}

/** El mismo prefijo puede existir en dos repos (dos clones comparten commits, o es casualidad): el SHA completo es lo que decide si hay uno solo. */
function resolverCommit(repos: readonly string[], corto: string): string {
  const encontrados = new Set<string>();
  for (const repo of repos) {
    // --disambiguate lista todos los objetos con ese prefijo: distingue "no existe en este repo" de "hay más de uno".
    const candidatos = git(repo, ["rev-parse", `--disambiguate=${corto.toLowerCase()}`]).split("\n").filter((l) => l !== "");
    for (const id of candidatos) if (git(repo, ["cat-file", "-t", id]).trim() === "commit") encontrados.add(id);
  }
  if (encontrados.size > 1) throw new ErrorUsuario(`El prefijo ${corto} es ambiguo: coincide con más de un commit entre los repos observados. Usá más caracteres del SHA.`);
  const [unico] = encontrados;
  if (unico === undefined) throw new ErrorUsuario(`No existe un commit único que empiece con ${corto}.`);
  return unico;
}

const descripcionDias = (t: Pick<Tarea, "dias" | "noEntra">): string => (t.noEntra ? "no entra" : t.dias.length === 0 ? "sin días" : textoDias(t.dias));
const descripcionDuracion = (d: Tarea["duracion"]): string => (d === null ? "sin duración" : textoDuracion(d));

const descripcionRepo = (repo: Tarea["repo"]): string => repo ?? "sin repo";

function diferencias(antes: Tarea, despues: Tarea): string[] {
  const partes: string[] = [];
  if (antes.repo !== despues.repo) partes.push(`repo ${descripcionRepo(antes.repo)} → ${descripcionRepo(despues.repo)}`);
  if (antes.estado !== despues.estado) partes.push(`${antes.estado} → ${despues.estado}`);
  if (descripcionDuracion(antes.duracion) !== descripcionDuracion(despues.duracion)) {
    partes.push(`${descripcionDuracion(antes.duracion)} → ${descripcionDuracion(despues.duracion)}`);
  }
  if (descripcionDias(antes) !== descripcionDias(despues)) partes.push(`${descripcionDias(antes)} → ${descripcionDias(despues)}`);
  return partes;
}

function sinPlan(destino: "vigente" | "propuesta"): never {
  throw new ErrorUsuario(
    destino === "vigente" ? "No hay plan para esta semana: armalo con `rastro plan <propuesta.md>`." : "No hay una propuesta para esta semana: armala con `rastro plan <propuesta.md>`.",
  );
}

export type ResultadoCambios = { vistaPrevia: string[]; aplicado: boolean };

/**
 * Lo único que puede modificar el plan y la bitácora. Sin `confirmar` solo calcula la vista previa;
 * con `confirmar` aplica todo o nada: se valida el lote entero antes de escribir el primer archivo.
 * Solo escribe dentro de .rastro/.
 */
export function aplicarCambios(o: {
  repos: readonly string[];
  config: Config;
  cambios: readonly Cambio[];
  destino: "vigente" | "propuesta";
  confirmar: boolean;
  hoy: Fecha;
}): ResultadoCambios {
  const r = rutasGlobales();
  const semana = lunesDe(o.hoy);
  const archivo = o.destino === "vigente" ? r.plan : r.planSugerido;
  const markdown = existsSync(archivo) ? readFileSync(archivo, "utf8") : "";
  const plan = parsearPlan(markdown, o.hoy);
  const planVigente = o.destino === "vigente" ? plan : existsSync(r.plan) ? parsearPlan(readFileSync(r.plan, "utf8"), o.hoy) : null;
  const tareas: Tarea[] = (plan?.tareas ?? []).map((t) => ({ ...t }));
  const fijadosPorSemana = leerFijados();
  const fijados = new Map(Object.entries(fijadosPorSemana[semana] ?? {}));
  const correcciones = new Map(leerCorrecciones());
  const ofrecimientos = leerOfrecimientos();
  const lineasAparte: string[] = [];
  let cambiaPlan = false;
  let cambiaFijados = false;
  let cambiaCorrecciones = false;
  let cambiaOfrecimientos = false;
  const reestimadas = new Set<string>();
  const fijadasAhora = new Set<string>();

  const buscar = (de: readonly Tarea[], slugBuscado: string): Tarea => {
    const t = de.find((x) => x.slug === slugBuscado);
    if (t === undefined) throw new ErrorUsuario(`No existe la tarea "${slugBuscado}" en el plan de esta semana.`);
    return t;
  };
  const nombreDe = (slugTarea: string | null | undefined): string => (slugTarea === null || slugTarea === undefined ? "sin tarea" : (planVigente?.tareas.find((t) => t.slug === slugTarea)?.nombre ?? slugTarea));

  for (const c of o.cambios) {
    if (c.tipo === "vinculo") {
      if (c.tarea !== null) {
        if (planVigente === null) sinPlan("vigente");
        buscar(planVigente.tareas, c.tarea);
      }
      const completo = resolverCommit(o.repos, c.commit);
      const previa = correcciones.get(completo);
      lineasAparte.push(`Commit ${completo.slice(0, 7)}: ${previa === undefined ? "sin corrección" : nombreDe(previa)} → ${nombreDe(c.tarea)}`);
      correcciones.set(completo, c.tarea);
      cambiaCorrecciones = true;
      continue;
    }
    if (c.tipo === "ofrecimiento") {
      const i = ofrecimientos.findIndex((x) => x.id === c.id && x.estado === "pendiente");
      const oferta = ofrecimientos[i];
      if (oferta === undefined) throw new ErrorUsuario(`No hay un ofrecimiento pendiente con el id "${c.id}".`);
      cambiaOfrecimientos = true;
      if (c.accion === "descartar") {
        oferta.estado = "descartado";
        lineasAparte.push(`Ofrecimiento ${oferta.nombre}: descartado`);
        continue;
      }
      if (plan === null) sinPlan(o.destino);
      if (tareas.some((t) => t.slug === oferta.id)) throw new ErrorUsuario(`La tarea "${oferta.id}" ya está en el plan.`);
      tareas.push({ slug: oferta.id, nombre: oferta.nombre, objetivo: oferta.objetivo, estado: oferta.estadoSugerido ?? "pendiente", duracion: oferta.duracion, dias: [], noEntra: false, repo: oferta.repo ?? null });
      ofrecimientos.splice(i, 1);
      cambiaPlan = true;
      lineasAparte.push(`Ofrecimiento ${oferta.nombre}: aceptado, se agrega al plan`);
      continue;
    }
    if (plan === null) sinPlan(o.destino);
    const t = buscar(tareas, c.tarea);
    cambiaPlan = true;
    if (c.tipo === "duracion") {
      if (c.duracion !== null && !duracionEnRango(c.duracion)) throw new ErrorUsuario("La duración debe estar entre 0,25 y 80 h o entre 0,25 y 10 d.");
      t.duracion = c.duracion;
      reestimadas.add(t.slug);
    } else if (c.tipo === "repo") {
      t.repo = c.repo;
      // El repo es texto libre del usuario (REQ-3): un nombre no registrado se acepta, pero se avisa en la vista previa.
      if (c.repo !== null && !nombreRegistrado(c.repo)) {
        lineasAparte.push(`Aviso: "${c.repo}" no es un repo registrado; la tarea queda con ese nombre igual.`);
      }
    } else if (c.tipo === "estado") {
      // Conserva los días: son lo sugerido que el Gantt compara contra lo real. Una hecha o sacada igual no consume horas.
      t.estado = c.estado;
    } else {
      const fuera = c.dias.find((d) => d < semana || d > sumarDias(semana, 6));
      if (fuera !== undefined) throw new ErrorUsuario(`El día ${fuera} está fuera de la semana del ${ddmm(semana)}.`);
      fijados.set(c.tarea, c.dias);
      fijadasAhora.add(c.tarea);
      // Los días pedidos después de la duración mandan: no se recalculan encima.
      reestimadas.delete(c.tarea);
      cambiaFijados = true;
      // Fijar siempre se guarda y se dice, aunque los días pedidos sean los que ya tenía o la tarea no tenga duración todavía.
      lineasAparte.push(`${t.nombre}: queda fijada en ${textoDias(c.dias)}${t.duracion === null ? " (sin duración: no se reparte hasta que la tenga)" : ""}`);
    }
  }

  // Nunca se asignan días que ya pasaron, y lo que ya empezó no se mueve (salvo que se re-estime): mover una atrasada borraría el atraso.
  const desde = o.hoy > semana ? o.hoy : semana;
  // Re-estimar una tarea con días fijados la recalcula desde su primer día fijado: dejarla fija con la duración vieja repartida en los mismos días no cambiaría nada.
  const primerosFijados = new Map([...reestimadas].flatMap((slugTarea) => {
    const primero = fijados.get(slugTarea)?.[0];
    return primero === undefined ? [] : [[slugTarea, primero] as const];
  }));
  const { fijadas, inicios } = conservarEmpezadas({ tareas, desde, fijadas: new Map([...fijados].filter(([slugTarea]) => !primerosFijados.has(slugTarea))), reestimadas });
  for (const [slugTarea, primero] of primerosFijados) inicios.set(slugTarea, primero);
  const repartidas = cambiaPlan ? conReparto({ desde, semana, config: o.config, tareas, fijadas, inicios }) : tareas;
  const nuevas: Tarea[] = tareas.map((t, i) => ({ ...t, dias: repartidas[i]?.dias ?? t.dias, noEntra: repartidas[i]?.noEntra ?? t.noEntra }));
  const lineasPlan = nuevas.flatMap((despues, i) => {
    const antes = plan?.tareas[i];
    const partes = antes === undefined ? [] : diferencias(antes, despues);
    return partes.length === 0 ? [] : [`${despues.nombre}: ${partes.join(" · ")}`];
  });
  // Lo recalculado es ahora lo fijado, para que un cambio posterior no vuelva a los días de la duración vieja.
  for (const slugTarea of primerosFijados.keys()) {
    const dias = nuevas.find((t) => t.slug === slugTarea)?.dias ?? [];
    if (dias.length > 0) fijados.set(slugTarea, dias);
    else fijados.delete(slugTarea);
    cambiaFijados = true;
  }
  // Lo que no entra en los días fijados no se pierde en silencio: la persona decide si mueve la tarea o la achica.
  const lineasFaltante = repartidas.flatMap((r, i) => {
    const t = nuevas[i];
    return t === undefined || t.duracion === null || !("faltante" in r) || !fijadasAhora.has(t.slug)
      ? []
      : [`${t.nombre}: ${textoDuracion(t.duracion)} no entran en ${textoDias(t.dias)}; faltan ${textoDuracion({ valor: Math.round((r.faltante ?? 0) * 100) / 100, unidad: t.duracion.unidad })}`];
  });
  const vistaPrevia = [...lineasPlan, ...lineasAparte, ...lineasFaltante];
  if (vistaPrevia.length === 0) return { vistaPrevia: ["Sin cambios."], aplicado: false };
  if (!o.confirmar) return { vistaPrevia, aplicado: false };

  const escrituras: { archivo: string; contenido: string }[] = [];
  if (cambiaFijados) escrituras.push({ archivo: r.fijados, contenido: textoJson({ ...fijadosPorSemana, [semana]: Object.fromEntries(fijados) }) });
  if (cambiaCorrecciones) escrituras.push({ archivo: r.correcciones, contenido: textoJson(Object.fromEntries(correcciones)) });
  if (cambiaOfrecimientos) escrituras.push({ archivo: r.ofrecimientos, contenido: textoJson(ofrecimientos) });
  // El reparto de este cambio es la nueva base de la propuesta: confirmarla no debe tomarlo por días corregidos a mano.
  if (cambiaPlan && o.destino === "propuesta") escrituras.push({ archivo: r.planBase, contenido: textoJson(baseDe(semana, nuevas)) });
  if (cambiaPlan) escrituras.push({ archivo, contenido: actualizarTareas(markdown, o.hoy, nuevas) });
  escribirAtomico(r.dir, escrituras);
  return { vistaPrevia, aplicado: true };
}

function diasDeTexto(texto: string, hoy: Fecha): Fecha[] {
  const dias = parsearDias(texto, lunesDe(hoy));
  if (dias === null) throw new ErrorUsuario(`Los días "${texto}" no son válidos: usá, por ejemplo, lun–mar o lun, jue.`);
  return dias;
}

function duracionDeTexto(texto: string): { valor: number; unidad: "h" | "d" } | null {
  if (texto === "sin") return null;
  const duracion = parsearDuracion(texto);
  if (duracion === null) throw new ErrorUsuario(`La duración "${texto}" no es válida: usá, por ejemplo, 4d, 1,5h o sin.`);
  return duracion;
}

/** Traduce los argumentos de `rastro plan cambiar <tipo> <tarea|sha> <valor>` al mismo formato que el JSON y lo valida igual. */
export function cambioDeArgumentos(tipo: string, objetivo: string, valor: string, hoy: Fecha): Cambio {
  const crudo =
    tipo === "duracion"
      ? { tipo, tarea: objetivo, duracion: duracionDeTexto(valor) }
      : tipo === "dia"
        ? { tipo, tarea: objetivo, dias: diasDeTexto(valor, hoy) }
        : tipo === "estado"
          ? { tipo, tarea: objetivo, estado: valor }
          : tipo === "repo"
            ? { tipo, tarea: objetivo, repo: valor === "ninguno" ? null : valor }
            : tipo === "vinculo"
              ? { tipo, commit: objetivo, tarea: valor === "sin-tarea" ? null : valor }
              : tipo === "ofrecimiento"
                ? { tipo, id: objetivo, accion: valor }
                : null;
  if (crudo === null) throw new ErrorUsuario(`El tipo de cambio "${tipo}" no existe: usá duracion, dia, estado, repo, vinculo u ofrecimiento.`);
  const [cambio] = validarCambios([crudo]);
  if (cambio === undefined) throw new ErrorUsuario("Falta el cambio.");
  return cambio;
}
