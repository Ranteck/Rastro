import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { arr, bool, ErrorValidacion, lit, num, obj, slug, str, type Check, type Infer } from "./contract/validar.ts";
import { ErrorUsuario } from "./errores.ts";

const zonaHoraria: Check<string> = (v, r) => {
  const zona = str(v, r);
  try {
    new Intl.DateTimeFormat("en", { timeZone: zona });
  } catch {
    throw new ErrorValidacion(r, "se esperaba una zona horaria IANA, como America/Argentina/Buenos_Aires");
  }
  return zona;
};

const urlHttp: Check<string> = (v, r) => {
  const texto = str(v, r);
  let protocolo: string | null = null;
  try {
    protocolo = new URL(texto).protocol;
  } catch {
    // Texto que no parsea como URL: se rechaza abajo con el mismo mensaje.
  }
  if (protocolo !== "http:" && protocolo !== "https:") throw new ErrorValidacion(r, "se esperaba una URL http o https");
  return texto;
};

const checkConfig = obj({
  persona: obj({ id: slug, nombre: str, equipo: str }),
  zonaHoraria,
  conectores: arr(lit("central", "notion")),
  central: obj({ url: urlHttp }),
  notion: obj({ modo: lit("mock", "claude") }),
  compartir: obj({ sugerencias: bool }),
  umbrales: obj({
    ramaQuietaDias: num,
    fueraDelPlanPct: num,
    repeticiones: obj({ veces: num, dias: num, ventanaMin: num }),
  }),
  llm: obj({ proveedor: lit("claude-cli", "ninguno"), modelo: str }),
  fuentes: obj({ zshHistory: str, claudeProjects: str }),
});

export type Config = Infer<typeof checkConfig>;

export function configPorDefecto(persona: Config["persona"]): Config {
  return {
    persona,
    zonaHoraria: "America/Argentina/Buenos_Aires",
    conectores: ["central", "notion"],
    central: { url: "http://127.0.0.1:4317" },
    notion: { modo: "mock" },
    compartir: { sugerencias: false },
    umbrales: { ramaQuietaDias: 3, fueraDelPlanPct: 50, repeticiones: { veces: 3, dias: 2, ventanaMin: 10 } },
    llm: { proveedor: "claude-cli", modelo: "haiku" },
    fuentes: { zshHistory: "~/.zsh_history", claudeProjects: "~/.claude/projects" },
  };
}

export type Rutas = {
  dir: string;
  config: string;
  eventos: string;
  plan: string;
  planSugerido: string;
  state: string;
  errores: string;
  notionPreview: string;
};

export function rutas(repo: string): Rutas {
  const dir = join(repo, ".rastro");
  return {
    dir,
    config: join(dir, "config.json"),
    eventos: join(dir, "events.jsonl"),
    plan: join(dir, "plan.md"),
    planSugerido: join(dir, "plan.sugerido.md"),
    state: join(dir, "state.json"),
    errores: join(dir, "errors.log"),
    notionPreview: join(dir, "notion-preview.md"),
  };
}

export function leerConfig(repo: string): Config {
  const archivo = rutas(repo).config;
  if (!existsSync(archivo)) throw new ErrorUsuario("Este repo no tiene .rastro/config.json: corré `rastro init`.");
  try {
    return checkConfig(JSON.parse(readFileSync(archivo, "utf8")), "config");
  } catch (e) {
    if (e instanceof ErrorValidacion || e instanceof SyntaxError) {
      throw new ErrorUsuario(`.rastro/config.json no es válido: ${e.message}`, { cause: e });
    }
    throw e;
  }
}

export function escribirConfig(repo: string, config: Config): void {
  mkdirSync(rutas(repo).dir, { recursive: true });
  writeFileSync(rutas(repo).config, `${JSON.stringify(config, null, 2)}\n`);
}

export function expandirHome(ruta: string): string {
  return ruta === "~" || ruta.startsWith("~/") ? join(homedir(), ruta.slice(1)) : ruta;
}
