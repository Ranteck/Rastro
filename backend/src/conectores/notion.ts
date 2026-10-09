import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Snapshot } from "../contract/snapshot.ts";
import { ddmm } from "../fechas.ts";
import type { Conector } from "./conector.ts";

/** Formato de la página Daily de daily-flock: "### DD/MM" y "- HH.MMhs **Tarea:** texto", en orden de hora. */
export function entradasDailyFlock(s: Snapshot): string {
  const nombreDe = (slug: string | null, rama: string): string => s.plan?.tareas.find((t) => t.slug === slug)?.nombre ?? rama;
  const porDia = new Map<string, string[]>();
  const enOrden = [...s.bitacora].sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));
  for (const e of enOrden) {
    porDia.set(e.fecha, [...(porDia.get(e.fecha) ?? []), `- ${e.hora.replace(":", ".")}hs **${nombreDe(e.tarea, e.rama)}:** ${e.texto}`]);
  }
  const bloques = [...porDia.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([fecha, lineas]) => [`### ${ddmm(fecha)}`, ...lineas].join("\n"));
  return `${bloques.join("\n\n")}\n`;
}

export class ConectorNotionMock implements Conector {
  readonly nombre = "notion";
  readonly #archivo: string;

  constructor(archivo: string) {
    this.#archivo = archivo;
  }

  async publicar(s: Snapshot): Promise<string> {
    mkdirSync(dirname(this.#archivo), { recursive: true });
    writeFileSync(this.#archivo, entradasDailyFlock(s));
    return `vista previa en ${this.#archivo} (modo mock)`;
  }
}
