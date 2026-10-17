import { accessSync, constants } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ErrorUsuario } from "./errores.ts";
import { comillas } from "./texto.ts";
import type { Ejecutor } from "./llm/claudeCli.ts";

export const HORA_POR_DEFECTO = "18:30";
const BIN_RASTRO = fileURLToPath(new URL("../bin/rastro.js", import.meta.url));

const MARCA_GLOBAL = "# rastro:global";
// La versión anterior marcaba una línea por repo con su ruta absoluta; la marca global nunca empieza con "/".
const esGlobal = (linea: string): boolean => linea.endsWith(` ${MARCA_GLOBAL}`);
const esPorRepo = (linea: string): boolean => / # rastro:\/[^\n]*$/.test(linea);
export const esDeRastro = (linea: string): boolean => esGlobal(linea) || esPorRepo(linea);

export function parsearHora(texto: string): { h: number; m: number } {
  const partes = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(texto);
  if (partes === null) throw new ErrorUsuario(`La hora "${texto}" no es válida: usá HH:MM, por ejemplo 18:30.`);
  return { h: Number(partes[1]), m: Number(partes[2]) };
}

/** La línea de crontab global: de lunes a viernes a `hora`, con la salida en el cron.log de la carpeta global. */
export function lineaDeCron(o: { dir: string; log: string; hora: string; node: string; bin: string; path: string; claudeConfigDir?: string }): string {
  const { h, m } = parsearHora(o.hora);
  // RASTRO_HOME va fijo: el cron corre con otro entorno y tiene que encontrar la misma carpeta global que la terminal.
  // CLAUDE_CONFIG_DIR va si estaba definida al instalar: `claude -p` tiene que usar la misma cuenta que la terminal.
  const cuenta = o.claudeConfigDir === undefined ? "" : ` CLAUDE_CONFIG_DIR=${comillas(o.claudeConfigDir)}`;
  const comando = `cd ${comillas(o.dir)} && RASTRO_HOME=${comillas(o.dir)}${cuenta} PATH=${comillas(o.path)} ${comillas(o.node)} ${comillas(o.bin)} daily >> ${comillas(o.log)} 2>&1`;
  // En crontab, `%` es un salto de línea salvo que se escape.
  return `${m} ${h} * * 1-5 ${comando.replaceAll("%", "\\%")} ${MARCA_GLOBAL}`;
}

/** Crontab viejo → crontab nuevo: saca la línea global y las por repo de la versión anterior y, si hay `linea`, agrega la global. Las demás quedan intactas. */
export function crontabNuevo(viejo: string, linea: string | null): string {
  const resto = viejo.split("\n").filter((l) => l !== "" && !esDeRastro(l));
  if (linea !== null) resto.push(linea);
  return resto.length === 0 ? "" : `${resto.join("\n")}\n`;
}

/** La hora instalada de la línea global, o null si no hay. */
export function horaInstalada(crontab: string): string | null {
  const linea = crontab.split("\n").find(esGlobal);
  const partes = linea === undefined ? null : /^(\d+) (\d+) /.exec(linea);
  return partes === null ? null : `${(partes[2] ?? "").padStart(2, "0")}:${(partes[1] ?? "").padStart(2, "0")}`;
}

/** Los repos de las líneas por repo de la versión anterior que siguen en el crontab: cada una corre hoy el daily global. */
export function reposDeLineasViejas(crontab: string): string[] {
  return crontab.split("\n").flatMap((l) => (esPorRepo(l) ? [l.slice(l.lastIndexOf(" # rastro:") + " # rastro:".length)] : []));
}

export type EntornoCron = { node: string; bin: string; path: string; claudeConfigDir?: string };

/** El crontab del usuario, o null si `crontab` no está instalado. */
export async function leerCrontab(ejecutar: Ejecutor): Promise<string | null> {
  let r: Awaited<ReturnType<Ejecutor>>;
  try {
    r = await ejecutar("crontab", ["-l"], "", 10_000);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ErrorUsuario("No pude leer el crontab.", { cause: e });
  }
  if (r.codigo === 0) return r.stdout;
  // Sin crontab todavía, `crontab -l` sale con 1: es el estado inicial, no un error.
  if (r.stderr.startsWith("no crontab for")) return "";
  throw new ErrorUsuario(`No pude leer el crontab (crontab -l salió con ${String(r.codigo)}).`);
}

export async function escribirCrontab(ejecutar: Ejecutor, contenido: string): Promise<void> {
  let r: Awaited<ReturnType<Ejecutor>>;
  try {
    r = await ejecutar("crontab", ["-"], contenido, 10_000);
  } catch (e) {
    throw new ErrorUsuario((e as NodeJS.ErrnoException).code === "ENOENT" ? "No pude escribir el crontab: ¿está instalado `crontab`?" : "No pude escribir el crontab.", { cause: e });
  }
  if (r.codigo !== 0) throw new ErrorUsuario(`No pude escribir el crontab (crontab - salió con ${String(r.codigo)}).`);
}

function buscarEnPath(nombre: string, path: string): string | null {
  for (const dir of path.split(delimiter)) {
    if (dir === "") continue;
    try {
      accessSync(join(dir, nombre), constants.X_OK);
      return join(dir, nombre);
    } catch {
      // No está en este directorio: se sigue con el siguiente.
    }
  }
  return null;
}

/** El entorno real: `node` es el que corre ahora, `claude` se busca en el PATH actual y el PATH del cron los incluye a ambos. */
export function entornoReal(): EntornoCron {
  const claude = buscarEnPath("claude", process.env["PATH"] ?? "");
  if (claude === null) throw new ErrorUsuario("No encuentro `claude` en el PATH: el daily automático lo necesita. Instalá Claude Code y reintentá.");
  const dirs = [dirname(process.execPath), dirname(claude), "/usr/local/bin", "/usr/bin", "/bin"];
  const cuenta = process.env["CLAUDE_CONFIG_DIR"];
  return { node: process.execPath, bin: BIN_RASTRO, path: [...new Set(dirs)].join(delimiter), ...(cuenta === undefined || cuenta === "" ? {} : { claudeConfigDir: cuenta }) };
}
