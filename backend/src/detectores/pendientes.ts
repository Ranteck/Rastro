import type { Evidencia, Pendiente, Plan } from "../contract/snapshot.ts";
import { diasEntre } from "../fechas.ts";
import type { Commit, LineaAgregada, Rama } from "../git.ts";
import { redactar } from "../redactar.ts";
import { escaparRegex, normalizar } from "../texto.ts";
import { ramaContieneSlug, vincularPorNombre, type Vinculo } from "./vinculo.ts";

export type CommitVinculado = Commit & { vinculo: Vinculo };

export type EntradaPendientes = {
  plan: Plan | null;
  /** Commits sin merges desde el lunes de la semana. */
  commitsSemana: readonly CommitVinculado[];
  /** Commits sin merges del período pedido. */
  commitsPeriodo: readonly CommitVinculado[];
  merges: readonly Commit[];
  ramas: readonly Rama[];
  ramaPrincipal: string;
  lineasAgregadas: (sha: string) => LineaAgregada[];
  evidenciaCommit: (sha: string) => Evidencia;
  ahora: Date;
  ramaQuietaDias: number;
};

const RE_MERGE = /^Merge (?:branch '([^']+)'|pull request #\d+ from [^/\s]+\/(\S+))/;
const RE_CODIGO = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|c|cc|cpp|h|hpp|swift|sh)$/;
const RE_TEST = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[a-z]+$/;

// El marcador cuenta solo dentro de un comentario: un string, una regex o un .md que nombran TODO no son pendientes.
const RE_TODO_EN_COMENTARIO = /(?:\/\/|#|\/\*|^\s*\*|--|<!--)\s*(?:TODO|FIXME)\b/;

const esCodigo = (a: string): boolean => RE_CODIGO.test(a) && !RE_TEST.test(a);
const esDoc = (a: string): boolean => /(^|\/)README[^/]*$/i.test(a) || a.startsWith("docs/");

export function ramaDeMerge(asunto: string): string | null {
  const m = RE_MERGE.exec(asunto);
  return m?.[1] ?? m?.[2] ?? null;
}

export function detectarPendientes(e: EntradaPendientes): Pendiente[] {
  return [...resueltosSinCerrar(e), ...cerradosSinEvidencia(e), ...ramasQuietas(e), ...todosNuevos(e), ...codigoSinDoc(e)];
}

function resueltosSinCerrar(e: EntradaPendientes): Pendiente[] {
  const res: Pendiente[] = [];
  for (const t of e.plan?.tareas ?? []) {
    if (t.estado !== "pendiente") continue;
    const evidencia: Evidencia[] = [];
    const motivos: string[] = [];
    for (const r of e.ramas) {
      if (r.mergeada && ramaContieneSlug(r.nombre, t.slug)) {
        evidencia.push({ tipo: "rama", ref: r.nombre }, e.evidenciaCommit(r.sha));
        motivos.push(`la rama ${r.nombre} está mergeada`);
      }
    }
    for (const m of e.merges) {
      const rama = ramaDeMerge(m.asunto);
      if (rama !== null && ramaContieneSlug(rama, t.slug)) {
        evidencia.push(e.evidenciaCommit(m.sha));
        motivos.push(`se mergeó ${rama}`);
      }
    }
    const reCierre = new RegExp(`\\b(cierra|closes|close|fixes)\\s+\\[${escaparRegex(normalizar(t.nombre))}\\]`);
    for (const c of e.commitsSemana) {
      if (reCierre.test(normalizar(`${c.asunto}\n${c.cuerpo}`))) {
        evidencia.push(e.evidenciaCommit(c.sha));
        motivos.push(`el commit ${c.sha.slice(0, 7)} la cierra`);
      }
    }
    if (motivos.length > 0) {
      res.push({
        tipo: "resuelto-sin-cerrar",
        tarea: t.slug,
        texto: `${t.nombre} está resuelta en el código (${motivos[0]}), pero sigue abierta en el plan.`,
        evidencia,
        proximoPaso: `Tildar ${t.nombre} en el plan.`,
      });
    }
  }
  return res;
}

function cerradosSinEvidencia(e: EntradaPendientes): Pendiente[] {
  const conCommits = new Set(e.commitsSemana.map((c) => c.vinculo.tarea));
  return (e.plan?.tareas ?? [])
    .filter((t) => t.estado === "hecha" && !conCommits.has(t.slug))
    .map(
      (t): Pendiente => ({
        tipo: "cerrado-sin-evidencia",
        tarea: t.slug,
        texto: `${t.nombre} figura como hecha, pero no hay commits vinculados esta semana.`,
        evidencia: [],
        proximoPaso: `Vincular la evidencia (un commit con [${t.nombre}]) o revisar si está hecha.`,
      }),
    );
}

function ramasQuietas(e: EntradaPendientes): Pendiente[] {
  const tareas = e.plan?.tareas ?? [];
  return e.ramas
    .filter((r) => r.nombre !== e.ramaPrincipal && !r.mergeada && diasEntre(r.ultimoCommit, e.ahora) >= e.ramaQuietaDias)
    .map(
      (r): Pendiente => ({
        tipo: "rama-quieta",
        tarea: vincularPorNombre({ rama: r.nombre, asunto: "", cuerpo: "" }, tareas),
        texto: `La rama ${r.nombre} no tiene commits hace ${diasEntre(r.ultimoCommit, e.ahora)} días y no está mergeada.`,
        evidencia: [{ tipo: "rama", ref: r.nombre }, e.evidenciaCommit(r.sha)],
        proximoPaso: `Mergear, retomar o borrar ${r.nombre}.`,
      }),
    );
}

function todosNuevos(e: EntradaPendientes): Pendiente[] {
  const res: Pendiente[] = [];
  for (const c of e.commitsPeriodo) {
    const todos = e.lineasAgregadas(c.sha).filter((l) => esCodigo(l.archivo) && RE_TODO_EN_COMENTARIO.test(l.texto));
    const primera = todos[0]?.texto;
    if (primera === undefined) continue;
    res.push({
      tipo: "todo-nuevo",
      tarea: c.vinculo.tarea,
      texto: `${todos.length === 1 ? "Se agregó un TODO/FIXME" : `Se agregaron ${todos.length} TODO/FIXME, por ejemplo`}: "${redactar(primera.trim()).slice(0, 80)}".`,
      evidencia: [e.evidenciaCommit(c.sha)],
      proximoPaso: "Resolverlo o sumarlo como tarea al plan.",
    });
  }
  return res;
}

function codigoSinDoc(e: EntradaPendientes): Pendiente[] {
  const grupos = new Map<string, { tarea: string | null; etiqueta: string; commits: CommitVinculado[] }>();
  for (const c of e.commitsPeriodo) {
    const clave = c.vinculo.tarea ?? `rama:${c.rama}`;
    const nombre = e.plan?.tareas.find((t) => t.slug === c.vinculo.tarea)?.nombre;
    const grupo = grupos.get(clave) ?? { tarea: c.vinculo.tarea, etiqueta: nombre ?? `la rama ${c.rama}`, commits: [] };
    grupo.commits.push(c);
    grupos.set(clave, grupo);
  }
  return [...grupos.values()]
    .filter((g) => {
      const archivos = g.commits.flatMap((c) => c.archivos);
      return archivos.some(esCodigo) && !archivos.some(esDoc);
    })
    .map(
      (g): Pendiente => ({
        tipo: "codigo-sin-doc",
        tarea: g.tarea,
        texto: `Cambió código de ${g.etiqueta} y no se actualizó README ni docs/.`,
        evidencia: g.commits.slice(0, 3).map((c) => e.evidenciaCommit(c.sha)),
        proximoPaso: "Revisar si hace falta documentar el cambio.",
      }),
    );
}
