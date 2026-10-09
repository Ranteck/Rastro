import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ErrorUsuario } from "../errores.ts";
import { Almacen } from "./almacen.ts";
import { crearCentral } from "./servidor.ts";

export const ESTATICOS = fileURLToPath(new URL("../../../frontend/dist", import.meta.url));

export async function cmdServe(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      puerto: { type: "string", default: "4317" },
      datos: { type: "string", default: join(homedir(), ".local", "share", "rastro-central") },
    },
  });
  const puerto = Number(values.puerto);
  if (!Number.isInteger(puerto) || puerto < 0 || puerto > 65535) throw new ErrorUsuario("--puerto tiene que ser un número entre 0 y 65535.");
  const servidor = crearCentral({ almacen: new Almacen(values.datos), estaticos: ESTATICOS });
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
  process.stdout.write(`Central de Rastro en http://127.0.0.1:${(servidor.address() as AddressInfo).port} (datos en ${values.datos}). Ctrl+C para salir.\n`);
  await new Promise<void>((resolve) => {
    const cerrar = (): void => {
      servidor.close(() => resolve());
    };
    process.once("SIGINT", cerrar);
    process.once("SIGTERM", cerrar);
  });
  return 0;
}
