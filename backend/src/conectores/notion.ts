import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Snapshot } from "../contract/snapshot.ts";
import { arr, bool, ErrorValidacion, objAbierto, str } from "../contract/validar.ts";
import { ErrorUsuario } from "../errores.ts";
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

const PERMITIDAS = ["Skill(daily-flock)", "mcp__claude_ai_Notion__notion-fetch", "mcp__claude_ai_Notion__notion-update-page"];
const checkSalidaNotion = objAbierto({ is_error: bool, result: str });
const checkSettings = objAbierto({}, { permissions: objAbierto({}, { allow: arr(str) }) });

/** Permisos globales del usuario que `--allowedTools` no restringe y hay que prohibir de forma explícita. */
function permisosAProhibir(home: string): string[] {
  const archivo = join(home, ".claude", "settings.json");
  let crudo: string;
  try {
    crudo = readFileSync(archivo, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new ErrorUsuario(`No pude leer ${archivo}; no publico en Notion sin saber qué permisos tiene claude.`, { cause: e });
  }
  try {
    const allow = checkSettings(JSON.parse(crudo), "settings.json").permissions?.allow ?? [];
    return allow.filter((p) => !PERMITIDAS.includes(p));
  } catch (e) {
    if (e instanceof SyntaxError || e instanceof ErrorValidacion) {
      throw new ErrorUsuario(`${archivo} no es válido (${e.message}); no publico en Notion sin saber qué permisos tiene claude.`, { cause: e });
    }
    throw e;
  }
}

/** Publica en la Daily de Notion delegando en la skill daily-flock, como ya hace Denis a mano. */
export class ConectorNotionClaude implements Conector {
  readonly nombre = "notion";
  readonly #modelo: string;
  readonly #ejecutar: Ejecutor;
  readonly #home: string;
  readonly #pagina: string | undefined;

  constructor(o: { modelo: string; ejecutar?: Ejecutor; home?: string; pagina?: string }) {
    this.#modelo = o.modelo;
    this.#pagina = o.pagina;
    this.#ejecutar = o.ejecutar ?? ejecutarProceso;
    this.#home = o.home ?? homedir();
  }

  async publicar(s: Snapshot): Promise<string> {
    const entradas = entradasDailyFlock(s);
    const destino = this.#pagina === undefined ? "la Daily de Notion" : `la página ${this.#pagina} de Notion`;
    if (entradas.trim() === "") return `nada para publicar en ${destino}`;
    const instruccion =
      this.#pagina === undefined
        ? "Usá la skill daily-flock (Flujo A: registrar entradas) para agregar a la página Daily estas entradas, respetando la fecha y la hora de cada una. No agregues nada más ni cambies lo que ya está."
        : `Usá notion-fetch para leer la página ${this.#pagina} y, con notion-update-page, agregá al final estas entradas tal cual (formato de la Daily de daily-flock). No toques ninguna otra página ni cambies lo que ya está. No uses la skill daily-flock ni escribas en la página Daily.`;
    const prompt = redactar(
      [
        instruccion,
        "",
        entradas,
      ].join("\n"),
    );
    // Excepción documentada a los flags de las demás llamadas a claude -p: necesita el conector de Notion de claude.ai
    // y la skill daily-flock, así que no puede usar --strict-mcp-config ni --setting-sources "". La restricción sale de
    // --tools Skill, --permission-mode dontAsk y --disallowedTools con los permisos globales del usuario, porque
    // --allowedTools solo preaprueba y no limita.
    const prohibidas = permisosAProhibir(this.#home);
    const args = [
      "-p", "--output-format", "json", "--model", this.#modelo, "--no-session-persistence",
      "--tools", "Skill", "--permission-mode", "dontAsk", "--setting-sources", "user", "--allowedTools", PERMITIDAS.join(","),
      ...(prohibidas.length > 0 ? ["--disallowedTools", prohibidas.join(",")] : []),
    ];
    // Directorio privado propio: no carga los settings del repo ni su hook SessionEnd.
    const cache = join(this.#home, ".cache");
    mkdirSync(cache, { recursive: true });
    const cwd = mkdtempSync(join(cache, "rastro-notion-"));
    try {
      const r = await this.#ejecutar("claude", args, prompt, 300_000, cwd);
      if (r.codigo !== 0) throw new Error(`claude salió con ${String(r.codigo)}: ${r.stderr.slice(0, 200)}`);
      const salida = checkSalidaNotion(JSON.parse(r.stdout), "claude");
      if (salida.is_error) throw new Error(`claude no pudo escribir en Notion: ${salida.result.slice(0, 200)}`);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
    return `registrado en ${destino} con claude`;
  }
}
