import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { rutasGlobales } from "./config.ts";
import { HORA_POR_DEFECTO, crontabNuevo, entornoReal, escribirCrontab, esDeRastro, horaInstalada, leerCrontab, lineaDeCron, parsearHora, reposDeLineasViejas, type EntornoCron } from "./cron.ts";
import { reposObservados } from "./daily.ts";
import { ErrorUsuario } from "./errores.ts";
import { ejecutarProceso, type Ejecutor } from "./llm/claudeCli.ts";

type Tipo = "systemd" | "launchd" | "crontab";
export type Opciones = { home: string; plataforma: NodeJS.Platform; uid: number };
type Hora = { h: number; m: number };

const NOMBRE_LAUNCHD = "ar.rastro.daily";
const DIAS_SYSTEMD = "Mon..Fri";
const DIAS_HABILES = [1, 2, 3, 4, 5];
const TIMEOUT = 10_000;
const NOMBRES: Record<Tipo, string> = { systemd: "un timer de systemd de usuario", launchd: "launchd", crontab: "crontab" };

const SIN_PROGRAMADOR = `No encontré ningún programador para el daily automático (ni systemd de usuario, ni launchd, ni crontab). Rastro sigue andando sin él: \`rastro daily\` a mano, o "cerrá el día" con el plugin. Para tenerlo, instalá uno:
  - systemd: suele venir con la distribución; en WSL, activalo en /etc/wsl.conf (\`[boot]\` con \`systemd=true\`) y reiniciá WSL.
  - Debian o Ubuntu: \`sudo apt install cron\` y \`sudo systemctl enable --now cron\`
  - Arch: \`sudo pacman -S cronie\` y \`sudo systemctl enable --now cronie\`
  - Fedora: \`sudo dnf install cronie\` y \`sudo systemctl enable --now crond\`
Después corré \`rastro cron instalar\`.
`;

function rutasDelProgramador(home: string): { service: string; timer: string; plist: string } {
  const unidades = join(home, ".config", "systemd", "user");
  return { service: join(unidades, "rastro-daily.service"), timer: join(unidades, "rastro-daily.timer"), plist: join(home, "Library", "LaunchAgents", `${NOMBRE_LAUNCHD}.plist`) };
}

const dosDigitos = (n: number): string => String(n).padStart(2, "0");
const horaTexto = ({ h, m }: Hora): string => `${dosDigitos(h)}:${dosDigitos(m)}`;

// systemd interpreta `%` (especificadores) en todos los valores, y `\`, `"` y `$` dentro de ExecStart.
const palabraSystemd = (t: string): string => `"${t.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%").replaceAll("$", "$$$$")}"`;
const asignacionSystemd = (clave: string, valor: string): string => `Environment="${clave}=${valor.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
const rutaSystemd = (t: string): string => t.replaceAll("%", "%%");

export function servicioSystemd(o: { dir: string; log: string; node: string; bin: string; path: string; claudeConfigDir?: string }): string {
  const entorno = [asignacionSystemd("RASTRO_HOME", o.dir), asignacionSystemd("PATH", o.path), ...(o.claudeConfigDir === undefined ? [] : [asignacionSystemd("CLAUDE_CONFIG_DIR", o.claudeConfigDir)])];
  return [
    "[Unit]",
    "Description=Rastro: daily automático",
    "",
    "[Service]",
    "Type=oneshot",
    `ExecStart=${palabraSystemd(o.node)} ${palabraSystemd(o.bin)} daily`,
    `WorkingDirectory=${rutaSystemd(o.dir)}`,
    ...entorno,
    `StandardOutput=append:${rutaSystemd(o.log)}`,
    `StandardError=append:${rutaSystemd(o.log)}`,
    "",
  ].join("\n");
}

export function timerSystemd({ h, m }: Hora): string {
  return [
    "[Unit]",
    "Description=Rastro: daily automático, de lunes a viernes",
    "",
    "[Timer]",
    `OnCalendar=${DIAS_SYSTEMD} *-*-* ${dosDigitos(h)}:${dosDigitos(m)}:00`,
    "Persistent=true",
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}

const escaparXml = (t: string): string => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const cadena = (t: string): string => `<string>${escaparXml(t)}</string>`;

export function plistLaunchd({ h, m }: Hora, o: { dir: string; log: string; node: string; bin: string; path: string; claudeConfigDir?: string }): string {
  const variables: [string, string][] = [["RASTRO_HOME", o.dir], ["PATH", o.path], ...(o.claudeConfigDir === undefined ? [] : [["CLAUDE_CONFIG_DIR", o.claudeConfigDir] as [string, string]])];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    `  <key>Label</key>\n  ${cadena(NOMBRE_LAUNCHD)}`,
    "  <key>ProgramArguments</key>",
    `  <array>\n    ${cadena(o.node)}\n    ${cadena(o.bin)}\n    ${cadena("daily")}\n  </array>`,
    `  <key>WorkingDirectory</key>\n  ${cadena(o.dir)}`,
    "  <key>EnvironmentVariables</key>",
    `  <dict>\n${variables.map(([k, v]) => `    <key>${escaparXml(k)}</key>\n    ${cadena(v)}`).join("\n")}\n  </dict>`,
    "  <key>StartCalendarInterval</key>",
    `  <array>\n${DIAS_HABILES.map((d) => `    <dict>\n      <key>Weekday</key>\n      <integer>${d}</integer>\n      <key>Hour</key>\n      <integer>${h}</integer>\n      <key>Minute</key>\n      <integer>${m}</integer>\n    </dict>`).join("\n")}\n  </array>`,
    `  <key>StandardOutPath</key>\n  ${cadena(o.log)}`,
    `  <key>StandardErrorPath</key>\n  ${cadena(o.log)}`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function horaDelTimer(texto: string): string | null {
  const p = /^OnCalendar=Mon\.\.Fri \*-\*-\* (\d{2}):(\d{2}):00$/m.exec(texto);
  return p === null ? null : `${p[1] ?? ""}:${p[2] ?? ""}`;
}

function horaDelPlist(texto: string): string | null {
  const p = /<key>Hour<\/key>\s*<integer>(\d+)<\/integer>\s*<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/.exec(texto);
  return p === null ? null : `${(p[1] ?? "").padStart(2, "0")}:${(p[2] ?? "").padStart(2, "0")}`;
}

/** Corre un comando del programador: `null` si el binario no existe, porque eso es "no hay programador" y no un fallo. */
async function correr(ejecutar: Ejecutor, bin: string, args: string[]): Promise<{ codigo: number | null; stderr: string } | null> {
  try {
    const r = await ejecutar(bin, args, "", TIMEOUT);
    return { codigo: r.codigo, stderr: r.stderr };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ErrorUsuario(`No pude correr ${bin}.`, { cause: e });
  }
}

async function exigir(ejecutar: Ejecutor, bin: string, args: string[]): Promise<void> {
  const r = await correr(ejecutar, bin, args);
  if (r === null || r.codigo !== 0) {
    const detalle = r?.stderr.trim().split("\n")[0] ?? "";
    throw new ErrorUsuario(`No pude instalar el daily automático: \`${bin} ${args.join(" ")}\` ${r === null ? "no existe" : `salió con ${String(r.codigo)}`}${detalle === "" ? "" : ` (${detalle})`}.`);
  }
}

async function detectar(ejecutar: Ejecutor, plataforma: NodeJS.Platform, hayCrontab: boolean): Promise<Tipo | null> {
  if (plataforma === "linux") {
    const r = await correr(ejecutar, "systemctl", ["--user", "show-environment"]);
    if (r?.codigo === 0) return "systemd";
  }
  if (plataforma === "darwin") return "launchd";
  return hayCrontab ? "crontab" : null;
}

async function instalarSystemd(ejecutar: Ejecutor, o: Opciones, hora: Hora, e: EntornoCron, abs: { dir: string; log: string }): Promise<void> {
  const r = rutasDelProgramador(o.home);
  mkdirSync(dirname(r.service), { recursive: true });
  writeFileSync(r.service, servicioSystemd({ ...abs, ...e }));
  writeFileSync(r.timer, timerSystemd(hora));
  await exigir(ejecutar, "systemctl", ["--user", "daemon-reload"]);
  await exigir(ejecutar, "systemctl", ["--user", "enable", "--now", "rastro-daily.timer"]);
  // `enable --now` no toca un timer que ya estaba activo: sin el restart, reinstalar con otra hora seguiría con la anterior.
  await exigir(ejecutar, "systemctl", ["--user", "restart", "rastro-daily.timer"]);
}

async function quitarSystemd(ejecutar: Ejecutor, o: Opciones): Promise<boolean> {
  const r = rutasDelProgramador(o.home);
  if (!existsSync(r.timer) && !existsSync(r.service)) return false;
  // Si el timer ya estaba deshabilitado, systemd no responde o no existe (macOS), igual hay que sacar los archivos: son lo que Rastro escribió.
  await correr(ejecutar, "systemctl", ["--user", "disable", "--now", "rastro-daily.timer"]);
  rmSync(r.timer, { force: true });
  rmSync(r.service, { force: true });
  await correr(ejecutar, "systemctl", ["--user", "daemon-reload"]);
  return true;
}

async function bootout(ejecutar: Ejecutor, o: Opciones): Promise<void> {
  // Si el agente no estaba cargado, `bootout` falla: es lo esperado en la primera instalación y al quitar algo ya quitado.
  await correr(ejecutar, "launchctl", ["bootout", `gui/${o.uid}/${NOMBRE_LAUNCHD}`]);
}

async function instalarLaunchd(ejecutar: Ejecutor, o: Opciones, hora: Hora, e: EntornoCron, abs: { dir: string; log: string }): Promise<void> {
  const { plist } = rutasDelProgramador(o.home);
  mkdirSync(dirname(plist), { recursive: true });
  writeFileSync(plist, plistLaunchd(hora, { ...abs, ...e }));
  await bootout(ejecutar, o);
  await exigir(ejecutar, "launchctl", ["bootstrap", `gui/${o.uid}`, plist]);
}

async function quitarLaunchd(ejecutar: Ejecutor, o: Opciones): Promise<boolean> {
  const { plist } = rutasDelProgramador(o.home);
  if (!existsSync(plist)) return false;
  if (o.plataforma === "darwin") await bootout(ejecutar, o);
  rmSync(plist, { force: true });
  return true;
}

async function quitarCrontab(ejecutar: Ejecutor, viejo: string | null): Promise<boolean> {
  if (viejo === null || !viejo.split("\n").some(esDeRastro)) return false;
  await escribirCrontab(ejecutar, crontabNuevo(viejo, null));
  return true;
}

function lineasViejas(viejo: string | null): string {
  const viejas = viejo === null ? [] : reposDeLineasViejas(viejo);
  if (viejas.length === 0) return "";
  const plural = viejas.length === 1 ? "" : "s";
  return `Hay ${viejas.length} línea${plural} vieja${plural} por repo (${viejas.join(", ")}) que también corre${viejas.length === 1 ? "" : "n"} el daily de todos los repos: \`rastro cron quitar\` o \`rastro cron instalar\` ${viejas.length === 1 ? "la saca" : "las saca"}.\n`;
}

async function estado(ejecutar: Ejecutor, o: Opciones, viejo: string | null, log: string): Promise<string> {
  const r = rutasDelProgramador(o.home);
  const cola = lineasViejas(viejo);
  const donde = `La salida queda en ${log}.`;
  if (existsSync(r.timer)) {
    const hora = horaDelTimer(readFileSync(r.timer, "utf8")) ?? "una hora que no pude leer";
    const habilitado = (await correr(ejecutar, "systemctl", ["--user", "is-enabled", "rastro-daily.timer"]))?.codigo === 0;
    return `El daily automático está instalado con ${NOMBRES.systemd}${habilitado ? "" : ", pero deshabilitado (`rastro cron instalar` lo vuelve a habilitar)"}: de lunes a viernes a las ${hora}. ${donde}\n${cola}`;
  }
  if (existsSync(r.plist)) {
    const hora = horaDelPlist(readFileSync(r.plist, "utf8")) ?? "una hora que no pude leer";
    return `El daily automático está instalado con ${NOMBRES.launchd}: de lunes a viernes a las ${hora}. ${donde}\n${cola}`;
  }
  const hora = viejo === null ? null : horaInstalada(viejo);
  if (hora !== null) return `El daily automático está instalado con ${NOMBRES.crontab}: de lunes a viernes a las ${hora}. ${donde}\n${cola}`;
  if ((await detectar(ejecutar, o.plataforma, viejo !== null)) === null) return `El daily automático no está instalado.\n${SIN_PROGRAMADOR}${cola}`;
  return `El daily automático no está instalado. Instalalo con \`rastro cron instalar\`.\n${cola}`;
}

/**
 * La hora del daily automático instalado, solo leyendo: nunca escribe ni toca el programador.
 * `crontab` es lazy porque leerlo lanza un proceso y solo hace falta si no hay timer ni agente.
 */
export async function horaDelDailyAutomatico(home: string, crontab: () => Promise<string | null>): Promise<string | null> {
  const r = rutasDelProgramador(home);
  if (existsSync(r.timer)) return horaDelTimer(readFileSync(r.timer, "utf8"));
  if (existsSync(r.plist)) return horaDelPlist(readFileSync(r.plist, "utf8"));
  const viejo = await crontab();
  return viejo === null ? null : horaInstalada(viejo);
}

/** Con el programador y el crontab reales: lo usa el central de `rastro start` y `rastro serve`. */
export function horaDelDailyReal(): Promise<string | null> {
  return horaDelDailyAutomatico(homedir(), async () => {
    try {
      return await leerCrontab(ejecutarProceso);
    } catch (e) {
      // Un crontab ilegible no puede romper el dashboard: sin la hora, la pantalla solo ofrece el comando manual.
      if (e instanceof ErrorUsuario) return null;
      throw e;
    }
  });
}

/** `entorno` es lazy: mostrar el estado o quitar no exige `claude`. */
export async function programador(args: string[], ejecutar: Ejecutor, entorno: () => EntornoCron, o: Opciones): Promise<string> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { hora: { type: "string" } } });
  const [accion, ...sobran] = positionals;
  if (sobran.length > 0 || (values.hora !== undefined && accion !== "instalar")) throw new ErrorUsuario("Uso: rastro cron [instalar [--hora HH:MM] | quitar]");
  if (accion === "instalar") reposObservados();
  const { dir, cronLog } = rutasGlobales();
  const abs = { dir: resolve(dir), log: resolve(cronLog) };
  if (abs.dir.includes("\n")) throw new ErrorUsuario("La ruta de la carpeta de Rastro no puede tener saltos de línea.");

  // Un crontab roto solo frena el caso `crontab`: con systemd o launchd se avisa y se sigue, porque el timer no depende de él.
  let viejo: string | null = null;
  let fallo: ErrorUsuario | null = null;
  try {
    viejo = await leerCrontab(ejecutar);
  } catch (e) {
    if (!(e instanceof ErrorUsuario)) throw e;
    fallo = e;
  }
  if (fallo !== null && (await detectar(ejecutar, o.plataforma, true)) === "crontab") throw fallo;
  const aviso = fallo === null ? "" : `Aviso: no pude limpiar el crontab: ${fallo.message}\n`;
  if (accion === undefined) return `${await estado(ejecutar, o, viejo, abs.log)}${aviso}`;

  if (accion === "instalar") {
    const horaTextoPedida = values.hora ?? HORA_POR_DEFECTO;
    const hora = parsearHora(horaTextoPedida);
    const tipo = await detectar(ejecutar, o.plataforma, viejo !== null || fallo !== null);
    // No es un error: `/rastro:init` tiene que seguir con los demás pasos aunque la máquina no tenga programador.
    if (tipo === null) return SIN_PROGRAMADOR;
    const e = entorno();
    for (const [nombre, valor] of [["node", e.node], ["el bin de Rastro", e.bin], ["PATH", e.path], ["CLAUDE_CONFIG_DIR", e.claudeConfigDir]] as const) {
      if (valor?.includes("\n") === true) throw new ErrorUsuario(`${nombre} tiene un salto de línea: no puedo instalar el daily automático con eso.`);
    }
    if (tipo === "systemd") await instalarSystemd(ejecutar, o, hora, e, abs);
    else if (tipo === "launchd") await instalarLaunchd(ejecutar, o, hora, e, abs);
    else await escribirCrontab(ejecutar, crontabNuevo(viejo ?? "", lineaDeCron({ ...abs, ...e, hora: horaTextoPedida })));
    // Una sola tarea: lo que quede de otro programador (o las líneas por repo de la versión anterior) correría el daily dos veces.
    if (tipo !== "crontab" && fallo === null) await quitarCrontab(ejecutar, viejo);
    if (tipo !== "systemd") await quitarSystemd(ejecutar, o);
    if (tipo !== "launchd") await quitarLaunchd(ejecutar, o);
    const linger = tipo === "systemd" ? " Si a esa hora no tenés la sesión iniciada, `loginctl enable-linger` lo deja correr igual (Rastro no lo corre por vos)." : "";
    return `Daily automático instalado con ${NOMBRES[tipo]}: de lunes a viernes a las ${horaTexto(hora)}. La salida queda en ${abs.log}.${linger}\n${aviso}`;
  }
  if (accion === "quitar") {
    const sacados = [await quitarSystemd(ejecutar, o), await quitarLaunchd(ejecutar, o), await quitarCrontab(ejecutar, viejo)];
    return `${sacados.some(Boolean) ? "Daily automático quitado.\n" : "No había un daily automático.\n"}${aviso}`;
  }
  throw new ErrorUsuario(`Acción desconocida "${accion}": usá instalar o quitar.`);
}

export async function cmdCron(args: string[]): Promise<number> {
  const uid = process.getuid?.();
  if (uid === undefined) throw new ErrorUsuario("El daily automático no está disponible en este sistema.");
  process.stdout.write(await programador(args, ejecutarProceso, entornoReal, { home: homedir(), plataforma: process.platform, uid }));
  return 0;
}
