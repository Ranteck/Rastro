import { ErrorUsuario } from "./errores.ts";
import { log } from "./log.ts";
import { versionDeRastro } from "./version.ts";

export type Comando = (args: string[]) => Promise<number>;

const AYUDA = `rastro ${versionDeRastro()}: tu plan de la semana contra lo que pasó en el código, con evidencia

Uso:
  rastro init [--equipo <nombre>]          Prepara el repo y los hooks
  rastro hook commit | session-end         Lo llaman los hooks
  rastro plan <propuesta.md> | --sugerir | --confirmar
                                           Propone, sugiere o confirma el plan de la semana
  rastro plan --desde-proyecto [--propuesta <archivo>] [--confirmar]
                                           Sugiere tareas desde la propuesta, el intent y el git del repo (con --confirmar acepta los ofrecimientos del repo)
  rastro plan cambiar <tipo> <tarea|sha|id> <valor> [--propuesta] [--confirmar]
  rastro plan cambiar --json [--propuesta] [--confirmar]
                                           Cambia duración, día, estado, repo (nombre|ninguno), vínculo u ofrecimiento (vista previa sin --confirmar; --json lee la lista por stdin)
  rastro plan sincronizar [--confirmar] [--usar notion|rastro]
                                           Lee el plan de Notion y lo deja igual al de Rastro (adopta lo que cambió en Notion; publica lo de Rastro solo con --confirmar)
  rastro aviso                             Imprime los desvíos de ahora (sin LLM ni red)
  rastro siguiente [--si-registrado]       Imprime la tarea actual, la siguiente, las atrasadas y lo que no entra (sin LLM ni red; con --si-registrado, no imprime nada fuera de un repo registrado)
  rastro daily [--desde AAAA-MM-DD]        Genera ~/.rastro/state.json
  rastro daily --para-pegar [tarea]        Imprime la bitácora del último daily, por tarea (o de una), para pegar
  rastro cron [instalar [--hora HH:MM] | quitar]
                                           Instala, quita o muestra el daily automático global de lunes a viernes (18:30 por defecto) con el programador de la máquina: un timer de systemd de usuario, launchd o crontab; la salida queda en cron.log de la carpeta de Rastro
  rastro publish [--yes]                   Publica en los conectores
  rastro serve [--puerto N] [--datos dir] [--personal]
                                           Levanta el central (con --personal, en modo personal sobre tu plan global)
  rastro start [--puerto N] [--sin-navegador]
                                           Levanta el central personal y abre el dashboard en el navegador
  rastro seed-demo [--central url]         Publica compañeros de ejemplo
  rastro --version                         Imprime la versión
`;

// Carga diferida: el hook de cada commit solo importa lo que usa.
const comandos: Readonly<Record<string, () => Promise<Comando>>> = {
  init: async () => (await import("./init.ts")).cmdInit,
  hook: async () => (await import("./hooks.ts")).cmdHook,
  aviso: async () => (await import("./aviso.ts")).cmdAviso,
  siguiente: async () => (await import("./aviso.ts")).cmdSiguiente,
  daily: async () => (await import("./daily.ts")).cmdDaily,
  cron: async () => (await import("./programador.ts")).cmdCron,
  plan: async () => (await import("./planCmd.ts")).cmdPlan,
  serve: async () => {
    const [{ cmdServe }, { horaDelDailyReal }] = await Promise.all([import("./central/cmd.ts"), import("./programador.ts")]);
    return (args: string[]) => cmdServe(args, { horaDaily: horaDelDailyReal });
  },
  start: async () => (await import("./start.ts")).cmdStart,
  publish: async () => (await import("./publish.ts")).cmdPublish,
  "seed-demo": async () => (await import("./central/seed.ts")).cmdSeedDemo,
};

export async function main(argv: string[]): Promise<number> {
  const [nombre, ...resto] = argv;
  if (nombre === "--version") {
    process.stdout.write(`${versionDeRastro()}\n`);
    return 0;
  }
  if (nombre === undefined || nombre === "--help" || nombre === "-h") {
    process.stdout.write(AYUDA);
    return 0;
  }
  // hasOwn: "constructor" o "toString" no son comandos aunque el objeto los herede.
  const cargar = Object.hasOwn(comandos, nombre) ? comandos[nombre] : undefined;
  if (cargar === undefined) {
    process.stderr.write(`Comando desconocido: ${nombre}\n\n${AYUDA}`);
    return 2;
  }
  try {
    return await (await cargar())(resto);
  } catch (e) {
    if (e instanceof ErrorUsuario) {
      process.stderr.write(`rastro: ${e.message}\n`);
      return 1;
    }
    if (e instanceof Error && (e as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS_") === true) {
      process.stderr.write(`rastro: ${e.message}\n\n${AYUDA}`);
      return 2;
    }
    log("error", "fallo_inesperado", { comando: nombre, detalle: e instanceof Error ? e.message : String(e) });
    if (e instanceof Error && e.stack !== undefined) log("debug", "stack", { stack: e.stack });
    process.stderr.write("rastro: error inesperado; corré con RASTRO_LOG=debug para ver el detalle.\n");
    return 1;
  }
}
