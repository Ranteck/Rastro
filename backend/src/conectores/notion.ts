import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import type { Snapshot } from "../contract/snapshot.ts";
import { bool, objAbierto, str } from "../contract/validar.ts";
import { ddmm } from "../fechas.ts";
import { ejecutarProceso, type Ejecutor } from "../llm/claudeCli.ts";
import { redactar } from "../redactar.ts";
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

const HERRAMIENTAS_NOTION = ["Skill", "mcp__claude_ai_Notion__notion-fetch", "mcp__claude_ai_Notion__notion-update-page"];
const checkSalidaNotion = objAbierto({ is_error: bool, result: str });

/** Publica en la Daily de Notion delegando en la skill daily-flock, como ya hace Denis a mano. */
export class ConectorNotionClaude implements Conector {
  readonly nombre = "notion";
  readonly #modelo: string;
  readonly #ejecutar: Ejecutor;

  constructor(o: { modelo: string; ejecutar?: Ejecutor }) {
    this.#modelo = o.modelo;
    this.#ejecutar = o.ejecutar ?? ejecutarProceso;
  }

  async publicar(s: Snapshot): Promise<string> {
    const prompt = redactar(
      [
        "Usá la skill daily-flock (Flujo A: registrar entradas) para agregar a la página Daily estas entradas, respetando la fecha y la hora de cada una. No agregues nada más ni cambies lo que ya está.",
        "",
        entradasDailyFlock(s),
      ].join("\n"),
    );
    // Excepción a los flags de las demás llamadas a claude -p: necesita MCP y la herramienta Skill,
    // así que no usa --tools "", --strict-mcp-config, --setting-sources "" ni --json-schema.
    const args = ["-p", "--output-format", "json", "--model", this.#modelo, "--no-session-persistence", "--allowedTools", HERRAMIENTAS_NOTION.join(",")];
    // Corre en un directorio temporal para no cargar los settings del repo ni su hook SessionEnd.
    const r = await this.#ejecutar("claude", args, prompt, 300_000, tmpdir());
    if (r.codigo !== 0) throw new Error(`claude salió con ${String(r.codigo)}: ${r.stderr.slice(0, 200)}`);
    const salida = checkSalidaNotion(JSON.parse(r.stdout), "claude");
    if (salida.is_error) throw new Error(`claude no pudo escribir en Notion: ${salida.result.slice(0, 200)}`);
    return "registrado en la Daily de Notion con daily-flock";
  }
}
