import type { Tarea } from "../contract/snapshot.ts";
import { normalizar } from "../texto.ts";

export type Vinculo = { tarea: string | null; tipo: "nombre" | "inferido" | "sin-tarea"; razon?: string };

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
