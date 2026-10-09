import { parseArgs } from "node:util";
import { ConectorCentral } from "../conectores/central.ts";
import { fechaLocal } from "../fechas.ts";
import { snapshotsDemo } from "./demo.ts";

const ZONA_DEMO = "America/Argentina/Buenos_Aires";

export async function cmdSeedDemo(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { central: { type: "string", default: "http://127.0.0.1:4317" } } });
  const ahora = new Date();
  const conector = new ConectorCentral(values.central);
  for (const s of snapshotsDemo(fechaLocal(ahora, ZONA_DEMO), ahora)) process.stdout.write(`✓ ${s.persona.nombre}: ${await conector.publicar(s)}\n`);
  return 0;
}
