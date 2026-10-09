import { rutas, type Config } from "../config.ts";
import { ConectorCentral } from "./central.ts";
import type { Conector } from "./conector.ts";
import { ConectorNotionMock } from "./notion.ts";

export function crearConectores(config: Config, repo: string): Conector[] {
  return config.conectores.map(
    (nombre): Conector => (nombre === "central" ? new ConectorCentral(config.central.url) : new ConectorNotionMock(rutas(repo).notionPreview)),
  );
}
