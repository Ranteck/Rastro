import type { Costo } from "../../src/contract/snapshot.ts";
import { ErrorLlm, type Llm, type PedidoLlm } from "../../src/llm/llm.ts";

/** LLM falso: responde por nombre de uso, o falla siempre con "falla". */
export class FakeLlm implements Llm {
  readonly usos: string[] = [];
  readonly prompts: string[] = [];
  readonly #respuestas: Readonly<Record<string, unknown>> | "falla";

  constructor(respuestas: Readonly<Record<string, unknown>> | "falla") {
    this.#respuestas = respuestas;
  }

  async completar<T>(pedido: PedidoLlm<T>): Promise<T> {
    this.usos.push(pedido.uso);
    this.prompts.push(pedido.prompt);
    if (this.#respuestas === "falla") throw new ErrorLlm(`${pedido.uso}: falla simulada`);
    const respuesta = this.#respuestas[pedido.uso];
    if (respuesta === undefined) throw new ErrorLlm(`${pedido.uso}: sin respuesta simulada`);
    return pedido.validar(respuesta, pedido.uso);
  }

  costo(): Costo {
    return { llamadas: this.usos.length, usd: 0, tokens: 0 };
  }
}
