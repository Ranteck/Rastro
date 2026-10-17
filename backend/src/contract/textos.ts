import type { Snapshot } from "./snapshot.ts";

/** Módulo puro, sin Node: lo importan la CLI y el frontend. */
export function textoParaPegar(snapshot: Snapshot, slugDeTarea: string): string | null {
  const entradas = snapshot.bitacora
    .filter((e) => e.tarea === slugDeTarea)
    .sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));
  return entradas.length === 0 ? null : entradas.map((e) => `- ${e.texto}`).join("\n");
}
