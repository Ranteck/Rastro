import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { arr, bool, ErrorValidacion, fecha, lit, num, obj, patron, slug, str, type Check, type Infer } from "./contract/validar.ts";
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

const numEntre = (min: number, max: number): Check<number> => (v, r) => {
  const n = num(v, r);
  if (n < min || n > max) throw new ErrorValidacion(r, `se esperaba un número entre ${min} y ${max}`);
  return n;
};

const enteroMinimo1: Check<number> = (v, r) => {
  const n = num(v, r);
  if (!Number.isInteger(n) || n < 1) throw new ErrorValidacion(r, "se esperaba un entero mayor o igual a 1");
  return n;
};

export const DIAS_SEMANA = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"] as const;
const dia = lit(...DIAS_SEMANA);

// Cada subcampo es opcional: un objeto incompleto toma el valor por defecto de lo que le falta.
const checkDisponibilidad = obj(
  {},
  {
    horasDia: numEntre(1, 24),
    dias: arr(dia),
    fijos: arr(obj({ nombre: str, dias: arr(dia), horas: numEntre(0, 24) })),
    excepciones: arr(obj({ fecha, horas: numEntre(0, 24) })),
  },
);

// Los campos de disponibilidad, chat y umbrales.atrasadas son opcionales en el archivo para que los configs
// anteriores sigan cargando; leerConfig les pone el valor por defecto.
const checkArchivo = obj(
  {
    persona: obj({ id: slug, nombre: str, equipo: str }),
    zonaHoraria,
    conectores: arr(lit("central", "notion")),
    central: obj({ url: urlHttp }),
    notion: obj({ modo: lit("mock", "claude") }, { pagina: patron(/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i, "un id de página de Notion: 32 caracteres hexadecimales, con o sin guiones") }),
    compartir: obj({ sugerencias: bool }),
    umbrales: obj(
      {
        ramaQuietaDias: num,
        fueraDelPlanPct: num,
        repeticiones: obj({ veces: num, dias: num, ventanaMin: num }),
      },
      { atrasadas: enteroMinimo1 },
    ),
    llm: obj({ proveedor: lit("claude-cli", "ninguno"), modelo: str }),
    fuentes: obj({ zshHistory: str, claudeProjects: str }),
  },
  { disponibilidad: checkDisponibilidad, chat: obj({}, { modelo: str }) },
);

type Archivo = Infer<typeof checkArchivo>;
export type Disponibilidad = Required<Infer<typeof checkDisponibilidad>>;
export type Config = Omit<Archivo, "disponibilidad" | "umbrales"> & {
  disponibilidad: Disponibilidad;
  umbrales: Omit<Archivo["umbrales"], "atrasadas"> & { atrasadas: number };
};

export const disponibilidadPorDefecto: Disponibilidad = {
  horasDia: 8,
  dias: ["lun", "mar", "mie", "jue", "vie"],
  fijos: [
    { nombre: "Daily", dias: ["lun", "mar", "mie", "jue", "vie"], horas: 0.25 },
    { nombre: "Checkpoint", dias: ["jue", "vie"], horas: 1.5 },
  ],
  excepciones: [],
};

export function configPorDefecto(persona: Config["persona"]): Config {
  return {
    persona,
    zonaHoraria: "America/Argentina/Buenos_Aires",
    conectores: ["central", "notion"],
    central: { url: "http://127.0.0.1:4317" },
    notion: { modo: "mock" },
    compartir: { sugerencias: false },
    umbrales: { ramaQuietaDias: 3, fueraDelPlanPct: 50, repeticiones: { veces: 3, dias: 2, ventanaMin: 10 }, atrasadas: 1 },
    disponibilidad: structuredClone(disponibilidadPorDefecto),
    llm: { proveedor: "claude-cli", modelo: "haiku" },
    fuentes: { zshHistory: "~/.zsh_history", claudeProjects: "~/.claude/projects" },
  };
}

export type RutasGlobales = {
  dir: string;
  config: string;
  plan: string;
  planSugerido: string;
  planBase: string;
  ofrecimientos: string;
  state: string;
  publicado: string;
  fijados: string;
  correcciones: string;
  chat: string;
  errores: string;
  notionPreview: string;
  notionBase: string;
  cronLog: string;
  repos: string;
};

/** Los datos de la persona: una sola carpeta para toda la PC (`$RASTRO_HOME` la reemplaza, p. ej. en los tests). */
export function rutasGlobales(): RutasGlobales {
  // Absoluta: el chat, el central y start comparan y publican esta ruta desde procesos con otro cwd.
  const dir = resolve(process.env["RASTRO_HOME"] ?? join(homedir(), ".rastro"));
  return {
    dir,
    config: join(dir, "config.json"),
    plan: join(dir, "plan.md"),
    planSugerido: join(dir, "plan.sugerido.md"),
    planBase: join(dir, "plan.base.json"),
    ofrecimientos: join(dir, "ofrecimientos.json"),
    state: join(dir, "state.json"),
    publicado: join(dir, "publicado.json"),
    fijados: join(dir, "fijados.json"),
    correcciones: join(dir, "correcciones.json"),
    chat: join(dir, "chat.json"),
    errores: join(dir, "errors.log"),
    notionPreview: join(dir, "notion-preview.md"),
    notionBase: join(dir, "notion-base.md"),
    cronLog: join(dir, "cron.log"),
    repos: join(dir, "repos.json"),
  };
}

/** Lo único que Rastro guarda dentro de un repo observado. */
export function rutasRepo(repo: string): { dir: string; eventos: string } {
  const dir = join(repo, ".rastro");
  return { dir, eventos: join(dir, "events.jsonl") };
}

export function leerConfig(): Config {
  const archivo = rutasGlobales().config;
  if (!existsSync(archivo)) throw new ErrorUsuario("Todavía no hay configuración de Rastro: corré `rastro init` en un repo.");
  try {
    const leido = checkArchivo(JSON.parse(readFileSync(archivo, "utf8")), "config");
    return {
      ...leido,
      umbrales: { ...leido.umbrales, atrasadas: leido.umbrales.atrasadas ?? 1 },
      disponibilidad: { ...structuredClone(disponibilidadPorDefecto), ...leido.disponibilidad },
    };
  } catch (e) {
    if (e instanceof ErrorValidacion || e instanceof SyntaxError) {
      throw new ErrorUsuario(`${archivo} no es válido: ${e.message}`, { cause: e });
    }
    throw e;
  }
}

export function escribirConfig(config: Config): void {
  const r = rutasGlobales();
  mkdirSync(r.dir, { recursive: true });
  writeFileSync(r.config, `${JSON.stringify(config, null, 2)}\n`);
}

export function expandirHome(ruta: string): string {
  return ruta === "~" || ruta.startsWith("~/") ? join(homedir(), ruta.slice(1)) : ruta;
}
