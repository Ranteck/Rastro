import type { Costo } from "../contract/snapshot.ts";
import type { Check } from "../contract/validar.ts";

export type PedidoLlm<T> = {
  /** Nombre del uso ("bitacora", "vinculos"...): aparece en logs y en el LLM falso de los tests. */
  uso: string;
  sistema: string;
  prompt: string;
  esquema: Record<string, unknown>;
  validar: Check<T>;
};

export interface Llm {
  completar<T>(pedido: PedidoLlm<T>): Promise<T>;
  costo(): Costo;
}

export class ErrorLlm extends Error {
  override name = "ErrorLlm";
}
