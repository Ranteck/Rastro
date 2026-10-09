import { rutas, type Config } from "../config.ts";
import { ConectorCentral } from "./central.ts";
import type { Conector } from "./conector.ts";
import { ConectorNotionClaude, ConectorNotionMock } from "./notion.ts";

export function crearConectores(config: Config, repo: string): Conector[] {
  return config.conectores.map((nombre): Conector => {
    if (nombre === "central") return new ConectorCentral(config.central.url);
    return config.notion.modo === "claude" ? new ConectorNotionClaude({ modelo: config.llm.modelo }) : new ConectorNotionMock(rutas(repo).notionPreview);
  });
}
