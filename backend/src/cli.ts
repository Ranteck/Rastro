import { ErrorUsuario } from "./errores.ts";
import { log } from "./log.ts";

export type Comando = (args: string[]) => Promise<number>;

const AYUDA = `rastro: memoria de equipo con evidencia

Uso:
  rastro init [--equipo <nombre>]          Prepara el repo y los hooks
  rastro hook commit | session-end         Lo llaman los hooks
  rastro plan <propuesta.md> | --sugerir   Arma o sugiere el plan de la semana
  rastro daily [--desde AAAA-MM-DD]        Genera .rastro/state.json
  rastro publish [--yes]                   Publica en los conectores
  rastro serve [--puerto N] [--datos dir]  Levanta el central
  rastro seed-demo [--central url]         Publica compañeros de ejemplo
`;

// Carga diferida: el hook de cada commit solo importa lo que usa.
const comandos: Readonly<Record<string, () => Promise<Comando>>> = {
  init: async () => (await import("./init.ts")).cmdInit,
  hook: async () => (await import("./hooks.ts")).cmdHook,
  daily: async () => (await import("./daily.ts")).cmdDaily,
};

export async function main(argv: string[]): Promise<number> {
  const [nombre, ...resto] = argv;
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
    log("error", "fallo_inesperado", { comando: nombre, detalle: e instanceof Error ? e.message : String(e) });
    if (e instanceof Error && e.stack !== undefined) log("debug", "stack", { stack: e.stack });
    process.stderr.write("rastro: error inesperado; corré con RASTRO_LOG=debug para ver el detalle.\n");
    return 1;
  }
}
