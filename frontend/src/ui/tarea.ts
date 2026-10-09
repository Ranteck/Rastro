import type { Snapshot } from "../../../backend/src/contract/snapshot.ts";

export function nombreDeTarea(snapshot: Snapshot, slug: string | null): string {
  if (slug === null) return "sin tarea";
  return snapshot.plan?.tareas.find((t) => t.slug === slug)?.nombre ?? slug;
}
