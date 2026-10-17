import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { leerConfig, rutasGlobales } from "../config.ts";
import { reposObservados } from "../daily.ts";
import { ErrorUsuario } from "../errores.ts";
import { Almacen } from "./almacen.ts";
import { crearCentral } from "./servidor.ts";

export const ESTATICOS = fileURLToPath(new URL("../../../frontend/dist", import.meta.url));

export type OpcionesServe = { estaticos?: string; alEscuchar?: (puerto: number) => Promise<void>; horaDaily?: () => Promise<string | null> };

export async function cmdServe(args: string[], extra: OpcionesServe = {}): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      puerto: { type: "string", default: "4317" },
      personal: { type: "boolean", default: false },
      datos: { type: "string", default: join(homedir(), ".local", "share", "rastro-central") },
    },
  });
  const puerto = Number(values.puerto);
  if (!Number.isInteger(puerto) || puerto < 0 || puerto > 65535) throw new ErrorUsuario("--puerto tiene que ser un número entre 0 y 65535.");
  // Modo personal: se valida que haya repos y config antes de abrir el puerto.
  if (values.personal) {
    reposObservados();
    leerConfig();
  }
  const servidor = crearCentral({ almacen: new Almacen(values.datos), estaticos: extra.estaticos ?? ESTATICOS, ...(values.personal ? { personal: extra.horaDaily === undefined ? {} : { horaDaily: extra.horaDaily } } : {}) });
  try {
    // Solo localhost: el central no tiene autenticación (ver Concerns del spec).
    await new Promise<void>((resolve, reject) => {
      servidor.once("error", reject);
      servidor.listen(puerto, "127.0.0.1", resolve);
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") throw new ErrorUsuario(`El puerto ${puerto} está ocupado: probá con --puerto.`, { cause: e });
    throw e;
  }
  const puertoReal = (servidor.address() as AddressInfo).port;
  process.stdout.write(`Central de Rastro en http://127.0.0.1:${puertoReal} (datos en ${values.datos}${values.personal ? `; modo personal sobre ${rutasGlobales().dir}` : ""}). Ctrl+C para salir.\n`);
  await extra.alEscuchar?.(puertoReal);
  await new Promise<void>((resolve) => {
    const cerrar = (): void => {
      servidor.close(() => resolve());
    };
    process.once("SIGINT", cerrar);
    process.once("SIGTERM", cerrar);
  });
  return 0;
}
