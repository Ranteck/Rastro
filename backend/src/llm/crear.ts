import type { Config } from "../config.ts";
import { ClaudeCli } from "./claudeCli.ts";
import type { Llm } from "./llm.ts";

export function crearLlm(config: Config): Llm | null {
  return config.llm.proveedor === "ninguno" ? null : new ClaudeCli({ modelo: config.llm.modelo });
}
