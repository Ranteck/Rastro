import { parseArgs } from "node:util";
import { ConectorCentral, ErrorConexionCentral } from "../conectores/central.ts";
import { ErrorUsuario } from "../errores.ts";
import { fechaLocal } from "../fechas.ts";
import { snapshotsDemo } from "./demo.ts";

const ZONA_DEMO = "America/Argentina/Buenos_Aires";

export async function cmdSeedDemo(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { central: { type: "string", default: "http://127.0.0.1:4317" } } });
  const ahora = new Date();
  const conector = new ConectorCentral(values.central);
  try {
    for (const s of snapshotsDemo(fechaLocal(ahora, ZONA_DEMO), ahora)) process.stdout.write(`✓ ${s.persona.nombre}: ${await conector.publicar(s)}\n`);
  } catch (e) {
    if (e instanceof ErrorConexionCentral) throw new ErrorUsuario(`No pude conectar con el central en ${values.central}; levantá \`rastro serve\` primero.`, { cause: e });
    throw e;
  }
  return 0;
}
