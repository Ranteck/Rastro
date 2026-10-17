import type { Snapshot } from "../../../backend/src/contract/snapshot.ts";

/** Los repos que nombra el snapshot, sin repetir y en orden alfabético. Sale de los datos y no de `snapshot.repo`, que con varios repos es una lista de texto. */
export function reposDelSnapshot(snapshot: Snapshot): string[] {
  const nombres = [
    ...(snapshot.plan?.tareas.map((t) => t.repo) ?? []),
    ...snapshot.bitacora.map((e) => e.repo),
    ...snapshot.gantt.barras.map((b) => b.repo),
    ...snapshot.ofrecimientos.map((o) => o.repo),
  ];
  return [...new Set(nombres.filter((n): n is string => typeof n === "string"))].sort((a, b) => a.localeCompare(b));
}
