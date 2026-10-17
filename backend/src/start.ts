import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ESTATICOS, cmdServe } from "./central/cmd.ts";
import { leerConfig, rutasGlobales } from "./config.ts";
import { reposObservados } from "./daily.ts";
import { ErrorUsuario } from "./errores.ts";
import { log } from "./log.ts";
import { horaDelDailyReal } from "./programador.ts";
import { horaOpcional } from "./sinDaily.ts";
import { versionDeRastro } from "./version.ts";

/** Abre `url` en el navegador; rechaza si no pudo lanzarlo. */
export type Lanzador = (url: string) => Promise<void>;

/** `horaDaily` es la hora del daily automático instalado, si hay uno. */
export type EntornoStart = { lanzar: Lanzador; estaticos: string; horaDaily?: () => Promise<string | null> };

export function comandoParaAbrir(plataforma: NodeJS.Platform, url: string): { bin: string; args: string[] } {
  if (plataforma === "darwin") return { bin: "open", args: [url] };
  // `start` es un builtin de cmd; el "" es el título de la ventana.
  if (plataforma === "win32") return { bin: "cmd", args: ["/c", "start", "", url] };
  return { bin: "xdg-open", args: [url] };
}

export const abrirNavegador: Lanzador = (url) =>
  new Promise((resolver, rechazar) => {
    const { bin, args } = comandoParaAbrir(process.platform, url);
    const hijo = spawn(bin, args, { stdio: "ignore", detached: true });
    hijo.once("error", rechazar);
    hijo.once("spawn", () => {
      hijo.unref();
      resolver();
    });
  });

/** ¿Hay en `puerto` un central de Rastro en modo personal sobre esta misma carpeta global? */
async function centralPersonal(puerto: number, dir: string): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${puerto}/api/sesion`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return false;
    const cuerpo = (await r.json()) as { personal?: unknown; dir?: unknown };
    return cuerpo.personal === true && cuerpo.dir === dir;
  } catch {
    // Nadie escucha, o no es un central de Rastro: serve decide qué error dar.
    return false;
  }
}

/** El build del frontend deja su versión en dist/version.txt; un dist de 0.1.x no la tiene. */
function versionDelDashboard(estaticos: string): string | null {
  const archivo = join(estaticos, "version.txt");
  return existsSync(archivo) ? readFileSync(archivo, "utf8").trim() : null;
}

async function abrir(lanzar: Lanzador, url: string): Promise<void> {
  process.stdout.write(`Dashboard: ${url}\n`);
  try {
    await lanzar(url);
  } catch {
    // Sin navegador (p. ej. falta xdg-open) el central sigue sirviendo: la URL ya está impresa.
    process.stderr.write("rastro: no pude abrir el navegador; abrí la URL de arriba a mano.\n");
  }
}

export async function start(args: string[], entorno: EntornoStart): Promise<number> {
  const { values } = parseArgs({ args, options: { puerto: { type: "string", default: "4317" }, "sin-navegador": { type: "boolean", default: false } } });
  const puerto = Number(values.puerto);
  if (!Number.isInteger(puerto) || puerto < 0 || puerto > 65535) throw new ErrorUsuario("--puerto tiene que ser un número entre 0 y 65535.");
  reposObservados();
  const persona = leerConfig().persona.id;
  if (!existsSync(entorno.estaticos)) {
    throw new ErrorUsuario("Falta el dashboard construido: corré `cd frontend && npm install && npm run build` (o usá /rastro:init en Claude Code).");
  }
  const construida = versionDelDashboard(entorno.estaticos);
  const version = versionDeRastro();
  // Un dashboard viejo habla otro contrato y se ve roto: se avisa sin frenar, porque el central sirve igual.
  if (construida !== version) {
    log("warn", "dashboard_desactualizado", { construido: construida ?? "sin versión", cli: version, reconstruir: "cd frontend && npm install && npm run build (o /rastro:init en Claude Code)" });
  }
  if (!existsSync(rutasGlobales().state)) {
    const hora = entorno.horaDaily === undefined ? null : await horaOpcional(entorno.horaDaily);
    // No frena: el dashboard sirve igual, con el plan si ya hay uno.
    process.stderr.write(`rastro: Todavía no corrió el daily: el dashboard va a estar casi vacío. Corré \`rastro daily\` (o decile a Claude «cerrá el día»)${hora === null ? "." : ` o esperá al automático de las ${hora}.`}\n`);
  }
  const urlDe = (p: number): string => `http://127.0.0.1:${p}/#/persona/${persona}/mi-dia`;
  const navegar = async (p: number): Promise<void> => {
    if (values["sin-navegador"]) process.stdout.write(`Dashboard: ${urlDe(p)}\n`);
    else await abrir(entorno.lanzar, urlDe(p));
  };

  if (puerto > 0 && (await centralPersonal(puerto, rutasGlobales().dir))) {
    process.stdout.write(`Rastro ya estaba corriendo en el puerto ${puerto}.\n`);
    await navegar(puerto);
    return 0;
  }
  return cmdServe(["--puerto", String(puerto), "--personal"], { estaticos: entorno.estaticos, alEscuchar: navegar, ...(entorno.horaDaily === undefined ? {} : { horaDaily: entorno.horaDaily }) });
}

export const cmdStart = (args: string[]): Promise<number> => start(args, { lanzar: abrirNavegador, estaticos: ESTATICOS, horaDaily: horaDelDailyReal });
