import type { Tarea } from "../contract/snapshot.ts";
import { normalizar } from "../texto.ts";

export type Vinculo = { tarea: string | null; tipo: "nombre" | "inferido" | "sin-tarea" | "corregido"; razon?: string };

/** "feat/docker-gui" contiene "docker-gui", pero "feat/planner" no contiene "plan". */
export function ramaContieneSlug(rama: string, slug: string): boolean {
  const tokens = normalizar(rama).split(/[^a-z0-9]+/).filter((t) => t !== "");
  return `-${tokens.join("-")}-`.includes(`-${slug}-`);
}

export function vincularPorNombre(c: { rama: string; asunto: string; cuerpo: string }, tareas: readonly Tarea[]): string | null {
  const mensaje = normalizar(`${c.asunto}\n${c.cuerpo}`);
  // El slug más largo primero: "docker-gui" gana sobre "docker".
  const porLargo = [...tareas].sort((a, b) => b.slug.length - a.slug.length);
  return (
    porLargo.find((t) => mensaje.includes(`[${normalizar(t.nombre)}]`))?.slug ??
    porLargo.find((t) => ramaContieneSlug(c.rama, t.slug))?.slug ??
    null
  );
}

/** Una corrección manual manda sobre el tag y la inferencia. Si apunta a una tarea que ya no está en el plan no se puede aplicar y se ignora. */
export function vinculoCorregido(correcciones: ReadonlyMap<string, string | null>, sha: string, tareas: readonly Tarea[]): Vinculo | null {
  const corregida = correcciones.get(sha);
  if (corregida === undefined || (corregida !== null && !tareas.some((t) => t.slug === corregida))) return null;
  return { tarea: corregida, tipo: "corregido" };
}
